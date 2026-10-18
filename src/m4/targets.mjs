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

// ★ 计费 / 用量页那一族文案（2026-10-16 加）。planUsage、plan-usage-included-section、
//   on-demand-limit-modal、get-more-usage-modal、glass-usage-lock 等模块把文案抽成
//   模块级常量，但只用在 switch 的 return、默认 props、三元分支上 —— 没有 `字段:常量`
//   这种位置，collectUiConstants 的第一道闸（至少在 UI_FIELDS 字段里当过值）够不着，
//   整族漏译。逐条核过：每个值在目标 bundle 里只出现 1–3 次，全部是
//   「声明 / 声明列表 / 渲染位置」，没有任何一处参与等值比较或字符串拼接。
//
//   三条刻意**不在**名单里，都验证过原因：
//     · `Share exceeds content limits` —— 在 glass 与内核里走
//       `t.rawMessage.includes(JBl)` / `.some(e=>…includes(JBl))` 做子串判定，
//       翻掉会让「分享超出内容上限」的识别失效。
//     · `No response was received within the time limit`（ask-question.ts）——
//       同一份代码里既是 `(t??"").trim().startsWith(hIo)` 的哨兵，又被插进提示词模板
//       `` `${hIo}. Proceed with the recommended option…` ``，翻了判定与提示词一起坏。
//     · `The AI provider is rate-limiting requests or is temporarily at capacity.` ——
//       全 bundle 只在 cloudAgentStreamErrorFixtures.js 里出现（错误回放用的脚本化
//       演示数据，不是真实用户可见文案）。
const USAGE_BILLING_LABELS = [
  "You're paused until your usage resets.",
  "You are out of usage. Switch to Auto or add usage to continue.",
  "Adjust your on-demand limit",
  "On-demand usage applies after your included usage is used up. Pay only for what you use.",
  "Set New Limit",
  "Adjust on-demand limit",
  "Get extra usage for busy days and longer work sessions.",
  "Adjust Limit",
  "Unlock higher monthly usage for heavier, everyday use.",
  "More models are only available on paid plans.",
  "Context usage canvas requires data storage.",
  "Could not open context usage canvas.",
  "Grok and Composer Usage",
  "Failed to save on-demand limit",
  "Showing cached usage data because the latest refresh failed.",
  "Weekly usage limit",
  "Monthly usage limit",
  "Usage past your limit is billed later as on-demand.",
  "Requests stop at this limit. Overage from requests already running isn't billed unless the limit is raised this billing cycle.",
  "Failed to enable usage-based pricing. Please try again.",
  "Failed to increase usage limit. Please try again.",
  "Continue without interruption",
];

// 只在 glass 里出现的五条（内核那份已由 NLS 语言包覆盖，实测该串在内核 bundle 里 0 次）。
const USAGE_BILLING_LABELS_GLASS_ONLY = [
  "Team environment edits are limited to admins by your team settings.",
  "Buy credits unavailable",
  "Credits can't be purchased here right now. You can add credits from the billing settings instead.",
  "Weekly usage limit reached",
  "Model Not Available",
];

// 两个 bundle 都有、但没跟上面那批排在一起的两条。
const USAGE_BILLING_LABELS_EXTRA = [
  "You're out of usage",
  "Usage limit reached, but you can continue at reduced speeds.",
];

