# Cursor 汉化工程

[![CI](https://github.com/enmingxiong821-cloud/Corsor-/actions/workflows/ci.yml/badge.svg)](https://github.com/enmingxiong821-cloud/Corsor-/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

把 Cursor 界面完整简体中文化 —— 随时可一键还原，Cursor 升级后自动跟随。

| 指标 | 实测值 |
| --- | ---: |
| Cursor 版本 | 3.24.18（内核 VS Code 1.128.0） |
| 界面消息键总数 | 13,530 |
| 中文覆盖 | **13,530（100.00%）** |
| 被校验文件 | 6 个 —— 4 个保持原样，2 个改写后同步重算校验值（`workbench.desktop.main.js` 与字体通道的 `workbench.desktop.main.css`） |

---

## 一键使用

1. 装好 [Node.js 18+](https://nodejs.org/)（已装可跳过）
2. **完全退出 Cursor** —— 连托盘图标一起（右键 → 退出）
3. 双击 **`install.cmd`**

重新打开 Cursor 就是中文。

之后 Cursor 每次升级，都会在你退出它之后自动重新汉化，**不用再管**。

想还原：完全退出 Cursor，双击 **`uninstall.cmd`**，字节级回到原样。

---

## 它做了什么

Cursor 启动时按这个规则取界面文案：

```js
译文 = 语言包[moduleId][key] || 默认消息表[i]
```

默认消息表 `out/nls.messages.json` **不在 `product.json` 的校验清单里**，而语言包缺的键会自动回退到它。所以提升覆盖率只需要：

1. 把语言包覆盖不到的那 1,971 条，按索引改写进这一个文件
2. 失效 Cursor 的语言缓存 `clp\<hash>.zh-cn\<commit>\`，让它重新构建

**NLS 这一层不生成语言包、不装 VSIX、不碰任何被校验文件、不改 `argv.json`、不重算任何哈希。**
因此 Cursor 的完整性校验永远通过，也不会出现"安装似乎损坏"。

（AI 面板层走的是另一条路 —— 那里必须改写两个被校验文件，代价与对策见下文「两个层次」。）

代价只有一个：写入必须在 Cursor 完全退出时进行 —— 这正是 `sync` 与计划任务存在的原因。

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `node src/cli.mjs scan` | 扫描并打印覆盖率（只读） |
| `node src/cli.mjs doctor` | 环境自检 |
| `node src/cli.mjs verify` | 校验 6 个被校验文件 + 金标准断言（只读） |
| `node src/cli.mjs sync` | 手动跟随一次 Cursor 升级（NLS + AI 面板） |
| `node src/cli.mjs install --yes` | 写入 Cursor 并失效缓存 |
| `node src/cli.mjs patch --yes` | 单独汉化 AI 面板（3 个 bundle + UI 字体规则，含重算校验值） |
| `node src/cli.mjs patch --dry-run` | 只预演 AI 面板汉化，不改动任何文件 |
| `node src/cli.mjs restore` | 从备份字节级还原 |
| `node src/cli.mjs cache` | 查看语言缓存状态 |

除 `install` / `patch` / `restore` / `sync` 外，**所有命令都不写入 Cursor 安装目录**。

`sync` 每次执行都会在 `logs/sync.log` 留一行记录，排错先看它。

---

## 自动跟随

`install.cmd` 会登记一个 Windows 计划任务 `CursorZhAutoSync`：**每 15 分钟检查一次**。

大多数时候它只是读一下版本和哈希（几毫秒）就退出。只有在这两种情况下才真正写入：

- Cursor 换了版本（升级）
- `out/nls.messages.json` 或两个 AI 面板 bundle 被换回了英文原文

两条通道互相独立：NLS 层失败不影响 AI 面板，反之亦然，各自在 `logs/sync.log` 留记录。

写入前后都遵守两条底线：**Cursor 运行中一律不写**；文件既不是原始内容也不是本工具写入的内容时（可能被别的工具动过）**只告警、不覆盖**。

注销任务：`scripts/unregister-task.ps1`，或直接跑 `uninstall.cmd`。

---

## 两个层次

**NLS 消息层**：13,530 条标准界面文案，跑 `scan` 报 **100.00% / 缺口 0**。做法是改写 `out/nls.messages.json` 并失效 `clp` 缓存 —— 这个文件免校验，所以不重算任何哈希。

**AI 面板层（M4）**：Cursor 自有的聊天、智能体面板等由 React/SolidJS **硬编码渲染**，不走 NLS。做法是直接改写 bundle 里的字符串常量：

| 文件 | 大小 | 是否在 `product.json.checksums` | 写入后 |
| --- | --- | --- | --- |
| `out/vs/workbench/workbench.glass.main.js` | 47 MB | 否 | 免校验，改完即完 |
| `out/vs/workbench/workbench.anysphere-ui-automations.js` | 8.9 MB | 否 | 免校验，改完即完 |
| `out/vs/workbench/workbench.desktop.main.js` | 39.8 MB | **是** | 重算 `product.json.checksums` 并过完整性闸门 |
| `out/vs/workbench/workbench.desktop.main.css` | 1.2 MB | **是** | 字体通道：末尾追加 `--vscode-font-family` 定义（补中文字体），同样重算校验值 |

前两个文件被 `workbench.js` 用动态 `import()` 加载，改它们不触发校验。第三个是 VS Code 内核本身，改完必须重算校验值 —— 这不是绕过校验，而是 Cursor 自己的 `IntegrityService` 就靠读 `product.json` 判断安装是否完好，所以重算正是官方机制。

**字体通道**：Cursor 把标题栏等一大批组件的字体写成 `var(--cursor-font-family, var(--vscode-font-family, …, sans-serif))`，而 `--vscode-font-family` 在主工作台里**从未被定义**（内核只把它发进 webview）。链尾于是落到 Chromium 默认 `sans-serif` = Noto Sans SC，笔画比官方中文界面的微软雅黑细约 10%，观感「虚浮」。修法是给同样被校验的 `workbench.desktop.main.css` 末尾追加一条变量定义，把**微软雅黑排在 `sans-serif` 之前**（generic family 恒有匹配，写在它后面等于不存在）。只定义 `--vscode-font-family` 一个就够，`--cursor-font-family-sans` 的定义链以它兜底。幂等靠 CSS 里的标记行，Cursor 升级换掉该文件后标记消失、自动重加。

**两条方向相反的扫描规则**（搞反会大面积误翻）：

- `glass` / `anysphere` 的 React 层**根本不调 `localize()`**，直接渲染字面量 —— 所以 NLS 表里有的串在这里**也要翻**（此类曾漏掉 336 条）。
- `workbench.desktop.main.js` 是 VS Code 内核，`localize()` 会在运行时替换 —— 表里已有的串在这里是**死文本**，翻了不生效还会让 diff 变脏，必须**排除**。

排除基准取**备份里的原始英文表**，不能取盘上当前的 `nls.messages.json`（装过之后它已经是中文）。

**标识值守卫**：代码里存在 `e.label==="Task"`、`o.label==="Production"?"prod":"dev"` 这类「拿显示文字反查标识」的写法。同一个值在渲染侧被翻译、在判断侧保持英文，就会失配（实测后果：`backgroundComposerEnv` 写不进存储、Cancel 快选返回错值）。所以凡参与过等值比较的字段值一律不翻，代价是 10 条文案让位给正确性。

译文表 5,463 条（`data/m4.json`），另有 727 条经判断**保留英文**（工具参数 schema、遥测指标、调试标签、模型名与专有名词），清单见 `data/m4-skipped.json`。下表按目标拆分（同一英文串在不同文件里各计一次）：

| 目标 | 命中 | 候选（去重） | 已译 | 保留英文 | 未处理 |
| --- | ---: | ---: | ---: | ---: | ---: |
| glass | 8,840 处 | 5,712 | 5,011 | 701 | **0** |
| anysphere | 865 处 | 650 | 578 | 72 | **0** |
| workbench.desktop.main | 3,969 处 | 3,056 | 2,674 | 382 | **0** |

**未处理已清零**：早先刻意留英文的那 59 条内核 JSON-schema `description`（如 `Name of the debug visualizer`，主要喂给模型而非用户）现已统一收进 `data/m4-skipped.json` 逐条注明原因，不再区分「未处理」与「保留英文」两种状态。

> 2026-10-15 修正了取值规则，详见 `docs/05` §7 —— 其中最关键的一条是**取消「NLS 英文表里已有就排除」**：NLS 只替换 `localize()` 调用点，而 Cursor Agent / Anysphere 那层 React 界面直接渲染 bundle 字面量、根本不调 `localize()`，排除掉就永远是英文（此类共 336 条）。该规则只对那两个免校验 bundle 成立，内核 bundle 恰好相反。
>
> 同日补齐了四类此前完全抓不到的写法：`title:{value,original}` 成对结构、设置页那份 ≥5 成员的 `id:"文案"` 左导航映射表、`||"…"` 兜底默认值、`? "…" : "…"` 三元分支；并修掉两处会真出错的解析：变量声明列表 `var A,B,C` 被误当成数组元素（导致模块级常量文案整片漏译），以及映射表**键带引号**时替换区间算到键上（改写后 `assertSyntax` 当场拦下，bundle 语法崩）。
>
> 同日还收进了第五类写法：**驼峰键映射表**（`zme={section:"Browser",automation:"Browser Automation",…}`）。它与左导航表形状相同、只是键为驼峰，原先「键必须全小写」的限定抓不到 —— 独立 Agent 设置面板的 Browser 那一组就是这么整片漏掉的。规则 ④ 是纯增量，四道闸拦住会改语义的表（Statsig 字段映射、权限 scope、枚举 slug）。另外把 58 个确实承载界面文案的 `*Label` 字段并进白名单（云环境搭建进度的四态 × 15 步、状态胶囊、空态与筛选、CI 修复胶囊）—— 做法不是「凡是 `*Label` 一律收」，362 个候选里只有这 58 个能产生新串，逐个按增量筛出，白名单保持最小可审计。
>
> 2026-10-16 修掉一处**会让整片区域失明**的扫描缺陷：切字符串用的正则只认引号配对、不是 JS 感知的。模板字符串里出现一个 apostrophe 时，它会跟后面某个单引号串的**开引号**配上对，把中间整段（含真实字面量）吞成一个 token —— 那些字面量压根不会被访问到，字段规则就此整片失效。实测 glass bundle 第一处翻转在偏移 11385（`` `'{snip} ${n}` ``），此后大段区间漏译，Agent 窗口菜单标题 `title:"New Browser"` 就是这么丢的（全量重扫共补出 356 条候选）。修法是另加一条**不依赖配对**的等价正则直接跑原文，与原来那轮按起始偏移去重，只净增、不覆盖，白名单与标识守卫两道闸照旧。
>
> 同日再补三类**三元链**写法，合计净增 80 条去重候选。⑥ 链的外层分支（`xa?"This PC":_r?"This Mac":"This Computer"`，else 支是另一条三元，而「两支都是字面量」的旧规则认不出来）；⑦ **本地化壳的对象形态**（`D({key:"glassOsEditUndo",comment:["&& denotes a mnemonic"]},"&&Undo")`）—— 编辑菜单下拉里那一排 Undo / Redo / Cut / Copy / Paste / Select All 就是从这里丢的：这层壳对非数字键直接返回英文实参，语言包永远够不着，只能改字面量；⑧ 深链（中间段带等值比较的链，`Move to this machine` / `Login` / `Unstage All` 一族）。⑧ 的判定用**不消耗字符的先行断言** —— 写成普通匹配会在链上交替命中，后面的分支永远轮不到自己那次匹配（实测 41 → 29，掉的是 `Login` 与 `Limit Reached`）；放行尺度按分支独立判定，不做 ⑥ 那种全链同尺度，因为链上后续环节里的 `"unreachable"` / `"cloud"` / `"ENETUNREACH"` 是**比较操作数**（标识）而不是渲染分支。`Insert` 由标识值守卫自动挡下，`Windows` 与 `Merge Request` 按专有名词、术语表一致性保留英文。
>
> 同日又补第九类：**裸常量值白名单**（`var Eee="No Repository",fKr="Start from scratch";`）。模块级常量赋值既没有字段名可依、也不是三元或兜底，前八条规则一条都够不着；而通用的「裸常量」规则实测会把 SVG 的 `d` 路径、zod 错误表、Java `toString` 格式整片收进来，已否决。所以改成**逐个值开口子，并且名单挂在目标上**（`M4_TARGETS[].bareConstAllow`），当前只有 anysphere 那两个仓库选择器的默认标签。名单必须按目标限定而不能做成全局值白名单，因为同一个英文串换个文件身份就变了：`Start from scratch` 在 glass（`Sye`）与内核（`_Yb`）里是「标签兼哨兵」，`t.displayName.trim()===Sye` 拿它比对环境数据里的显示名、`name:_Yb` 写进工作区标识，翻掉会让 pending-new-project 环境被误判成普通工作区 —— 那两处因此保持英文，只在 anysphere 里译为「从头开始」。匹配只锚「`=值`」不锚标识符：minified 名在同一个 bundle 里会被不同模块复用，锚标识符等于给自己埋雷。
>
> 同日把第九类的名单从 anysphere 扩到三个目标：**计费 / 用量页**那族文案（`planUsage`、`plan-usage-included-section`、`plan-usage-on-demand-section`、`on-demand-limit-modal`、`get-more-usage-modal`、`buy-credits-modal`、`glass-usage-lock` 等模块）被抽成模块级常量，却只出现在 `switch` 的 `return`、默认 props 和三元分支上，没有 `字段:常量` 这种位置，前九条规则一条都够不着 —— 套餐与用量整页因此停在英文。另有两个非 `*Label` 命名的展示字段 `trayLabel`、`disabledPrimaryActionHintText` 一并收录（各带来 4 条限额提示与按钮禁用说明）。逐条核过使用站点后**刻意留了三条英文**：`Share exceeds content limits`（子串判定）、`No response was received within the time limit`（既是 `startsWith` 哨兵又被插进提示词模板）、`The AI provider is rate-limiting requests or is temporarily at capacity.`（只出现在错误回放用的脚本化演示数据里，不是真实文案）。同族的 `Premium`、`Get more usage with Premium`、`Upgrade to Premium` 在三个 bundle 里出现 0 次 —— 由服务端下发，本地改不到。


安全措施：改写前先 `node --check` 校验整份语法，语法不过就中止且不写；写入用「临时文件 + 原子改名」，47 MB 文件写到一半断电也不会留下半截文件；被校验文件（内核 bundle 与字体 CSS）写入后立刻把 6 个文件全部重算一遍，任何一个对不上就**自动回滚**该文件与 `product.json`，退回写入前状态。万一恰在「文件已写、校验值未更新」的间隙被强杀，下次 `sync` 会认出那是自己的半成品并**补算**校验值 —— 而不是卡在「无需改写」分支里再也修不回来。备份与 NLS 层共用同一套 manifest，`restore` 会一并还原。

---

## 目录结构

```
.
├── install.cmd / uninstall.cmd   一键安装 / 一键还原（双击即可）
├── CLAUDE.md                     编码代理入口（铁律、关键事实）
├── docs/                         调研与设计文档
├── src/                          产品代码（Node ESM，零第三方依赖）
│   ├── scan/                       定位 Cursor、解析键表、读语言包
│   ├── align/                      合并、归一化、报告
│   ├── dict/                       补译词典装载、校验、组装
│   ├── deploy/                     备份、写入、还原、缓存失效
│   ├── m4/                         AI 面板 bundle 扫描、改写、完整性闸门、字体通道、语法校验
│   └── cli.mjs                     命令行入口
├── scripts/                      一键安装编排 + 计划任务注册/注销
├── data/                         overrides.json（补译词典）、m4.json、m4-skipped.json、renames.json、terms.json
├── tests/                        零依赖单元测试
├── tools/                        早期调研脚本（覆盖率量化、GitHub 检索）
├── backup/                       写入前的原始文件备份（按 版本_发行版 分层）
└── build/                        生成产物（工作单、改写后的表、逐条对照）
```

`backup/` 与 `build/` 不入库：前者含 Cursor 自身内容且还原依赖本地副本，后者可随时重新生成。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | **编码代理入口** —— 铁律、关键事实、开工顺序 |
| [docs/05-开发规格.md](docs/05-开发规格.md) | **实现规格** —— 模块清单、算法、里程碑、验收标准 |
| [docs/01-设计蓝图.md](docs/01-设计蓝图.md) | 分层架构、关键算法、实施路线、验证与回滚协议 |
| [docs/02-同类项目调研.md](docs/02-同类项目调研.md) | GitHub 全网检索、技术路线分类、社区共识与分歧 |
| [docs/03-技术机制与实测数据.md](docs/03-技术机制与实测数据.md) | 本地化加载链、覆盖率实测、修改通道分析 |
| [docs/04-参考资料与路径索引.md](docs/04-参考资料与路径索引.md) | 上游权威资源、本机关键路径、术语表 |

> 环境备注：本机 `python` 被 Microsoft Store 别名劫持、`Python313` 被执行策略拒绝，故工具链全部采用 **Node 24** 实现。

---

## 贡献

三条自检是合并的前提，CI 会在每次 push 与 PR 上重跑（其中前两条需要本机已装 Cursor，
故不在 CI 里跑，由 PR 模板要求自行附上输出）：

```bash
node src/cli.mjs scan && node src/cli.mjs verify && node --test "tests/**/*.test.mjs"
```

预期依次是 **13,530 / 13,530（100.00%）**、**6/6 通过**、**全绿**。

- **反馈漏译**：先查 `data/m4-skipped.json` —— 那 727 条是**刻意保留英文**的
  （模型参数 schema、遥测指标、调试标签、专有名词，以及翻了会导致判断侧与显示侧失配的标识值）。
- **改扫描 / 改写规则**：请一并补 `tests/m4.test.mjs` 的回归用例。那些规则的边界决定了
  哪些英文字符串会被写进 47 MB 的 bundle，放宽错了的代价是 Cursor 白屏，不是少一块中文。
- **加译文**：只改 `data/*.json`。不要为了凑覆盖率数字而伪造译文 ——
  覆盖率是结果，不是目标。

---

## 许可

MIT。`backup/` 下是 Cursor 自身的文件，不在本项目的授权范围内，请勿分发。
