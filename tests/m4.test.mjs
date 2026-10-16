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

test("scanBundle：驼峰键的映射表也整块收（独立 Agent 设置面板那批）", () => {
  // 键是驼峰时 ② 的「全小写」限定抓不到，Browser 那一组就是这么整片漏译的。
  const src = `zme={section:"Browser",automation:"Browser Automation",protection:"Browser Protection",protectionDescription:"Prevent Agent from automatically running Browser tools",openWebLinks:"Open Web Links in Cursor Browser"}`;
  assert.deepEqual(scanBundle(src).map((h) => [h.field, h.raw]), [
    ["section", "Browser"],
    ["automation", "Browser Automation"],
    ["protection", "Browser Protection"],
    ["protectionDescription", "Prevent Agent from automatically running Browser tools"],
    ["openWebLinks", "Open Web Links in Cursor Browser"],
  ]);

  // 键里只要有一个落进 NEVER_FIELDS，整块丢 —— 实测这一步挡掉 Statsig 字段映射、
  // 权限 scope、枚举 slug 三张「值是标识而非文案」的表，翻了会直接改运行时语义。
  const telemetry = `T={eventCount:"ec",sdkKey:"k",sdkType:"st",sessionId:"sid",type:"Something"}`;
  assert.deepEqual(scanBundle(telemetry).map((h) => h.raw), []);

  // 有一个值不像界面文案（这里是 slug 风格），整块也不收 —— 挡掉 {invalid_type:"invalid_type"} 那类
  const slugMap = `S={stepOne:"Will Select",stepTwo:"Adopt Step",stepThree:"Remeasure Area",stepFour:"Reveal Settle",slug:"browser-automation"}`;
  assert.deepEqual(scanBundle(slugMap).map((h) => h.raw), []);
});

