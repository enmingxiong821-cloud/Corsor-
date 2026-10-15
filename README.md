# Cursor 汉化工程

把 Cursor 界面完整简体中文化 —— **不改动任何被校验文件**，随时可一键还原，Cursor 升级后自动跟随。

| 指标 | 实测值 |
| --- | ---: |
| Cursor 版本 | 3.24.18（内核 VS Code 1.128.0） |
| 界面消息键总数 | 13,530 |
| 中文覆盖 | **13,530（100.00%）** |
| 被校验文件 | 6 个，**全部保持原样** |

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

**不生成语言包、不装 VSIX、不碰那 6 个被校验文件、不改 `argv.json`、不重算任何哈希。**
因此 Cursor 的完整性校验永远通过，也不会出现"安装似乎损坏"。

代价只有一个：写入必须在 Cursor 完全退出时进行 —— 这正是 `sync` 与计划任务存在的原因。

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `node src/cli.mjs scan` | 扫描并打印覆盖率（只读） |
| `node src/cli.mjs doctor` | 环境自检 |
| `node src/cli.mjs verify` | 校验 6 个被校验文件 + 金标准断言（只读） |
| `node src/cli.mjs sync` | 手动跟随一次 Cursor 升级 |
| `node src/cli.mjs install --yes` | 写入 Cursor 并失效缓存 |
| `node src/cli.mjs restore` | 从备份字节级还原 |
| `node src/cli.mjs cache` | 查看语言缓存状态 |

除 `install` / `restore` / `sync` 外，**所有命令都不写入 Cursor 安装目录**。

`sync` 每次执行都会在 `logs/sync.log` 留一行记录，排错先看它。

---

## 自动跟随

`install.cmd` 会登记一个 Windows 计划任务 `CursorZhAutoSync`：**每 15 分钟检查一次**。

大多数时候它只是读一下版本和哈希（几毫秒）就退出。只有在这两种情况下才真正写入：

- Cursor 换了版本（升级）
- `out/nls.messages.json` 被换回了英文原文

写入前后都遵守两条底线：**Cursor 运行中一律不写**；文件既不是原始内容也不是本工具写入的内容时（可能被别的工具动过）**只告警、不覆盖**。

注销任务：`scripts/unregister-task.ps1`，或直接跑 `uninstall.cmd`。

---

## 边界

这个项目解决的是 **NLS 消息层**（13,530 条标准界面文案），已 100% 覆盖。

Cursor 的 AI 面板、设置页等由 React/SolidJS **硬编码渲染**的文案不走 NLS，约 3,100 条，**不在本项目当前范围内** —— 那需要注入运行时脚本并改写被校验文件，风险等级完全不同（见 [docs/05](docs/05-开发规格.md) M4）。

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
│   └── cli.mjs                     命令行入口
├── scripts/                      一键安装编排 + 计划任务注册/注销
├── data/                         overrides.json（补译词典）、renames.json、terms.json
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

## 许可

MIT。`backup/` 下是 Cursor 自身的文件，不在本项目的授权范围内，请勿分发。
