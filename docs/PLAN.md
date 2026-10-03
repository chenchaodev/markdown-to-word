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

### 2026-10-03 · 步序 1 开工

**① 步序 1 的范围被低估：一件写成三件。** 规划写的是「宿主可执行文件定位重构」，读代码后发现至少还要做两件事：把宿主的启动设置抽成两种入口共用（见②）、给主进程加 `--pdf-host` 分支（见④）。原因是 `--pdf-host` 不能插在 `--smoke` 那个位置。

**② 宿主的启动设置活在被 import 就不执行的入口守卫里。** `cli-pdf-host.ts` 的 `app.setPath("userData", 临时目录)`（**必须在 ready 之前**，否则 Chromium 已按真实 `%APPDATA%` 建好 profile）与 `app.on("window-all-closed", () => {})`（那个同步杀进程的坑，症状是退出码 0、无 stderr、结果文件不存在）都在 `if (isEntryPoint())` 块内。所以「让已安装应用当宿主」若只做 `import("./cli-pdf-host.js")` 调 `convertPdfJob`，**那两行不会跑** —— 等于把步序 2 修过的坑重新引进来。故必须抽成可复用函数由两处入口共用，而不是各写一份。

**③ asar 对 `fs` 透明 ≠ 可以把 asar 内的文件当应用路径启动。** 实测证明 `ELECTRON_RUN_AS_NODE` 下能直接 `readFileSync` asar 内的 `dist/**`，于是「代码不必挪出 asar」成立（§六）。但**已安装形态不能用脚本路径形态拉起宿主**：`dist/main/cli-pdf-host.js` 落在 `app.asar` 内，Electron 会把它当应用目录去找 `package.json`，起不来。⇒ 已安装形态必须走 flag 形态（`--pdf-host`），源码检出形态保持脚本路径形态不变。**这是「实测通了」到「能用」之间的一步，不该省。**

**④ `--pdf-host` 必须豁免单实例锁，否则静默失效。** `main/index.ts:26` 是 `if (!SMOKE && !app.requestSingleInstanceLock()) { app.quit(); }`，`--smoke` 已豁免。若 pdf 宿主不豁免：**用户开着图形界面时跑一次 pdf 转换，宿主立刻退出**，CLI 侧拿到的正是②里那个「退出码 0、无 stderr、结果文件不存在」的静默失败 —— 长得像成功。豁免理由必须写进注释，否则后来人会按「与 smoke 一致」把它改回去。

**⑤ `--pdf-host` 不能沿用 `--smoke` 的位置。** smoke 分支在 `app.whenReady()` 内部、且在 `createWindow()` 之后（`main/index.ts:57` 先建窗口）。pdf 宿主不能建主窗口、不能注册 IPC、不能跑启动设置运行时，故必须是一条**取代**整个 GUI 启动流程的分支，而非插在它内部。

**⑥ 判别式取 `process.versions.electron` 是否有值。** 备选的「路径里有没有 app.asar」被否：要读 `argv[1]`，而 CLI 也可能被当脚本以不同相对路径启动，信号随调用方式漂。用一个只描述「本进程是什么」的量，比用「我从哪被叫起来」稳。

**⑦ `--pdf-host` 形态有个「恰好成立」的时序，必须改成结构上确定。** dev 形态在模块顶层同步 `setPath("userData")`，安全；`--pdf-host` 形态则是**先 `await import()` 重模块、再设 profile**。实测那一次成立（真实 `%APPDATA%\MarkdownToWord` 全程未被创建，pdf 正常产出），**但成立不等于安全**：Electron 只保证 `ready` 排在主脚本同步求值之后，那次 import 要拉装配层与 pdf-lib，冷缓存或慢盘上完全可能输给 `ready` —— 而输掉的代价是 Chromium 已在真实路径建好 profile，宿主还在往别处重定向：**往用户真实 profile 里写数据，静默且难查**。

