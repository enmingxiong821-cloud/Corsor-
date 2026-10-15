# CLAUDE.md

Cursor 界面简体中文汉化工程。**开工前请读完本文件。**

## 一句话目标

让 Cursor 界面尽量完整地显示中文 —— **当前已达 100%（13,530 / 13,530）**，
且不破坏 Cursor、不影响其正常使用、每一步都可回滚。

**已交付**：`install.cmd` 一键安装、`sync` + 计划任务自动跟随 Cursor 升级。
**下一阶段**：M4 运行时补丁（AI 面板等 React/SolidJS 硬编码文案，约 3,100 条，见 `docs/05` §7）。

## 铁律（违反即失败）

1. **用 Node.js（ESM，`.mjs`）实现，禁止用 Python**
   —— 本机 `python` 被 Microsoft Store 别名劫持，`Python313\python.exe`
   被执行策略拒绝（实测 `ResourceUnavailable`），`py -3` 也找不到运行时。
2. **默认只读** —— 除 `install` / `sync` / `patch` / `restore` 外，任何命令不得写入 Cursor 安装目录。
3. **写前必备份** —— 记录原始 SHA-256；`restore` 必须能字节级还原。
4. **改写被校验文件后必须重算 checksums**
   —— 否则 Cursor 启动时报 `installation appears to be corrupt`。
5. **不碰用户内容** —— 编辑器正文、终端、输入框、`contenteditable`、Monaco、聊天正文一律不动。
6. **禁用 `innerHTML`** —— CSP 含 `require-trusted-types-for 'script'`，只能用 `textContent`。
7. **注入必须同源** —— CSP `script-src 'self'` 且无 `unsafe-inline`，不能内联 `<script>`。

## 关键事实（省得重新摸索）

- Cursor **3.24.18**，内核 VS Code **1.128.0**
- `out/nls.keys.json` = `[[moduleId, [key, ...]], ...]` —— 1,150 模块 / 13,530 键
- `out/nls.messages.json` = 长度 13,530 的英文原文数组，**与键逐位对应**
- 语言包 bundle **确定**包在 `{contents: ...}` 里 —— 模块表是 `bundle.contents[moduleId]`
- 校验值算法 = `base64(sha256(bytes))`，**去掉末尾 `=` 填充**
- 被校验文件只有 6 个；`workbench.glass.main.js` 与 `nls.messages.json` **免校验**
- 覆盖率 **100.00%**（13,530 / 13,530）= 语言包 11,559 + 路径归一化 332 + 补译词典 1,971
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

`install` 之前必须先**完全退出 Cursor** —— `sync` 会强制这条规则，手工跑也别跳过。
里程碑定义见 `docs/05-开发规格.md` §7（M1–M3、M5 已完成，M4 未开工）。

## 已备好的输入数据

| 文件 | 内容 |
| --- | --- |
| `data/renames.json` | 路径归一化映射（已填实测值） |
| `data/terms.json` | 术语表（翻译时保持一致） |
| `data/overrides.json` | 补译词典（已填 1,971 条，重名键按英文原文逐条区分） |
| `build/missing.json` | 待补译工作单（按模块分组，含英文原文） |
| `build/all-keys.json` | 全量键 + 英文原文 + 现有译文 |

## 参考实现

`tools/gap2.mjs`（覆盖率统计）与 `tools/map.mjs`（路径归一化量化）
已经验证输出正确，可作为解析逻辑的参照，但**不要直接复制进 `src/`**
（它们是调研脚本，不是产品代码）。
