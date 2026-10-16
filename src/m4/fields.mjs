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
  // 2026-10-15 二轮补入：`*Label` 家族里「确实承载界面文案」的那批。
  //
  // 做法不是「凡是 *Label 一律收」—— 实测 362 个候选字段里只有这 58 个能产生新串，
  // 其余要么值已覆盖、要么值不是界面文案。逐个按增量筛出来，白名单保持最小可审计。
  // 每一批的价值：云环境搭建进度（running/done/failed/warning 四态 × 15 步）、
  // 设置页与独立 Agent 窗口的状态胶囊（pill/status/kind/source）、
  // 空态与筛选（empty/content/activeScopeEmpty）、CI 修复胶囊（fixCiPill*）。
  //
  // 刻意不收的两个：
  //   · displayLabel —— 唯一新站点是用量统计图例 {type:"tab",label:"tab",displayLabel:"Tab"}，
  //     那里的 Tab 指 Cursor Tab 补全，而词典里 "Tab" 是「选项卡」，收了会把图例译错
  //   · productLabel 的值是产品名（Codex），已在 m4-skipped.json 逐条保留
  "runningLabel",
  "doneLabel",
  "failedLabel",
  "warningLabel",
  "pillLabel",
  "kindLabel",
  "settingsLabel",
  "tooltipLabel",
  "statusLabel",
  "emptyLabel",
  "actionLabel",
  "dismissLabel",
  "loadingLabel",
  "compactLabel",
  "openLabel",
  "contentLabel",
  "inlineLabel",
  "sourceLabel",
  "inputAriaLabel",
  "dropdownAriaLabel",
  "busyAriaLabel",
  "copyAriaLabel",
  "fallbackAgentLabel",
  "groupedLabel",
  "fullTabActionLabel",
  "moreLabel",
  "lessLabel",
  "closeTrayLabel",
  "sessionKindLabel",
  "productLabel",
  "legacyNewAgentLabel",
  "cloudOptionLabel",
  "localOptionLabel",
  "fixCiPillSingleLabel",
  "fixCiPillLoadingLabel",
  "fixCiPillLoadingProgressLabel",
  "fsdFixCiPillSingleLabel",
  "fsdFixCiPillLoadingLabel",
  "fsdFixCiPillLoadingProgressLabel",
  "downloadCtaLabel",
  "openCtaLabel",
  "nowLabel",
  "primaryActionLabel",
  "ctaLabel",
  "newAutomationButtonLabel",
  "quotableLabel",
  "folderBackLabel",
  "workersLabel",
  "executionLabel",
  "activeScopeEmptyLabel",
  "pluralLabel",
  "buildLabel",
  "currentLabel",
  "breadcrumbLabel",
  "rootLabel",
  "projectAgentsSectionLabel",
  // 2026-10-16 补入：计费/用量页那两个非 *Label 命名的展示字段。
  // 增量实测各 4 条（glass 与内核是同一批值）：trayLabel 是三条限额提示，
  // disabledPrimaryActionHintText 是按钮禁用时的悬停说明 —— 都只作展示。
  "trayLabel",
  "disabledPrimaryActionHintText",
  "dontAskAgainLabel",
  "allLabel",
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