修法是把这两步（`setPath` + `window-all-closed` 空处理器）抽进 `src/main/services/pdf-host-profile.ts`，该模块**只依赖 electron 与 node 内置模块**，故 `main/index.ts` 能**静态**导入并在动态 import **之前**同步调用；重的部分留在 `cli-pdf-host.ts` 仍走动态 import，GUI 启动路径不为它付费。

**该函数必须幂等**：两种入口形态都会调它（重模块兜底 + `main/index.ts` 先调一次），而 `mkdtempSync` 每次建新目录 —— 不加标记会白留一个临时 profile 在 tmpdir 里。实测重构后只产生一个，标记有效。

**判据怎么定的**：不是「跑一次没出问题」，而是「这条顺序在结构上有没有可能输」。凡是涉及 `app.setPath` / ready / 窗口生命周期的顺序，都按后者判。

**⑧ `ELECTRON_RUN_AS_NODE` 会继承进宿主子进程 ⇒ pdf 在安装版必然失败（架构评审实测抓到，已修）。** `spawnSync` 不传 `env` 就是全继承，而已装形态的 launcher 正是设了这个变量让 CLI 以纯 node 跑应用 exe；子进程继承到它就**也**以纯 node 启动，随后以 `SyntaxError: The requested module 'electron' does not provide an export named 'shell'` 崩掉、结果文件不产出（实测退出码 3，pdf 未落盘）。dev 形态同样中招：开发机 shell 里恰好有该变量即中。

**修法必须是 `delete`，不能置 `=0`** —— Electron 只判断该变量**是否存在**、不读取值，实测 `=0` 与 `=1` 同样致命。写成 `env: { ...process.env, ELECTRON_RUN_AS_NODE: "0" }` 是**看起来修了其实没修**。这处不变量现在落在 `host-launch.ts` 的 `hostEnv()`，两种入口形态都必经。

同源的第二个传播路径：`.cmd` 转发器的 `setlocal` **不隔离**环境变量 —— 所以转发器不做任何隔离是「对」的，隔离反而会掩盖这条。`ELECTRON_NO_ASAR` 同样会改变形态（置 1 会让 asar 不再透明、已装形态随即读不到自己的代码），但**本轮未实测「置空是否有效」**，故暂不剔除 —— 凭推测加进剔除列表比留着更危险。

**⑨ 覆盖率门禁判「0% 文件」时，先怀疑自己的测试不够，不要先怀疑工具。** 本轮 `host-launch.ts` 报 `functions 0/6` 且 `fnMap` 为空，我一度判成 c8 的归因异常并准备走豁免。实际是**真实缺口**：那个「直接调纯函数」的测试确实调了 5 个函数，但**判定本身在调用链上** —— `convertPdfViaHost` 是唯一调用者，而它从未执行（`options.test.js` 里那处 `--format pdf` 只是 `expandFormats("pdf")` 的纯函数断言）。补一段**派生纯 node 跑真 pdf** 的验收后，该文件 `functions 0/6 → 6/6`、`cli/index.ts` `7/11 → 10/11`，`pdf-host-profile.ts` 顺带从 0/1 到 1/1，**两个「异常」一起归零，豁免一张都不需要**。

⇒ 门禁那句「要么它是新增死代码(必须补测试或删掉)」是准确判断，而「函数有测试调用」不等于「它在生产路径上被调用」。派生形态的选择也有讲究：**别在 Electron 宿主里再 spawn Electron**（实测整段超时 180s 被硬终止），派生纯 node 才对 —— 既避开嵌套，覆盖面还更大（子进程走 dev 分支，连 `resolveDevElectron` 一并覆盖）。

**⑩ 覆盖率门禁有一个「产物依赖顺序」造成的自锁：真修好了也会被判成没修。** 现象是同一条门禁**连续两轮给出完全相同的数字**（`statements 127/155, functions 0/5`），而同期定向跑同一段已量到 `100 / 6/6`。

因果链（`verify:ci` 的 `&&` 顺序）：

