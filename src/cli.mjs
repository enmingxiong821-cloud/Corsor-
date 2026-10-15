#!/usr/bin/env node
// cursor-zh 命令行入口。
//
// 默认只读：scan / report / doctor 绝不写入任何文件（report 只写 build/reports 产物）。
// 写入类命令（build / install / restore）必须在后续里程碑显式实现，且需 --yes 确认。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { locate } from "./scan/locate.mjs";
import { readProduct } from "./scan/product.mjs";
import { loadFlatKeys } from "./scan/keys.mjs";
import { loadPrimaryPack, findLanguagePacks } from "./scan/pack.mjs";
import { loadRenames } from "./align/normalize.mjs";
import { merge, mergeStrict } from "./align/merge.mjs";
import { renderText, renderMissingTop, writeReport } from "./align/report.mjs";
import { loadOverrides, countOverrides } from "./dict/load.mjs";
import { assemble, writeOverrides } from "./dict/assemble.mjs";
import { validateOverrides, validateResolved } from "./dict/validate.mjs";
import { buildPatchedMessages, renderDiffSummary, looksTranslatedTable } from "./deploy/nls.mjs";
import { install } from "./deploy/install.mjs";
import { restore, listBackups } from "./deploy/restore.mjs";
import { describeCache } from "./deploy/cache.mjs";
import { isCursorRunning } from "./deploy/process.mjs";
import {
  base64Sha256,
  backupRoot,
  readManifest,
  sha256Hex,
} from "./deploy/backup.mjs";
import { loadM4Dict, validateM4Dict, countM4Dict } from "./m4/dict.mjs";
import { installBundles, installFontFix } from "./m4/deploy.mjs";
import { M4_TARGETS } from "./m4/targets.mjs";
import { loadOriginalNlsEnglish } from "./m4/nlsbase.mjs";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const BUILD_DIR = path.join(ROOT, "build");
const REPORTS_DIR = path.join(ROOT, "reports");
const SYNC_LOG = path.join(ROOT, "logs", "sync.log");
const TARGET_REL = "out/nls.messages.json";

// 基准表：一律以「备份里的原始英文表」为准，而不是磁盘上当前的 nls.messages.json。
//
// 安装之后磁盘上那份已经是中文了，再拿它当"英文原文"去词典里匹配，必然匹配不上，
// 于是报出一批不存在的缺口（实测 13 条：它们在安装后的表里本来就是中文）。
// 基准固定为原始表，覆盖率数字才不会随"装没装"漂移，build 的幂等性也有了保证。
function baselineTable(paths, product) {
  try {
    const backup = path.join(backupRoot(ROOT, product), "files", TARGET_REL);
    if (fs.existsSync(backup)) return backup;
  } catch {
    // 备份目录名不合法（product 读不到）时退回当前文件
  }
  // 退回磁盘上那份之前先确认它确实是英文表。它可能已经是本工具写过的中文 —— 那样
  // 覆盖率基准就失真了，而且是「静默失真」：历史上正是这条静默回退把污染藏了起来。
  const current = fs.readFileSync(paths.nlsMessages);
  if (looksTranslatedTable(current)) {
    console.error(
      `警告：备份里没有 ${TARGET_REL}，而磁盘上那份已经是中文 —— 覆盖率基准会失真。\n` +
        "      本轮数字不可信，请先确认备份是否完好（`restore` 或重新 `install`）。"
    );
  }
  return paths.nlsMessages;
}

function context() {
  const paths = locate();
  const product = readProduct(paths);
  const base = baselineTable(paths, product);
  const { flat, moduleCount } = loadFlatKeys({ ...paths, nlsMessages: base });
  const pack = loadPrimaryPack(paths);
  return { paths, product, base, flat, moduleCount, pack };
}

