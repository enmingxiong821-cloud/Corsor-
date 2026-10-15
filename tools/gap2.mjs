// 真实覆盖率分析（替换早前错误的扁平数组解析）。
//
// 数据结构（已核实）：
//   out/nls.keys.json     : [[moduleId, [messageKey, ...]], ...]    1150 模块 / 13530 键
//   语言包 main.i18n.json : { moduleId: { messageKey: 译文 } }      1855 模块
//
// 命中 = 语言包中同一 moduleId 下存在非空译文；否则回退英文。
// 运行: node tools/gap2.mjs

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
const bundleRaw = read(path.join(PACK, "translations", "main.i18n.json"));
const bundle = bundleRaw.contents ?? bundleRaw;

const extDir = path.join(PACK, "translations", "extensions");
const extBundles = fs.existsSync(extDir)
  ? fs.readdirSync(extDir).filter((f) => f.endsWith(".i18n.json"))
  : [];

let total = 0;
let hit = 0;
let empty = 0;
const moduleStats = [];

for (const [mod, keys] of nls) {
  const b = bundle[mod];
  let h = 0;
  let m = 0;
  let e = 0;
  for (const k of keys) {
    total++;
    const v = b?.[k];
    if (typeof v === "string" && v.length > 0) {
      h++;
    } else if (v === "") {
      e++;
    } else {
      m++;
    }
  }
  hit += h;
  empty += e;
  moduleStats.push({ mod, h, m, e, n: keys.length });
}

const pct = (a, b) => `${((a / b) * 100).toFixed(2)}%`;
console.log("=".repeat(78));
console.log(`Cursor 模块数     : ${nls.length}`);
console.log(`Cursor 消息键总数 : ${total.toLocaleString()}`);
console.log(`语言包模块数      : ${Object.keys(bundle).length.toLocaleString()}`);
console.log(`已本地化          : ${hit.toLocaleString()}  (${pct(hit, total)})`);
console.log(`空字符串译文      : ${empty.toLocaleString()}`);
console.log(`未本地化(走英文)  : ${(total - hit - empty).toLocaleString()}  (${pct(total - hit - empty, total)})`);

const prod = read(path.join(APP, "product.json"));
console.log(`Cursor 版本       : ${prod.version}  (VS Code ${prod.vscodeVersion})`);
console.log("=".repeat(78));

const rows = moduleStats.filter((r) => r.m > 0).sort((a, b) => b.m - a.m);
console.log(`\n--- 有缺口的模块：${rows.length} / ${nls.length} ---`);
console.log(`${"miss".padStart(6)} ${"ok".padStart(6)} ${"total".padStart(6)}  coverage  module`);
for (const r of rows.slice(0, 40)) {
  console.log(
    `${String(r.m).padStart(6)} ${String(r.h).padStart(6)} ${String(r.n).padStart(6)}  ${pct(r.h, r.n).padStart(7)}  ${r.mod}`
  );
}

const cursorMods = moduleStats.filter((r) => /cursor|anysphere/i.test(r.mod));
const cm = cursorMods.reduce((a, r) => a + r.m, 0);
const cn = cursorMods.reduce((a, r) => a + r.n, 0);
console.log(`\n--- 名称含 cursor/anysphere 的模块 ---`);
console.log(`模块 ${cursorMods.length} 个 / 键 ${cn} / 缺口 ${cm}`);
for (const r of cursorMods.sort((a, b) => b.m - a.m).slice(0, 25)) {
  console.log(`  ${String(r.m).padStart(4)}/${String(r.n).padStart(4)}  ${r.mod}`);
}

const builtinExt = path.join(APP, "extensions");
const installed = fs.existsSync(builtinExt)
  ? fs.readdirSync(builtinExt).filter((d) => fs.existsSync(path.join(builtinExt, d, "package.json")))
  : [];
console.log(`\n--- 内置扩展 ---`);
console.log(`Cursor 内置扩展  : ${installed.length}`);
console.log(`语言包扩展 bundle: ${extBundles.length}`);
console.log(`样例: ${extBundles.slice(0, 8).join(", ")}`);
