// Cursor 自有 bundle（glass / anysphere）里硬编码文案的识别规则。
//
// 与 NLS 不同，这些字符串是编译进代码的字面量，没有 key，只能按「出现在哪个字段」
// 反推它是不是给用户看的。判错的代价很直接：
//   · 把 CSS 变量名当文案翻掉 → 主题配色错乱
//   · 把遥测字段当文案翻掉 → 数据上报语义变化
//   · 把命令 ID 当文案翻掉 → 快捷键/命令失效
// 所以 NEVER 是硬约束，UI 则偏保守 —— 宁可漏译，不可误伤。

export const UI_FIELDS = new Set([
  // 展示型字段（实测命中量从高到低）
  "label",
  "title",
  "children",
  "description",
  "placeholder",
  "placeHolder",
  "ariaLabel",
  "tooltip",
  "hintText",
  "text",
  "detail",
  "subtitle",
  "caption",
  "emptyMessage",
  "noResultsMessage",
  "helpText",
  "labelLong",
  "labelShort",
  "accessibleLabel",
  "LABEL",
  "LABEL_LONG",
  "LABEL_SHORT",
  "subLabel",
  "tooltipText",
  "hint",
  // 2026-10-15 实测补入（Agent 窗口与设置页残留英文的主因之一）。
  // 刻意不收的两个：
  //   · glassCategory —— 键位分组名，与 category 共用同一批值，翻了会让快捷键归错组
  //   · message / error / body / header / source —— 既是显示文案也是协议字段，分不清
  "sectionTitle",
  "sectionLabel",
  "collectionLabel",
  "listLabel",
  "itemLabel",
  "columnLabel",
  "rowLabel",
  "groupLabel",
  "defaultLabel",
  "cancelLabel",
  "saveLabel",
  "confirmLabel",
  "buttonLabel",
  "primaryLabel",
  "primaryButton",
  "secondaryLabel",
  "connectLabel",
  "regretLabel",
  "navLabel",
  "menuLabel",
  "tabLabel",
  "headerTitle",
  "emptyStateTitle",
  "heading",
  "pageTitle",
  "displayName",
  "locationName",
  "loadingAction",
  "completedAction",
]);

export const NEVER_FIELDS = new Set([
  // 标识与技术字段：翻了就坏
  "value",
  "id",
  "command",
  "key",
  "name",
  "icon",
  "codicon",
  "themeIcon",
  "type",
  "kind",
  "className",
  "class",
  "style",
  "url",
  "uri",
  "path",
  "href",
  "src",
  "alias",
  "domain",
  "purpose",
  "scope",
  "category",
  "tag",
  "role",
  "mode",
  "status",
  "state",
  "event",
  "action",
  "method",
  "field",
  "format",
  "scheme",
  "protocol",
  "mime",
  "charset",
  "encoding",
  "version",
  "commit",
  "hash",
  "sha",
  "token",
  "secret",
  "env",
]);

// 紧邻字符串的字段名，形如 {label:"…"} 或 label="…"。
// 也认带引号的字段名：{"aria-label":"Repositories"} —— 早期只认裸标识符，这类整片漏译。
export const FIELD_RE = /(?:"([A-Za-z][\w-]*)"|'([A-Za-z][\w-]*)'|([A-Za-z_$][\w$]*))\s*[:=]\s*$/;

// aria-label → ariaLabel，带连字符的字段名折成驼峰后再对白名单，好让一个名字管两种写法。
export function normalizeFieldName(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// 字段名识别窗口：minified 代码里字段名与字符串之间只有 : 或 = ，40 字符足够。
// 带引号的名字要长一点（"aria-label": 有 13 个字符），但仍在窗口内。
export const FIELD_WINDOW = 40;

