# CLAUDE.md

Cursor 界面简体中文汉化工程。**开工前请读完本文件。**

## 一句话目标

让 Cursor 界面尽量完整地显示中文 —— **NLS 层已达 100%（13,530 / 13,530）**，
且不破坏 Cursor、不影响其正常使用、每一步都可回滚。

**已交付**：`install.cmd` 一键安装、`sync` + 计划任务自动跟随 Cursor 升级（NLS + AI 面板两条通道）。
**M4（AI 面板硬编码文案 + UI 字体）**：已实现并接入 `sync` / `setup`，译文 4,853 条、保留英文 670 条。
**不是**运行时注入，而是改写三个 bundle 里的字符串常量，外加一条 CSS 字体通道：

| 目标 | 校验 | 处理 |
| --- | --- | --- |
| `workbench.glass.main.js` | 免校验 | 直接改 |
| `workbench.anysphere-ui-automations.js` | 免校验 | 直接改 |
| `workbench.desktop.main.js` | **被校验** | 改完重算 `product.json.checksums`，再过完整性闸门 |
| `workbench.desktop.main.css` | **被校验** | 末尾追加 `--vscode-font-family` 定义（字体通道） |

2026-10-15 实机验证通过：中文在 Cursor 主窗口与独立 Agent 窗口均正常渲染，
`CachedData` 不会造成「改了不生效」（三个目标 bundle 都不在渲染器缓存里）。

★ **字体通道**（2026-10-15 加，实现在 `src/m4/fontfix.mjs`）：Cursor 把标题栏等一大批组件改写成
`var(--cursor-font-family, var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif))`，
而 `--vscode-font-family` 在主工作台里**从未被定义** —— 内核只把它发进 webview 的
`WebViewThemeDataProvider`，主 workbench 的 UI 字体走 `.monaco-workbench.windows:lang(zh-Hans)`
那条规则，根本不发这个变量。于是链尾兜底落到 Chromium 默认 `sans-serif` = Noto Sans SC，
笔画比官方 zh-Hans 的微软雅黑细约 10%（实测 4,531 vs 5,058 ink），观感「虚浮」。
修法是给 `workbench.desktop.main.css` 末尾追加一条变量定义
`"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",sans-serif`（**雅黑必须排在 `sans-serif` 之前**，
generic family 恒有匹配，写它后面等于不存在），带 `!important` 压过可能的运行时内联值。
只定义 `--vscode-font-family` 一个就够 —— `--cursor-font-family-sans` 的定义链以它兜底。
幂等靠 CSS 里的标记行 `/* cursor-zh-fontfix */`，Cursor 升级换掉该文件后标记消失、自动重加。

**候选覆盖率**（2026-10-15 修正取值规则后重算，未处理全部清零）：

| 目标 | 命中 | 候选（去重） | 已译 | 保留英文 | 未处理 |
| --- | ---: | ---: | ---: | ---: | ---: |
| glass | 7,754 处 | 5,039 | 4,395 | 644 | **0** |
| anysphere | 789 处 | 585 | 550 | 35 | **0** |
| 内核 desktop.main | 3,995 处 | 2,840 | 2,503 | 337 | **0** |

早先那 59 条「喂给模型而非用户」的内核 JSON-schema `description` 现已收进 `data/m4-skipped.json`
逐条注明原因，与其余保留项合并统计 —— **不再另设「未处理」这一状态**。
`out/vs/workbench/workbench.xai-commerce-prepaid.js` 同样免校验，但实测命中 0 条，无需处理。

## 铁律（违反即失败）

1. **用 Node.js（ESM，`.mjs`）实现，禁止用 Python**
   —— 本机 `python` 被 Microsoft Store 别名劫持，`Python313\python.exe`
   被执行策略拒绝（实测 `ResourceUnavailable`），`py -3` 也找不到运行时。
2. **默认只读** —— 除 `install` / `sync` / `patch` / `restore` 外，任何命令不得写入 Cursor 安装目录。
3. **写前必备份** —— 记录原始 SHA-256；`restore` 必须能字节级还原。
4. **改写被校验文件后必须重算 checksums**
   —— 否则 Cursor 启动时报 `installation appears to be corrupt`。
   可写路径：`src/m4/integrity.mjs`。`applyChecksumUpdates` 只改目标键的值（写前断言
   `JSON.stringify(obj, null, "\t") === 原始文本`，保证不会顺手把整个文件重排），
   写后 `assertIntegrity` 把 6 个被校验文件全部重算一遍，任何一个对不上就回滚
   bundle 与 `product.json`。**不要在别的路径上手写 product.json。**
