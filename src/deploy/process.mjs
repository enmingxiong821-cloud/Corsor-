// 进程探测：写入 Cursor 安装目录之前，必须先确认它已完全退出。
//
// 运行中写入有两个问题：文件可能被占用导致 rename 失败；即使写成功，
// 失效缓存也会在错误的时机生效。所以拿不准时一律当作"正在运行"处理。

import { spawnSync } from "node:child_process";

// Windows 上 tasklist 会卡死（实测：15 秒超时、沙箱内外都一样，而同一时刻
// PowerShell 的 Get-Process 毫秒级返回）。探测一旦拿不到结果，sync 被判定为
// "不确定"就永不写入 —— 计划任务会静默失效。所以 tasklist 拿不到结果时换
// PowerShell 再试一次；两条路都失败才返回 null。
function viaTasklist() {
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq Cursor.exe", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (r.error || typeof r.stdout !== "string" || r.status !== 0) return null;
  return r.stdout.includes("Cursor.exe");
}

function viaPowerShell() {
  const r = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "@(Get-Process -Name Cursor -ErrorAction SilentlyContinue).Count",
    ],
    { encoding: "utf8", windowsHide: true, timeout: 15000, windowsVerbatimArguments: false }
  );
  if (r.error || typeof r.stdout !== "string") return null;
  const n = Number.parseInt(r.stdout.trim(), 10);
  if (!Number.isFinite(n)) return null;
  return n > 0;
}

// 返回 true / false；无法判定时返回 null（调用方应按"不确定就别写"处理）
export function isCursorRunning() {
  if (process.platform !== "win32") return null;
  const viaList = viaTasklist();
  if (viaList !== null) return viaList;
  return viaPowerShell();
}
