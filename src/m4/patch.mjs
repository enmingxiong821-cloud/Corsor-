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
  // 模板正文（规则 ⑪）只转义反斜杠与反引号 —— 译文里的 ${…} 是要保留的活插值，
  // 不能像引号字面量那样把内容当死文本处理。
  if (quote === "`") return "`" + zh.replace(/[\\`]/g, (c) => (c === "\\" ? "\\\\" : "\\`")) + "`";
  return quote + zh.replace(/[\\"']/g, (c) => ESCAPE[c]) + quote;
}

// 模板正文的插值必须逐一原样保留：顺序与文本都得一致，否则这条译文丢弃。
// 手写译文时最容易把 ${count} 漏掉或多打一个，宁可漏译也不能生成坏模板。
const SLOT_RE = /\$\{[^}]*\}/g;
function slotsMatch(raw, target) {
  const a = raw.match(SLOT_RE) ?? [];
  const b = target.match(SLOT_RE) ?? [];
  return a.length === b.length && a.every((x, i) => x === b[i]);
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
    // 重叠保护：模板正文会把体内嵌的引号字面量一起包住（`${x?"Foo":"Bar"}`）。
    // 命中的 start 升序，整段模板先替换掉之后，落在其区间内的内层命中一律跳过
    // —— 否则两段替换会互相覆盖，bundle 语法直接崩（实测被 assertSyntax 拦下）。
    // 反过来，模板没有译文时不会推进 last，内层命中照常生效。
    if (h.start < last) continue;
    const target = zh[h.raw];
    if (target === undefined) {
      missing.add(h.raw);
      continue;
    }
    if (h.quote === "`" && !slotsMatch(h.raw, target)) {
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
