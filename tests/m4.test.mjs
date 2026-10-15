// M4 扫描与改写规则的回归测试。
//
// 这几条规则每一条放宽都会直接改变「哪些英文字符串会被写进 47 MB 的 bundle」，
// 改错了的代价是 Cursor 白屏或主题/遥测错乱，所以边界必须锁死在用例里。

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isUiText, scanBundle, collectUiConstants, collectIdentityValues } from "../src/m4/scan.mjs";
import { patchBundle } from "../src/m4/patch.mjs";
import { validateM4Dict } from "../src/m4/dict.mjs";
import { applyChecksumUpdates, assertIntegrity } from "../src/m4/integrity.mjs";
import { loadOriginalNlsEnglish } from "../src/m4/nlsbase.mjs";
import { base64Sha256 } from "../src/deploy/backup.mjs";
import { M4_TARGETS, checksumKey } from "../src/m4/targets.mjs";
import { FONT_CSS_REL, FONT_MARK, applyFontFix } from "../src/m4/fontfix.mjs";
import { installBundles, installFontFix, assertSyntax } from "../src/m4/deploy.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

test("isUiText：单词型标签放行，标识符风格仍挡下", () => {
  // 放行：首字母大写的纯英文单词（Settings 侧栏、列头、按钮）
  for (const s of ["Search", "Save", "Back", "Agents", "Repositories", "Dockerfile"]) {
    assert.equal(isUiText(s), true, `${s} 应放行`);
  }
  // 挡下：全小写、全大写、含数字、含大小写混排 —— 这些是标识符不是文案
  for (const s of ["search", "SEARCH", "OK", "utf8", "GitHub", "CSS3", "a11y"]) {
    assert.equal(isUiText(s), false, `${s} 应挡下`);
  }
  // 多词文案走原来的通路，不受影响
  assert.equal(isUiText("Start from scratch"), true);
});

test("collectUiConstants：只在界面字段用过的常量才收", () => {
  const src = `
    Sye="Start from scratch",ATe="No Repo",Mrl="New Chat",Zz="Cursor Tab";
    a={children:Sye};
    b={label:ATe};
    c={name:Zz};
    d=[ATe,"none","home"];
  `;
  const got = collectUiConstants(src);

  assert.equal(got.get("Sye"), "Start from scratch", "只在 children 用过 → 收");
  assert.equal(got.has("Mrl"), false, "没有任何字段用法 → 无法判定，不收");
  assert.equal(got.has("Zz"), false, "出现在 name（NEVER）→ 同一个常量还兼作数据标识，不收");
  assert.equal(got.has("ATe"), false, "出现在数组裸值位置 → 可能参与等值判断，不收");
});

test("scanBundle：同一个英文串只在 UI 字段那一处命中", () => {
  const src = `x={label:"Search"},y={value:"Search"},z={children:"Search"}`;
  const hits = scanBundle(src);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.field), ["label", "children"]);
});

test("patchBundle：位置精确替换，value 里的同名字符串不动", () => {
  const src = `x={label:"Search"},y={value:"Search"}`;
  const r = patchBundle(src, { Search: "搜索" });
  assert.equal(r.changed, 1);
  assert.equal(r.source, `x={label:"搜索"},y={value:"Search"}`);
});

test("patchBundle：常量型命中在定义处改写，全篇一致", () => {
  const src = `Sye="Start from scratch";a={children:Sye};b={tooltip:Sye}`;
  const r = patchBundle(src, { "Start from scratch": "从头开始" });
  assert.equal(r.changed, 1);
  assert.equal(r.source, `Sye="从头开始";a={children:Sye};b={tooltip:Sye}`);
});

