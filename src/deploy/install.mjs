// 安装：把补译后的 out/nls.messages.json 写回 Cursor，并失效 clp 缓存。
//
// 事务顺序（docs/05 §6.2）：
//   1. 备份原始文件（含 SHA-256）；已备份过则复用，绝不覆盖
//   2. 校验当前文件是「原始内容」或「上次我们写入的内容」（否则说明被 Cursor 升级动过，中止）
//   3. 原子写入（临时文件 + rename）
//   4. 失效 clp 缓存
//   5. 回填 installedSha256，供 restore 判断能否安全覆盖
// 任一步失败：还原已写入的文件并抛出。

import fs from "node:fs";
import path from "node:path";

import { backupRoot, readManifest, createBackup, recordInstalledSha256, sha256Hex } from "./backup.mjs";
import { invalidate } from "./cache.mjs";

const TARGET = "out/nls.messages.json";

export function install({ paths, product, projectRoot, messages, dryRun = false, log = () => {} }) {
  const sourcePath = path.join(paths.appDir, "out", "nls.messages.json");
  const dir = backupRoot(projectRoot, product);
  const relPath = TARGET;

  const original = fs.readFileSync(sourcePath);
  const originalHash = sha256Hex(original);
  const next = Buffer.from(JSON.stringify(messages), "utf8");

  // —— 备份 ——
  let manifest = readManifest(dir);
  if (!dryRun && !manifest) {
    manifest = createBackup(dir, {
      cursorVersion: product.version,
      distro: product.distro,
      commit: product.commit,
      files: [{ relativePath: relPath, sourcePath }],
    });
    log(`已备份原始文件 → ${path.relative(projectRoot, dir)}（sha256 ${originalHash.slice(0, 16)}…）`);
  }

  const entry = manifest?.files?.find((f) => f.relativePath === relPath);

  // 已有备份时必须是「原始内容」或「上次我们写的内容」之一，否则说明被外部改过。
  // 只比 entry.sha256 会让第二次 install 把自己的产出误判成外部改动而中止。
  if (manifest && entry) {
    const isOriginal = originalHash === entry.sha256;
    const isOurOutput = entry.installedSha256 && originalHash === entry.installedSha256;
    if (!isOriginal && !isOurOutput) {
      throw new Error(
        `当前 ${relPath} 与备份记录不一致。\n` +
          `  原始 sha256     ${entry.sha256}\n` +
          `  上次写入 sha256 ${entry.installedSha256 ?? "（未记录）"}\n` +
          `  当前 sha256     ${originalHash}\n` +
          "可能 Cursor 已升级或被其它工具改过。请先 `restore` 或移走旧备份目录后再安装。"
      );
    }
  }

  const changedBytes = next.length - original.length;
  log(`目标 ${sourcePath}`);
  log(`  ${original.length} → ${next.length} 字节（${changedBytes >= 0 ? "+" : ""}${changedBytes}）`);

  if (dryRun) {
    log("--dry-run：未写入任何文件。");
    return { dryRun: true, wouldBackup: !manifest, target: sourcePath };
  }

  // —— 原子写入 ——
  const tmp = `${sourcePath}.cursor-zh.tmp`;
  try {
    fs.writeFileSync(tmp, next);
    fs.renameSync(tmp, sourcePath);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {}
    throw new Error(`写入失败：${e.message}`);
  }

  try {
    const markers = invalidate(paths.clpDir);
    log(
      markers.length
        ? `已失效 clp 缓存：${markers.map((m) => path.basename(path.dirname(m))).join("、")}`
        : "clp 缓存目录不存在（首次启动会自动生成），无需失效"
    );
  } catch (e) {
    // 缓存未失效会导致"改了没生效"，属于必须回滚的失败
    fs.writeFileSync(sourcePath, original);
    throw new Error(`缓存失效失败，已还原目标文件：${e.message}`);
  }

  // 写入并确认缓存失效之后才回填，失败路径上不会留下错误的 installedSha256
  recordInstalledSha256(dir, relPath, sha256Hex(next));

  return { dryRun: false, target: sourcePath, backupDir: dir, bytes: next.length };
}
