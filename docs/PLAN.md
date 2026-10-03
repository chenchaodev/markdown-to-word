# 安装版命令行入口：复用已装宿主，不引第二套运行时

> **大型需求载体。**台账记「为什么做」，本文件记「做到哪、下一步是什么、怎么才算完」。
> 事实基线见 `docs/evidence/20261003-180918-命令行exe分发路径调研.md`（含版本坐标与逐条来源）；路径初判在该文件 §八，本文件只留**决策**与**步序**。
> 验证命令唯一载体是 `docs/DEV-GUIDE.md`，本文件只留一行指针、不复制命令。
> 收尾即删。**完成标准逐条划完才许删**（大型需求以「整体完成标准」为准）。

## 目标

让**只安装了 Windows 安装包**的用户也能调用命令行转换与 MCP 服务端，不必先有源码检出、Node.js 与一次构建。

## 路线决策

**采用：复用已装宿主**（`ELECTRON_RUN_AS_NODE=1` + 应用自己的 exe），**不引入第二套运行时、不引入任何打包器依赖。**

判据（每条都有实测或官方出处，见 evidence 文件）：

| 事实 | 依据 |
|---|---|
| `RunAsNode` fuse 在本仓真实产物里**已开启**，不需改打包配置、不削弱安全姿态 | 实测 `ELECTRON_RUN_AS_NODE=1 ./release/win-unpacked/MarkdownToWord.exe -e ...` → `node=24.18.0 electron=43.2.0` |
| 内置 Node **24.18.0** 满足 `engines >= 22.13` | 同上 |
| **asar 在该模式下对 `fs` 完全透明**，`dist/` 子树可直接读 ⇒ 代码不必挪出 asar、不必 `asarUnpack`、不必 `extraResources` 搬代码 | 实测读 `app.asar/dist/main/index.js` 与 `dist/core/convert.js` 均成功 |
| 额外体积 **≈ 0**（不塞 node 本体） | 同上 |

**否决的路线**（否决理由即上表的对立面，详见 evidence §八）：

- **官方 SEA**（自包含 exe）：Node 22/24 LTS 的 SEA **只吃 CommonJS**（ESM 入口是 25.7+ 才有，而 25 已 EOL、26 是 Current）。走它要先用打包器把 remark / markdown-it / katex / mermaid 这整棵 ESM-only 依赖图手工转成单文件，并吃满 `require` 非文件型 / `useCodeCache` 关掉 `import()` / assets 三坑；产物 100–130 MB；SEA 稳定度仍标 1.1 Active development。
- **`bun build --compile`**：运行时被换成 Bun，与 `engines.node >= 22.13` 正面冲突；pdf 路线强依赖 Electron `printToPDF`，与「产物内无 electron」冲突。
- **npm bin**（REQ-163）：装版用户机器上没有 node。**不否决它** —— 它对 npm 用户仍是更轻的路，本条只是它解决不了本需求。
- **改 fuse 以启用 `RUN_AS_NODE`**：不需要（实测已开启）。若哪天 electron-builder 改了默认，这条要重新评估。

## 下一步（一个动作）

步序 1 · 宿主可执行文件定位重构 —— `src/cli/index.ts:93-95` 的 `resolveDevElectron()` 仍是 `createRequire(import.meta.url)("electron")`，在安装版必然失效，而**它是本规划所有步序的前置**。

## 相关 ADR 一行结论

| ADR | 一行结论 |
|---|---|
| [ADR-060](adr/ADR-060-多层交付面与headless装配层.md) | 现行 —— 三层结构 + 四个注入点 + 门禁 deny→allow；「实施复测」小节记了步序 1-3 落地后才撞到的 19 条约束 |
| [ADR-013](adr/ADR-013-发布供应链与明确不签名.md) | 现行 —— 不采购证书、明确不签名。本路线**新增一个随包分发的可执行入口**，该 ADR 未讨论过此情形，需在步序 5 一并交代 |
| 待写（步序 5） | 本路线决策本身 —— 涉及改对外可调用面，按涉架构判据须留 ADR |

## 验证基线

见 `docs/DEV-GUIDE.md`。

---

## 步序 1 · 宿主可执行文件定位重构（前置，卡住一切）

**为什么它排在最前**：evidence §四·D0 记的是「四条路径共同的前置」——`electron` 包的 `path.txt` 只在开发机安装时生成，发布包内**没有**该文件，且打包时 `node_modules/electron` 被剥离 ⇒ `require("electron")` 在任何已安装语境下都拿不到用户的宿主 exe。不改它，本规划后面每一步都做不通。

**判别式**（不用「路径里有没有 asar」这种间接信号）：`process.versions.electron` 有值 ⇒ 当前进程由 Electron 提供，`process.execPath` **就是**宿主 exe；否则是源码检出的纯 node，沿用现有解析。

