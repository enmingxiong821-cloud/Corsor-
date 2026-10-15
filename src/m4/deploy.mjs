// 把译文写进 Cursor 的 AI 面板 bundle，并纳入与 NLS 同一套备份/还原体系。
//
// 与 NLS 通道的关键差别：这里改的是可执行代码，不是数据表。所以多一道
// assertSyntax —— 语法一旦坏了 Cursor 直接白屏，比少翻几条严重得多。
// 备份走 ensureBackupEntry，写回后回填 installedSha256，于是 restore 会
// 自动把 bundle 一并还原（它遍历 manifest.files，不需要为 M4 单独写逻辑）。
//
// 三个目标分两档：
//   · glass / anysphere：免校验，改完即完
//   · desktop.main：被校验，改完还要重算 product.json 并过完整性闸门，不过就回滚
//
// 另有一条独立的字体通道 installFontFix（追加 CSS 变量定义，同样改被校验文件），
// 理由与实现见 fontfix.mjs 顶部。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { M4_TARGETS, checksumKey } from "./targets.mjs";
import { patchBundle } from "./patch.mjs";
import { FONT_CSS_REL, applyFontFix } from "./fontfix.mjs";
import { applyChecksumUpdates, assertIntegrity, readProductChecksums } from "./integrity.mjs";
import {
  backupRoot,
  readManifest,
  ensureBackupEntry,
  recordInstalledSha256,
  base64Sha256,
  sha256Hex,
} from "../deploy/backup.mjs";

const PRODUCT_JSON = "product.json";

