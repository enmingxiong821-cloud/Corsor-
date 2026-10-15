// 合并译文，产出按索引对齐的最终结果。
//
// 优先级：精确 → 补译词典 → 路径归一化兜底。
//
// 为什么补译优先于归一化（与 docs/05 §4.5 的初版顺序相反，有实测依据）：
//   · 归一化靠「模块路径 + 键名」查表，而 1,971 条缺口中有 273 条在同模块内键名重复，
//     重名键必然被赋同一句译文（实测索引 11933/11934 拿到同一段中文，其中一条语义相反）。
//   · 补译词典可以按英文原文细分，重名但英文不同的键能分别给译文。
//   · 另测：归一化救回的 332 条中有 4 条占位符不匹配（官方包自身亦有 21 条），
//     说明它是"有损复用"，只适合在没有自有译文时兜底。
// 归一化仍然保留，用于报告里展示 85.43% → 87.89% 的投影，以及后续缺译时的兜底。
//
// 补译词典的两种取值形式：
//   字符串            "译文"              → 该 key 下所有索引共用（仅当它们英文相同才正确）
//   对象              { 英文原文: 译文 }   → 按英文逐条区分（重名键的唯一正确写法）

import { variants } from "./normalize.mjs";
import { normalizeMnemonic } from "./mnemonic.mjs";

export const SOURCE = {
  EXACT: "exact",
  OVERRIDE: "override",
  RENAMED: "renamed",
  MISSING: "missing",
};

// 补译词典取值：字符串对该 key 下所有索引生效；对象按英文原文取。
// merge 与 dict/validate 共用，保证「怎么查」和「怎么校验」永远一致。
export function overrideFor(overrides, moduleId, key, en) {
  const slot = overrides?.[moduleId]?.[key];
  if (typeof slot === "string") return slot;
  if (slot && typeof slot === "object" && !Array.isArray(slot)) return slot[en];
  return undefined;
}

export function placeholdersOf(s) {
  const out = [];
  for (const m of String(s ?? "").matchAll(/\{(\d+)\}/g)) out.push(Number(m[1]));
  return out.sort((a, b) => a - b);
}

const samePlaceholders = (en, zh) =>
  placeholdersOf(en).join(",") === placeholdersOf(zh).join(",");

export function merge({ flat, pack, overrides, renameRules, useRenames = true }) {
  const resolved = new Array(flat.length);
  const missing = [];
  const stats = { total: flat.length, exact: 0, override: 0, renamed: 0, renamedRejected: 0, missing: 0 };
  // 仅作报告投影：不管补译是否存在，归一化"理论上"能命中多少
  let rescueableByRename = 0;

  for (const item of flat) {
    const { moduleId, key, index } = item;
    const exact = pack.get(moduleId)?.get(key);

    let renamed = null;
    let renamedFrom = null;
    for (const v of variants(moduleId, renameRules)) {
      const hit = pack.get(v)?.get(key);
      if (hit !== undefined) {
        renamed = hit;
        renamedFrom = v;
        break;
      }
    }
    if (exact === undefined && renamed !== null) rescueableByRename++;

    const override = overrideFor(overrides, moduleId, key, item.en);

    let zh = null;
    let source = SOURCE.MISSING;
    if (exact !== undefined) {
      zh = exact;
      source = SOURCE.EXACT;
      stats.exact++;
    } else if (typeof override === "string" && override.length > 0) {
      zh = normalizeMnemonic(item.en, override);
      source = SOURCE.OVERRIDE;
      stats.override++;
    } else if (useRenames && renamed !== null && samePlaceholders(item.en, renamed)) {
      zh = renamed;
      source = `${SOURCE.RENAMED}<${renamedFrom}>`;
      stats.renamed++;
    } else {
      // 旧路径译文与当前英文的占位符对不上 → 放弃复用。硬套会让界面字面显示 "{0}"，
      // 实测 installActions 的 5 条正是如此（其中两条英文语义相反却拿到同一句中文）。
      if (useRenames && renamed !== null) stats.renamedRejected++;
      stats.missing++;
    }

    resolved[index] = { ...item, zh, source, renamedFrom };
    if (zh === null) missing.push(resolved[index]);
  }

  return { resolved, missing, stats, rescueableByRename };
}

// M1 验收口径：只按 moduleId 精确匹配，不做归一化、不接补译。
// 这个数字必须与 docs/03 §3.1 完全一致（11,559 / 1,971 / 295）。
export function mergeStrict({ flat, pack }) {
  const resolved = new Array(flat.length);
  const missing = [];
  const stats = { total: flat.length, exact: 0, missing: 0 };
  const missingModules = new Set();

  for (const item of flat) {
    const zh = pack.get(item.moduleId)?.get(item.key);
    if (zh !== undefined) {
      resolved[item.index] = { ...item, zh, source: SOURCE.EXACT };
      stats.exact++;
    } else {
      resolved[item.index] = { ...item, zh: null, source: SOURCE.MISSING };
      missing.push(resolved[item.index]);
      stats.missing++;
      missingModules.add(item.moduleId);
    }
  }

  return { resolved, missing, stats, missingModuleCount: missingModules.size };
}