test("patchBundle：译文里的引号一律转义，产物仍是合法 JS", () => {
  // 两种引号都转义：非定界符那个多一个反斜杠，在 JS 里同样合法（'\'' 与 "\"" 等价），
  // 换来的是不必判断当前定界符是哪个。
  assert.equal(patchBundle(`x={label:'Say "hi"'}`, { 'Say "hi"': '说"你好"' }).source,
    String.raw`x={label:'说\"你好\"'}`);
  assert.equal(patchBundle(`x={label:"Quote me"}`, { "Quote me": '他说"好"' }).source,
    String.raw`x={label:"他说\"好\""}`);
  assert.equal(patchBundle(`x={label:'Ab cd'}`, { "Ab cd": "甲'乙" }).source,
    String.raw`x={label:'甲\'乙'}`);
});

test("产出词典自洽：无自身映射、无与跳过清单重叠、校验零错误", () => {
  const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "data/m4.json"), "utf8"));
  const skipped = JSON.parse(fs.readFileSync(path.join(ROOT, "data/m4-skipped.json"), "utf8"));

  const selfMap = Object.entries(dict).filter(([en, zh]) => en === zh);
  assert.deepEqual(selfMap, [], "「译文=原文」是无意义的自我替换，应移入跳过清单");

  const both = Object.keys(dict).filter((en) => skipped[en] !== undefined);
  assert.deepEqual(both, [], "同一条不能既在译文表又在跳过清单");

  const { errors } = validateM4Dict(dict);
  assert.deepEqual(errors, []);

  assert.ok(Object.keys(dict).length > 0);
});

test("collectIdentityValues：字段的取值一旦参与等值比较就被记为标识", () => {
  const src = `x={label:"Task"};f=function(e){return e.label==="Task"};
             y={label:"Save"};g=function(e){return e.label.startsWith("Save")};
             h=function(e){return e["label"]!=="Cancel"};k=function(e){return e.label===Sye};
             Sye="Cancel";`;
  const ids = collectIdentityValues(src, new Map([["Sye", "Cancel"]]));

  for (const s of ["Task", "Save", "Cancel"]) {
    assert.ok(ids.byField.get("label")?.has(s), `${s} 应被记为 label 的标识值`);
  }
  // 别的字段不受牵连：label 上的比较不该让 children 下的同名字面量失效
  assert.equal(ids.byField.get("children"), undefined);
});

test("scanBundle：参与过等值比较的字段值不再当文案，未参与的照常命中", () => {
  const src = `a={label:"Task"},b={label:"Save"},c={children:"Sync"},
             f=function(e){return e.label==="Task"}`;
  // Task 被 e.label==="Task" 引用 → 渲染侧也不翻；Save / Sync 无比较 → 照翻
  assert.deepEqual(scanBundle(src).map((h) => h.raw), ["Save", "Sync"]);
});

test("scanBundle：常量兼作比较对象时，它的定义处也不改", () => {
  const src = `Sye="Cancel";a={children:Sye};f=function(r){return r.label===Sye};
             Kye="Dismiss";b={children:Kye};`;
  // Sye 的取值 Cancel 参与过比较 → 整个常量按标识处理；Kye 没有 → 照改
  const hits = scanBundle(src).map((h) => h.raw);
  assert.deepEqual(hits, ["Dismiss"]);
});

test("scanBundle：同名文案出现在别的字段上不受守卫牵连", () => {
  const src = `a={label:"Ready"},b={children:"Ready"},f=function(e){return e.label==="Ready"}`;
  // 只有 label 这个字段被比较过，children 上的 Ready 仍然要翻
  assert.deepEqual(scanBundle(src).map((h) => [h.field, h.raw]), [["children", "Ready"]]);
});

test("collectUiConstants：var 声明列表不是数组元素，不再误挡常量", () => {
  const src = `var Sye,n_s,i_s;Sye="Start from scratch",n_s="Create a new chat";
             a={children:Sye};b={label:n_s};`;
  const got = collectUiConstants(src);
  // 早期把 `var Sye,n_s,i_s` 当成数组裸值位置，Sye 这类只在定义处出现的文案全被挡掉
  assert.equal(got.get("Sye"), "Start from scratch");
  assert.equal(got.get("n_s"), "Create a new chat");
});

