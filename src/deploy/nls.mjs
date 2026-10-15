// NLS 层构建：改写免校验的 out/nls.messages.json。
//
// 原理（docs/03 §1.1 实测确证）：运行时按 `pack[key] || defaultMsgs[i]` 合并，
// 语言包没有的键才回退到默认表。所以
//   · 只改「语言包未覆盖」的索引 → 其余 11,559 条保持字节不变，diff 最小
//   · 不改任何被校验文件 → 无需重算 product.json.checksums
// 代价：必须同时失效 clp 缓存（见 cache.mjs）。

import { SOURCE } from "../align/merge.mjs";

// 返回 { messages, changed, unchangedCount }
// messages 是可直接 JSON.stringify 写盘的完整数组（长度不变、顺序不变）
export function buildPatchedMessages({ defaultMessages, resolved }) {
  const messages = defaultMessages.slice();
  const changed = [];

  for (const r of resolved) {
    if (r.zh === null) continue;
    // 语言包精确命中的键，运行时根本不读默认表，改了也没有意义
    if (r.source === SOURCE.EXACT) continue;
    if (messages[r.index] === r.zh) continue;

    changed.push({
      index: r.index,
      moduleId: r.moduleId,
      key: r.key,
      before: messages[r.index],
      after: r.zh,
      source: r.source,
    });
    messages[r.index] = r.zh;
  }

  return { messages, changed };
}

export function renderDiffSummary(changed, total, limit = 8) {
  const lines = [`将改写 ${changed.length} 条（其余 ${(total - changed.length).toLocaleString("en-US")} 条字节不变）`];
  for (const c of changed.slice(0, limit)) {
    lines.push(`  [${c.index}] ${c.before}`);
    lines.push(`      → ${c.after}   (${c.moduleId})`);
  }
  if (changed.length > limit) lines.push(`  … 其余 ${changed.length - limit} 条省略`);
  return lines.join("\n");
}

// 原始英文表里不该有成片中文。用来分辨「当前这份到底是原始英文表，还是已经被翻译过的产物」——
// 两处需要它：
//   · install 备份前：文件已是中文却没有原始备份时，绝不能把它存成「原始备份」，
//     否则 restore 会把中文原样"还原"回去；
//   · 覆盖率基准回退时：退回磁盘上那份前先确认它确实是英文表，否则基准已经失真。
//
// 阈值取 10%：原始表可能零星含中文（提到中日韩的文案），但不可能过线；
// 翻译产物则至少一半条目带中文。JSON 解析失败当作"不是我们认识的表"，返回 false。
export function looksTranslatedTable(buf) {
  let arr;
  try {
    arr = JSON.parse(Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf));
  } catch {
    return false;
  }
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const cjk = /[一-鿿]/;
  let hit = 0;
  for (const s of arr) if (typeof s === "string" && cjk.test(s)) hit++;
  return hit / arr.length > 0.1;
}