5. **不碰用户内容** —— 编辑器正文、终端、输入框、`contenteditable`、Monaco、聊天正文一律不动。
6. **禁用 `innerHTML`** —— CSP 含 `require-trusted-types-for 'script'`，只能用 `textContent`。
7. **注入必须同源** —— CSP `script-src 'self'` 且无 `unsafe-inline`，不能内联 `<script>`。

## 关键事实（省得重新摸索）

- Cursor **3.24.18**，内核 VS Code **1.128.0**
- `out/nls.keys.json` = `[[moduleId, [key, ...]], ...]` —— 1,150 模块 / 13,530 键
- `out/nls.messages.json` = 长度 13,530 的英文原文数组，**与键逐位对应**
- 语言包 bundle **确定**包在 `{contents: ...}` 里 —— 模块表是 `bundle.contents[moduleId]`
- 校验值算法 = `base64(sha256(bytes))`，**去掉末尾 `=` 填充**
- 被校验文件只有 6 个；`workbench.glass.main.js`、`workbench.anysphere-ui-automations.js`
  与 `nls.messages.json` **免校验**；`workbench.desktop.main.js` 在清单内，M4 会改写它
- ★ **M4 的「不做 NLS 排除」规则只适用于那两个免校验 bundle，不可套到
  `workbench.desktop.main.js`**：VS Code 内核那层确实在 `localize()` 调用点替换，
  bundle 里的字面量是死文本，改了没用。而 Cursor Agent / Anysphere 的 React 层直接
  渲染字面量、不调 `localize()`，所以那两个 bundle 必须不排除。同一个规则结论相反，
  由 `M4_TARGETS[].nlsExclude` 这对标志编码（测试里锁死了二者必须一致）。
  排除基准取**备份里的原始英文表**（`src/m4/nlsbase.mjs`），缺备份时**跳过内核目标**
  而不是硬改。
- ★ **标识值守卫**（`src/m4/scan.mjs` 的 `collectIdentityValues`）：代码里存在
  `e.label==="Task"`、`o.label==="Production"?"prod":"dev"`、`r.label==="Cancel"`
  这类「拿显示文字反查标识」的写法。同一个值渲染侧翻、判断侧不翻就会失配
  （实测会写不进 `backgroundComposerEnv`、快选把取消项当正常项）。所以**凡在本字段下
  参与过等值比较的值一律不翻** —— 只影响同名字段，`children:"Cancel"` 照翻。
  代价：10 条文案让位给正确性。放宽这条前先想清楚。
- 那 59 条内核 JSON-schema `description` 已按「喂给模型而非用户」的判断保留英文，
  收进 `data/m4-skipped.json` 并逐条注明原因 —— **主 IDE 已无「未处理」候选**。
- ★ **M4 取值形态**（2026-10-15 补齐，实现在 `src/m4/scan.mjs`）。除最基础的
  `字段:"文案"` 外，还有四类必须单独识别，否则整片漏译：
  ① `title:{value:"…",original:"…"}` 成对结构（`value` 本身在 `NEVER_FIELDS` 里，
     靠 `TITLE_OBJ_RE` 单独兜住）；② 设置页那份 ≥5 成员的 `id:"文案"` **左导航映射表**
     （键是小写 id，永远匹配不上 `UI_FIELDS`，靠 `NAV_MAP_RE`/`NAV_ENTRY_RE` 识别）；
  ③ `||"…"` / `??"…"` 兜底默认值（`FALLBACK_RE`）；④ `? "…" : "…"` 三元分支
     （`TERNARY_RE`，**两分支必须都是文案才翻** —— 否则会破坏
     `e?"Top":"InlineStart"` 这类 CSS/枚举三元式）。
- ★ **三处会真出错的解析细节**，改动前务必看清：
  ① 三元与兜底命中的位置没有字段可查，`cmpAny` 守卫靠**同位置是否已被
     `collectIdentityValues` 收录**来决定翻不翻；② 变量声明列表 `var A,B,C` 一度被
     `BARE_RE` 误当成数组元素，导致模块级常量文案（如左导航那 24 个成员）整片漏译，
     靠 `DECL_RE` 区分声明与取值；③ **映射表的替换区间必须从条目末尾回推**
     （`e[0].length - (引号+值+引号).length`），不能用 `indexOf(值)` —— 键也带引号时
     （`{"aria-label":"Pinned"}`）会落到**键**的开引号上，改写后把 `"aria-la` 截断、
     bundle 语法直接崩（`assertSyntax` 会当场拦下，但别依赖它兜底）。