test("scanBundle：title:{value,original} 只翻 value，两串不同则不认", () => {
  const same = `A=class{constructor(){super({id:x,title:{value:"New Chat",original:"New Chat"}})}}`;
  assert.deepEqual(scanBundle(same).map((h) => [h.field, h.raw]), [["title", "New Chat"]]);

  // 两个串不一样说明这不是那份成对的本地化结构（别处 value 是数字、original 是查表键），
  // 一律不动 —— 实测按 value 放宽会命中 {original:"Debug",value:D(2106)} 那种键值对。
  const diff = `B={title:{value:"New Chat",original:"New Chat Tab"}}`;
  assert.deepEqual(scanBundle(diff).map((h) => h.raw), []);
});

test("scanBundle：≥5 成员的 id→文案映射表整块收，短载荷不收", () => {
  const nav = `T={general:"General",profile:"Profile",appearance:"Appearance",models:"Models",docs:"Docs"}`;
  assert.deepEqual(scanBundle(nav).map((h) => [h.field, h.raw]), [
    ["general", "General"],
    ["profile", "Profile"],
    ["appearance", "Appearance"],
    ["models", "Models"],
    ["docs", "Docs"],
  ]);

  // 两三个成员的错误载荷长得一模一样，靠成员数区分：设置页那份导航表有 24 个成员
  assert.deepEqual(scanBundle(`P={message:"Something failed",error:"Timed out"}`).map((h) => h.raw), []);
});

test("scanBundle：命中的区间必须精确套住那个字面量", () => {
  // 键也带引号时，映射表的值位置不能靠 indexOf(引号) 找 —— 会落到键的开引号上，
  // 改写时把 "aria-la 截断，bundle 语法直接崩（实测在干跑时被 assertSyntax 拦下）。
  const src = `N={"general":"Pinned","docs":"Unpinned","profile":"Role","appearance":"Mode","models":"State"}`;
  const hits = scanBundle(src);
  assert.deepEqual(hits.map((h) => h.raw), ["Pinned", "Unpinned", "Role", "Mode", "State"]);
  for (const h of hits) {
    assert.equal(src.slice(h.start, h.end), h.quote + h.raw + h.quote, `区间没套住 ${h.raw}`);
  }
});

test("scanBundle：带引号的字段名折成驼峰再对白名单", () => {
  const src = `a={"aria-label":"Repositories"},b={"data-test":"Repositories"}`;
  // aria-label 是真实的无障碍标签；data-test 只是测试选择器，不在白名单里，不翻
  assert.deepEqual(scanBundle(src).map((h) => [h.field, h.raw]), [["ariaLabel", "Repositories"]]);
});

test("scanBundle：兜底与三元分支的默认文案，参与过等值判断的不翻", () => {
  const src = `f=function(e){return e.getComposerTitle()||"New Chat"};
             g=function(x){return x?"This PC":"This Mac"}`;
  assert.deepEqual(scanBundle(src).map((h) => h.raw), ["New Chat", "This PC", "This Mac"]);

  // 两个分支文案相同：必须记成两处独立命中，否则只会翻掉前一处、留下一处英文
  const twin = `h=function(x){return x?"Home":"Home"}`;
  const hits = scanBundle(twin);
  assert.equal(hits.length, 2, "同一文案的两个分支是两个替换点");
  assert.equal(hits[0].end <= hits[1].start, true, "两处命中不得重叠");

  // 只有 ? 后是字面量、: 后是变量 → 不认（那是取值的常见写法，翻了会改动语义）
  assert.deepEqual(scanBundle(`k=function(x,a){return x?"Yes":a}`).map((h) => h.raw), []);

  // 取值三元：只有一个分支像文案 → 不认。实测 e?"Top":"InlineStart" 是 CSS 方向值，
  // 翻了 "Top" 会让布局错位；真正的文案三元两边都像文案。
  assert.deepEqual(scanBundle(`m=function(e){const i=e?"Top":"InlineStart";return i}`).map((h) => h.raw), []);
  // 状态文案三元两边都像文案 → 照翻（枚举定义处不是命中位置，不会被改写）
  assert.deepEqual(scanBundle(`n=function(o){return o.isWeak?"Weak":"Strong"}`).map((h) => h.raw), ["Weak", "Strong"]);

  // Cancel 在别处被 label 比较过 → 按标识处理，兜底处也不能翻
  const guarded = `h={label:"Cancel"},k=function(e){return e.label==="Cancel"},m=function(x){return x||"Cancel"}`;
  assert.deepEqual(scanBundle(guarded).map((h) => h.raw), []);
});

