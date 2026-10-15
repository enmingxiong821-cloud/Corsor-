// 被校验文件的完整性处理：重算 product.json.checksums，以及写入后的闸门。
//
// Cursor 的 IntegrityService 就在 workbench.desktop.main.js 里，启动时读
// productService.checksums（即 product.json），逐个比对文件实际校验值，不符就报
// "installation appears to be corrupt"。所以改被校验文件后重算 product.json
// 正是官方机制本身，不是在绕过什么。
//
// 校验值算法与 backup.mjs 的 base64Sha256 一致：base64(sha256(bytes)) 去掉末尾 '='。

import fs from "node:fs";
import path from "node:path";

import { base64Sha256 } from "../deploy/backup.mjs";

const PRODUCT = "product.json";

export function readProductChecksums(appDir) {
  const raw = fs.readFileSync(path.join(appDir, PRODUCT), "utf8");
  const obj = JSON.parse(raw);
  return { raw, product: obj, checksums: obj.checksums || {} };
}

/** 逐个文件重算校验值，expected 取自 checksums。 */
export function computeChecksums(appDir, checksums) {
  const rows = [];
  for (const [rel, expected] of Object.entries(checksums)) {
    const file = path.join(appDir, "out", rel);
    if (!fs.existsSync(file)) {
      rows.push({ rel, expected, got: null, ok: false, reason: "文件缺失" });
      continue;
    }
    const got = base64Sha256(fs.readFileSync(file));
    rows.push({ rel, expected, got, ok: got === expected, reason: got === expected ? "" : "校验值不符" });
  }
  return rows;
}

/**
 * 把新的校验值写回 product.json。
 *
 * 用 JSON.stringify(obj, null, "\t") 序列化 —— 实测与原始 product.json **字节完全相同**，
 * 所以落盘后唯一的差异就是我们改的那几个值。写前先断言这一点，避免顺手把整个文件的
 * 格式洗一遍（那会让 diff 无法审阅，也只是徒增风险）。
 */
export function applyChecksumUpdates(appDir, updates) {
  const file = path.join(appDir, PRODUCT);
  const raw = fs.readFileSync(file, "utf8");
  const obj = JSON.parse(raw);

  // 前提断言：原文件就是制表符缩进的规范序列化结果
  if (JSON.stringify(obj, null, "\t") !== raw) {
    throw new Error(
      `${PRODUCT} 不是制表符缩进的规范 JSON，拒绝改写（否则会整文件重排）。\n` +
        "请人工确认该文件的格式后再处理。"
    );
  }

  const checksums = obj.checksums;
  if (!checksums) throw new Error(`${PRODUCT} 里没有 checksums 字段，无法重算。`);
  for (const key of Object.keys(updates)) {
    if (!Object.prototype.hasOwnProperty.call(checksums, key)) {
      throw new Error(`${PRODUCT}.checksums 里没有 ${key}，不在校验清单内，拒绝写入。`);
    }
  }
  Object.assign(checksums, updates);

  const next = JSON.stringify(obj, null, "\t");
  JSON.parse(next); // 落盘前确认仍是合法 JSON

  const tmp = `${file}.cursor-zh-tmp`;
  fs.writeFileSync(tmp, next, "utf8");
  if (fs.statSync(tmp).size !== Buffer.byteLength(next, "utf8")) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${PRODUCT} 临时文件长度不符，磁盘可能已满，未改动原文件。`);
  }
  fs.renameSync(tmp, file);
  return next;
}

/** 写入后的闸门：所有被校验文件都必须与 product.json 相符，否则抛错（由调用方回滚）。 */
export function assertIntegrity(appDir, label = "写入后") {
  const { checksums } = readProductChecksums(appDir);
  const rows = computeChecksums(appDir, checksums);
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    const detail = bad
      .map((r) => `  ${r.rel}\n    实际 ${r.got ?? "（缺失）"}\n    期望 ${r.expected}`)
      .join("\n");
    throw new Error(`${label}完整性闸门未通过（${bad.length} 个文件）：\n${detail}`);
  }
  return rows;
}