function cmdScan(argv) {
  const { paths, product, flat, moduleCount, pack } = context();
  const renameRules = loadRenames(path.join(DATA_DIR, "renames.json"));
  const overrides = loadOverrides(path.join(DATA_DIR, "overrides.json"));

  const strict = mergeStrict({ flat, pack: pack.translations });
  const merged = merge({
    flat,
    pack: pack.translations,
    overrides,
    renameRules,
    useRenames: true,
  });

  console.log(
    renderText({
      strict,
      merged,
      packName: pack.primary.name,
      packCount: pack.packs.length,
      renameRules: renameRules.length,
    })
  );
  console.log(
    `基数信息      Cursor ${product.version} / VSCode ${product.vscodeVersion} / ` +
      `模块 ${moduleCount} / 补译词典 ${countOverrides(overrides)} 条`
  );
  console.log("");
  console.log(renderMissingTop(strict.missing, 10));
  return { paths, product, strict, merged, pack, renameRules, overrides };
}

function cmdReport() {
  const ctx = cmdScan();
  const file = writeReport(REPORTS_DIR, {
    cursorVersion: ctx.product.version,
    distro: ctx.product.distro,
    strict: ctx.strict,
    merged: ctx.merged,
    missing: ctx.strict.missing,
  });
  console.log(`报告已写入 ${path.relative(ROOT, file)}`);
}

function cmdDoctor() {
  const checks = [];
  const ok = (label, detail) => checks.push([true, label, detail]);
  const bad = (label, detail) => checks.push([false, label, detail]);

  checks.push([process.versions.node.split(".")[0] >= 18, "Node 版本", process.versions.node]);

  let paths, product;
  try {
    paths = locate();
    product = readProduct(paths);
    ok("Cursor 安装目录", paths.appDir);
    ok("Cursor 版本", `${product.version}（VSCode ${product.vscodeVersion}）`);
  } catch (e) {
    bad("Cursor 安装目录", e.message);
  }

  if (paths) {
    try {
      const { flat, moduleCount } = loadFlatKeys(paths);
      ok("键表解析", `${moduleCount} 模块 / ${flat.length} 键`);
    } catch (e) {
      bad("键表解析", e.message);
    }

    try {
      const packs = findLanguagePacks(paths.extensionsDir, "zh-cn");
      if (packs.length === 0) bad("zh-cn 语言包", `未在 ${paths.extensionsDir} 找到`);
      else if (packs.length > 1)
        bad("zh-cn 语言包", `发现 ${packs.length} 个，会互相冲突：${packs.map((p) => p.name).join("、")}`);
      else ok("zh-cn 语言包", packs[0].name);
    } catch (e) {
      bad("zh-cn 语言包", e.message);
    }

    try {
      const argv = fs.readFileSync(paths.argvJson, "utf8");
      const m = argv.match(/"locale"\s*:\s*"([^"]+)"/);
      if (m && m[1] === "zh-cn") ok("argv.json locale", "zh-cn");
      else bad("argv.json locale", m ? `当前为 ${m[1]}` : "未设置 locale 字段");
    } catch (e) {
      bad("argv.json", e.message);
    }

    if (fs.existsSync(paths.clpDir)) {
      const dirs = fs.readdirSync(paths.clpDir);
      ok("clp 缓存目录", `${dirs.length} 项：${dirs.slice(0, 4).join("、")}${dirs.length > 4 ? " …" : ""}`);
    } else {
      ok("clp 缓存目录", "不存在（首次启动后会生成）");
    }
  }

  console.log("");
  console.log("环境自检");
  console.log("─".repeat(48));
  for (const [pass, label, detail] of checks) {
    console.log(`${pass ? "  OK  " : " FAIL "}  ${label.padEnd(16)} ${detail}`);
  }
  console.log("");
  if (checks.some(([p]) => !p)) process.exitCode = 1;
}

