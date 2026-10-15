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
