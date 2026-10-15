// 读取「原始英文 NLS 表」，用于给被校验的内核 bundle 做排除基准。
//
// 必须用备份里的原始表，不能用磁盘上当前的 out/nls.messages.json ——
// 装过汉化之后后者已经是中文，拿它当英文基准会一条都对不上。
// 这是 CLAUDE.md 里已经踩过的坑，M1 的覆盖率统计也吃过同一次亏。

import fs from "node:fs";
import path from "node:path";

import { backupRoot } from "../deploy/backup.mjs";

const REL = "out/nls.messages.json";

/**
 * @returns {{set:Set<string>, source:string}|null} 找不到备份返回 null（调用方据此跳过内核目标）
 */
export function loadOriginalNlsEnglish({ projectRoot, product }) {
  let dir;
  try {
    dir = backupRoot(projectRoot, product);
  } catch {
    return null;
  }
  const file = path.join(dir, "files", REL);
  if (!fs.existsSync(file)) return null;

  let table;
  try {
    table = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(table) || table.length === 0) return null;

  const set = new Set();
  for (const s of table) if (typeof s === "string") set.add(s);
  return { set, source: file };
}
