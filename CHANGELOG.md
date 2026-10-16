# 更新日志

Cursor 界面简体中文汉化。版本号约定 `zh-<Cursor 版本>.<序号>`，序号从 1 起，
Cursor 升级后重新汉化就递增（例如 Cursor 出 3.25.0 → `zh-3.25.0.1`）。

**本日志只记「改了什么、验证了什么」。** 当前状态快照、规则实现对照表与遗留项
见 [`docs/06-进度与遗留项.md`](docs/06-进度与遗留项.md)；实现规格见
[`docs/05-开发规格.md`](docs/05-开发规格.md)。

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
