// 定位 Cursor 安装目录与用户目录。纯只读。
//
// 优先 CURSOR_INSTALL_DIR 环境变量，其次探测常见路径。
// 校验依据：目录下存在 resources/app/out/nls.keys.json。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "cursor"),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Cursor"),
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Cursor"),
  "/Applications/Cursor.app/Contents/Resources/app",
  "/usr/share/cursor",
  "/opt/Cursor",
].filter(Boolean);

function isAppDir(dir) {
  return !!dir && fs.existsSync(path.join(dir, "out", "nls.keys.json"));
}

function resolveInstallDir() {
  const fromEnv = process.env.CURSOR_INSTALL_DIR;
  if (fromEnv) {
    const app = isAppDir(path.join(fromEnv, "resources", "app"))
      ? path.join(fromEnv, "resources", "app")
      : fromEnv;
    if (!isAppDir(app)) {
      throw new Error(`CURSOR_INSTALL_DIR 指向的目录里找不到 out/nls.keys.json：${fromEnv}`);
    }
    return app;
  }

  for (const dir of CANDIDATES) {
    // macOS 候选本身就是 resources/app，其余是安装根目录
    const app = isAppDir(dir) ? dir : path.join(dir, "resources", "app");
    if (isAppDir(app)) return app;
  }

  throw new Error(
    "未能定位 Cursor 安装目录。请设置环境变量 CURSOR_INSTALL_DIR 指向安装根目录\n" +
      `（已尝试：${CANDIDATES.join("、")}）`
  );
}

// Cursor 的用户数据目录：clp 缓存就在它下面的 clp/。
// 三个平台各不相同，写错不会报错——只会让缓存失效静默失效，表现为"改了没生效"。
function resolveDataDir(home) {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Cursor");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Cursor");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Cursor");
}

export function locate() {
  const appDir = resolveInstallDir();
  const outDir = path.join(appDir, "out");
  const home = os.homedir();
  const userDir = path.join(home, ".cursor");
  const dataDir = resolveDataDir(home);

  return {
    appDir,
    outDir,
    userDir,
    extensionsDir: path.join(userDir, "extensions"),
    argvJson: path.join(userDir, "argv.json"),
    dataDir,
    clpDir: path.join(dataDir, "clp"),
    productJson: path.join(appDir, "product.json"),
    nlsKeys: path.join(outDir, "nls.keys.json"),
    nlsMessages: path.join(outDir, "nls.messages.json"),
  };
}
