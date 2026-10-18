# 更新日志

Cursor 界面简体中文汉化。版本号约定 `zh-<Cursor 版本>.<序号>`，序号从 1 起，
Cursor 升级后重新汉化就递增（例如 Cursor 出 3.25.0 → `zh-3.25.0.1`）。

**本日志只记「改了什么、验证了什么」。** 当前状态快照、规则实现对照表与遗留项
见 [`docs/06-进度与遗留项.md`](docs/06-进度与遗留项.md)；实现规格见
[`docs/05-开发规格.md`](docs/05-开发规格.md)。

---

## zh-3.25.6.1 — 2026-10-18

commit `d1c6165` ｜ Cursor **3.25.6** / 内核 VS Code 1.128.0

**适配 Cursor 3.25.6。** 计划任务在 2026-10-18 11:34 检测到升级并自动完成 NLS 重建、
bundle 改写、校验值重算与字体通道；本版补齐新版本带来的新增文案与一条取值规则。

### 新版本带来的增量

- NLS 键表 13,530 → **13,533**（+3 键，全部由 `data/overrides.json` 补译，覆盖率仍 100%）
- M4 新增 **216 条**候选：App Secrets、Agent 安全审查与 PR 审查、合并队列、项目邀请、
  Origin 命名空间、环境面板、搜索与侧栏、颜色名、开发类开关等
- 215 条译为中文；`Sky Map` 作为示例应用名保留英文（收进 `data/m4-skipped.json` 并注明原因）

### 新规则 ⑩：裸 `return` / 混合三元白名单

Agent 输入框的占位文案与模式说明（`Add a follow-up`、`Ask, learn, brainstorm`、
`Plan, Build, / for skills, @ for context` 等 15 条）同时躲过前九条规则：写法只有裸
`return "…"`、`switch` 分支里的 `return "…"`，以及「三元一支是变量」。与规则 ⑨ 同构，
名单按目标登记在 `M4_TARGETS[].bareReturnAllow`，逐值确认过全 bundle 只出现在渲染位置、
没有任何一处参与等值比较。规则本身净增 18 处（仅 glass），anysphere 与内核 0 处。

### 指标

| 指标 | 值 |
| --- | --- |
| NLS 覆盖率 | 13,533 / 13,533（100.00%），缺口 0 |
| M4 命中 / 可写入 | 13,716 处 / 12,577 处（未处理 0） |
| 译文表 / 保留英文 | 5,687 / 728 |
| `scan` / `verify` / 测试 | 100% / 6-6 / 73-73 |

### 验证

- 真机落盘：glass 8,103 处 / anysphere 784 处 / 内核 3,690 处，`verify` 6/6
- 抽查 `workbench.glass.main.js`：「规划、构建；/ 调用技能，@ 引用上下文」「添加密钥」
  「安全审查员」「合并 Pull Request」均已出现
- 三个目标 dry-patch `UNHANDLED=0`，`assertSyntax` 全过

### 文档

`CLAUDE.md`、`README.md`、`docs/04`、`docs/05`、`docs/06` 与 PR 模板同步到
3.25.6 / 13,533 / 十条规则的统一口径。

---

## zh-3.24.18.6 — 2026-10-17

commit `9e84258` ｜ Cursor 3.24.18 / 内核 VS Code 1.128.0

**仓库维护版，无新译文。** 译文表与 bundle 改写结果与 `.4` / `.5` 完全一致。

- 10 个默认标签中的 8 个译成中文（缺陷 / 新功能 / 文档 / 疑问 / 重复 / 无效 / 不予处理 / 无障碍），
  issue 模板的 `labels:` 引用同步更新
- `good first issue` / `help wanted` **只译描述、保留英文名** —— 改名会丢失 GitHub 特殊标签的行为
- 新增 `SECURITY.md`：私密上报渠道、支持范围、关注的风险类别、什么不算安全问题
- 新增 `.github/dependabot.yml`：每月检查 GitHub Actions 版本（仓库零第三方依赖，
  只监控 Actions）
- 关闭仓库 Projects（启用但未使用）

| 指标 | 值 |
| --- | --- |
| NLS 覆盖率 | 13,530 / 13,530（100.00%） |
| 可写入 | 13,674 处（未处理 0） |
| `scan` / `verify` / 测试 | 100% / 6-6 / 71-71 |

---

## zh-3.24.18.5 — 2026-10-16

commit `0c216d7` ｜ **文档版，无新译文**

- 新增 `CHANGELOG.md`（本文件）：把此前只存在于 GitHub Release 上的版本历史收进仓库
- 新增 `docs/06-进度与遗留项.md`：状态快照、十条规则 → 实现 → 用例对照表、带阻塞原因的
  遗留清单、换版本必重验清单
- 确立**数字口径的权威源**：同一个数字曾散在六处、每次只改一部分，`docs/06` 此后为先改之处，
  其余文件同步引用

---

## zh-3.24.18.4 — 2026-10-16

commit `d6d18c2` ｜ Cursor 3.24.18 / 内核 VS Code 1.128.0

**新增第十条规则：裸常量值白名单**（`M4_TARGETS[].bareConstAllow`）。

「套餐与用量」整页的文案被抽成模块级常量（`qos="You're paused until your usage resets."`），
只出现在 `switch` 的 `return`、默认 props 与三元分支上，没有 `字段:"文案"` 这种位置，
前九条规则一条都够不着。通用的「裸常量 / 裸 return」规则**实测会误收** SVG 的 `d` 路径、
zod 错误表、Java `toString` 格式，**已否决**；改为逐个值开口子。

