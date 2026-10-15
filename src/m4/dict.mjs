// M4 译文表：data/m4.json，形如 { "英文原文": "中文" }。
//
// 用英文原文当键而不是位置——位置会随 Cursor 升级整体漂移，原文相对稳定，
// 也让工作单、审校记录、译文表三者的对照关系一眼可见。

import fs from "node:fs";

export function loadM4Dict(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function countM4Dict(dict) {
  return Object.keys(dict).length;
}

// 译文要写进 JS 字符串字面量，换行与控制字符会直接破坏语法；
// 空译文和「原文=译文」通常意味着漏填，一并拦下。
export function validateM4Dict(dict) {
  const errors = [];
  for (const [en, zh] of Object.entries(dict)) {
    if (typeof zh !== "string") {
      errors.push(`${JSON.stringify(en)} 的译文不是字符串`);
      continue;
    }
    if (!zh.trim()) errors.push(`${JSON.stringify(en)} 的译文为空`);
    else if (/[\r\n]/.test(zh)) errors.push(`${JSON.stringify(en)} 的译文含换行`);
    else if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(zh)) errors.push(`${JSON.stringify(en)} 的译文含控制字符`);
    else if (zh === en) errors.push(`${JSON.stringify(en)} 的译文与原文相同`);
  }
  return { errors };
}
