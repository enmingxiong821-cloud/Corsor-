// clp 缓存失效（docs/03 §1.1 ④）。
//
// 运行时译文表是缓存文件，不是语言包：
//   %APPDATA%\Cursor\clp\<语言包hash>.zh-cn\<Cursor commit>\nls.messages.json
// 只要该 commit 目录存在，Cursor 就直接返回缓存，不会重读 nls.messages.json。
// 所以改完默认表必须失效缓存，否则重启多少次都不生效。
//
// 采用「投放 corrupted.info 空文件」——这是 Cursor 自带的修复通路，
// 下次启动会整目录重建，属于可逆且低风险的手段。

import fs from "node:fs";
import path from "node:path";

export function listCacheRoots(clpDir, languageId = "zh-cn") {
  if (!fs.existsSync(clpDir)) return [];
  return fs
    .readdirSync(clpDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith(`.${languageId}`))
    .map((d) => path.join(clpDir, d.name));
}

export function describeCache(clpDir, languageId = "zh-cn") {
  const roots = listCacheRoots(clpDir, languageId);
  return roots.map((root) => ({
    root,
    name: path.basename(root),
    hasMarker: fs.existsSync(path.join(root, "corrupted.info")),
    commits: fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  }));
}

export function invalidate(clpDir, languageId = "zh-cn") {
  const roots = listCacheRoots(clpDir, languageId);
  const touched = [];
  for (const root of roots) {
    const marker = path.join(root, "corrupted.info");
    fs.writeFileSync(marker, "", "utf8");
    touched.push(marker);
  }
  return touched;
}
