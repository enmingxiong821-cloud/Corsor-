// M4 目标文件。
//
// 前两个【不在】product.json 的 checksums 清单里 —— 改它们不必重算任何哈希，
// 入口 out/vs/code/electron-sandbox/workbench/workbench.js 虽被校验，但只是加载器，
// 用动态 import() 把这两个 bundle 拉进来。
//
// 第三个【在】checksums 清单里，改完必须重算 product.json 的校验值，否则 Cursor
// 的 IntegrityService（就在这个 bundle 里）报 "installation appears to be corrupt"。
//
// ★ 两者的取值规则正好相反，别搞混：
//   · glass / anysphere：Cursor 自研 React 层直接渲染字面量，不调 localize()，
//     所以 NLS 英文表里的串也必须翻（不加 nlsExclude）。
//   · desktop.main：VS Code 内核在 localize() 调用点替换，表内有键的字面量是死文本，
//     翻了没用；只有不在表里的裸字面量才是可见英文。所以必须加 nlsExclude。

export const M4_TARGETS = [
  { rel: "out/vs/workbench/workbench.glass.main.js", label: "AI 面板主体" },
  { rel: "out/vs/workbench/workbench.anysphere-ui-automations.js", label: "AI 自动化界面" },
  {
    rel: "out/vs/workbench/workbench.desktop.main.js",
    label: "主工作台内核",
    checksummed: true,
    nlsExclude: true,
  },
];

// product.json 的 checksums 键相对 out/ 目录，去掉 rel 的 "out/" 前缀即可。
export function checksumKey(rel) {
  return rel.replace(/^out\//, "");
}