test("scanBundle：映射表的值在别处参与过等值比较就不翻（比 ② 多一道按值的闸）", () => {
  // ② 只按表键查 byField，而 x==="Browser Automation" 这种裸比较记不到表键名下，
  // 于是表值翻了、判断侧没翻。④ 对每个值再查一次全局比较集。
  const src = `zme={section:"Browser",automation:"Browser Automation",protection:"Browser Protection",protectionDescription:"Prevent Agent from running Browser tools",openWebLinks:"Open Web Links"};
               f=function(x){return x==="Browser Automation"}`;
  const raws = scanBundle(src).map((h) => h.raw);
  assert.equal(raws.includes("Browser Automation"), false, "参与过等值比较的表值不得改写");
  assert.equal(raws.includes("Browser Protection"), true, "未参与比较的照常收");
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

test("scanBundle：模板串里的单引号不会让整片字段规则失明", () => {
  // LIT 只认引号配对。模板字符串里的一个 apostrophe 会跟后面某个单引号串的**开引号**
  // 配上对，把中间整段（含真实字面量）吞成一个字符串 token —— 那些真字面量压根不会被
  // 访问到，字段规则就此整片失效。实测 glass bundle 第一处翻转在偏移 11385
  // （`'{snip} ${n}`），此后一大段区间漏译，Agent 窗口菜单标题 New Browser 就是这么丢的。
  // 补的是一条不依赖配对的同规则通道，按起始偏移去重，只净增、不覆盖。
  const flip = `u=\`it's\`;b={title:"New Browser"};c='z'`;
  const hits = scanBundle(flip);
  assert.deepEqual(hits.map((h) => h.raw), ["New Browser"], "翻转区间里的真字面量必须还能命中");
  assert.equal(flip.slice(hits[0].start, hits[0].end), `"New Browser"`, "补回命中的区间同样要精确");

  // apostrophe 个数为偶时不会翻转 —— 两种情况都得命中，修的是「不再漏」，不是「换个漏法」
  assert.deepEqual(
    scanBundle(`u=\`it's\`;c='z';b={title:"New Browser"}`).map((h) => h.raw),
    ["New Browser"]
  );

  // 真实形态：HTML 片段装在单引号 JS 字符串里，属性值就是用户看得见的 tooltip。
  // 另一条通道按位置改写，改写的是那一小段属性值本身，不会破坏宿主字符串。
  const html = `wt('<button title="Save">')`;
  assert.deepEqual(scanBundle(html).map((h) => [h.field, h.raw]), [["title", "Save"]]);

  // 补回的通道同样要过白名单与标识守卫，不能因为「另一条路」就放行
  assert.deepEqual(scanBundle(`u=\`it's\`;b={"data-test":"New Browser"};c='z'`).map((h) => h.raw), []);
  assert.deepEqual(
    scanBundle(`u=\`it's\`;b={title:"New Browser"},k=function(e){return e.title==="New Browser"};c='z'`)
      .map((h) => h.raw),
    []
  );
  assert.deepEqual(
    scanBundle(`u=\`it's\`;b={title:"New Browser"};c='z'`, { nlsExclude: new Set(["New Browser"]) })
      .map((h) => h.raw),
    []
  );
});

test("scanBundle：本地化壳的对象形态也能命中，且不会把 React 的 key prop 算进来", () => {
  // 上游是 localize({key, comment}, msg)。打包后的壳函数退化成
  // `D(t,e){ return typeof t=="number" ? 表[t] : e }` —— 键不是数字就恒返回英文实参，
  // 语言包也碰不到（它的键不在 NLS 键表里）。实测 Agent 窗口的编辑菜单
  // （撤销/重做/剪切/复制/粘贴/全选）就是这么整条漏掉的。
  const menu = `Ir({menu:{title:D({key:"glassOsEditUndo",comment:["&& denotes a mnemonic"]},"&&Undo")}})`;
  const hits = scanBundle(menu);
  assert.deepEqual(hits.map((h) => h.raw), ["&&Undo"], "对象键的英文实参必须命中");
  assert.equal(menu.slice(hits[0].start, hits[0].end), `"&&Undo"`, "命中区间要精确套住字面量，不碰 key/comment");
  assert.equal(hits[0].field, null, "没有字段名可依，走按值的标识守卫");

  // 助记符让首字母闸失守，只能剥掉 && 再验 —— 但只放宽这一条：
  // 剥掉之后仍要是像文案的串，Cu&&t 放行、乱码不放行。
  assert.deepEqual(scanBundle(`D({key:"a",comment:["x"]},"Cu&&t")`).map((h) => h.raw), ["Cu&&t"]);
  assert.deepEqual(scanBundle(`D({key:"a",comment:["x"]},"x&&8z")`).map((h) => h.raw), []);

  // comment 是必需项：省了就退化成「{key:"…"}, "文案"」这个宽形状，
  // 会把 React 的 createElement(tag,{key:"strong"},"文案") 大片算进来。
  assert.deepEqual(scanBundle(`YG.createElement("strong",{key:"strong"},"What this demonstrates:")`).map((h) => h.raw), []);

  // 同样要过标识守卫与 nlsExclude，不能因为「另一条路」就放行
  assert.deepEqual(scanBundle(`D({key:"a",comment:["x"]},"&&Undo"),k=function(e){return e==="&&Undo"}`).map((h) => h.raw), []);
  assert.deepEqual(scanBundle(`D({key:"a",comment:["x"]},"&&Undo")`, { nlsExclude: new Set(["&&Undo"]) }).map((h) => h.raw), []);
});

test("scanBundle：三元链的外层分支不再漏，且只收外层那一支", () => {
  // TERNARY_RE 只认「两支都是字面量」。外层三元 `xa?"This PC":_r?...` 的 else 支
  // 是另一条三元而不是字面量，于是这一支整条漏掉。实测同一个函数渲染出来是
  // 「This PC / 此 Mac / 此计算机」三不像。
  const src = `function qX(){return xa?"This PC":_r?"This Mac":"This Computer"}`;
  const hits = scanBundle(src);
  assert.deepEqual(hits.map((h) => h.raw).sort(), ["This Computer", "This Mac", "This PC"]);
  for (const h of hits) {
    assert.equal(src.slice(h.start, h.end), `"${h.raw}"`, "三段区间都要精确");
  }
  // 内层两支本来就由 TERNARY_RE 收，去重后不能重复计
  assert.equal(new Set(hits.map((h) => h.start)).size, hits.length);

  // 三分支都要像文案才认 —— 只翻外层会得到一半中文一半英文
  assert.deepEqual(scanBundle(`return a?"Ready":b?"dark":"light"`).map((h) => h.raw), []);

  // 中间那段不认带括号的调用：宁可少收，也不要把两边含义不同的串配到一起。
  // 内层那对仍由 TERNARY_RE 照常收 —— 这里要证的是外层 Ready 没被顺带收进来。
  assert.deepEqual(scanBundle(`return a?"Ready":f()?"Started":"Stopped"`).map((h) => h.raw), ["Started", "Stopped"]);

  // 外层那支参与过等值比较的不翻
  assert.deepEqual(
    scanBundle(`w=function(e){return e==="This PC"};return xa?"This PC":_r?"This Mac":"This Computer"`)
      .map((h) => h.raw)
      .sort(),
    ["This Computer", "This Mac"]
  );
});

test("scanBundle：三元深链的外层分支不再漏，且不吃掉链上其余分支", () => {
  // TERNARY_CHAIN_RE 的中间段限定「裸标识符」，带等值比较的链够不着，于是整条链
  // 最外层那一支漏译 —— Agent 窗口的 Move to this machine / Login / Unstage All
  // 一族就是这么丢的（实测三个 bundle 净增 80 条去重）。
  const src = `function kK1(t){return t.value!=="undecided"?"Move to this machine":t.probe==="unreachable"&&t.probeReason==="hosted_dial_failures"?"Keep it on this machine":"Run it on this machine"}`;
  const hits = scanBundle(src);
  assert.deepEqual(
    hits.map((h) => h.raw).sort(),
    ["Keep it on this machine", "Move to this machine", "Run it on this machine"]
  );
  for (const h of hits) assert.equal(src.slice(h.start, h.end), `"${h.raw}"`, "三段区间都要精确");
  assert.equal(new Set(hits.map((h) => h.start)).size, hits.length, "同一处不得重复计");

  // 先行断言必须不消耗字符：链上每一环都要各自命中一次。写成普通匹配会在链上交替
  // 命中，命中一处就吃掉后面一段，后面的分支永远轮不到自己那次匹配（实测 41 → 29，
  // 掉的是 Login 与 Limit Reached）。
  const deep = `return a==="x"?"Alpha":b==="y"?"Bravo":c==="z"?"Charlie":"Delta"`;
  assert.deepEqual(scanBundle(deep).map((h) => h.raw).sort(), [
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
  ]);

  // 必要条件：链里得有等值比较符。不带比较符的普通三元由 TERNARY_RE 管；而中间那段
  // 带调用的形状两边含义可能毫不相干，宁可少收也不要把它们配到一起。
  assert.deepEqual(
    scanBundle(`return check(x)?"Ready":probe(y)==="unreachable"?"Not Ready":"Fully Ready"`).map(
      (h) => h.raw
    ),
    ["Not Ready", "Fully Ready"]
  );

  // 参与过等值比较的那一支不翻（与其余形状规则同一条标识守卫）
  assert.deepEqual(
    scanBundle(
      `w=function(e){return e==="Login"};return t.value!=="undecided"?"Login":t.probe==="unreachable"?"Keep it here":"Run it here"`
    )
      .map((h) => h.raw)
      .sort(),
    ["Keep it here", "Run it here"]
  );

  // 放行尺度按「? 后那一支」独立判定，不做 ⑥ 那种全链同尺度：链上后续环节里的
  // "unreachable" / "cloud" / "ENETUNREACH" 是**比较操作数**（标识），不是渲染分支，
  // 全链同尺度会把这些枚举一起要求「像文案」，实测要白丢 31 条正解。
  assert.deepEqual(
    scanBundle(
      `return k==="cloud"?"Cloud agent view is unavailable":k==="local"?"Project view is unavailable":"Other view is unavailable"`
    )
      .map((h) => h.raw)
      .sort(),
    ["Cloud agent view is unavailable", "Other view is unavailable", "Project view is unavailable"]
  );
});

test("scanBundle：裸常量只按目标白名单收，白名单外一条不碰", () => {
  const allow = ["No Repository", "Start from scratch"];
  const src = `var Eee="No Repository",fKr="Start from scratch";`;

  // 不下发名单：字段规则够不着裸常量赋值，一条都不该收
  assert.deepEqual(scanBundle(src).map((h) => h.raw), []);

  const hits = scanBundle(src, { bareConstAllow: allow });
  assert.deepEqual(hits.map((h) => [h.field, h.raw]), [
    [null, "No Repository"],
    [null, "Start from scratch"],
  ]);
  // 区间只套住值本身 —— 含标识符或等号会改写坏语法
  assert.equal(src.slice(hits[1].start, hits[1].end), '"Start from scratch"');

  // 名单不等于全局放行：glass（Sye）与内核（_Yb）那两个同值哨兵靠「不下发名单」保住
  assert.deepEqual(scanBundle(`var Sye="Start from scratch";`).map((h) => h.raw), []);

  // 值若在别处参与过等值比较，⑨ 同样被标识值守卫拦下
  assert.deepEqual(
    scanBundle(`var fKr="Start from scratch",q=function(){return x==="Start from scratch"};`, {
      bareConstAllow: allow,
    }).map((h) => h.raw),
    []
  );

  // 名单外的裸常量照旧不翻
  assert.deepEqual(
    scanBundle(`var z="Some Label",y="Another Label";`, { bareConstAllow: allow }).map((h) => h.raw),
    []
  );
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

  // 裸常量白名单（规则 ⑨）按内容分两类，不能混：
  //   · anysphere 的 `No Repository` / `Start from scratch` 在 glass 与内核里兼作哨兵
  //     （`t.displayName.trim()===Sye`、`name:_Yb`），**只准挂在 anysphere 上**；
  //   · glass / 内核的计费用量文案是纯展示标签，两边各挂各的。
  // 混挂的后果是把哨兵翻掉、workspace 标识被写坏，所以这里逐目标锁名单。
  const withBare = M4_TARGETS.filter((t) => t.bareConstAllow);
  assert.deepEqual(
    withBare.map((t) => t.rel),
    [
      "out/vs/workbench/workbench.glass.main.js",
      "out/vs/workbench/workbench.anysphere-ui-automations.js",
      "out/vs/workbench/workbench.desktop.main.js",
    ],
    "三个目标各自的白名单必须显式列出"
  );
  const SENTINELS = ["No Repository", "Start from scratch"];
  for (const t of withBare) {
    const bare = t.bareConstAllow;
    assert.ok(bare.length > 0, `${t.rel} 的白名单不得为空`);
    assert.equal(new Set(bare).size, bare.length, `${t.rel} 的白名单不得有重复项`);
    if (t.rel.includes("anysphere")) {
      assert.deepEqual(bare, SENTINELS);
    } else {
      for (const s of SENTINELS) {
        assert.ok(!bare.includes(s), `${t.rel} 不得收录兼作哨兵的 ${JSON.stringify(s)}`);
      }
      // 这三个串是「标签兼判定」的反例，已实测否决，翻掉会坏功能
      for (const bad of [
        "Share exceeds content limits",
        "No response was received within the time limit",
        "The AI provider is rate-limiting requests or is temporarily at capacity.",
      ]) {
        assert.ok(!bare.includes(bad), `${t.rel} 不得收录 ${JSON.stringify(bad)}`);
      }
    }
  }
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

test("installBundles：以备份原始英文为输入，第二轮能补上第一轮漏掉的串", () => {
  // 左导航映射表规则要求「≥5 个成员、且值都是 UI 文案」。第一轮只译了两条，那两条变成
  // 中文后不再算 UI 文案，整张表就只剩 3 个成员 —— 若以盘上文件为输入，规则不再成立，
  // 剩下 3 条永远扫不到。这正是独立 Agent 设置面板整片英文的根因。
  const src = 'N={general:"General",profile:"Profile",appearance:"Appearance",models:"Models",docs:"Docs"};';
  const sb = m4sandbox({ checksums: { [CORE_REL]: base64Sha256(Buffer.from(src)) } });
  fs.writeFileSync(sb.file(CORE_REL), src);
  const args = (dict) => ({ ...bundleArgs(sb), dict });

  installBundles(args({ General: "常规", Profile: "配置文件" }));
  const mid = fs.readFileSync(sb.file(CORE_REL), "utf8");
  assert.match(mid, /general:"常规"/);
  assert.match(mid, /appearance:"Appearance"/, "第一轮装不下这条，留到第二轮");

  const again = installBundles(
    args({ General: "常规", Profile: "配置文件", Appearance: "外观", Models: "模型", Docs: "文档" })
  ).find((s) => s.rel.endsWith("workbench.desktop.main.js"));

  assert.equal(again.status, "patched", "第二轮必须真的改写，不能判成 no-change");
  assert.equal(
    fs.readFileSync(sb.file(CORE_REL), "utf8"),
    'N={general:"常规",profile:"配置文件",appearance:"外观",models:"模型",docs:"文档"};'
  );
});

test("installBundles：盘上内容来路不明时拒绝用旧备份覆盖", () => {
  // 输入改成取备份之后，写入内容不再依赖盘上现状 —— 所以必须拦住「盘上被别人改过」的
  // 情况，否则会拿旧备份把第三方的改动整个抹掉。
  const src = 'x={label:"Save"};';
  const sb = m4sandbox({ checksums: { [CORE_REL]: base64Sha256(Buffer.from(src)) } });
  fs.writeFileSync(sb.file(CORE_REL), src);
  installBundles(bundleArgs(sb)); // 建立备份

  fs.writeFileSync(sb.file(CORE_REL), 'x={label:"Save"};/* 别的工具改过 */');
  const r = installBundles(bundleArgs(sb)).find((s) => s.rel.endsWith("workbench.desktop.main.js"));

  assert.equal(r.status, "foreign");
  assert.match(fs.readFileSync(sb.file(CORE_REL), "utf8"), /别的工具改过/, "不得覆盖");
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