export function assertSyntax(source, label) {
  const tmp = path.join(os.tmpdir(), `cursor-zh-m4-${process.pid}-${Date.now()}.mjs`);
  fs.writeFileSync(tmp, source, "utf8");
  try {
    const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8", timeout: 60000 });
    if (r.status !== 0) {
      throw new Error(
        `${label} 改写后语法校验失败，已中止且未写入：\n${(r.stderr || r.error?.message || "").slice(0, 800)}`
      );
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function writeAtomic(abs, data, label) {
  // 39.8 MB 原地覆盖一旦中断就留下半截文件，Cursor 直接起不来。
  // 先写同目录临时文件再改名，改名是原子的，最坏情况也只是留下一个 .tmp。
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  const tmp = `${abs}.cursor-zh-tmp`;
  fs.writeFileSync(tmp, buf);
  if (fs.statSync(tmp).size !== buf.length) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`${label} 临时文件长度不符，磁盘可能已满，未改动原文件。`);
  }
  fs.renameSync(tmp, abs);
}

/** 把 rels 里的文件按备份原样写回，并把 installedSha256 清空。任一文件失败即抛出。 */
function rollbackFromBackup(dir, appDir, rels) {
  const failures = [];
  for (const rel of rels) {
    const src = path.join(dir, "files", rel);
    if (!fs.existsSync(src)) continue;
    try {
      // 走原子写：回滚本身也发生在异常时刻，半截文件比不回滚更糟。
      writeAtomic(path.join(appDir, rel), fs.readFileSync(src), rel);
      recordInstalledSha256(dir, rel, null);
    } catch (e) {
      failures.push(`  ${rel} —— ${e.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`以下文件回滚失败：\n${failures.join("\n")}`);
  }
}

/**
 * 回滚失败时不能把原始错误吞掉 —— 否则现场只剩一句「回滚失败」，
 * 真正的原因（完整性闸门为什么没过）反而丢了。
 */
function rollbackAndThrow(dir, appDir, rels, cause) {
  try {
    rollbackFromBackup(dir, appDir, rels);
  } catch (re) {
    throw new Error(`回滚未完成，需人工处理。\n回滚错误：${re.message}\n原始错误：${cause.message}`);
  }
  throw new Error(`已回滚到写入前状态。\n${cause.message}`);
}

/**
 * 半成品自愈：被校验文件已写入、但 product.json 还没来得及更新时（进程被杀 / 断电 /
 * 回滚自身失败），会留下「文件已改 + 校验值过期」—— Cursor 启动即报 corrupt。
 * 而重跑又因为文件里已无可替换的英文而走 no-change 分支，永远进不到重算那一步，
 * 于是每 15 分钟的自动 sync 也修不回来。这里在每次改写前先核对一次。
 *
 * 只认「当前哈希 == 本工具上次写入的哈希」这一种情况，即确认是我们自己的半成品才补算；
 * 别的工具或升级器改过的文件一律不碰，交给完整性闸门去报错。
 */
function healHalfWritten({ paths, rel, product, projectRoot, log }) {
  const dir = backupRoot(projectRoot, product);
  const entry = readManifest(dir)?.files?.find((f) => f.relativePath === rel);
  if (!entry?.installedSha256) return "not-ours";

  const abs = path.join(paths.appDir, rel);
  if (sha256Hex(fs.readFileSync(abs)) !== entry.installedSha256) return "not-ours";

  const key = checksumKey(rel);
  const { checksums } = readProductChecksums(paths.appDir);
  const actual = base64Sha256(fs.readFileSync(abs));
  if (actual === checksums[key]) return "consistent";

  const productAbs = path.join(paths.appDir, PRODUCT_JSON);
  ensureBackupEntry(dir, {
    relativePath: PRODUCT_JSON,
    sourcePath: productAbs,
    cursorVersion: product.version,
    distro: product.distro,
    commit: product.commit,
  });
  applyChecksumUpdates(paths.appDir, { [key]: actual });
  recordInstalledSha256(dir, PRODUCT_JSON, sha256Hex(fs.readFileSync(productAbs)));
  assertIntegrity(paths.appDir, `${rel} 半成品自愈后`);
  log(`  已修复   ${PRODUCT_JSON}.checksums[${key}] —— 上次写入未完成，本次补算`);
  return "healed";
}

/**
 * 取 patch 的输入。**优先用备份里的原始英文，而不是盘上当前文件。**
 *
 * scan 里有几条规则是「整表 / 整文件」分析：左导航映射表要求 ≥5 个成员的**值都是** UI 文案、
 * `title:{value,original}` 要求两者相等、`collectUiConstants` 要求目标常量「没有任何
 * NEVER 字段且不出现在数组裸值位置」。上一轮写入后大量串已是中文，这些前提就不再成立，
 * 剩下的英文从此再也扫不到 —— 实测以盘上文件为输入，glass 可替换 **0** 处；用备份里的
 * 原始英文则是 **7,008** 处。反复 patch 会卡死在「改了一半」的稳态。这正是独立 Agent
 * 设置面板整片英文的根因。
 *
 * 代价是写入内容不再依赖盘上现状，所以先确认盘上文件要么是原始件、要么是我方上次写入的
 * 结果；两者都不是就说明被别的工具或升级器动过 —— 只告警不覆盖（与 NLS 通道同一条底线），
 * 返回 null 让调用方跳过该目标。
 */
function readPatchSource({ dir, rel, abs, log }) {
  const bak = path.join(dir, "files", rel);
  if (!fs.existsSync(bak)) return fs.readFileSync(abs, "utf8");

  const entry = readManifest(dir)?.files?.find((f) => f.relativePath === rel);
  const diskHash = sha256Hex(fs.readFileSync(abs));
  if (entry && diskHash !== entry.sha256 && diskHash !== entry.installedSha256) {
    log(
      `  跳过     ${rel} —— 盘上内容既不是原始文件、也不是本工具上次写入的结果，` +
        "可能被别的工具动过。拒绝用旧备份覆盖它；确认无误后先 restore 再重试。"
    );
    return null;
  }
  return fs.readFileSync(bak, "utf8");
}

export function installBundles({
  paths,
  product,
  projectRoot,
  dict,
  nlsExclude = null,
  dryRun = false,
  log = () => {},
}) {
  const dir = backupRoot(projectRoot, product);
  const summary = [];

  for (const target of M4_TARGETS) {
    const { rel, label } = target;
    const abs = path.join(paths.appDir, rel);
    if (!fs.existsSync(abs)) {
      log(`  跳过     ${rel} —— 文件不存在（Cursor 版本结构可能已变化）`);
      summary.push({ rel, label, status: "missing" });
      continue;
    }

    // 内核 bundle 必须拿「原始英文 NLS 表」当排除基准；没有备份就宁可不改。
    if (target.nlsExclude && !nlsExclude) {
      log(
        `  跳过     ${rel} —— 缺 NLS 原始英文表（备份里没有 out/nls.messages.json）。\n` +
          "           内核层要排除 NLS 覆盖的串，缺基准会误翻，先跑一次 install 生成备份。"
      );
      summary.push({ rel, label, status: "needs-baseline" });
      continue;
    }

    // 半成品自愈：只有当文件确是本工具写了一半留下的，才会补算校验值。
    if (target.checksummed && healHalfWritten({ paths, rel, product, projectRoot, log }) === "healed") {
      summary.push({ rel, label, status: "healed" });
    }

    const opts = target.nlsExclude ? { nlsExclude } : undefined;
    const source = readPatchSource({ dir, rel, abs, log });
    if (source === null) {
      summary.push({ rel, label, status: "foreign" });
      continue;
    }

    const r = patchBundle(source, dict, opts);

    if (r.changed === 0) {
      log(`  无需改写 ${rel} —— 没有可替换的文案`);
      summary.push({ rel, label, status: "no-change" });
      continue;
    }

    // 输入恒为备份里的原始英文，所以每次算出的结果都一样；盘上已经等于它就真的是最新，
    // 不必重写 —— 否则计划任务每 15 分钟重写一次 40 MB，被校验文件还会反复重算校验值。
    if (fs.readFileSync(abs, "utf8") === r.source) {
      log(`  无需改写 ${rel} —— 已是最新`);
      summary.push({ rel, label, status: "no-change" });
      continue;
    }

    assertSyntax(r.source, rel);

    if (dryRun) {
      log(`  将改写   ${rel} —— ${r.changed} 处 / ${r.applied.length} 条文案`);
      summary.push({
        rel,
        label,
        status: "would-patch",
        changed: r.changed,
        applied: r.applied.length,
        checksummed: !!target.checksummed,
      });
      continue;
    }

    const { entry, added } = ensureBackupEntry(dir, {
      relativePath: rel,
      sourcePath: abs,
      cursorVersion: product.version,
      distro: product.distro,
      commit: product.commit,
    });
    if (added) log(`  已备份   ${rel}（${entry.size.toLocaleString("en-US")} 字节）`);

    const productAbs = path.join(paths.appDir, PRODUCT_JSON);
    if (target.checksummed) {
      const p = ensureBackupEntry(dir, {
        relativePath: PRODUCT_JSON,
        sourcePath: productAbs,
        cursorVersion: product.version,
        distro: product.distro,
        commit: product.commit,
      });
      if (p.added) log(`  已备份   ${PRODUCT_JSON}（${p.entry.size.toLocaleString("en-US")} 字节）`);
    }

    writeAtomic(abs, r.source, rel);
    recordInstalledSha256(dir, rel, sha256Hex(fs.readFileSync(abs)));

    if (target.checksummed) {
      const key = checksumKey(rel);
      try {
        applyChecksumUpdates(paths.appDir, {
          [key]: base64Sha256(fs.readFileSync(abs)),
        });
        recordInstalledSha256(dir, PRODUCT_JSON, sha256Hex(fs.readFileSync(productAbs)));
        // 闸门：把 6 个被校验文件全部重算一遍，任何一个对不上都回滚。
        // 这一步把「改坏 Cursor 起不来」变成「写完自己撤回」。
        assertIntegrity(paths.appDir, `${rel} 写入后`);
      } catch (e) {
        log(`  回滚     ${rel} 与 ${PRODUCT_JSON} —— 完整性闸门未通过`);
        rollbackAndThrow(dir, paths.appDir, [rel, PRODUCT_JSON], e);
      }
      log(`  已重算   ${PRODUCT_JSON}.checksums[${key}]`);
    }

    log(`  已改写   ${rel} —— ${r.changed} 处 / ${r.applied.length} 条文案`);
    summary.push({
      rel,
      label,
      status: "patched",
      changed: r.changed,
      applied: r.applied.length,
      checksummed: !!target.checksummed,
    });
  }

  return summary;
}

/**
 * 字体通道：给被校验的 workbench.desktop.main.css 末尾追加一条 --vscode-font-family 定义。
 *
 * 与 bundle 那批的差别是「追加固定文本」而非「按译文表做位置替换」，所以单独一个函数；
 * 但备份、原子写、重算 checksums、完整性闸门、回滚全部复用同一套，没有第二份实现。
 *
 * 幂等靠 CSS 里的标记行：跑过一次就是 no-change，Cursor 升级换掉该文件后标记消失、自动重加。
 */
export function installFontFix({ paths, product, projectRoot, dryRun = false, log = () => {} }) {
  const abs = path.join(paths.appDir, FONT_CSS_REL);
  if (!fs.existsSync(abs)) {
    log(`  跳过     ${FONT_CSS_REL} —— 文件不存在（Cursor 版本结构可能已变化）`);
    return { rel: FONT_CSS_REL, status: "missing" };
  }

  const healed = healHalfWritten({ paths, rel: FONT_CSS_REL, product, projectRoot, log }) === "healed";
  const r = applyFontFix(fs.readFileSync(abs, "utf8"));

  if (!r.changed) {
    if (healed) return { rel: FONT_CSS_REL, status: "healed", checksummed: true };
    log(`  无需改写 ${FONT_CSS_REL} —— 字体规则已在`);
    return { rel: FONT_CSS_REL, status: "no-change" };
  }

  if (dryRun) {
    log(`  将追加   ${FONT_CSS_REL} —— 定义 --vscode-font-family（补中文字体）`);
    return { rel: FONT_CSS_REL, status: "would-patch", checksummed: true };
  }

  const dir = backupRoot(projectRoot, product);
  const productAbs = path.join(paths.appDir, PRODUCT_JSON);

  const { entry, added } = ensureBackupEntry(dir, {
    relativePath: FONT_CSS_REL,
    sourcePath: abs,
    cursorVersion: product.version,
    distro: product.distro,
    commit: product.commit,
  });
  if (added) log(`  已备份   ${FONT_CSS_REL}（${entry.size.toLocaleString("en-US")} 字节）`);

  const p = ensureBackupEntry(dir, {
    relativePath: PRODUCT_JSON,
    sourcePath: productAbs,
    cursorVersion: product.version,
    distro: product.distro,
    commit: product.commit,
  });
  if (p.added) log(`  已备份   ${PRODUCT_JSON}（${p.entry.size.toLocaleString("en-US")} 字节）`);

  writeAtomic(abs, r.source, FONT_CSS_REL);
  recordInstalledSha256(dir, FONT_CSS_REL, sha256Hex(fs.readFileSync(abs)));

  const key = checksumKey(FONT_CSS_REL);
  try {
    applyChecksumUpdates(paths.appDir, { [key]: base64Sha256(fs.readFileSync(abs)) });
    recordInstalledSha256(dir, PRODUCT_JSON, sha256Hex(fs.readFileSync(productAbs)));
    assertIntegrity(paths.appDir, `${FONT_CSS_REL} 写入后`);
  } catch (e) {
    log(`  回滚     ${FONT_CSS_REL} 与 ${PRODUCT_JSON} —— 完整性闸门未通过`);
    rollbackAndThrow(dir, paths.appDir, [FONT_CSS_REL, PRODUCT_JSON], e);
  }
  log(`  已重算   ${PRODUCT_JSON}.checksums[${key}]`);
  log(`  已追加   ${FONT_CSS_REL} —— --vscode-font-family 补上中文字体`);

  return { rel: FONT_CSS_REL, status: "patched", checksummed: true };
}
