// 还原：从备份把文件恢复成字节级原始内容。
//
// 安全规则（docs/05 §6.3）：还原前逐文件判断当前内容属于哪一种。
//   等于 entry.sha256          → 已是原始内容，无需还原
//   等于 entry.installedSha256 → 确认是本工具改的，安全还原
//   两者都不等                  → 可能被 Cursor 升级器更新过，跳过并告警，绝不用旧备份强覆盖
// 还原后同样失效 clp 缓存，让 Cursor 按原始文件重建。

import fs from "node:fs";
import path from "node:path";

import { backupRoot, readManifest, recordInstalledSha256, sha256Hex } from "./backup.mjs";
import { invalidate } from "./cache.mjs";

export function listBackups(projectRoot) {
  const root = path.join(projectRoot, "backup");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function restore({ paths, product, projectRoot, dryRun = false, log = () => {} }) {
  const dir = backupRoot(projectRoot, product);
  const manifest = readManifest(dir);
  if (!manifest) {
    throw new Error(
      `找不到当前版本的备份：${dir}\n` +
        `当前 Cursor ${product.version} / ${product.distro}。\n` +
        "（备份按 版本_发行版 分目录，不会跨版本复用。）"
    );
  }

  const results = [];
  for (const entry of manifest.files) {
    const target = path.join(paths.appDir, entry.relativePath);
    const backupFile = path.join(dir, "files", entry.relativePath);

    if (!fs.existsSync(backupFile)) {
      results.push({ entry, status: "missing-backup" });
      continue;
    }

    const current = fs.readFileSync(target);
    const currentHash = sha256Hex(current);
    const backupBuf = fs.readFileSync(backupFile);
    const backupFileHash = sha256Hex(backupBuf);

    if (backupFileHash !== entry.sha256) {
      results.push({ entry, status: "backup-corrupt", currentHash, backupFileHash });
      continue;
    }

    if (currentHash === entry.sha256) {
      results.push({ entry, status: "already-original" });
      continue;
    }

    if (!entry.installedSha256 || currentHash !== entry.installedSha256) {
      results.push({ entry, status: "externally-modified", currentHash });
      continue;
    }

    if (dryRun) {
      results.push({ entry, status: "would-restore" });
      continue;
    }

    fs.writeFileSync(target, backupBuf);
    if (sha256Hex(fs.readFileSync(target)) !== entry.sha256) {
      throw new Error(`还原后哈希不符：${entry.relativePath}，备份文件可能已损坏。`);
    }
    recordInstalledSha256(dir, entry.relativePath, null);
    results.push({ entry, status: "restored" });
  }

  const restorable = results.filter((r) =>
    ["restored", "would-restore", "already-original"].includes(r.status)
  );
  if (!dryRun && restorable.length) {
    const markers = invalidate(paths.clpDir);
    if (markers.length) log(`已失效 clp 缓存 ${markers.length} 处，Cursor 下次启动会重建`);
  }

  for (const r of results) {
    const label = r.entry.relativePath;
    switch (r.status) {
      case "restored":
        log(`  已还原   ${label}`);
        break;
      case "would-restore":
        log(`  将还原   ${label}（--dry-run）`);
        break;
      case "already-original":
        log(`  无需还原 ${label}（已是原始内容）`);
        break;
      case "externally-modified":
        log(
          `  跳过     ${label} —— 当前内容与备份不一致，可能已被 Cursor 升级更新。\n` +
            `           当前 ${r.currentHash.slice(0, 16)}… / 备份 ${r.entry.sha256.slice(0, 16)}…\n` +
            "           未做覆盖，请人工确认后再处理。"
        );
        break;
      case "backup-corrupt":
        log(`  跳过     ${label} —— 备份文件自身哈希不符，备份可能已损坏。`);
        break;
      case "missing-backup":
        log(`  跳过     ${label} —— 备份文件缺失。`);
        break;
    }
  }

  return { results, dryRun };
}