// 构建/安装共用：算出将写入默认表的全部条目，并跑校验
function prepare(messages) {
  const { paths, product, flat, moduleCount, pack } = context();
  const renameRules = loadRenames(path.join(DATA_DIR, "renames.json"));
  const overrides = loadOverrides(path.join(DATA_DIR, "overrides.json"));

  const dictCheck = validateOverrides(overrides, flat);
  if (dictCheck.errors.length) {
    console.error(`补译词典有 ${dictCheck.errors.length} 处错误：`);
    for (const e of dictCheck.errors.slice(0, 20)) console.error(`  · ${e}`);
    if (dictCheck.errors.length > 20) console.error(`  … 其余 ${dictCheck.errors.length - 20} 处省略`);
    throw new Error("词典校验未通过，已中止。");
  }

  const merged = merge({ flat, pack: pack.translations, overrides, renameRules, useRenames: true });
  const resolvedCheck = validateResolved(merged.resolved);
  if (resolvedCheck.errors.length) {
    console.error(`待写入译文有 ${resolvedCheck.errors.length} 处不合法：`);
    for (const e of resolvedCheck.errors.slice(0, 20)) console.error(`  · ${e}`);
    throw new Error("译文校验未通过，已中止。");
  }
  for (const w of resolvedCheck.warnings) console.warn(`提示：${w}`);

  const { messages: patched, changed } = buildPatchedMessages({
    defaultMessages: messages,
    resolved: merged.resolved,
  });

  return { paths, product, flat, moduleCount, pack, overrides, renameRules, merged, patched, changed, dictCheck };
}

function cmdBuild() {
  const paths0 = locate();
  const raw = fs.readFileSync(baselineTable(paths0, readProduct(paths0)), "utf8");
  const defaultMessages = JSON.parse(raw);
  if (JSON.stringify(defaultMessages) !== raw) {
    console.warn(
      "提示：原始 nls.messages.json 不是紧凑 JSON.stringify 形式，" +
        "改写后整文件字节都会变（仍安全，但 diff 会变大）。"
    );
  }
  const ctx = prepare(defaultMessages);

  // 最小改动自证：逐个索引比对，差异处必须恰好等于预告的条目数
  const diffs = [];
  for (let i = 0; i < defaultMessages.length; i++) {
    if (defaultMessages[i] !== ctx.patched[i]) diffs.push(i);
  }
  const expected = ctx.changed.map((c) => c.index);
  const mismatch =
    diffs.length !== expected.length || diffs.some((v, i) => v !== expected[i]);

  const outFile = path.join(BUILD_DIR, "nls.messages.zh.json");
  const changeFile = path.join(BUILD_DIR, "changes.json");
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(ctx.patched), "utf8");
  fs.writeFileSync(changeFile, JSON.stringify(ctx.changed, null, 1), "utf8");

  const total = ctx.flat.length;
  const covered = total - ctx.merged.stats.missing;
  console.log("");
  console.log(renderDiffSummary(ctx.changed, total));
  console.log("");
  console.log(
    `最小改动自证  ${mismatch ? "✗ 失败" : "✓ 通过"}：实际差异 ${diffs.length} 处，` +
      `预告 ${expected.length} 处，其余 ${(total - diffs.length).toLocaleString("en-US")} 条字节不变`
  );
  console.log("");
  console.log(
    `运行时预计覆盖 ${covered.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} ` +
      `(${((covered / total) * 100).toFixed(2)}%)，剩 ${ctx.merged.stats.missing} 条走英文原文。`
  );
  console.log(`产物：${path.relative(ROOT, outFile)}`);
  console.log(`      ${path.relative(ROOT, changeFile)}（逐条对照）`);
  console.log("");
  console.log("未写入 Cursor 安装目录。要生效请执行：node src/cli.mjs install --yes");
  if (mismatch) process.exitCode = 1;
}

// 手工命令（install / patch / restore）在写入前必须确认 Cursor 已完全退出。
// sync 用自己那套「跳过本轮」的措辞，不共用这个 —— 无人值守通道不该以失败退出。
function requireCursorClosed() {
  const running = isCursorRunning();
  if (running === null) {
    console.error("无法判定 Cursor 是否在运行，不在不确定时写入。");
    process.exitCode = 1;
    return false;
  }
  if (running) {
    console.error("Cursor 正在运行，不能改写。—— 请完全退出 Cursor（含托盘）后重试。");
    process.exitCode = 1;
    return false;
  }
  return true;
}

