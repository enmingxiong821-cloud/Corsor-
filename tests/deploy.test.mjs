// 零依赖测试（node --test）。覆盖 docs/05 §9.1 要求的单元测试，
// 以及本工程特有的三条不变量：最小改动、字节级还原、占位符守恒。
//
// 运行：node --test tests/

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { base64Sha256, sha256Hex, backupRoot, createBackup, readManifest } from "../src/deploy/backup.mjs";
import { install } from "../src/deploy/install.mjs";
import { restore } from "../src/deploy/restore.mjs";
import { buildPatchedMessages } from "../src/deploy/nls.mjs";
import { normalizeMnemonic } from "../src/align/mnemonic.mjs";
import { merge } from "../src/align/merge.mjs";
import { validateOverrides, validateResolved } from "../src/dict/validate.mjs";
import { assemble } from "../src/dict/assemble.mjs";
import { countOverrides } from "../src/dict/load.mjs";
import { locate } from "../src/scan/locate.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

// —— 临时工程骨架：模拟 appDir / clpDir / projectRoot ——
function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-test-"));
  const paths = {
    appDir: path.join(base, "app"),
    clpDir: path.join(base, "clp"),
  };
  fs.mkdirSync(path.join(paths.appDir, "out"), { recursive: true });
  fs.mkdirSync(paths.clpDir, { recursive: true });
  const product = { version: "0.0.0-test", distro: "testdistro", commit: "testcommit" };
  return { base, paths, product, projectRoot: path.join(base, "proj"), nlsFile: path.join(paths.appDir, "out", "nls.messages.json") };
}

function writeMessages(file, arr) {
  fs.writeFileSync(file, JSON.stringify(arr), "utf8");
}

// ───────────────────────── docs/05 §6.1 金标准 ─────────────────────────

test("金标准：checksum 算法在真实文件上复现", () => {
  let paths;
  try {
    paths = locate();
  } catch {
    return; // 未装 Cursor 的环境跳过
  }
  const html = path.join(paths.outDir, "vs/code/electron-sandbox/workbench/workbench.html");
  if (!fs.existsSync(html)) return;

  assert.equal(
    base64Sha256(fs.readFileSync(html)),
    "BZ8Zb4TGBbDPaaGjA+MuDJxaFsxjmmG0YMyttD4zgcU"
  );
  const main = path.join(paths.outDir, "vs/workbench/workbench.desktop.main.js");
  assert.equal(
    base64Sha256(fs.readFileSync(main)),
    "7Wkip6hsjESKRqo5rwyTFYDaFidw/kBqDUFzcpDmN9k"
  );
});

// ───────────────────────── 最小改动不变量 ─────────────────────────

test("buildPatchedMessages：只改目标索引，其余逐字节不变", () => {
  const defaults = ["a", "b", "c", "d", "e"];
  const resolved = [
    { index: 0, moduleId: "m", key: "k0", en: "a", zh: "甲", source: "override" },
    { index: 1, moduleId: "m", key: "k1", en: "b", zh: "乙", source: "exact" }, // 语言包已覆盖 → 不写
    { index: 2, moduleId: "m", key: "k2", en: "c", zh: null, source: "missing" },
    { index: 3, moduleId: "m", key: "k3", en: "d", zh: "丁", source: "renamed<old>" },
    { index: 4, moduleId: "m", key: "k4", en: "e", zh: "戊", source: "override" },
  ];
  const { messages, changed } = buildPatchedMessages({ defaultMessages: defaults, resolved });

  assert.equal(messages.length, defaults.length, "长度必须不变");
  assert.deepEqual(messages, ["甲", "b", "c", "丁", "戊"]);
  assert.deepEqual(changed.map((c) => c.index), [0, 3, 4], "exact 与 missing 都不应改写");
});

test("buildPatchedMessages：输出可 JSON 往返，紧凑序列化字节稳定", () => {
  const defaults = ["More Actions...", "OK"];
  const resolved = [
    { index: 0, moduleId: "m", key: "k0", en: defaults[0], zh: "更多操作…", source: "override" },
    { index: 1, moduleId: "m", key: "k1", en: defaults[1], zh: "确 定", source: "exact" },
  ];
  const { messages } = buildPatchedMessages({ defaultMessages: defaults, resolved });
  const round = JSON.parse(JSON.stringify(messages));
  assert.deepEqual(round, messages);
});