// ★ Agent 输入框占位文案 + 模式说明（2026-10-18 加，规则 ⑩）。
//
//   两族都是同一段代码在 glass 与内核里各打包一份（写法完全相同），anysphere 里 0 次。
//   写法上同时躲过前九条：占位文案是裸 `return"…"`，模式说明是 `switch` 的
//   `case"chat":return"…"`，还有一处 `$b?Ojs:"…"` 的三元一支是变量 ——
//   没有字段名可依、不是裸常量赋值、也不是「两支都是字面量」的三元。
//
//   逐条核过（全 bundle 逐处打印上下文）：每个值只出现在「声明 / 返回 / 三元分支」，
//   没有任何一处参与等值比较或字符串拼接，也没有一处写进标识或数据表。所以是纯展示文案。
//
//   注意 `Add a follow-up` 早就躺在 data/m4.json 里（另有一批模式说明也是），
//   但在规则 ⑩ 落地前没有任何规则能命中它们 —— 词典条目是死的，界面照旧英文。
const AGENT_COMPOSER_HINTS = [
  // 输入框占位
  "Plan, Build, / for skills, @ for context",
  "Ask, learn, brainstorm",
  "Work on explicitly added files (no tools)",
  "Plan, search, build anything",
  "Continue locally",
  "Reject, suggest, follow up?",
  "Ask follow-ups in the worktree",
  "Add a follow-up",
  // getModeDescription() 的 switch 分支
  "Ask Cursor questions about your codebase",
  "Manually decide what gets added to the context (no tools)",
  "Create detailed plans for accomplishing tasks",
  "Create structured plans with implementation steps",
  "Run and coordinate multiple tasks in parallel",
  "Coordinate long-horizon tasks with delegated subagents",
];

// 模式说明里背景模式那一条被抽成了模块级常量（glass 的 `aMg`、内核的 `PFy`），
// 由规则 ⑨ 处理。两处都只有「声明 + `return`」两个站点，不参与比较。
const BACKGROUND_MODE_DESCRIPTION = "Build, research, debug at a longer horizon";

export const M4_TARGETS = [
  {
    rel: "out/vs/workbench/workbench.glass.main.js",
    label: "AI 面板主体",
    bareConstAllow: [
      ...USAGE_BILLING_LABELS,
      ...USAGE_BILLING_LABELS_EXTRA,
      ...USAGE_BILLING_LABELS_GLASS_ONLY,
      BACKGROUND_MODE_DESCRIPTION,
    ],
    bareReturnAllow: AGENT_COMPOSER_HINTS,
  },
  {
    rel: "out/vs/workbench/workbench.anysphere-ui-automations.js",
    label: "AI 自动化界面",
    // 规则 ⑨ 的裸常量白名单（实现见 scan.mjs）。下面两条是仓库选择器那两个默认 props：
    //   `newRepositoryLabel:L=fKr`（Start from scratch）、`clearSelectionLabel:ge=Eee`（No Repository）
    // 两者都是**纯渲染标签** —— 在同一个 bundle 内只出现在「定义 / 默认 props / 导出表」三处，
    // 不参与任何等值比较，导出名也不被别的 bundle 引用（glass 与内核里该导出名出现 0 次，实测）。
    //
    // ★ 名单必须按目标限定，不能改成全局值白名单：`Start from scratch` 在 glass（`Sye`）
    //   与内核（`_Yb`）里是「标签兼哨兵」—— `t.displayName.trim()===Sye` 拿它比对环境数据里的
    //   显示名，`name:_Yb` 写进工作区标识，翻掉会让 pending-new-project 环境被误判成普通工作区。
    //   同一个英文串在三个 bundle 里一个能翻、两个不能翻，这就是名单挂目标而非挂值的原因。
    bareConstAllow: ["No Repository", "Start from scratch"],
  },
  {
    rel: "out/vs/workbench/workbench.desktop.main.js",
    label: "主工作台内核",
    checksummed: true,
    nlsExclude: true,
    // 内核里那一份少了五条（那五条走 NLS 语言包，或本就不在内核 bundle 里）；
    // `You're out of usage` 与 `Usage limit reached, …` 在内核里是内联字面量，
    // 由 UI_FIELDS 的 trayLabel / disabledPrimaryActionHintText 两条字段规则收，
    // 不必再进白名单。
    bareConstAllow: [...USAGE_BILLING_LABELS, BACKGROUND_MODE_DESCRIPTION],
    bareReturnAllow: AGENT_COMPOSER_HINTS,
  },
];

// product.json 的 checksums 键相对 out/ 目录，去掉 rel 的 "out/" 前缀即可。
export function checksumKey(rel) {
  return rel.replace(/^out\//, "");
}
