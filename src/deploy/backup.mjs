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