**范围**：`src/cli/index.ts` 的定位函数，拆成「宿主 exe 解析」与「pdf 子进程入口路径解析」两件事——后者在安装版下要落到 `app.asar` 内，与源码检出不同。

**完成标准**

- 源码检出下 CLI 的 docx 与 pdf 两条路径行为**零变化**（回归）
- 新增测试覆盖两种上下文（Electron 提供 / 纯 node）下的解析结果
- 定位函数在两种上下文下的判别有断言，不是靠实测日志说话

## 步序 2 · 安装版转发入口与打包配置

**已实测的前提使这一步很轻**：代码留在 `app.asar` 内即可，不需要 `asarUnpack`、不需要搬 `extraResources`、**不需要碰 `build.files`**（`check-ci-contract.mjs:462-468` 会把新增正向模式判红）、**不需要碰 asar 顶层清单**（`check-asar-manifest.mjs:47` 双向写死）。

**要做的**：一个 asar 之外的转发入口（`.cmd` 转发器 + 开始菜单快捷方式），内容是设 `ELECTRON_RUN_AS_NODE=1` 后调 `%~dp0..\<产品名>.exe` 并传入 asar 内的入口脚本路径。经 `extraResources` 落地。

**不需要改 `release.yml`** —— 它按 `artifactName` 点名上传三个文件，入口随安装包走即自动分发。这是本路线相对「单文件 exe」的一项实质优势，写在这里免得后来人误以为漏了。

**完成标准**

- 干净环境安装后，用户能通过一个可发现的位置启动命令行转换并成功产出 `.docx`
- `verify:release` 通过（顶层名字串仍恰为 `'verify:ci,dist'`）
- 签名门禁通过（新增 exe 落在 `release/` 内会被 `check-signature-status.mjs` 递归扫到，期望值恒为 `unsigned`，与 ADR-013 一致）

## 步序 3 · PDF 路径在安装版下的行为校正（实测驱动，不预设结论）

`src/main/cli-pdf-host.ts:15-18` 现在明确记录了一个坑：`katexDir` **不能**用 `getKatexDir()`，因为那一支以 `app.getAppPath()` 为基准，在源码检出下会给出不存在的 `dist/main/node_modules/katex/dist`。

**但在安装版里这个前提可能反转** —— `app.getAppPath()` 会是 `.../resources/app.asar`，而 `node_modules` **就在 asar 内**，那条路径可能反而是对的。

⇒ 本步序的结论**必须来自安装版实测**，不得从源码检出的行为外推。若确实要分叉，则两处解析都得写明各自适用的上下文。

**完成标准**

- 在安装版里跑通 pdf 转换（不是只跑 docx）
- katex 资源解析的逻辑有注释说明它分叉的依据，且两个上下文的判定有测试
- 若发现 `getKatexDir()` 在安装版可用，`cli-pdf-host.ts` 文件头的注释要同步更正（现有注释会变成误导）

## 步序 4 · MCP 同源入口

同一套机制换入口脚本即覆盖 REQ-162 同样存在的「装版用户拿不到 MCP」问题。参照 MCP 接入文档里的 `mcpServers` 配置。

**本步序有一个未实测且可能致命的前提**：转发器若是 `.cmd`，则 stdio 通道会经过 `cmd.exe`，而 JSON-RPC 严格按行分隔读取 —— **`cmd.exe` 对管道 I/O 的缓冲与控制字符处理有已知问题，可能破坏 MCP 握手**。这不是理论顾虑，是 MCP 在 Windows 上的经典坑。

⇒ **先实测再定形态**。若 `.cmd` 不成立，退路是：直接让用户把 `command` 配成应用 exe 并另给环境变量，或做一个真正的 launcher exe（那会重新引入打包链，要回本文件重评路线）。

**完成标准**

- 实测结论落进 evidence 文件（成立或不成立都要写，不成立也要写清现象）
- MCP 客户端能连上并完成一次真实转换
- 步序 2 的转发器若因本步结论而改形态，同批改完，不留两种形态并存

## 步序 5 · 门禁、文档与 ADR 登记

- **ADR**：本路线否决了三条替代路径、改了对外可调用面 ⇒ 涉架构判据成立，须留决策全文（含否决理由与它们各自的失效条件，避免后来人重复评估）
- `docs/DEV-GUIDE.md` 的「命令」表与「门禁接入点」表各登记一行
- `docs/ADR-013` 补一句：本路线新增一个随包分发的可执行入口，签名立场如何适用于它
- `README.md` / `README_EN.md` / `docs/USER-GUIDE.md` / `docs/CLI.md` / `docs/MCP.md` 的措辞从「仅源码检出」改为「安装版可用」——**这批文档本轮刚把标签纠正过来，改回去要有实据支撑，而实据就是本规划落地**
- `docs/REQ.md` REQ-166 转「在办」，完工转「已完成」

## 修复项复测

<!-- 实施过程中撞到的、与上面判据不符或未预料的事实，逐条追加。与 ADR-060「实施复测」小节同体例。 -->