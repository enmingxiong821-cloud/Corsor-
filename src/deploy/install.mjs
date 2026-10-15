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

import { backupRoot, readManifest, ensureBackupEntry, recordInstalledSha256, sha256Hex } from "./backup.mjs";
import { invalidate } from "./cache.mjs";
import { looksTranslatedTable } from "./nls.mjs";

const TARGET = "out/nls.messages.json";

export function install({ paths, product, projectRoot, messages, dryRun = false, log = () => {} }) {
  const sourcePath = path.join(paths.appDir, "out", "nls.messages.json");
  const dir = backupRoot(projectRoot, product);
  const relPath = TARGET;

  const original = fs.readFileSync(sourcePath);
  const originalHash = sha256Hex(original);
  const next = Buffer.from(JSON.stringify(messages), "utf8");

  const hadEntry = readManifest(dir)?.files?.some((f) => f.relativePath === relPath) ?? false;

  const changedBytes = next.length - original.length;
  log(`目标 ${sourcePath}`);
  log(`  ${original.length} → ${next.length} 字节（${changedBytes >= 0 ? "+" : ""}${changedBytes}）`);

  if (dryRun) {
    log("--dry-run：未写入任何文件。");
    return { dryRun: true, wouldBackup: !hadEntry, target: sourcePath };
  }

  // —— 备份 ——
  // 必须用 ensureBackupEntry，不能用 createBackup：备份目录可能已被 M4 的 patch 建好
  // （里面只有 bundle 条目），旧写法看到 manifest 已存在就整段跳过备份，于是盲写出去、
  // 之后再也 restore 不回来，覆盖率基准还会跟着被污染。
  if (!hadEntry && looksTranslatedTable(original)) {
    throw new Error(
      `当前 ${relPath} 看起来已经是翻译过的内容，但备份里没有它的原始副本。\n` +
        "把它存成「原始备份」会让 restore 把中文原样「还原」回去，因此拒绝继续。\n" +
        `请先移走 ${path.relative(projectRoot, dir)}，用 Cursor 安装包修复出原始文件后再安装。`
    );
  }
  const { entry, added } = ensureBackupEntry(dir, {
    relativePath: relPath,
    sourcePath,
    cursorVersion: product.version,
    distro: product.distro,
    commit: product.commit,
  });
  if (added) {
    log(`已备份原始文件 → ${path.relative(projectRoot, dir)}（sha256 ${entry.sha256.slice(0, 16)}…）`);
  }

  // 守卫无条件执行：旧写法写成 `if (manifest && entry)`，一旦备份里缺 nls 条目，
  // entry 为空就把整段跳过 —— 现在 entry 一定存在，守卫也就一定生效。
  // 当前内容必须是「原始内容」或「上次我们写的内容」之一，否则说明被外部改过。
  // 只比 entry.sha256 会让第二次 install 把自己的产出误判成外部改动而中止。
  const isOriginal = originalHash === entry.sha256;
  const isOurOutput = !!entry.installedSha256 && originalHash === entry.installedSha256;
  if (!isOriginal && !isOurOutput) {
    throw new Error(
      `当前 ${relPath} 与备份记录不一致。\n` +
        `  原始 sha256     ${entry.sha256}\n` +
        `  上次写入 sha256 ${entry.installedSha256 ?? "（未记录）"}\n` +
        `  当前 sha256     ${originalHash}\n` +
        "可能 Cursor 已升级或被其它工具改过。请先 `restore` 或移走旧备份目录后再安装。"
    );
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
    // 缓存未失效会导致"改了没生效"，属于必须回滚的失败。
    // 回滚同样走「临时文件 + 改名」：此刻本就在异常路径上，半截文件比不回滚更糟。
    const back = `${sourcePath}.cursor-zh.tmp`;
    fs.writeFileSync(back, original);
    fs.renameSync(back, sourcePath);
    throw new Error(`缓存失效失败，已还原目标文件：${e.message}`);
  }

  // 写入并确认缓存失效之后才回填，失败路径上不会留下错误的 installedSha256
  recordInstalledSha256(dir, relPath, sha256Hex(next));

  return { dryRun: false, target: sourcePath, backupDir: dir, bytes: next.length };
}
