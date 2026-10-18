// 把译文表套用到 bundle 源码上。
//
// 只替换 scanBundle 定位到的那些位置（字段名紧邻的字符串），不做全局字符串替换 ——
// 同一个英文串在 UI 和遥测里都出现时，全局替换会连遥测一起改掉。
//
// 实现上是「按位置切片 + 一次 join」：45 MB 的文件里可能有上万处替换点，
// 逐处 slice 拼接会退化成 O(n²)。

import { scanBundle } from "./scan.mjs";

const ESCAPE = { '"': '\\"', "'": "\\'", "\\": "\\\\" };

function quoteAs(zh, quote) {
  return quote + zh.replace(/[\\"']/g, (c) => ESCAPE[c]) + quote;
}

/**
 * @param {object} zh 译文表 { [英文原文]: 中文 }
 * @param {{nlsExclude?: Set<string>, bareConstAllow?: string[], bareReturnAllow?: string[]}} [opts] 透传给 scanBundle，见其说明
 * @returns {{source:string, applied:string[], missing:string[], changed:number}}
 */
export function patchBundle(source, zh, opts) {
  const hits = scanBundle(source, opts);
  return applyHits(source, hits, zh);
}

/**
 * 位置精确替换。hits 必须按 start 升序。
 */
export function applyHits(source, hits, zh) {
  const parts = [];
  const applied = new Set();
  const missing = new Set();
  let last = 0;
  let changed = 0;

  for (const h of hits) {
    const target = zh[h.raw];
    if (target === undefined) {
      missing.add(h.raw);
      continue;
    }
    parts.push(source.slice(last, h.start), quoteAs(target, h.quote));
    last = h.end;
    applied.add(h.raw);
    changed++;
  }
  parts.push(source.slice(last));

  return {
    source: parts.join(""),
    applied: [...applied],
    missing: [...missing],
    changed,
  };
}