// ───────────────────────── 备份 / 安装 / 还原 ─────────────────────────

test("install → restore：必须字节级还原", () => {
  const sb = sandbox();
  const original = ["Hello", "World", "Third"];
  writeMessages(sb.nlsFile, original);
  const originalBytes = fs.readFileSync(sb.nlsFile);

  install({
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    messages: ["你好", "World", "第三"],
    log: () => {},
  });
  assert.notEqual(sha256Hex(fs.readFileSync(sb.nlsFile)), sha256Hex(originalBytes), "install 应已改写文件");

  const manifest = readManifest(backupRoot(sb.projectRoot, sb.product));
  assert.equal(manifest.files[0].sha256, sha256Hex(originalBytes), "manifest 应记录原始哈希");

  const { results } = restore({
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    log: () => {},
  });

  assert.equal(results[0].status, "restored", `期望 restored，实际 ${results[0].status}`);
  assert.ok(fs.readFileSync(sb.nlsFile).equals(originalBytes), "还原后必须与原始字节完全一致");
});

test("备份目录名必须是 <版本>_<发行版>（docs/05 §5.4）", () => {
  const sb = sandbox();
  writeMessages(sb.nlsFile, ["A"]);
  install({
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    messages: ["甲"],
    log: () => {},
  });
  const dirs = fs.readdirSync(path.join(sb.projectRoot, "backup"));
  assert.deepEqual(dirs, ["0.0.0-test_testdistro"], `实际得到 ${JSON.stringify(dirs)}`);
});

test("install 可重复执行（幂等），不应因自身改动而中止", () => {
  const sb = sandbox();
  writeMessages(sb.nlsFile, ["A", "B"]);
  const args = {
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    log: () => {},
  };
  install({ ...args, messages: ["甲", "B"] });
  assert.doesNotThrow(() => install({ ...args, messages: ["甲", "乙"] }), "第二次 install 不应抛错");
  assert.deepEqual(JSON.parse(fs.readFileSync(sb.nlsFile, "utf8")), ["甲", "乙"]);
});

test("restore：被外部改动的文件必须跳过并告警，不覆盖", () => {
  const sb = sandbox();
  writeMessages(sb.nlsFile, ["Orig"]);
  const originalBytes = fs.readFileSync(sb.nlsFile);

  install({
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    messages: ["已汉化"],
    log: () => {},
  });
  // 模拟 Cursor 升级器把文件换成了别的东西
  writeMessages(sb.nlsFile, ["Upgraded"]);
  const upgradedBytes = fs.readFileSync(sb.nlsFile);

  const { results } = restore({
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    log: () => {},
  });

  assert.equal(results[0].status, "externally-modified");
  assert.ok(fs.readFileSync(sb.nlsFile).equals(upgradedBytes), "外部改动过的文件不得被覆盖");
  assert.notEqual(sha256Hex(originalBytes), sha256Hex(upgradedBytes));
});

test("install --dry-run 不产生任何写入", () => {
  const sb = sandbox();
  writeMessages(sb.nlsFile, ["A"]);
  const before = fs.readFileSync(sb.nlsFile);
  install({
    paths: sb.paths,
    product: sb.product,
    projectRoot: sb.projectRoot,
    messages: ["甲"],
    dryRun: true,
    log: () => {},
  });
  assert.ok(fs.readFileSync(sb.nlsFile).equals(before));
  assert.equal(fs.existsSync(path.join(sb.projectRoot, "backup")), false, "dry-run 不应创建备份");
});

test("createBackup 拒绝重复备份同一版本", () => {
  const sb = sandbox();
  writeMessages(sb.nlsFile, ["A"]);
  const dir = path.join(sb.projectRoot, "backup", "v_d");
  const files = [{ relativePath: "out/nls.messages.json", sourcePath: sb.nlsFile }];
  createBackup(dir, { cursorVersion: "v", distro: "d", commit: "c", files });
  assert.throws(
    () => createBackup(dir, { cursorVersion: "v", distro: "d", commit: "c", files }),
    /备份目录已存在/
  );
});

// ───────────────────────── 助记符 / 校验 / 组装 ─────────────────────────

