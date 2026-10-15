// 助记符（mnemonic）归一化。
//
// 语言包里带 && 且精确命中的 348 条中，官方写法 299 条是「译文(&&X)」，保存原英文字母，
// 这样 Alt+X 快捷键在中文界面下仍然可用。补译时不能保证风格一致，这里统一改写。
// 例：en="Cu&&t" → 译者给 "文&&件" 或 "剪切" 都归一成 "剪切(&&T)"。

export function normalizeMnemonic(en, zh) {
  const m = String(en).match(/&&(.)/);
  if (!m) return zh;
  // 官方统一大写：en="Cu&&t" 对应 zh="剪切(&&T)"
  const key = /[a-z]/.test(m[1]) ? m[1].toUpperCase() : m[1];

  let clean = String(zh);
  clean = clean.replace(/\s*\(&{1,2}.\)\s*$/, ""); // 去掉译者可能已写的 (&&X) / (&X) 后缀
  clean = clean.replace(/&&/g, ""); // 去掉内嵌的 &&
  clean = clean.trimEnd();

  if (clean === "") return zh;
  return `${clean}(&&${key})`;
}
