#!/usr/bin/env node
// 一键安装：把译文写入 Cursor，并登记「升级后自动重新汉化」的计划任务。
//
//   node scripts/setup.mjs              正常安装
//   node scripts/setup.mjs --no-task    只写入，不登记计划任务
//   node scripts/setup.mjs --dry-run    完整预演：检查环境、算好译文，但一个字节都不写
//
// 任何一步失败都立即停下，并把"接下来该怎么办"写清楚 —— 双击 install.cmd 的用户
// 看不到滚动日志，只会在窗口关闭前扫一眼最后几行。

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { locate } from "../src/scan/locate.mjs";
import { findLanguagePacks } from "../src/scan/pack.mjs";
import { isCursorRunning } from "../src/deploy/process.mjs";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "cli.mjs");
const REGISTER = path.join(ROOT, "scripts", "register-task.ps1");

const TOTAL = 5;
const dryRun = process.argv.includes("--dry-run");
const say = (s = "") => console.log(s);
const step = (n, title) => say(`\n[${n}/${TOTAL}] ${title}`);

function fail(msg, hint) {
  say("");
  say(`✗ ${msg}`);
  if (hint) say(`  → ${hint}`);
  say("");
  process.exit(1);
}

function runCli(args, label) {
  const r = spawnSync(process.execPath, [CLI, ...args], { stdio: "inherit", cwd: ROOT });
  if (r.error) fail(`${label}无法启动`, r.error.message);
  if (r.status !== 0) fail(`${label}失败（退出码 ${r.status}）`, "详细原因见上方输出，未做进一步改动。");
}

say("");
say("Cursor 简体中文汉化 · 一键安装");
say("═".repeat(56));

// —— 1. 环境 ——
step(1, "检查环境");
if (Number(process.versions.node.split(".")[0]) < 18) {
  fail(`Node 版本过低：${process.versions.node}`, "请安装 Node.js 18 或更高版本后重试：https://nodejs.org/");
}

let paths;
try {
  paths = locate();
} catch (e) {
  fail("找不到 Cursor 安装目录", e.message);
}
say(`  Node        ${process.versions.node}`);
say(`  Cursor      ${paths.appDir}`);

const packs = findLanguagePacks(paths.extensionsDir, "zh-cn");
if (packs.length === 0) {
  say("  ⚠ 未找到 zh-cn 语言包 —— 汉化仍可用，但基础中文会缺一大块。");
  say("    建议先在 Cursor 里安装扩展 Chinese (Simplified) Language Pack。");
} else if (packs.length > 1) {
  say(`  ⚠ 发现 ${packs.length} 个 zh-cn 语言包，可能互相冲突：`);
  for (const p of packs) say(`      ${p.name}`);
} else {
  say(`  语言包      ${packs[0].name}`);
}

// —— 2. Cursor 必须完全退出 ——
step(2, "确认 Cursor 已完全退出");
const running = isCursorRunning();
if (dryRun) {
  say("  --dry-run：不写入任何文件，因此跳过这项检查。");
} else if (running === null) {
  fail("无法确认 Cursor 是否在运行", "请在任务管理器里确认没有 Cursor.exe 进程后重试。");
} else if (running) {
  fail(
    "Cursor 正在运行，不能写入",
    "请完全退出 Cursor（含托盘图标：右键 → 退出），然后重新双击本文件。"
  );
} else {
  say("  已确认退出，可以安全写入。");
}

// —— 3. 写入译文 ——
step(3, dryRun ? "预演写入（不会改动任何文件）" : "写入译文（会自动备份原始文件，可随时还原）");
runCli(
  ["install", "--yes", ...(dryRun ? ["--dry-run"] : [])],
  dryRun ? "预演" : "写入译文"
);

// —— 4. AI 面板 ——
// 失败不中止：主界面汉化已经装好，这里只是 Cursor 自有的那部分硬编码文案，
// 少翻一层不该让用户以为整个安装失败了。
step(4, dryRun ? "预演汉化 AI 面板（不会改动任何文件）" : "汉化 AI 面板（聊天、智能体面板等硬编码文案）");
const m4 = spawnSync(
  process.execPath,
  [CLI, "patch", "--yes", ...(dryRun ? ["--dry-run"] : [])],
  { stdio: "inherit", cwd: ROOT }
);
if (m4.error || m4.status !== 0) {
  say("");
  say("⚠ AI 面板汉化失败 —— 主界面汉化已经装好，不影响 Cursor 正常使用。");
  say("  影响：AI 面板、聊天等位置的文案仍是英文。");
  say("  排除原因后可单独重试：");
  say("      node src/cli.mjs patch --yes");
}

// —— 5. 自动跟随 ——
if (process.argv.includes("--no-task")) {
  step(5, "跳过计划任务（--no-task）");
} else if (dryRun) {
  step(5, "预演结束（--dry-run 不登记计划任务）");
} else {
  step(5, "登记自动跟随任务（每 15 分钟检查一次 Cursor 升级）");
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", REGISTER],
    { stdio: "inherit", cwd: ROOT }
  );
  if (r.error || r.status !== 0) {
    say("");
    say("⚠ 计划任务登记失败 —— 汉化本身已经装好，不影响使用。");
    say("  影响：Cursor 升级后需要手动跑一次 `node src/cli.mjs sync`。");
    say("  稍后可单独重试：");
    say("      powershell -ExecutionPolicy Bypass -File scripts\\register-task.ps1");
  }
}

// —— 完成 ——
say("");
say("═".repeat(56));
if (dryRun) {
  say("✓ 预演完成 —— 没有改动任何文件。");
  say("");
  say("去掉 --dry-run 即可真正安装。");
} else {
  say("✓ 安装完成");
  say("");
  say("现在重新打开 Cursor 即可看到中文。首次启动会重建语言缓存，慢几秒属正常。");
  say("");
  say("之后 Cursor 升级时会在你退出它之后自动重新汉化，不用再管。");
}
say("");
say("其他命令：");
say("  node src/cli.mjs scan           查看覆盖率");
say("  node src/cli.mjs sync           手动跟随一次升级（也可直接等计划任务）");
say("  node src/cli.mjs patch --dry-run 只预演 AI 面板汉化，不改动任何文件");
say("  node src/cli.mjs restore        还原成英文（或双击 uninstall.cmd）");
say("");