function cmdInstall(argv) {
  const dryRun = argv.includes("--dry-run");
  if (!dryRun && !argv.includes("--yes")) {
    console.error("install 会写入 Cursor 安装目录。确认请加 --yes，预演请加 --dry-run。");
    process.exitCode = 1;
    return;
  }
  if (!dryRun && !requireCursorClosed()) return;

  const paths0 = locate();
  const defaultMessages = JSON.parse(
    fs.readFileSync(baselineTable(paths0, readProduct(paths0)), "utf8")
  );
  const ctx = prepare(defaultMessages);

  console.log("");
  console.log(renderDiffSummary(ctx.changed, ctx.flat.length, 5));
  console.log("");

  install({
    paths: ctx.paths,
    product: ctx.product,
    projectRoot: ROOT,
    messages: ctx.patched,
    dryRun,
    log: (s) => console.log(s),
  });

  if (!dryRun) {
    console.log("");
    console.log("完成。请**完全退出 Cursor**（含托盘进程）后重新打开 —— 只重载窗口无效。");
  }
}

function cmdRestore(argv) {
  const dryRun = argv.includes("--dry-run");
  if (!dryRun && !requireCursorClosed()) return;

  const paths0 = locate();
  const product = readProduct(paths0);

  console.log("");
  console.log("还原");
  console.log("─".repeat(48));
  try {
    restore({ paths: paths0, product, projectRoot: ROOT, dryRun, log: (s) => console.log(s) });
  } catch (e) {
    console.error(e.message);
    const dirs = listBackups(ROOT);
    if (dirs.length) console.error(`现有备份：${dirs.join("、")}`);
    process.exitCode = 1;
    return;
  }
  console.log("");
  if (!dryRun) console.log("完成。请完全退出 Cursor 后重新打开。");
}

function cmdCache() {
  const paths = locate();
  const entries = describeCache(paths.clpDir);
  console.log("");
  console.log("clp 缓存");
  console.log("─".repeat(48));
  if (!entries.length) {
    console.log("  无 zh-cn 缓存目录（Cursor 尚未以中文启动过）。");
  }
  for (const e of entries) {
    console.log(`  ${e.name}${e.hasMarker ? "   [已标记损坏，下次启动将重建]" : ""}`);
    for (const c of e.commits) console.log(`      ${c}`);
  }
  console.log("");
}

// 自动跟随 Cursor 升级：比对版本与文件哈希，只在需要时重跑一遍写入。
//
// 设计约束：
//   1. Cursor 运行中绝不写入 —— 文件被占用，且缓存失效会在错误时机生效。直接跳过本轮。
//   2. 判断全部只读；译本生成（prepare）也在内存完成，任何一步失败都不落盘。
//   3. 只处理「原始内容」与「本工具写入的内容」两种状态；第三种（外部改动）一律跳过并告警，
//      绝不自动覆盖 —— 那可能是 Cursor 升级器的中间态，覆盖会毁掉安装。
//   4. 本命令被计划任务高频调用，无事可做时必须是纯读的快速路径（几毫秒）。
// 成功与否都写 logs/sync.log，便于事后复盘。
const SYNC_LOG_MAX = 1 << 20;

function syncLog(line) {
  fs.mkdirSync(path.dirname(SYNC_LOG), { recursive: true });
  try {
    // 每 15 分钟一行，天长日久会攒到几十万行；超过 1 MB 就留一份上一代
    if (fs.statSync(SYNC_LOG).size > SYNC_LOG_MAX) {
      fs.rmSync(`${SYNC_LOG}.1`, { force: true });
      fs.renameSync(SYNC_LOG, `${SYNC_LOG}.1`);
    }
  } catch {}
  fs.appendFileSync(SYNC_LOG, `[${new Date().toISOString()}] ${line}\n`, "utf8");
}

// 跳过类消息：手动在终端执行时可见，计划任务里静默落到日志
function note(line) {
  if (process.stdout.isTTY) console.log(line);
  syncLog(line);
}

// sync 跑两条互不相干的通道：NLS 层（改数据表）与 M4（改 AI 面板 bundle）。
// 前置检查共用；任一条失败只记自己的 exitCode，不影响另一条。
function cmdSync(argv) {
  const dryRun = argv.includes("--dry-run");
  const say = (s) => {
    console.log(s);
    syncLog(s);
  };

  let paths;
  let product;
  try {
    paths = locate();
    product = readProduct(paths);
  } catch (e) {
    note(`跳过：定位 Cursor 失败 —— ${e.message}`);
    return;
  }

  // --dry-run 全程不写文件，运行中也可以安全预演；真实写入则必须先退出 Cursor
  const running = isCursorRunning();
  if (running === null && !dryRun) {
    note("跳过：无法判定 Cursor 是否在运行（tasklist 不可用），不在不确定时写入。");
    return;
  }
  if (running && !dryRun) {
    note(`跳过：Cursor ${product.version} 正在运行，本轮不改动任何文件。`);
    return;
  }

  syncNlsChannel({ paths, product, dryRun, say, note });
  syncBundlesChannel({ paths, product, dryRun, say, note });
}

