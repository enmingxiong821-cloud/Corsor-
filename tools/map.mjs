// 诊断"路径漂移"造成的假缺口：上游 VS Code 把 electron-browser 重命名为
// electron-sandbox 之后，语言包仍按旧路径组织，导致译文对不上号。
//
// 本脚本量化：
//   1. baseline（严格按 moduleId 精确匹配）
//   2. 路径归一化后能救回多少键
//   3. 全局键名兜底还能救回多少
//   4. 真正需要新翻译的净缺口
//
// 运行: node tools/map.mjs

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
const bundle = read(path.join(PACK, "translations", "main.i18n.json"));
const contents = bundle.contents ?? bundle;

// 全局键名索引：key -> [译文...]（仅用于兜底统计）
const byKey = new Map();
for (const mod of Object.keys(contents)) {
  for (const [k, v] of Object.entries(contents[mod])) {
    if (!v) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(v);
  }
}

// 常见上游目录重命名（VS Code layering 重构）
const RENAMES = [
  ["electron-browser", "electron-sandbox"],
  ["electron-sandbox", "electron-browser"],
  ["/browser/", "/electron-browser/"],
  ["/electron-browser/", "/browser/"],
  ["contrib/search/common", "contrib/search/browser"],
];

function variants(mod) {
  const out = new Set();
  for (const [a, b] of RENAMES) {
    if (mod.includes(a)) out.add(mod.split(a).join(b));
  }
  return [...out];
}

let total = 0;
let baseHit = 0;
let renameHit = 0;
let keyFallback = 0;
let netMiss = 0;

const stillMissing = [];
const renameSaved = [];

for (const [mod, keys] of nls) {
  const b = contents[mod];
  const vs = variants(mod);
  for (const k of keys) {
    total++;
    if (b?.[k]) {
      baseHit++;
      continue;
    }
    let ok = false;
    for (const v of vs) {
      if (contents[v]?.[k]) {
        renameHit++;
        if (renameSaved.length < 25) renameSaved.push(`${mod}  ->  ${v}  [${k}]`);
        ok = true;
        break;
      }
    }
    if (ok) continue;
    if (byKey.has(k)) {
      keyFallback++;
      continue; // 键名别处出现过，但模块不同，语义存疑 -> 单列
    }
    netMiss++;
    stillMissing.push({ mod, k });
  }
}

const p = (a) => `${((a / total) * 100).toFixed(2)}%`;
console.log("=".repeat(74));
console.log(`总键数                : ${total.toLocaleString()}`);
console.log(`baseline 命中         : ${baseHit.toLocaleString()}  (${p(baseHit)})`);
console.log(`路径归一化额外救回    : ${renameHit.toLocaleString()}  (${p(renameHit)})`);
console.log(`  -> 合计可达          : ${(baseHit + renameHit).toLocaleString()}  (${p(baseHit + renameHit)})`);
console.log(`全局同名键兜底(存疑)  : ${keyFallback.toLocaleString()}  (${p(keyFallback)})`);
console.log(`净缺口(必须新翻译)    : ${netMiss.toLocaleString()}  (${p(netMiss)})`);
console.log("=".repeat(74));

console.log("\n--- 路径归一化救回样例 ---");
for (const s of renameSaved) console.log("  " + s);

console.log("\n--- 净缺口所属模块 Top 25 ---");
const g = new Map();
for (const x of stillMissing) g.set(x.mod, (g.get(x.mod) ?? 0) + 1);
for (const [m, n] of [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(n).padStart(4)}  ${m}`);
}