1. `check:coverage-zero:selftest` 的最后一条 case 是「真实仓库当前未漂移」，它拿 `output/coverage/coverage-summary.json` 跑判定；
2. 而唯一会刷新那个文件的 `test:coverage` 排在 selftest **之后**；
3. 于是任一次「链在到达 `test:coverage` 之前失败」都会留下判红的 summary → 下一轮 selftest 读到它 → 又红 → `&&` 断开 → **`test:coverage` 永远跑不到** → summary 永不刷新 → 死循环。

**判据**：连续两轮拿到**逐字相同**的覆盖数字，就不是「代码没修好」，而是「读到陈旧产物」——真缺口的数字会随代码变动而变。破解是先手动 `npm run test:coverage` 刷新产物再跑链。

**已定位到根因，且不是那条 case 写错了。** `check-coverage-zero.selftest.mjs:364-366` 自陈契约：「期望值按数据源在不在分成两支，**两支都是确定性断言，没有「跳过」**：本门禁的契约就是「**必须紧跟 `test:coverage` 执行**」—— 数据在则判绿；数据不在则按契约判红并点名数据源缺失。」

⇒ 它是 **CLI 适配层冒烟 + 顺序契约的执行者**，**不是**漂移检查（尽管那条 case 叫「真实仓库当前未漂移」）。我先前猜「它是为防陈旧产物冒充绿」**恰好相反**：它对「没有数据」容忍度为零。

所以缺陷在链：`verify:ci` 把它排在 `test:coverage` **之前** ⇒ 链未兑现自己声明的契约。**推论**：修它不该给 case 加跳过分支（与声明意图正面冲突），而是让顺序兑现契约。

**已核实的可推导事实**（留给后续动手的人省一步）：`REQUIRED_CI_STEPS`（`check-ci-contract.mjs:273-285`）只断言 11 步的相对顺序，**不含** `check:coverage-zero:selftest`；`registry.mjs:78` 只是「脚本名 → 文件路径」映射、不管顺序 ⇒ **移动它不撞任何既有断言**。

**处置（2026-10-03 用户裁决）**：不单独挪一行，**留到按 CI 脚本整体分组重排时一起改** —— 链现在是按「所有 check 排前面 → 再 build/test/coverage」组织的，而这条 selftest 是唯一一条「组织顺序」与「数据依赖顺序」冲突的检查，单独挪会破坏那份组织对称性。已登记为独立工作项（见 `docs/REQ.md`）。**代价**：下一次任何「链在到达 `test:coverage` 之前失败」的情况都会复现同样的误导——本轮已实测被带偏一次。

### 2026-10-03 · 步序 2（安装版转发入口）