function syncNlsChannel({ paths, product, dryRun, say, note }) {
  const target = path.join(paths.appDir, TARGET_REL);
  const dir = backupRoot(ROOT, product);
  const manifest = readManifest(dir);
  const entry = manifest?.files?.find((f) => f.relativePath === TARGET_REL);
  const currentHash = sha256Hex(fs.readFileSync(target));

  // —— 快速路径：同版本，且当前内容正是上次本工具写入的 ——
  if (entry?.installedSha256 && currentHash === entry.installedSha256) {
    note(`Cursor ${product.version} 未变化，out/nls.messages.json 已是最新，跳过。`);
    return;
  }

  if (entry && currentHash !== entry.sha256) {
    note(
      `跳过：当前 out/nls.messages.json 既不是原始内容（${entry.sha256.slice(0, 16)}…），` +
        `也不是本工具写入的内容（${(entry.installedSha256 ?? "未记录").slice(0, 16)}…），` +
        `实际为 ${currentHash.slice(0, 16)}…。可能被其它工具改过，需人工确认后再处理。`
    );
    process.exitCode = 1;
    return;
  }

  // entry 不存在 = Cursor 换了版本（备份目录按 版本_发行版 分层），视为全新安装
  say(
    entry
      ? `检测到 out/nls.messages.json 已回到原始内容，重新写入译文（Cursor ${product.version}）。`
      : `检测到新版本 Cursor ${product.version} / commit ${String(product.commit).slice(0, 8)}，开始重建译文表。`
  );

  // 基准一律用备份里的原始表（见 baselineTable），反复执行结果完全一致
  const basePath = baselineTable(paths, product);

  let ctx;
  try {
    ctx = prepare(JSON.parse(fs.readFileSync(basePath, "utf8")));
  } catch (e) {
    say(
      `中止：新版本键表与现有词典不匹配 —— ${e.message}\n` +
        "未写入任何文件，Cursor 保持原样。需人工核对 data/overrides.json 后重试。"
    );
    process.exitCode = 1;
    return;
  }

  try {
    install({
      paths: ctx.paths,
      product: ctx.product,
      projectRoot: ROOT,
      messages: ctx.patched,
      dryRun,
      log: (s) => note(`  ${s}`),
    });
  } catch (e) {
    say(`写入失败：${e.message}`);
    process.exitCode = 1;
    return;
  }

  say(
    dryRun
      ? `预演完成：将写入 ${ctx.changed.length} 条译文（--dry-run，未改动任何文件）。`
      : `完成：写入 ${ctx.changed.length} 条译文，clp 缓存已失效，Cursor 下次启动即为中文。`
  );
}

// M4 自动通道。改写后 bundle 里已无英文候选，重跑自然是 0 处，所以幂等，
// 不必像 NLS 那样做「内容是否等于上次写入值」的快速判定。
// 内核 bundle 的排除基准：备份里的「原始英文 NLS 表」。
// 取不到就返回 null —— installBundles 会跳过内核目标而不是硬改。
function coreNlsExclude(product) {
  const base = loadOriginalNlsEnglish({ projectRoot: ROOT, product });
  return base ? base.set : null;
}

