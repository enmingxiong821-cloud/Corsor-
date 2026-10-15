// 展开缺口清单，并导出待翻译工作单。
//
// 关键事实（已核实）：
//   out/nls.keys.json     = [[moduleId, [key...]], ...]   顺序展开
//   out/nls.messages.json = [英文原文...] 长度 13530，与上面逐位对应
//   main.i18n.json        = { moduleId: { key: 译文 } }
//
// 运行: node tools/gap3.mjs    -> 打印摘要，并写出 build/missing.json

import fs from "node:fs";
import path from "node:path";

const APP = path.join(process.env.LOCALAPPDATA, "Programs", "cursor", "resources", "app");
const PACK = path.join(
  process.env.USERPROFILE,
  ".cursor",
  "extensions",
  "ms-ceintl.vscode-language-pack-zh-hans-1.128.0-universal"
);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const nls = read(path.join(APP, "out", "nls.keys.json"));
const messages = read(path.join(APP, "out", "nls.messages.json"));
const bundle = read(path.join(PACK, "translations", "main.i18n.json"));
const contents = bundle.contents ?? bundle;

const items = [];
let i = 0;
for (const [mod, keys] of nls) {
  for (const key of keys) {
    const en = messages[i++];
    const zh = contents[mod]?.[key];
    items.push({ mod, key, en, zh: typeof zh === "string" ? zh : null, done: !!(zh && zh.length) });
  }
}

const missing = items.filter((x) => !x.done);
const byMod = new Map();
for (const x of missing) byMod.set(x.mod, (byMod.get(x.mod) ?? 0) + 1);

console.log(`总键 ${items.length} | 已译 ${items.length - missing.length} | 缺口 ${missing.length}`);
console.log(`涉及模块 ${byMod.size} 个\n`);

const outDir = path.join(process.cwd(), "build");
fs.mkdirSync(outDir, { recursive: true });

// 工作单：只保留缺口，按模块分组，附带英文原文与当前位置
const worksheet = {};
for (const x of missing) {
  (worksheet[x.mod] ??= []).push({ key: x.key, en: x.en });
}
fs.writeFileSync(path.join(outDir, "missing.json"), JSON.stringify(worksheet, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "all-keys.json"), JSON.stringify(items, null, 2), "utf8");

console.log("--- 缺口模块（英文原文样例）---");
const sorted = [...byMod.entries()].sort((a, b) => b[1] - a[1]);
for (const [mod, n] of sorted.slice(0, 32)) {
  const samples = missing.filter((x) => x.mod === mod).slice(0, 2);
  console.log(`\n[${n}] ${mod}`);
  for (const s of samples) console.log(`     ${s.key} = ${JSON.stringify(s.en).slice(0, 96)}`);
}

// 判断缺口里有多少是"标准 VS Code 模块"（命名不含 cursor/anysphere）—— 这类可能能从上游
// vscode-loc 仓库补到翻译，而不是从零翻译。
const upstream = missing.filter((x) => !/cursor|anysphere/i.test(x.mod));
console.log(`\n缺口构成: 标准模块路径 ${upstream.length}  vs  Cursor 专有路径 ${missing.length - upstream.length}`);
console.log(`\n已写出: build/missing.json, build/all-keys.json`);
