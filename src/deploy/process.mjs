// 进程探测：写入 Cursor 安装目录之前，必须先确认它已完全退出。
//
// 运行中写入有两个问题：文件可能被占用导致 rename 失败；即使写成功，
// 失效缓存也会在错误的时机生效。所以拿不准时一律当作"正在运行"处理。

import { spawnSync } from "node:child_process";

// 返回 true / false；无法判定时返回 null（调用方应按"不确定就别写"处理）
export function isCursorRunning() {
  if (process.platform !== "win32") return null;
  // 必须带超时：tasklist 在某些受限环境（沙箱、被劫持的 PATH、系统卡顿）下会一直不返回，
  // 而这里是无超时的同步调用 —— 一旦卡住，手工 patch 和每 15 分钟的计划任务会一起挂死。
  const r = spawnSync("tasklist", ["/FI", "IMAGENAME eq Cursor.exe", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (r.error || typeof r.stdout !== "string") return null;
  return r.stdout.includes("Cursor.exe");
}