function syncBundlesChannel({ paths, product, dryRun, say, note }) {
  const dictFile = path.join(DATA_DIR, "m4.json");
  const dict = loadM4Dict(dictFile);
  if (countM4Dict(dict) === 0) {
    note("跳过：M4 译文表为空或不存在，本轮不改动 AI 面板。");
    return;
  }
  const dictCheck = validateM4Dict(dict);
  if (dictCheck.errors.length) {
    say(`跳过：M4 译文表有 ${dictCheck.errors.length} 处问题，本轮不改动 AI 面板。`);
    process.exitCode = 1;
    return;
  }

  try {
    const summary = installBundles({
      paths,
      product,
      projectRoot: ROOT,
      dict,
      nlsExclude: coreNlsExclude(product),
      dryRun,
      log: (s) => note(s),
    });
    for (const s of summary) {
      const tail = s.checksummed ? "（已重算 product.json 校验值）" : "";
      if (s.status === "would-patch") {
        say(`预演：将改写 ${s.rel} —— ${s.changed} 处 / ${s.applied} 条文案${tail}。`);
      } else if (s.status === "patched") {
        say(`已改写 ${s.rel} —— ${s.changed} 处 / ${s.applied} 条文案${tail}。`);
      } else if (s.status === "healed") {
        say(`已修复 ${s.rel} —— 上次写入未完成，本次补算 product.json 校验值。`);
      }
    }
    if (!summary.some((s) => ["patched", "would-patch", "healed"].includes(s.status))) {
      note("AI 面板 bundle 已是最新，无需改写。");
    }

    // 字体通道：与译文无关，只在 Cursor 升级换掉 CSS 后才会真的动手，所以也放进自动通道。
    const font = installFontFix({ paths, product, projectRoot: ROOT, dryRun, log: (s) => note(s) });
    if (font.status === "patched") {
      say(`已给 ${font.rel} 追加字体规则 —— 中文改用微软雅黑，与官方 zh-Hans 一致（已重算校验值）。`);
    } else if (font.status === "would-patch") {
      say(`预演：将给 ${font.rel} 追加字体规则（已重算校验值）。`);
    } else if (font.status === "healed") {
      say(`已修复 ${font.rel} —— 上次写入未完成，本次补算 product.json 校验值。`);
    }
  } catch (e) {
    say(`AI 面板改写失败：${e.message}`);
    process.exitCode = 1;
  }
}

// M4：把 Cursor 自有 AI 面板 bundle 里的硬编码文案换成中文，并修正自有 UI 的字体链。
//
// 与 NLS 通道的区别在于改的是可执行代码与样式，不是数据表，所以多两道保险：
// 写入前 node --check 语法校验（仅 bundle），以及写入时 Cursor 必须已退出。
// 被校验的目标（内核 bundle、workbench.desktop.main.css）改完重算 product.json 校验值，
// 并过完整性闸门，不过就自动回滚。
function cmdPatch(argv) {
  const dryRun = argv.includes("--dry-run");
  if (!dryRun && !argv.includes("--yes")) {
    console.error("patch 会改写 Cursor 安装目录。确认请加 --yes，预演请加 --dry-run。");
    process.exitCode = 1;
    return;
  }

  const paths = locate();
  const product = readProduct(paths);

  const dictFile = path.join(DATA_DIR, "m4.json");
  const dict = loadM4Dict(dictFile);
  const total = countM4Dict(dict);
  if (total === 0) {
    console.error(`译文表为空或不存在：${path.relative(ROOT, dictFile)}`);
    process.exitCode = 1;
    return;
  }
  const dictCheck = validateM4Dict(dict);
  if (dictCheck.errors.length) {
    console.error(`M4 译文表有 ${dictCheck.errors.length} 处问题：`);
    for (const e of dictCheck.errors.slice(0, 20)) console.error(`  · ${e}`);
    console.error("未写入任何文件，已中止。");
    process.exitCode = 1;
    return;
  }

  if (!dryRun && !requireCursorClosed()) return;

  console.log("");
  console.log("M4 · Cursor AI 面板汉化");
  console.log("─".repeat(56));
  console.log(`  译文表    ${total} 条`);
  const core = M4_TARGETS.filter((t) => t.checksummed).length;
  console.log(
    `  目标文件  ${M4_TARGETS.length} 个（${M4_TARGETS.length - core} 个免校验，${core} 个被校验需重算哈希）`
  );
  console.log("  字体通道  workbench.desktop.main.css（被校验，需重算哈希）");
  console.log("");
  try {
    installBundles({
      paths,
      product,
      projectRoot: ROOT,
      dict,
      nlsExclude: coreNlsExclude(product),
      dryRun,
      log: (s) => console.log(s),
    });
    installFontFix({ paths, product, projectRoot: ROOT, dryRun, log: (s) => console.log(s) });
  } catch (e) {
    console.error("");
    console.error(e.message);
    process.exitCode = 1;
    return;
  }
  console.log("");
  console.log(dryRun ? "--dry-run：未改动任何文件。" : "完成。请完全退出 Cursor 后重新打开。");
}

