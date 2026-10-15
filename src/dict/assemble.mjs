// 把分片译文组装成 data/overrides.json，并以 build/missing.json 为准逐个核对。
//
// 关键：以**工作单**为唯一真源，而不是以译文文件为准。
// 少条目、多条目、键名对不上，都要报出来，绝不静默放过——否则缺口会悄悄留英文。
//
// ★ 重名键：同一个模块内可能有多个同名 key 对应不同英文原文（实测 1,971 条缺口里 273 条如此，
//   其中 15 条英文互不相同）。只按 key 存译文会让它们共用一句中文，实测会让
//   "Successfully installed…" 与 "Successfully unlinked…" 拿到同一句、其中一条语义相反。
//   因此产物对这类键自动写成 { 英文原文: 译文 } 形式，逐条区分。

import fs from "node:fs";
import path from "node:path";

const slotOf = (moduleId, key) => `${moduleId}\u0000${key}`;

export function assemble({ missing, batchFiles }) {
  // —— 工作单展开：按顺序保留每一条，不用 Map 去重 ——
  const plan = [];
  const groups = new Map(); // slot -> Set(英文原文)
  for (const [moduleId, items] of Object.entries(missing)) {
    for (const it of items) {
      plan.push({ moduleId, key: it.key, en: it.en });
      const slot = slotOf(moduleId, it.key);
      if (!groups.has(slot)) groups.set(slot, new Set());
      groups.get(slot).add(it.en);
    }
  }

  // —— 读分片译文 ——
  // 字符串形式落到多条不同英文上时记为空串键 ""，用于事后报告歧义
  const raw = new Map(); // slot -> Map(英文原文 | "" -> 译文)
  const unexpected = [];
  const problems = [];

  for (const file of batchFiles) {
    const base = path.basename(file);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const [moduleId, keys] of Object.entries(data)) {
      for (const [key, slot] of Object.entries(keys)) {
        const gk = slotOf(moduleId, key);
        const group = groups.get(gk);
        if (!group) {
          unexpected.push({ file: base, moduleId, key, zh: slot });
          continue;
        }

        let pairs;
        if (typeof slot === "string") {
          const only = [...group];
          pairs = group.size === 1 ? [[only[0], slot]] : [["", slot]];
        } else if (slot && typeof slot === "object" && !Array.isArray(slot)) {
          pairs = Object.entries(slot);
          for (const [en] of pairs) {
            if (!group.has(en)) {
              problems.push(
                `英文原文对不上：${moduleId} :: ${key} 下的 ${JSON.stringify(en)} 不在工作单里（${base}）`
              );
            }
          }
          pairs = pairs.filter(([en]) => group.has(en));
        } else {
          problems.push(`取值必须是字符串或 { 英文原文: 译文 }：${moduleId} :: ${key}（${base}）`);
          continue;
        }

        if (!raw.has(gk)) raw.set(gk, new Map());
        const store = raw.get(gk);
        for (const [en, zh] of pairs) {
          if (typeof zh !== "string" || zh.trim() === "") continue;
          if (store.has(en)) {
            problems.push(
              `重复定义：${moduleId} :: ${key}${en ? " " + JSON.stringify(en) : ""}（${base}）`
            );
            continue;
          }
          store.set(en, zh);
        }
      }
    }
  }

  // —— 逐条落实 ——
  const resolved = [];
  const missingKeys = [];
  const ambiguous = new Map(); // slot -> [英文原文...]

  for (const { moduleId, key, en } of plan) {
    const gk = slotOf(moduleId, key);
    const group = groups.get(gk);
    const store = raw.get(gk);

    let zh;
    if (store?.has(en)) zh = store.get(en);
    else if (store?.has("")) {
      zh = store.get("");
      if (group.size > 1) ambiguous.set(gk, [...group]);
    }

    if (zh === undefined) missingKeys.push({ moduleId, key, en });
    else resolved.push({ moduleId, key, en, zh, multi: group.size > 1 });
  }

  // —— 落成产物：单条英文写成字符串，重名键写成 { 英文原文: 译文 } ——
  const overrides = {};
  for (const e of resolved) {
    overrides[e.moduleId] ||= {};
    if (!e.multi) overrides[e.moduleId][e.key] = e.zh;
    else (overrides[e.moduleId][e.key] ||= {})[e.en] = e.zh;
  }

  // 保持工作单里的模块顺序，便于 diff
  const ordered = {};
  for (const moduleId of Object.keys(missing)) {
    if (overrides[moduleId] && Object.keys(overrides[moduleId]).length) {
      ordered[moduleId] = overrides[moduleId];
    }
  }

  return {
    overrides: ordered,
    missingKeys,
    unexpected,
    problems,
    ambiguous: [...ambiguous].map(([gk, ens]) => {
      const [moduleId, key] = gk.split("\u0000");
      return { moduleId, key, ens };
    }),
  };
}

export function writeOverrides(file, overrides) {
  const payload = {
    _schema:
      "{ moduleId: { key: 译文 | { 英文原文: 译文 } } }；" +
      "重名键必须用对象形式逐条区分；由 tools 管线生成，人工审校后固化",
    ...overrides,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 1) + "\n", "utf8");
  return file;
}
