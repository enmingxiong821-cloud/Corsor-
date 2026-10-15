// 字体修复：让 Cursor 自有 UI 的中文不再掉到 Chromium 默认字体。
//
// 背景（2026-10-15 实机确证）：
//   内核 workbench.js 的 setupNLS 会写 <html lang="zh-Hans">，于是 VS Code 官方的
//   `.monaco-workbench.windows:lang(zh-Hans){font-family:Segoe WPC,Segoe UI,Microsoft YaHei,sans-serif}`
//   确实生效。但 Cursor 把标题栏等一大批组件改写成了
//   `font-family:var(--cursor-font-family,var(--vscode-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif))`，
//   而 --vscode-font-family 在主工作台里**从来没有被定义过** ——
//   内核只把它发进 webview 的 WebViewThemeDataProvider（workbench.desktop.main.js 里的
//   `a={"vscode-font-family":nFt,...}` 那个对象），主 workbench 的 UI 字体走的是上面那条
//   :lang() 规则，根本不发这个变量。
//   → 链尾兜底落到 sans-serif = 本机 Chromium 默认的 Noto Sans SC，
//     笔画比微软雅黑细约 10%，观感就是「虚浮」。
//
// 实测（canvas 渲染 + 像素哈希 + 墨迹像素数，26px，同一段中文）：
//   Segoe UI, sans-serif            → Noto Sans SC   4,531 ink
//   Segoe UI, Microsoft YaHei UI    → 微软雅黑        5,058 ink   ← 官方 zh-Hans 的落点
//   两者相差约 10%，正是肉眼看到的粗细差。本机未安装 Segoe WPC，
//   所以官方栈 `Segoe WPC,Segoe UI,Microsoft YaHei` 的实际落点也是微软雅黑。
//
// 为什么只定义 --vscode-font-family 这一个变量就够：
//   --cursor-font-family-sans 的定义是 `var(--cursor-font-family, var(--vscode-font-family, ...))`，
//   三个变量最终都收敛到 --vscode-font-family。反过来，如果用户或 Cursor 自己显式设过
//   --cursor-font-family，那条链会优先用它，我们不去剥夺显式配置 —— 这是有意的。
//
// 两条必须遵守的细节：
//   1. 微软雅黑必须排在 sans-serif **之前**。generic family 恒有匹配，写在它后面等于不存在。
//   2. 用 !important。!(内联非 important) 输给样式表的 important 声明，这样即使运行时
//      某处做过 body.style.setProperty("--vscode-font-family", ...) 也压得住。
//
// 拉丁字符仍然走 Segoe UI，与改动前完全一致 —— 变的只有汉字。

export const FONT_CSS_REL = "out/vs/workbench/workbench.desktop.main.css";

// 幂等标记。升级 Cursor 后这个文件会被换掉，标记随之消失，于是自动重新追加。
export const FONT_MARK = "/* cursor-zh-fontfix */";

const FONT_STACK = '"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif';

export const FONT_RULE = `${FONT_MARK}\n:root,.monaco-workbench{--vscode-font-family:${FONT_STACK}!important}\n`;

/**
 * 幂等追加。已含标记就原样返回，重复调用不会把规则叠第二遍。
 *
 * @param {string} source 现有 CSS 文本
 * @returns {{source:string, changed:boolean}}
 */
export function applyFontFix(source) {
  if (source.includes(FONT_MARK)) return { source, changed: false };
  const sep = source.endsWith("\n") ? "\n" : "\n\n";
  return { source: source + sep + FONT_RULE, changed: true };
}