// 只读：确认被校验文件仍然完好，并复现 docs/05 §6.1 的金标准断言。
//
// 金标准断言（算法自检）必须对**原始字节**做 —— 内核 bundle 一旦被 M4 改写，
// 盘上就不是原始内容了，所以优先取备份里的原始文件来验算法，盘上文件留给
// checksums 那一段去核对。这样「算法对不对」和「运行时能不能过 IntegrityService」
// 两件事各验各的，改写之后也仍然有效。
const GOLDEN = {
  "vs/code/electron-sandbox/workbench/workbench.html":
    "BZ8Zb4TGBbDPaaGjA+MuDJxaFsxjmmG0YMyttD4zgcU",
  "vs/workbench/workbench.desktop.main.js":
    "7Wkip6hsjESKRqo5rwyTFYDaFidw/kBqDUFzcpDmN9k",
};

function cmdVerify() {
  const paths = locate();
  const product = JSON.parse(fs.readFileSync(paths.productJson, "utf8"));
  const checksums = product.checksums || {};

  let backupDir = null;
  try {
    backupDir = backupRoot(ROOT, readProduct(paths));
  } catch {
    /* 拿不到版本/发行版就没有备份可比，退回盘上文件 */
  }

  console.log("");
  console.log("完整性校验");
  console.log("─".repeat(64));

  const golden = [];
  for (const [rel, expected] of Object.entries(GOLDEN)) {
    const backupFile = backupDir ? path.join(backupDir, "files", "out", rel) : null;
    const useBackup = backupFile && fs.existsSync(backupFile);
    const file = useBackup ? backupFile : path.join(paths.outDir, rel);
    if (!fs.existsSync(file)) {
      golden.push(`  缺失  ${rel}`);
      continue;
    }
    const got = base64Sha256(fs.readFileSync(file));
    const tag = useBackup ? "（备份原始文件）" : "（盘上文件）";
    golden.push(`${got === expected ? "  OK  " : " FAIL "} 金标准  ${rel} ${tag}`);
  }

  const rows = [];
  for (const [rel, expected] of Object.entries(checksums)) {
    const file = path.join(paths.outDir, rel);
    if (!fs.existsSync(file)) {
      rows.push([false, rel, "文件缺失"]);
      continue;
    }
    const got = base64Sha256(fs.readFileSync(file));
    rows.push([got === expected, rel, `${got.slice(0, 12)}… / 期望 ${expected.slice(0, 12)}…`]);
  }

  for (const line of golden) console.log(line);
  console.log("");
  for (const [pass, rel, detail] of rows) console.log(`${pass ? "  OK  " : " FAIL "} ${rel}\n         ${detail}`);
  console.log("");
  console.log(`被校验文件 ${rows.filter((r) => r[0]).length}/${rows.length} 通过。`);

  const goldenOk = !golden.some((l) => l.includes("FAIL") || l.includes("缺失"));
  if (!goldenOk || rows.some((r) => !r[0])) process.exitCode = 1;
}