test("normalizeMnemonic：统一为官方「译文(&&X)」风格且大写", () => {
  assert.equal(normalizeMnemonic("Cu&&t", "剪切"), "剪切(&&T)");
  assert.equal(normalizeMnemonic("Cu&&t", "文&&件"), "文件(&&T)");
  assert.equal(normalizeMnemonic("Cu&&t", "剪切(&&T)"), "剪切(&&T)");
  assert.equal(normalizeMnemonic("&&Close", "关闭(&C)"), "关闭(&&C)");
  assert.equal(normalizeMnemonic("Restart", "重启"), "重启", "原文无 && 则不加");
});

test("validateOverrides：拦截占位符与空译文，不拦截全角引号", () => {
  const flat = [
    { moduleId: "m", key: "k1", en: "Delete {0} files?", index: 0 },
    { moduleId: "m", key: "k2", en: "&&Save", index: 1 },
  ];
  const bad = validateOverrides({ m: { k1: "删除文件？", k2: "" } }, flat);
  assert.equal(bad.errors.length, 2, "占位符丢失 + 空译文各算一条");

  const good = validateOverrides({ m: { k1: "删除 {0} 个文件？", k2: "保存“全部”(&&S)" } }, flat);
  assert.equal(good.errors.length, 0, "全角引号不应算错误");
});

test("validateResolved：占位符不匹配一律硬错误（归一化来源已在 merge 阶段过滤）", () => {
  const r = validateResolved([
    { index: 0, moduleId: "m", key: "k", en: "{0} items", zh: "项目", source: "override" },
    { index: 1, moduleId: "m", key: "k", en: "{0} items", zh: "项目", source: "renamed<old>" },
  ]);
  assert.equal(r.errors.length, 2, "两种来源的不匹配都要拦");
  assert.equal(r.warnings.length, 0);
});

test("merge：归一化兜底只在占位符对齐时生效（防止界面字面显示 {0}）", () => {
  const pack = new Map([
    ["m/old", new Map([
      ["ok", "已成功安装 Shell 命令“{0}”。"],
      ["leak", "在 PATH 中安装“{0}”命令"],
    ])],
  ]);
  const rules = [{ from: "m/new", to: "m/old" }];
  const flat = [
    { moduleId: "m/new", key: "ok", en: "Shell command '{0}' successfully installed.", index: 0 },
    { moduleId: "m/new", key: "leak", en: "Install 'code' command", index: 1 },
  ];

  const r = merge({ flat, pack, overrides: {}, renameRules: rules });
  assert.equal(r.resolved[0].zh, "已成功安装 Shell 命令“{0}”。", "占位符对齐 → 复用");
  assert.equal(r.resolved[1].zh, null, "占位符对不上 → 宁可留英文缺口");
  assert.equal(r.stats.renamedRejected, 1);
});

test("assemble：以工作单为真源，报出缺译与多余键", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-asm-"));
  const missing = { "mod/a": [{ key: "k1", en: "One" }, { key: "k2", en: "Two" }] };
  const f = path.join(tmp, "out-01.json");
  fs.writeFileSync(f, JSON.stringify({ "mod/a": { k1: "一", kX: "多出来的" } }), "utf8");

  const r = assemble({ missing, batchFiles: [f] });
  assert.deepEqual(r.overrides, { "mod/a": { k1: "一" } });
  assert.deepEqual(r.missingKeys.map((m) => m.key), ["k2"]);
  assert.equal(r.unexpected.length, 1);
  assert.equal(r.unexpected[0].key, "kX");
});

test("merge：字符串形式对该 key 下所有索引生效，对象形式按英文逐条生效", () => {
  const pack = new Map([["m/old", new Map([["dup", "来自旧路径的同一句"]])]]);
  const rules = [{ from: "m/new", to: "m/old" }];
  const flat = [
    { moduleId: "m/new", key: "dup", en: "Installed", index: 0 },
    { moduleId: "m/new", key: "dup", en: "Unlinked", index: 1 },
  ];

  const strForm = merge({ flat, pack, overrides: { "m/new": { dup: "已安装" } }, renameRules: rules });
  assert.equal(strForm.resolved[0].zh, "已安装");
  assert.equal(strForm.resolved[1].zh, "已安装", "字符串形式按约定一译多用");

  const objForm = merge({
    flat,
    pack,
    overrides: { "m/new": { dup: { Installed: "已安装", Unlinked: "已解除链接" } } },
    renameRules: rules,
  });
  assert.equal(objForm.resolved[0].zh, "已安装");
  assert.equal(objForm.resolved[1].zh, "已解除链接", "重名键按英文分别取译文");

  const noOverride = merge({ flat, pack, overrides: {}, renameRules: rules });
  assert.equal(noOverride.resolved[0].zh, "来自旧路径的同一句");
  assert.equal(noOverride.resolved[1].zh, "来自旧路径的同一句", "兜底路径下重名键必然同值");
});