**⑪ 落点：`extraFiles` 落安装根目录（`extraResources` 试过并否决）。** 实测 `release/win-unpacked/m2w.cmd` 与 `MarkdownToWord.exe` **同级**，asar 在 `resources\` 下。故 `%~dp0` = 安装根，exe 取 `%~dp0MarkdownToWord.exe`、归档取 `%~dp0resources\app.asar\…`。

**否决 `extraResources` 的理由是可发现性，不是技术**：它会落在 `resources\m2w.cmd`，与 `app.asar` 同级 —— 技术上完全成立（那条形态的五项验证同样全过），但用户找入口时看的是安装根目录（exe 在那儿），转发器埋进 `resources\` 里多了一层、且与「这是个应用资源目录」的直觉冲突。2026-10-03 用户裁决改落安装根目录。

**`build.files` 与 asar 顶层清单一个字都没动**（那两条是本就会判红的红线），两个 `extra*` 键都不在任何门禁判定面内。

**⑫ `.cmd` 转发器形态成立，MCP 走它没坏 stdio 分帧。** 实测：stdout 恰好 2 个 JSON 帧、含 `\r` 的行 0、非 JSON 行 0；启动横幅与 crashpad 噪声都在 stderr。**未加任何缓冲逻辑** —— 这条曾被列为「可能致命、可能要回退到 launcher exe」（那会重新引入打包链），现在可以关闭。附带实测：退出码 0/1/2/4 原样透传；**带空格的路径也通**（完整复制解包目录后 docx/pdf/MCP 全过）。

一个方法论记要：**验证「路径含空格」不必用目录联接** —— `%~dp0` 相对 `.cmd` 自身解析，直接在真实落点跑就是真实形态；要试空格则**复制**一份即可。上一个泳道卡在 `mklink` + `rm -rf` 上被取消，那两条本就不必要（破坏性操作本就不该由我代批）。

**⑬ 不给 `.cmd` 钉 `eol=crlf`。** 有人建议加，理由是入库 LF + `core.autocrlf=true` ⇒ 别的机器构建时包内字节不同。**不采纳**：仓库的 EOL 策略明写「入库统一 LF，检出 EOL 交由各端决定」（2026-08-24 用户确认），而 `.gitattributes` 里那几行 `eol=lf` 追加**每条的理由都是「门禁逐字节比对，CRLF 会让门禁恒红」**——`m2w.cmd` 不被任何门禁逐字节比对，那条理由不成立；cmd.exe 两种行尾都吃（已实测）。故加那行属无理由偏离既定策略。

**未完成（步序 2 尚不能算完）**：① 入口**不在 PATH、无开始菜单快捷方式** —— 落安装根目录已经比埋进 `resources\` 好找得多（与 exe 并列），但用户仍需知道 `%LOCALAPPDATA%\Programs\MarkdownToWord\m2w.cmd` 这个位置，得靠文档写明；② 以上验证是在 `release/win-unpacked/` 上做的，**不是真 NSIS 安装**（`extraFiles` 在安装根目录的落点是 electron-builder 文档化行为 + 解包产物实测三方印证，但仍不是走完安装器）。两项都留给下一步。

### 2026-10-03 · 步序 3（安装版 katex 定位）

**⑭ 结论：代码不用改，要改的是注释。** 规划预期「安装版里 `getKatexDir()` 的前提可能反转」—— 实测**确实反转了**，但反转的方向是「**两条路径在安装版给出同一答案且都对**」，不是「另一条才对、现在用的那条错了」。

两轮实测证据：

1. 安装版经 `--pdf-host` 转 pdf：带公式 53628 B、不带公式 42591 B（差 11 KB），且产物**不含字面 `$a^2`** ⇒ 公式确实被 KaTeX 渲染（模块自身位置上溯两级的解析在安装版成立）。注：产物里 grep 不到 `KaTeX` 字样**不能当反证** —— 字体名在压缩对象流里，裸字节看不到。
2. 同一产物跑 `--smoke`（它用 `getKatexDir()`）exit 0、pdf 转换成功、**无 `warn.katexCssLoadFailed` 降级行** ⇒ 该形态下 `getKatexDir()` 同样可用。

⇒ 分叉只存在于**一种**启动形态：dev 的脚本路径启动（`electron dist/main/cli-pdf-host.js`）—— 那时 `app.getAppPath()` 等于脚本目录，`getKatexDir()` 指向不存在的 `dist/main/node_modules/katex/dist`。

**⑮ 一条会误导后来人的注释被更正。** 原文件头写「katexDir 不能用 `getKatexDir()`」，那是把上表第一行的结论当成了普遍结论 —— 会让人以为另一条在打包态也坏，进而可能把一条在 dev 下被实测过的避坑改掉。已改为按两种形态对照陈述并附本条的实测数据。同时把解析抽成导出的纯函数 `resolvePdfHostKatexDir(hostModuleDir)`，让两种形态的判定**可在验收段里各断言一次**，而不必真起一个 Electron 才能验。

**判据记要**：这一步的规划明写「结论必须来自安装版实测，不得从源码检出的行为外推」。而**源码检出侧的推论恰好是反的**（`app.getAppPath()` 在脚本路径启动时等于脚本目录 ⇒ 另一条坏），所以若按源码侧外推，会把一条正确的避坑当成错的而改掉。这条比「记得实测」更值钱：**当某个结论依赖「进程以什么形态启动」时，源码侧的行为不能代表打包侧**。