test("scanBundle：无字段名可依的位置，凡在任何地方被比较过的值一律不翻", () => {
  // Enter 在这里只是个按钮兜底文案，但别处拿它当键名比较过 —— 显示侧翻了、判断侧没翻就失配。
  const src = `a=function(x){return x||"Enter"},b=function(e){return e.key==="Enter"},
             c=function(x){return x?"This PC":"This Mac"}`;
  assert.deepEqual(scanBundle(src).map((h) => h.raw), ["This PC", "This Mac"]);

  // 比较在左侧、以及 case 分支，同样算数
  const other = `d=function(x){return x||"Auto"},e=function(t){switch(t){case "Auto":return 1}}`;
  assert.deepEqual(scanBundle(other).map((h) => h.raw), []);

  // 这道闸只管无字段名可依的位置；字段名那一侧另有更精确的守卫，不受牵连
  const withField = `a={label:"Enter"},b=function(e){return e.key==="Enter"}`;
  assert.deepEqual(scanBundle(withField).map((h) => h.raw), ["Enter"]);
});

test("targets：只有内核 bundle 标了 checksummed / nlsExclude", () => {
  const core = M4_TARGETS.filter((t) => t.checksummed);
  assert.deepEqual(
    core.map((t) => t.rel),
    ["out/vs/workbench/workbench.desktop.main.js"],
    "被校验的目标只能有内核 bundle 一个"
  );
  // 内核层要排除 NLS 表内的串，另外两个恰好相反 —— 这两条规则搞反会大面积误翻/漏翻
  for (const t of M4_TARGETS) {
    assert.equal(!!t.nlsExclude, !!t.checksummed, `${t.rel} 的 nlsExclude 应与 checksummed 一致`);
  }
  assert.equal(checksumKey(core[0].rel), "vs/workbench/workbench.desktop.main.js");
});

test("scanBundle：nlsExclude 只挡 NLS 表内的串，其余照常命中", () => {
  const src = `a={label:"Save"},b={label:"Suggested Dockerfile"},c={children:"Open in Terminal Pane"}`;
  assert.deepEqual(scanBundle(src).map((h) => h.raw), [
    "Save",
    "Suggested Dockerfile",
    "Open in Terminal Pane",
  ]);
  // 内核 bundle：Save 在 NLS 表里，是 localize 的默认值，翻了不起作用
  const core = scanBundle(src, { nlsExclude: new Set(["Save"]) });
  assert.deepEqual(core.map((h) => h.raw), ["Suggested Dockerfile", "Open in Terminal Pane"]);
});

