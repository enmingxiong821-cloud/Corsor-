// 模块路径归一化：把 Cursor 现用路径还原成语言包里的旧路径。
//
// 方向很重要——from 是 Cursor 现用路径，to 是语言包中的路径。
// 规则全部来自 data/renames.json，不硬编码，便于升级后维护。

import fs from "node:fs";

const REPLACE_ALL = "replaceAll";

export function loadRenames(renamesPath) {
  if (!fs.existsSync(renamesPath)) return [];
  const raw = JSON.parse(fs.readFileSync(renamesPath, "utf8"));
  const rules = Array.isArray(raw) ? raw : raw.rules;
  if (!Array.isArray(rules)) return [];
  return rules.filter(
    (r) => r && typeof r.from === "string" && typeof r.to === "string" && r.from !== r.to
  );
}

// 返回候选 moduleId 数组（不含原始值），按规则出现顺序。
export function variants(moduleId, rules) {
  const out = new Set();
  for (const r of rules) {
    if (!moduleId.includes(r.from)) continue;
    out.add(moduleId.replaceAll(r.from, r.to));
  }
  return [...out];
}