test("assemble：重名键英文相同 → 字符串形式；不同 → 对象形式", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-zh-dup-"));
  const missing = {
    "mod/a": [
      { key: "same", en: "Alpha" },
      { key: "same", en: "Alpha" },
      { key: "diff", en: "Installed" },
      { key: "diff", en: "Unlinked" },
    ],
  };

  // 分片里同一个 key 只能给一条字符串译文（当前 10 个翻译代理的产出格式）
  const strFile = path.join(tmp, "out-01.json");
  fs.writeFileSync(strFile, JSON.stringify({ "mod/a": { same: "同名同义", diff: "一条通吃" } }), "utf8");
  const r1 = assemble({ missing, batchFiles: [strFile] });

  assert.equal(r1.overrides["mod/a"].same, "同名同义", "英文相同的重名键可退化为字符串");
  assert.deepEqual(r1.overrides["mod/a"].diff, {
    Installed: "一条通吃",
    Unlinked: "一条通吃",
  });
  assert.equal(r1.missingKeys.length, 0);
  assert.equal(r1.ambiguous.length, 1, "字符串落到多条不同英文上必须报歧义");
  assert.equal(r1.ambiguous[0].key, "diff");

  // 对象形式：逐条区分，无歧义
  const objFile = path.join(tmp, "out-02.json");
  fs.writeFileSync(
    objFile,
    JSON.stringify({ "mod/a": { same: "同名同义", diff: { Installed: "已安装", Unlinked: "已解除链接" } } }),
    "utf8"
  );
  const r2 = assemble({ missing, batchFiles: [objFile] });
  assert.deepEqual(r2.overrides["mod/a"].diff, { Installed: "已安装", Unlinked: "已解除链接" });
  assert.equal(r2.ambiguous.length, 0);
  assert.equal(r2.missingKeys.length, 0);

  // 只给一条、漏掉另一条英文 → 必须报缺译，不能静默
  const partial = path.join(tmp, "out-03.json");
  fs.writeFileSync(
    partial,
    JSON.stringify({ "mod/a": { same: "同名同义", diff: { Installed: "已安装" } } }),
    "utf8"
  );
  const r3 = assemble({ missing, batchFiles: [partial] });
  assert.deepEqual(r3.missingKeys.map((m) => m.en), ["Unlinked"]);
});

test("validateOverrides：重名键的占位符按各自英文校验", () => {
  // 同一个 key 下两种英文，一个带 {0} 一个不带
  const flat = [
    { moduleId: "m", key: "install", en: "Install '{0}' command", index: 0 },
    { moduleId: "m", key: "install", en: "Install 'code' command", index: 1 },
  ];

  const str = validateOverrides({ m: { install: "安装 'code' 命令" } }, flat);
  assert.equal(str.errors.length, 1, "字符串形式缺 {0}，必须报错而不是漏过");
  assert.ok(str.warnings.some((w) => w.includes("多条不同英文")));

  const obj = validateOverrides(
    { m: { install: { "Install '{0}' command": "安装 '{0}' 命令", "Install 'code' command": "安装 'code' 命令" } } },
    flat
  );
  assert.equal(obj.errors.length, 0, "对象形式逐条给对占位符即通过");

  const objMissing = validateOverrides({ m: { install: { "Install '{0}' command": "安装 '{0}' 命令" } } }, flat);
  assert.ok(objMissing.warnings.some((w) => w.includes("未给译文")), "漏掉的英文要告警");
});

test("countOverrides：对象形式按实际译文条数计", () => {
  assert.equal(countOverrides({ a: { k: "一" } }), 1);
  assert.equal(countOverrides({ a: { k: { X: "一", Y: "二" } } }), 2);
});

test("校验：全角引号确实是合法 JSON", () => {
  const s = JSON.stringify({ a: "保存“全部”(&&S)" });
  assert.deepEqual(JSON.parse(s), { a: "保存“全部”(&&S)" });
  assert.equal(crypto.createHash("sha256").update(s).digest("hex").length, 64);
});

test("项目根可解析（防止路径假设写死）", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "CLAUDE.md")));
});