// 把 build/batches/out-*.json 组装成 data/overrides.json，并以工作单为准逐条核对。
// 只写项目内的 data/，不碰 Cursor。
function cmdAssemble(argv) {
  const worklistPath = path.join(BUILD_DIR, "missing.json");
  if (!fs.existsSync(worklistPath)) {
    console.error(`找不到工作单 ${path.relative(ROOT, worklistPath)}`);
    process.exitCode = 1;
    return;
  }
  const missing = JSON.parse(fs.readFileSync(worklistPath, "utf8"));

  const batchDir = path.join(BUILD_DIR, "batches");
  const batchFiles = fs.existsSync(batchDir)
    ? fs
        .readdirSync(batchDir)
        .filter((f) => /^out-\d+\.json$/.test(f))
        .sort()
        .map((f) => path.join(batchDir, f))
    : [];

  if (!batchFiles.length) {
    console.error(`尚未找到任何分片译文（${path.relative(ROOT, batchDir)}/out-NN.json）`);
    process.exitCode = 1;
    return;
  }

  const result = assemble({ missing, batchFiles });
  let total = 0;
  let multiKey = 0;
  for (const keys of Object.values(result.overrides)) {
    for (const slot of Object.values(keys)) {
      if (typeof slot === "string") total += 1;
      else {
        total += Object.keys(slot).length;
        multiKey += 1;
      }
    }
  }
  const worklistTotal = Object.values(missing).reduce((n, items) => n + items.length, 0);

  console.log("");
  console.log("组装补译词典");
  console.log("─".repeat(48));
  console.log(`  读入分片      ${batchFiles.length} 个`);
  console.log(`  工作单条目    ${worklistTotal}`);
  console.log(`  组装译文      ${total}${multiKey ? `（含 ${multiKey} 个重名键，按英文逐条区分）` : ""}`);
  console.log(`  工作单未覆盖  ${result.missingKeys.length}`);
  console.log(`  工作单外的键  ${result.unexpected.length}`);
  console.log(`  重名键歧义    ${result.ambiguous.length}`);
  console.log(`  格式问题      ${result.problems.length}`);

  if (result.ambiguous.length) {
    console.log("");
    console.log("  ⚠ 以下重名键只拿到一条字符串译文，会一译多用，需改成 { 英文原文: 译文 }：");
    for (const a of result.ambiguous.slice(0, 20)) {
      console.log(`    · ${a.moduleId} :: ${a.key}`);
      for (const en of a.ens) console.log(`        ${JSON.stringify(en)}`);
    }
    if (result.ambiguous.length > 20) console.log(`    … 其余 ${result.ambiguous.length - 20} 个省略`);
  }
  if (result.problems.length) for (const p of result.problems.slice(0, 10)) console.log(`    · ${p}`);
  if (result.unexpected.length) {
    for (const u of result.unexpected.slice(0, 5)) {
      console.log(`    · 多余键 ${u.moduleId} :: ${u.key}（${u.file}）`);
    }
  }
  if (result.missingKeys.length) {
    for (const m of result.missingKeys.slice(0, 10)) {
      console.log(`    · 缺译 ${m.moduleId} :: ${m.key}   ${JSON.stringify(m.en).slice(0, 70)}`);
    }
  }

  const shouldWrite = argv.includes("--write");
  if (!shouldWrite) {
    console.log("");
    console.log("未写入。确认无误后加 --write 生成 data/overrides.json。");
    return;
  }
  const file = writeOverrides(path.join(DATA_DIR, "overrides.json"), result.overrides);
  console.log("");
  console.log(`已写入 ${path.relative(ROOT, file)}`);
}

const COMMANDS = {
  scan: cmdScan,
  report: cmdReport,
  doctor: cmdDoctor,
  verify: cmdVerify,
  assemble: cmdAssemble,
  build: cmdBuild,
  install: cmdInstall,
  restore: cmdRestore,
  cache: cmdCache,
  sync: cmdSync,
  patch: cmdPatch,
};

function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    console.log(
      [
        "用法：node src/cli.mjs <命令>",
        "",
        "只读命令",
        "  scan              扫描并打印覆盖率",
        "  report            生成覆盖率报告到 reports/",
        "  doctor            环境自检",
        "  cache             查看 clp 缓存状态",
        "  verify            校验 6 个被校验文件 + 金标准断言",
        "",
        "写入命令",
        "  assemble [--write] 分片译文 → data/overrides.json（核对工作单）",
        "  build             生成改写后的消息表到 build/（不碰 Cursor）",
        "  install [--dry-run] [--yes]   写入 Cursor 并失效 clp 缓存",
        "  restore [--dry-run]           从备份还原",
        "  sync [--dry-run]              自动跟随：版本变化或被覆盖时重新写入（供计划任务调用）",
        "  patch [--dry-run] [--yes]     M4：改写 AI 面板 bundle 的硬编码文案 + UI 字体规则",
      ].join("\n")
    );
    return;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`未知命令：${cmd}`);
    process.exitCode = 1;
    return;
  }
  fn(rest);
}

main();
