#!/usr/bin/env node
// 一键卸载：注销自动跟随任务，并把 Cursor 还原成原始英文界面。
//
//   node scripts/teardown.mjs
//
// 顺序很关键：先注销任务，再还原文件。反过来的话，任务可能在还原后立刻又装回去。

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { locate } from "../src/scan/locate.mjs";
import { readProduct } from "../src/scan/product.mjs";
import { listBackups } from "../src/deploy/restore.mjs";
import { isCursorRunning } from "../src/deploy/process.mjs";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "cli.mjs");
const UNREGISTER = path.join(ROOT, "scripts", "unregister-task.ps1");

const TOTAL = 3;
const say = (s = "") => console.log(s);
const step = (n, title) => say(`\n[${n}/${TOTAL}] ${title}`);

function fail(msg, hint) {
  say("");
  say(`✗ ${msg}`);
  if (hint) say(`  → ${hint}`);
  say("");
  process.exit(1);
}

say("");
say("Cursor 简体中文汉化 · 一键还原");
say("═".repeat(56));

// —— 1. Cursor 必须完全退出 ——
step(1, "确认 Cursor 已完全退出");
const running = isCursorRunning();
if (running === null) {
  fail("无法确认 Cursor 是否在运行", "请在任务管理器里确认没有 Cursor.exe 进程后重试。");
}
if (running) {
  fail(
    "Cursor 正在运行，不能写入",
    "请完全退出 Cursor（含托盘图标：右键 → 退出），然后重新双击本文件。"
  );
}
say("  已确认退出。");

// —— 2. 注销自动跟随 ——
step(2, "注销自动跟随任务");
const r = spawnSync(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", UNREGISTER],
  { stdio: "inherit", cwd: ROOT }
);
if (r.error || r.status !== 0) {
  say("");
  say("⚠ 任务注销未成功，不影响还原，但请稍后手动确认：");
  say("      schtasks /Query /TN CursorZhAutoSync");
}

// —— 3. 还原文件 ——
step(3, "还原被改写的文件");
let paths;
try {
  paths = locate();
} catch (e) {
  fail("找不到 Cursor 安装目录", e.message);
}
const backups = listBackups(ROOT);
if (backups.length === 0) {
  say("  没有任何备份，说明汉化大概从未写入过 —— 无需还原。");
} else {
  const product = readProduct(paths);
  const wanted = `${product.version}_${product.distro}`;
  if (!backups.includes(wanted)) {
    say(`  没有当前版本（${wanted}）的备份，不做任何覆盖。`);
    say(`  现有备份：${backups.join("、")}`);
    say("  这通常意味着 Cursor 已升级到新版本，旧备份不能拿来覆盖新文件。");
  } else {
    const rr = spawnSync(process.execPath, [CLI, "restore"], { stdio: "inherit", cwd: ROOT });
    if (rr.error) fail("还原无法启动", rr.error.message);
    if (rr.status !== 0) fail(`还原失败（退出码 ${rr.status}）`, "详细原因见上方输出。");
  }
}

say("");
say("═".repeat(56));
say("✓ 还原完成");
say("");
say("重新打开 Cursor 即为原始英文界面。语言缓存会在启动时重建。");
say("（本项目自身的 data/、backup/、logs/ 都没有删除，需要的话可以手动清理。）");
say("");
