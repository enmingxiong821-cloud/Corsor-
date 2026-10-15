// 读 Cursor 的 product.json：版本、commit、发行版标识。纯只读。
//
// 实测 Cursor 3.24.18 的 product.json **没有 distro 字段**，同一构建的标识只能用
// commit（clp 缓存目录也正是按 commit 分层的），所以这里回退到 commit。

import fs from "node:fs";

export function readProduct(paths) {
  const p = JSON.parse(fs.readFileSync(paths.productJson, "utf8"));
  return {
    version: p.version,
    commit: p.commit,
    vscodeVersion: p.vscodeVersion,
    distro: p.distro || p.commit,
  };
}
