// 补译词典与最终译文校验。
//
// 分级原则（有实测依据）：
//   · 硬错误 = 只会由"我方产出"造成、且会让界面出问题的问题 → 占位符丢失/编号不一致、空译文
//   · 软告警 = 官方语言包自身也大量存在的问题 → 全角引号、非我方产出的占位符偏差
//
// 关于全角引号：它**不是** JSON 问题（U+201C/U+201D 是普通 Unicode 字符，JSON 合法），
// 官方 zh-hans 包在 11,559 条精确命中里就用了 928 处。此处仅作风格提示，不阻塞。
// （docs/05 §8.5 的旧说法"全角引号会让 JSON 失效"已作废。）

import { SOURCE, placeholdersOf } from "../align/merge.mjs";

const FULLWIDTH_QUOTES = /[“”‘’]/;

export function validateOverrides(overrides, flat) {
  const errors = [];
  const warnings = [];
  // 同一个 moduleId+key 可能对应多条不同英文（重名键），必须按英文分别校验，
  // 否则占位符会校验到"碰巧排在最后"的那条英文上，放过缺 {0} 的译文。
  const byKey = new Map();
  for (const item of flat) {
    const k = `${item.moduleId}\u0000${item.key}`;
    if (!byKey.has(k)) byKey.set(k, new Map());
    byKey.get(k).set(item.en, item);
  }

  let fullwidth = 0;

  const checkPair = (at, en, zh) => {
    if (typeof zh !== "string" || zh.trim() === "") {
      errors.push(`译文为空 —— ${at}\n    原文 ${JSON.stringify(en)}`);
      return;
    }

    const want = placeholdersOf(en ?? "");
    const got = placeholdersOf(zh);
    if (want.join(",") !== got.join(",")) {
      errors.push(
        `占位符不匹配 —— ${at}\n    原文 {${want.join("} {")}}  译文 {${got.join("} {")}}\n    ${JSON.stringify(en)} → ${JSON.stringify(zh)}`
      );
    }

    const enMnemonic = ((en ?? "").match(/&&/g) || []).length;
    const zhMnemonic = (zh.match(/&&/g) || []).length;
    if (enMnemonic === 1 && zhMnemonic !== 1) {
      // 不是错误：merge 阶段会按官方风格统一改写成「译文(&&X)」
      warnings.push(`助记符将由归一化补齐（原文 1 个，译文 ${zhMnemonic} 个）—— ${at}`);
    }
    if (enMnemonic === 0 && zhMnemonic > 0) {
      warnings.push(`原文无 && 但译文出现 && —— ${at}`);
    }

    if (FULLWIDTH_QUOTES.test(zh)) fullwidth++;
  };

  for (const [moduleId, keys] of Object.entries(overrides)) {
    for (const [key, slot] of Object.entries(keys)) {
      const at = `${moduleId} :: ${key}`;
      const group = byKey.get(`${moduleId}\u0000${key}`);
      if (!group) {
        warnings.push(`键不在当前 Cursor 键表中（升级后可能残留）—— ${at}`);
        continue;
      }

      if (typeof slot === "string") {
        if (group.size > 1) {
          warnings.push(
            `${at} 下有多条不同英文（${group.size} 条），字符串形式会一译多用。` +
              "若语义不同请改用 { 英文原文: 译文 } 形式。"
          );
        }
        // 字符串对该 key 下所有索引生效，因此要对每一条英文都成立
        for (const en of group.keys()) checkPair(at, en, slot);
        continue;
      }

      if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
        errors.push(`取值必须是字符串或 { 英文原文: 译文 } —— ${at}`);
        continue;
      }

      for (const [en, zh] of Object.entries(slot)) {
        if (!group.has(en)) {
          warnings.push(`${at} 下没有这条英文原文（升级后可能残留）—— ${JSON.stringify(en)}`);
          continue;
        }
        checkPair(at, en, zh);
      }
      for (const en of group.keys()) {
        if (!Object.hasOwn(slot, en)) {
          warnings.push(`${at} 有英文原文未给译文（重名键需逐条给）—— ${JSON.stringify(en)}`);
        }
      }
    }
  }

  if (fullwidth > 0) warnings.push(`${fullwidth} 条译文含全角引号（风格问题，官方包同样如此，不阻塞）`);

  return { errors, warnings };
}

// 写入前的最后一道闸。只对"将要写进默认表"的条目做检查。
// 归一化来源的译文已在 merge 阶段按占位符过滤掉，走到这里的只有 override 与
// 占位符已对齐的 renamed，因此任何不匹配都说明上游有 bug，一律按硬错误处理。
export function validateResolved(resolved) {
  const errors = [];
  const warnings = [];
  let fullwidth = 0;

  for (const r of resolved) {
    if (r.zh === null || r.source === SOURCE.EXACT) continue;

    if (typeof r.zh !== "string" || r.zh.length === 0) {
      errors.push(`索引 ${r.index} 译文为空：${r.moduleId} :: ${r.key}`);
      continue;
    }

    if (FULLWIDTH_QUOTES.test(r.zh)) fullwidth++;

    const want = placeholdersOf(r.en);
    const got = placeholdersOf(r.zh);
    if (want.join(",") !== got.join(",")) {
      errors.push(
        `索引 ${r.index} 占位符不匹配：${r.moduleId} :: ${r.key}\n    ` +
          `${JSON.stringify(r.en)} → ${JSON.stringify(r.zh)}`
      );
    }
  }

  if (fullwidth > 0) warnings.push(`${fullwidth} 条译文含全角引号（风格问题，不阻塞）`);

  return { errors, warnings };
}
