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

// 紧邻字符串的字段名，形如 {label:"…"} 或 label="…"
export const FIELD_RE = /([A-Za-z_$][\w$]*)\s*[:=]\s*$/;

// 字段名识别窗口：minified 代码里字段名与字符串之间只有 : 或 = ，40 字符足够。
export const FIELD_WINDOW = 40;