- 覆盖率 **100.00%**（13,530 / 13,530）= 语言包 11,559 + 路径归一化 **328** + 补译词典 **1,643**
  —— 这是 1,971 条缺口的分解：① 归一化映射上限 332，其中 4 条占位符不匹配被闸拒
  （`stats.renamedRejected`），净救回 328、投影 87.86%；② 词典实际命中 1,643 条
  （`data/overrides.json` 里另有 76 条 `_` 前缀说明字段，加载器会跳过，故有效译文 1,792 条，
  其中 149 条覆盖的是语言包/归一化已覆盖的键）。口径以 2026-10-15 实测为准。
- ★ 覆盖率基准必须取**备份里的原始表**，不是磁盘上当前的 `nls.messages.json`
  —— 装过之后后者已是中文，拿它当"英文原文"会凭空报出 13 条假缺口

## 运行时机制（源码级确证，改之前必须懂，详见 `docs/03` §1.1）

- **运行时真正的译文表不是语言包，而是缓存文件**：
  `%APPDATA%\Cursor\clp\<语言包hash>.zh-cn\<Cursor commit>\nls.messages.json`
- 合并规则（`out/main.js`）：`译文 = 语言包[moduleId][key] || 默认表[i]`
  —— 语言包缺的键**回退到 `out/nls.messages.json`**
- **缓存命中即短路**：该文件存在就直接用，**不会重读键表**。
  改完不失效缓存，重启多少次都不生效 —— 这就是"汉化没生效"的真实根因
- 失效缓存的两种手段：删 `clp\<hash>.zh-cn\<commit>\`，或在该目录旁的
  `clp\<hash>.zh-cn\` 里放一个空文件 `corrupted.info`（Cursor 自带的修复通路）

> **战略含义**：`out/nls.messages.json` 免校验 + 缺口自动回退到它
> → 改这**一个 665 KB 文件**即可让 1,971 个缺口键显示中文，
> **无需生成语言包、无需触碰被校验文件、无需重算哈希**。这是 M2 的首选路径。

## 必过的金标准断言

实现校验算法后，先用真实文件验证：

```js
base64Sha256(workbenchHtml) === "BZ8Zb4TGBbDPaaGjA+MuDJxaFsxjmmG0YMyttD4zgcU"
```

跑不通就不要往下做——算法写错了，后面全会错。

## 文档导航

| 文档 | 什么时候看 |
| --- | --- |
| `docs/05-开发规格.md` | **主实现规格**：模块清单、算法、里程碑、验收标准 |
| `docs/01-设计蓝图.md` | 架构决策与理由 |
| `docs/03-技术机制与实测数据.md` | 机制细节、实测数字、约束条件 |
| `docs/02-同类项目调研.md` | 社区已有方案，避免重复造轮子 |
| `docs/04-参考资料与路径索引.md` | 路径索引、术语表 |

## 开工顺序

动任何东西之前，先跑这三条只读自检：

```bash
node src/cli.mjs scan && node src/cli.mjs verify && node --test tests/deploy.test.mjs
```

验收基准：`scan` 报 **13,530 / 13,530（100.00%）**、缺口 **0**；`verify` **6/6 通过**；测试全绿。
数字对不上说明键表解析或基准表取错，先排查再继续。

`install` / `patch` 之前必须先**完全退出 Cursor** —— `sync` 会强制这条规则，手工跑也别跳过。
里程碑定义见 `docs/05-开发规格.md` §7（M1–M5 均已完成；M4 已于 2026-10-15 实机验证通过）。

## 已备好的输入数据

| 文件 | 内容 |
| --- | --- |
| `data/renames.json` | 路径归一化映射（已填实测值） |
| `data/terms.json` | 术语表（翻译时保持一致） |
| `data/overrides.json` | 补译词典（有效译文 1,792 条，实际命中 1,643 条；另含 76 条 `_` 前缀说明字段。重名键按英文原文逐条区分） |
| `build/missing.json` | 待补译工作单（按模块分组，含英文原文） |
| `build/all-keys.json` | 全量键 + 英文原文 + 现有译文 |

## 参考实现

`tools/gap2.mjs`（覆盖率统计）与 `tools/map.mjs`（路径归一化量化）
已经验证输出正确，可作为解析逻辑的参照，但**不要直接复制进 `src/`**
（它们是调研脚本，不是产品代码）。