test("integrity：重算后闸门通过，且只改动目标键的值", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-int-"));
  try {
    fs.mkdirSync(path.join(dir, "out", "vs", "workbench"), { recursive: true });
    fs.writeFileSync(path.join(dir, "out", "vs", "workbench", "a.js"), "AAA");
    fs.writeFileSync(path.join(dir, "out", "vs", "workbench", "b.js"), "BBB");
    const good = base64Sha256(Buffer.from("BBB"));
    fs.writeFileSync(
      path.join(dir, "product.json"),
      JSON.stringify(
        { name: "cursor", checksums: { "vs/workbench/a.js": "stale", "vs/workbench/b.js": good } },
        null,
        "\t"
      )
    );

    // a.js 的校验值是过期的 → 闸门必须拦下，而不是放行一个起不来的 Cursor
    assert.throws(() => assertIntegrity(dir), /完整性闸门未通过/);

    const before = fs.readFileSync(path.join(dir, "product.json"), "utf8");
    const fresh = base64Sha256(Buffer.from("AAA"));
    applyChecksumUpdates(dir, { "vs/workbench/a.js": fresh });
    const after = fs.readFileSync(path.join(dir, "product.json"), "utf8");

    assert.equal(after, before.replace('"stale"', `"${fresh}"`), "除目标键外不得改动任何字节");
    assert.doesNotThrow(() => assertIntegrity(dir));

    // 不在 checksums 清单里的键一律拒绝 —— 否则等于把任意文件塞进校验清单
    assert.throws(
      () => applyChecksumUpdates(dir, { "vs/workbench/c.js": "x" }),
      /不在校验清单内/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("integrity：product.json 不是制表符缩进时拒绝改写", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-int2-"));
  try {
    fs.writeFileSync(
      path.join(dir, "product.json"),
      JSON.stringify({ checksums: { "vs/workbench/a.js": "x" } }, null, 2) // 两空格缩进
    );
    assert.throws(() => applyChecksumUpdates(dir, { "vs/workbench/a.js": "y" }), /制表符缩进/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nlsbase：没有备份就返回 null，让内核目标被跳过而不是硬改", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-nls-"));
  try {
    const got = loadOriginalNlsEnglish({
      projectRoot: dir,
      product: { version: "1.2.3", distro: "abc" },
    });
    assert.equal(got, null);

    // 有备份但文件缺失，同样返回 null
    fs.mkdirSync(path.join(dir, "backup", "1.2.3_abc", "files", "out"), { recursive: true });
    assert.equal(
      loadOriginalNlsEnglish({ projectRoot: dir, product: { version: "1.2.3", distro: "abc" } }),
      null
    );

    // 放上原始表就能读到
    fs.writeFileSync(
      path.join(dir, "backup", "1.2.3_abc", "files", "out", "nls.messages.json"),
      JSON.stringify(["Save", "Open"])
    );
    const base = loadOriginalNlsEnglish({
      projectRoot: dir,
      product: { version: "1.2.3", distro: "abc" },
    });
    assert.ok(base);
    assert.equal(base.set.has("Save"), true);
    assert.equal(base.set.has("Nope"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fontfix：雅黑排在 sans-serif 之前，且用 !important 压过内联值", () => {
  const { source } = applyFontFix("");
  const yahei = source.indexOf("Microsoft YaHei UI");
  const generic = source.indexOf("sans-serif");
  // generic family 恒有匹配，写在它后面的字体等于不存在 —— 这是这条规则唯一的硬约束
  assert.ok(yahei > 0, "规则里应当有微软雅黑");
  assert.ok(yahei < generic, `雅黑(${yahei}) 必须排在 sans-serif(${generic}) 之前`);
  assert.match(source, /--vscode-font-family:/);
  assert.match(source, /!important/);
  // 覆盖两个作用域：:root 管整窗，.monaco-workbench 管工作台根
  assert.match(source, /:root,\.monaco-workbench\{/);
});

test("fontfix：幂等 —— 重复追加不会把规则叠第二遍", () => {
  const once = applyFontFix("body{}\n");
  assert.equal(once.changed, true);

  const twice = applyFontFix(once.source);
  assert.equal(twice.changed, false);
  assert.equal(twice.source, once.source);
  assert.equal(once.source.split(FONT_MARK).length - 1, 1);
});

test("fontfix：末尾没有换行的 CSS 也不会把规则粘在上一行", () => {
  const { source } = applyFontFix("body{}");
  assert.match(source, /body\{\}\n/);
  assert.ok(source.endsWith("\n"));
});

test("fontfix：目标就是校验清单里的那个 css", () => {
  assert.equal(FONT_CSS_REL, "out/vs/workbench/workbench.desktop.main.css");
  assert.equal(checksumKey(FONT_CSS_REL), "vs/workbench/workbench.desktop.main.css");
});

// ───────────────────────── 写入管线（installBundles / installFontFix） ─────────────────────────
//
// 这一段是唯一会把字面量写进 39.8 MB bundle、并改写被校验文件的代码，此前零覆盖。
// 骨架只造出内核 bundle，另外两个目标不存在 → 走 "missing" 分支，不影响断言。

const CORE_REL = "vs/workbench/workbench.desktop.main.js";
const CSS_REL = "vs/workbench/workbench.desktop.main.css";

function m4sandbox({ checksums = {}, files = {} }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-m4d-"));
  const appDir = path.join(base, "app");
  fs.mkdirSync(path.join(appDir, "out", "vs", "workbench"), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(appDir, "out", rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  fs.writeFileSync(path.join(appDir, "product.json"), JSON.stringify({ name: "cursor", checksums }, null, "\t"));
  return {
    appDir,
    product: { version: "0.0.0-test", distro: "testdistro", commit: "testcommit" },
    projectRoot: path.join(base, "proj"),
    file: (rel) => path.join(appDir, "out", rel),
    productJson: path.join(appDir, "product.json"),
  };
}

function bundleArgs(sb) {
  return {
    paths: { appDir: sb.appDir },
    product: sb.product,
    projectRoot: sb.projectRoot,
    dict: { Save: "保存" },
    nlsExclude: new Set(),
    log: () => {},
  };
}

test("installBundles：改写被校验 bundle 并重算校验值，闸门通过", () => {
  const src = 'x={label:"Save"};';
  const sb = m4sandbox({ checksums: { [CORE_REL]: base64Sha256(Buffer.from(src)) } });
  fs.writeFileSync(sb.file(CORE_REL), src);

  const mine = installBundles(bundleArgs(sb)).find((s) => s.rel.endsWith("workbench.desktop.main.js"));
  assert.equal(mine.status, "patched");

  const after = fs.readFileSync(sb.file(CORE_REL), "utf8");
  assert.equal(after, 'x={label:"保存"};');
  assert.equal(
    JSON.parse(fs.readFileSync(sb.productJson, "utf8")).checksums[CORE_REL],
    base64Sha256(Buffer.from(after))
  );
  assert.doesNotThrow(() => assertIntegrity(sb.appDir));
});

test("installBundles：上次写入未完成时自愈，不会永久卡在 no-change", () => {
  const src = 'x={label:"Save"};';
  const sb = m4sandbox({ checksums: { [CORE_REL]: base64Sha256(Buffer.from(src)) } });
  fs.writeFileSync(sb.file(CORE_REL), src);

  installBundles(bundleArgs(sb));
  const patched = fs.readFileSync(sb.file(CORE_REL), "utf8");

  // 制造「bundle 已写、product.json 还没写就被杀」：把校验值退回复写前的值
  const product = JSON.parse(fs.readFileSync(sb.productJson, "utf8"));
  product.checksums[CORE_REL] = base64Sha256(Buffer.from(src));
  fs.writeFileSync(sb.productJson, JSON.stringify(product, null, "\t"));
  assert.throws(() => assertIntegrity(sb.appDir), /完整性闸门未通过/, "先要有损坏态才谈自愈");

  // 重跑：bundle 里已无英文，patchBundle 必然是 0 处。旧代码在这里 continue，
  // 校验值永远修不回、Cursor 每次启动都报 corrupt。
  const again = installBundles(bundleArgs(sb)).find((s) => s.rel.endsWith("workbench.desktop.main.js"));
  assert.equal(again.status, "healed");
  assert.equal(fs.readFileSync(sb.file(CORE_REL), "utf8"), patched, "自愈不应再动 bundle 内容");
  assert.doesNotThrow(() => assertIntegrity(sb.appDir));
});

test("installBundles：无从证明是自己的半成品时不自愈", () => {
  const src = 'x={label:"Save"};';
  const sb = m4sandbox({ checksums: { [CORE_REL]: base64Sha256(Buffer.from(src)) } });
  // 文件不是本工具写的（既没有备份，也没有 installedSha256），校验值也对不上
  fs.writeFileSync(sb.file(CORE_REL), 'x={label:"保存"};');
  const before = fs.readFileSync(sb.productJson);

  const r = installBundles(bundleArgs(sb)).find((s) => s.rel.endsWith("workbench.desktop.main.js"));
  assert.equal(r.status, "no-change", "已无英文可翻");
  assert.ok(fs.readFileSync(sb.productJson).equals(before), "不得替来路不明的内容补校验值");
  assert.throws(() => assertIntegrity(sb.appDir), /完整性闸门未通过/, "损坏态原样留着，交给人判断");
});

test("installBundles：闸门不过时回滚 bundle 与 product.json", () => {
  const src = 'x={label:"Save"};';
  const sb = m4sandbox({
    checksums: {
      [CORE_REL]: base64Sha256(Buffer.from(src)),
      "vs/workbench/ghost.js": "stale", // 文件不存在 → 闸门必然不过
    },
  });
  fs.writeFileSync(sb.file(CORE_REL), src);
  const before = fs.readFileSync(sb.productJson);

  assert.throws(() => installBundles(bundleArgs(sb)), /已回滚到写入前状态/);
  assert.equal(fs.readFileSync(sb.file(CORE_REL), "utf8"), src, "bundle 必须还原");
  assert.ok(fs.readFileSync(sb.productJson).equals(before), "product.json 必须还原成原始字节");
});

test("assertSyntax：坏语法在写入前被拦下", () => {
  assert.throws(() => assertSyntax("function (", "t"), /语法校验失败/);
  assert.doesNotThrow(() => assertSyntax("const a = 1;\n", "t"));
});

test("installFontFix：追加规则、重算校验值，二次调用幂等", () => {
  const css = "body{}\n";
  const sb = m4sandbox({ checksums: { [CSS_REL]: base64Sha256(Buffer.from(css)) } });
  fs.writeFileSync(sb.file(CSS_REL), css);
  const args = { paths: { appDir: sb.appDir }, product: sb.product, projectRoot: sb.projectRoot, log: () => {} };

  assert.equal(installFontFix(args).status, "patched");
  const after = fs.readFileSync(sb.file(CSS_REL), "utf8");
  assert.ok(after.includes(FONT_MARK));
  assert.equal(JSON.parse(fs.readFileSync(sb.productJson, "utf8")).checksums[CSS_REL], base64Sha256(Buffer.from(after)));
  assert.doesNotThrow(() => assertIntegrity(sb.appDir));

  assert.equal(installFontFix(args).status, "no-change");
});

test("installFontFix：css 半成品写入同样能自愈", () => {
  const css = "body{}\n";
  const sb = m4sandbox({ checksums: { [CSS_REL]: base64Sha256(Buffer.from(css)) } });
  fs.writeFileSync(sb.file(CSS_REL), css);
  const args = { paths: { appDir: sb.appDir }, product: sb.product, projectRoot: sb.projectRoot, log: () => {} };

  installFontFix(args);
  const product = JSON.parse(fs.readFileSync(sb.productJson, "utf8"));
  product.checksums[CSS_REL] = base64Sha256(Buffer.from(css)); // 退回写入前
  fs.writeFileSync(sb.productJson, JSON.stringify(product, null, "\t"));

  // 标记行已在 → applyFontFix 返回 no-change，旧代码就此返回、校验值永远修不回
  assert.equal(installFontFix(args).status, "healed");
  assert.doesNotThrow(() => assertIntegrity(sb.appDir));
});

