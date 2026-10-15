// 解析键表与英文原文，展平为 [{ moduleId, key, en }]。
//
//   out/nls.keys.json     = [[moduleId, [key, ...]], ...]
//   out/nls.messages.json = [en, ...]  与上面逐位对应
//
// 两个数组顺序必须严格一致；长度不等说明 Cursor 版本结构变了，直接报错而不是继续。

import fs from "node:fs";

export function loadFlatKeys(paths) {
  const keysJson = JSON.parse(fs.readFileSync(paths.nlsKeys, "utf8"));
  const messagesJson = JSON.parse(fs.readFileSync(paths.nlsMessages, "utf8"));

  const flat = [];
  let i = 0;
  for (const [moduleId, keys] of keysJson) {
    for (const key of keys) {
      flat.push({ moduleId, key, en: messagesJson[i], index: i });
      i++;
    }
  }

  if (i !== messagesJson.length) {
    throw new Error(
      `键表与原文表长度不一致：键表展平 ${i} 条，nls.messages.json ${messagesJson.length} 条。` +
        "Cursor 版本结构可能已变化，请先核对再继续。"
    );
  }

  return { flat, moduleCount: keysJson.length, messagesJson, keysJson };
}
