// 解析已装语言包的 bundle。纯只读。
//
// 一个扩展目录下可能声明多个 locale，按 languageId 过滤。
// bundle 结构可能是 { contents: { moduleId: { key: 译文 } } }，
// 也可能是直接的 { moduleId: { key: 译文 } }，两种都要兼容。

import fs from "node:fs";
import path from "node:path";

export function findLanguagePacks(extensionsDir, languageId = "zh-cn") {
  if (!fs.existsSync(extensionsDir)) return [];

  const packs = [];
  for (const name of fs.readdirSync(extensionsDir)) {
    const dir = path.join(extensionsDir, name);
    const pkgPath = path.join(dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;

    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
      continue;
    }

    const localizations = pkg?.contributes?.localizations;
    if (!Array.isArray(localizations)) continue;

    for (const loc of localizations) {
      if (loc.languageId !== languageId) continue;
      packs.push({
        dir,
        name,
        languageId: loc.languageId,
        localizedLanguageName: loc.localizedLanguageName,
        translations: Array.isArray(loc.translations) ? loc.translations : [],
      });
    }
  }
  return packs;
}

function readBundle(file) {
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`语言包 bundle 解析失败：${file}\n${e.message}`);
  }
  const bundle = raw && typeof raw === "object" && raw.contents ? raw.contents : raw;
  return bundle && typeof bundle === "object" ? bundle : null;
}

// 返回 Map<moduleId, Map<key, 译文>>。空字符串译文视为缺失。
export function loadPackTranslations(pack) {
  const out = new Map();
  for (const t of pack.translations) {
    const bundle = readBundle(path.join(pack.dir, t.path));
    if (!bundle) continue;
    for (const [moduleId, keys] of Object.entries(bundle)) {
      if (!keys || typeof keys !== "object") continue;
      let mod = out.get(moduleId);
      if (!mod) out.set(moduleId, (mod = new Map()));
      for (const [key, value] of Object.entries(keys)) {
        if (typeof value === "string" && value.length > 0) mod.set(key, value);
      }
    }
  }
  return out;
}

// 取第一个语言包（本工程场景下同时只应存在一个 zh-cn 包）
export function loadPrimaryPack(paths, languageId = "zh-cn") {
  const packs = findLanguagePacks(paths.extensionsDir, languageId);
  if (packs.length === 0) {
    throw new Error(`未在 ${paths.extensionsDir} 找到 languageId = "${languageId}" 的语言包`);
  }
  return { packs, primary: packs[0], translations: loadPackTranslations(packs[0]) };
}
