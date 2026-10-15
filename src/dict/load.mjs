// 加载补译词典。只认「moduleId → key → 译文」的两层结构。

import fs from "node:fs";

export function loadOverrides(overridesPath) {
  if (!fs.existsSync(overridesPath)) return {};
  const raw = JSON.parse(fs.readFileSync(overridesPath, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${overridesPath} 必须是 { moduleId: { key: 译文 } } 对象`);
  }
  const out = {};
  for (const [moduleId, keys] of Object.entries(raw)) {
    if (moduleId.startsWith("_")) continue; // 允许 _note / _schema 等说明字段
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) continue;
    out[moduleId] = { ...keys };
  }
  return out;
}

// 统计实际译文条数：重名键写成对象时，一个 key 下有多条译文。
export function countOverrides(overrides) {
  let n = 0;
  for (const keys of Object.values(overrides)) {
    for (const slot of Object.values(keys)) {
      n += typeof slot === "string" ? 1 : Object.keys(slot ?? {}).length;
    }
  }
  return n;
}