- 名单覆盖 glass 与内核的**计费 / 用量页文案族**（`planUsage`、`plan-usage-*`、
  `on-demand-limit-modal`、`get-more-usage-modal`、`buy-credits-modal`、`glass-usage-lock`、
  `contextUsageCanvasFileContents` 等），以及 anysphere 的两条仓库选择器默认标签
- 匹配只锚「`=值`」**不锚标识符** —— minified 名在同一个 bundle 里会被不同模块复用
- 名单**按目标限定**，不做全局值白名单：`Start from scratch` 在 glass（`Sye`）与
  内核（`_Yb`）里是「标签兼哨兵」，翻掉会让 pending-new-project 环境被误判
- 另收录两个非 `*Label` 展示字段 `trayLabel`、`disabledPrimaryActionHintText`
- 逐条核过使用站点后**刻意留三条英文**：`Share exceeds content limits`（子串判定）、
  `No response was received within the time limit`（既是 `startsWith` 哨兵又被插进提示词模板）、
  `The AI provider is rate-limiting requests or is temporarily at capacity.`
  （只出现在 `cloudAgentStreamErrorFixtures.js` 的错误回放演示数据里）

| 指标 | 变化 |
| --- | --- |
| 可写入 | 13,615 → **13,674 处** |
| 译文表 `data/m4.json` | 5,432 → **5,463 条** |
| 未处理候选 | **0** |

验证：`scan` 100% · `verify` 6/6 · `node --test` 71/71 · 实机 `patch` 后二次 `--dry-run`
四个目标全部报「无需改写」（证明是就地替换而非重复追加）。

## zh-3.24.18.3 — 2026-10-16

commit `0dac697`（功能提交 `c2eba2b`）

**新增三条规则，补三类三元链写法**（⑥⑦⑧），合计净增 **80 条**去重候选：

- ⑥ 链的外层分支（`xa?"This PC":_r?"This Mac":"This Computer"` —— else 支是另一条三元，
  而「两支都是字面量」的旧规则认不出来）
- ⑦ **本地化壳的对象形态**（`D({key:"glassOsEditUndo",comment:["&& denotes a mnemonic"]},"&&Undo")`）
  —— 这层壳对非数字键直接返回英文实参，语言包永远够不着。编辑菜单下拉那一排
  Undo / Redo / Cut / Copy / Paste / Select All 由此补回
- ⑧ 深链（中间段带等值比较的链，`Move to this machine` / `Login` / `Unstage All` 一族）

⑧ 的判定用**不消耗字符的先行断言**（写成普通匹配会在链上交替命中，后面的分支轮不到自己
那次匹配，实测 41 → 29）；放行尺度**按分支独立判定**，不做 ⑥ 那种全链同尺度 ——
链上后续环节里的 `"unreachable"` / `"cloud"` / `"ENETUNREACH"` 是**比较操作数**（标识）
而不是渲染分支。`Insert` 由标识值守卫自动挡下。

## zh-3.24.18.2 — 2026-10-16

commit `16642be`

**修一处会让整片区域失明的扫描缺陷。** 切字符串用的 `LIT` 只认引号配对、不是 JS 感知的：
模板字符串里出现一个 apostrophe 时，会跟后面某个单引号串的**开引号**配上对，把中间整段
（含真实字面量）吞成一个 token —— 那些字面量压根不会被访问，字段规则整片失明。

实测 glass bundle 第一处翻转在偏移 11385（`` `'{snip} ${n}` ``），此后大段区间漏译，
Agent 窗口菜单标题 `title:"New Browser"` 就是这么丢的。

修法是加一条**不依赖配对**的等价正则 `DIRECT_FIELD_RE` 直接跑原文，与 `LIT` 那轮按起始
偏移去重（只净增、不覆盖）。全量重扫补出 **356 条**候选（316 译 + 40 保留）。

## zh-3.24.18.1 — 2026-10-15

commit `03a18d4`

**M4 二轮补全，未处理清零：**

- 新增规则 ⑤ **驼峰键映射表**（`zme={section:"Browser",automation:"Browser Automation",…}`）
  —— 与设置页左导航表形状相同、只是键为驼峰，原先「键必须全小写」的限定抓不到，
  独立 Agent 设置面板的 Browser 那一组就是这么整片漏掉的
- 把 **58 个** `*Label` 字段并入 `UI_FIELDS`：从 362 个候选里**逐个按增量筛出**，只把这
  58 个能产生新串的收进来（价值最大的是云环境搭建进度的四态 × 15 步）。
  **刻意不收 `displayLabel`** —— 它唯一的增量站点是用量统计图例 `{type:"tab",label:"tab",displayLabel:"Tab"}`，
  那里的 Tab 指 Cursor Tab 补全，收了会把图例译错

---

## zh-3.24.18.0 之前（未打 tag）

工程建立与 M1–M4 首次交付。主要提交：

| commit | 内容 |
| --- | --- |
| `4a24e91` | M4 交付（AI 面板文案改写 + UI 字体通道）并加固写入管线 |
| `1c62203` | 修复独立 Agent 窗口汉化失效（补齐四类语法形态 + 两处解析错误） |
| `6f777d5` | 一键安装体验（`install.cmd` / `uninstall.cmd`）与 `setup` 编排 |
| `4960c78` | 新增 `sync` 命令与计划任务，Cursor 升级后自动重新汉化 |
| `01a835d` | 覆盖率基准改用备份里的原始英文表，消除安装后的 13 条假缺口 |
| `7db8a96` | 初始提交：规格、源码与工具 |

**已发布 Release**：`zh-3.24.18.1` → `03a18d4` ｜ `.2` → `16642be` ｜ `.3` → `0dac697` ｜ `.4` → `d6d18c2`
