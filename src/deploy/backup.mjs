// 版本化备份 + 哈希工具。所有写入前的第一道保险。
//
// 备份目录按 <cursorVersion>_<distro> 分层，绝不用旧版本的备份覆盖新版本文件。
// manifest.json 记录每个文件的原始 SHA-256（hex），还原时用它判断文件是否被外部改过。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function base64Sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, "");
}

export function backupRoot(projectRoot, product) {
  const { version, distro } = product ?? {};
  if (typeof version !== "string" || !version || typeof distro !== "string" || !distro) {
    throw new Error(
      `备份目录需要 <版本>_<发行版>，但拿到 version=${JSON.stringify(version)} distro=${JSON.stringify(distro)}。` +
        "检查 product.json 是否被读到。"
    );
  }
  return path.join(projectRoot, "backup", `${version}_${distro}`);
}

export function readManifest(dir) {
  const file = path.join(dir, "manifest.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// files: [{ relativePath, sourcePath }]
// relativePath 相对 appDir（例如 out/nls.messages.json）
//
// manifest.json 最后才 rename 落定：中途崩溃只会留下没有 manifest 的目录，
// 下次调用会重新备份，而不会把半成品当成有效备份复用。
export function createBackup(dir, { cursorVersion, distro, commit, files }) {
  if (fs.existsSync(path.join(dir, "manifest.json"))) {
    throw new Error(
      `备份目录已存在：${dir}\n` +
        "同一版本不允许重复备份（避免用本次已改动的文件覆盖原始备份）。" +
        "如需重新备份，请先确认该目录内的备份无效并手动移走。"
    );
  }

  const entries = files.map((f) => {
    const buf = fs.readFileSync(f.sourcePath);
    return {
      relativePath: f.relativePath,
      sha256: sha256Hex(buf),
      size: buf.length,
      backedUpAt: new Date().toISOString(),
    };
  });

  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, "manifest.json");
  const tmp = `${manifestFile}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(
      { cursorVersion, distro, commit, createdAt: new Date().toISOString(), files: entries },
      null,
      2
    ),
    "utf8"
  );

  for (const f of files) {
    const dst = path.join(dir, "files", f.relativePath);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f.sourcePath, dst);
  }

  fs.renameSync(tmp, manifestFile);
  return readManifest(dir);
}

// 安装成功后回填「我方写入后的哈希」，这是区分「文件是我们改的」与
// 「文件被 Cursor 升级器换过」的唯一依据。没有它，restore 无法判断能否安全覆盖。
export function recordInstalledSha256(dir, relativePath, hash) {
  const manifestFile = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const entry = manifest.files.find((f) => f.relativePath === relativePath);
  if (!entry) throw new Error(`manifest 里没有 ${relativePath}，无法回填 installedSha256`);
  entry.installedSha256 = hash;
  entry.installedAt = hash === null ? null : new Date().toISOString();

  const tmp = `${manifestFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmp, manifestFile);
  return manifest;
}

// 向已有版本的备份追加一个文件（M4 的 bundle 与 NLS 表共用同一个备份目录）。
//
// 与 createBackup 的区别：这里允许目录已存在。代价是必须自己守住「不许把改过的
// 文件当成原始文件存下来」——所以追加前先查当前哈希是否等于本工具写入过的哈希，
// 命中就说明文件已经被改过，直接拒绝，让调用者先 restore。
export function ensureBackupEntry(dir, { relativePath, sourcePath, cursorVersion, distro, commit }) {
  const manifestFile = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestFile)) {
    // 新建路径同样要带上 entry —— 否则调用方拿到的 entry 是 undefined，
    // 一旦有人真的走这条路径（备份目录还不存在时），守卫和日志都会崩。
    const manifest = createBackup(dir, { cursorVersion, distro, commit, files: [{ relativePath, sourcePath }] });
    return { manifest, entry: manifest.files.find((f) => f.relativePath === relativePath), added: true };
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const existing = manifest.files.find((f) => f.relativePath === relativePath);
  if (existing) return { manifest, entry: existing, added: false };

  const buf = fs.readFileSync(sourcePath);
  const hash = sha256Hex(buf);
  const ours = manifest.files.find((f) => f.installedSha256 && f.installedSha256 === hash);
  if (ours) {
    throw new Error(
      `${relativePath} 当前内容与 ${ours.relativePath} 曾写入的版本一致，说明它已经被本工具改过。\n` +
        "拒绝把它存成「原始备份」。请先执行 restore 还原后再重试。"
    );
  }

  const entry = { relativePath, sha256: hash, size: buf.length, backedUpAt: new Date().toISOString() };
  const dst = path.join(dir, "files", relativePath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(sourcePath, dst);

  manifest.files.push(entry);
  const tmp = `${manifestFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), "utf8");
  fs.renameSync(tmp, manifestFile);
  return { manifest, entry, added: true };
}
