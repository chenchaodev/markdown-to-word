# 多层交付面与 headless 装配层

> 状态：现行
> 日期：2026-10-03
> 工作项：见 `docs/REQ.md` 台账「多层交付面」行

## 决定

引入一个 **headless 装配层 `src/convert/`**，把「路径进、路径出」的单文件转换从 GUI 宿主里剥离出来，成为 GUI / CLI / MCP / 库模式**四个交付面共用**的装配单元。配套三件事：

1. `src/convert/` 落成新的一层，向上可被 `main` / `cli` / 库消费，**自身不得 import electron**。
2. `src/cli/` 落成新的交付面，消费 `src/convert/`，**今天只做本地可执行形态**。
3. 门禁的层向治理从 **deny-list 改为 allow-list**：新增 `src/` 顶层目录必须登记，否则判红。

**分层**：`core`（纯转换）← `convert`（装配，能力注入）← {`main`(electron)、`cli`、`mcp`、库}。
`cli` 与 `mcp` 是**同一层的两个 adapter，二者零依赖**，不为它们各立一层。

**注入点恰好四个**，这是 `emitConvertedArtifact`（原 `src/main/converter/output-skeleton.ts:93`）离 headless 的全部距离：

| 现状 | 位置 | 改造后 |
|---|---|---|
| `loadSettings()` / `settingsSnapshot` | `single.ts:50` | 入参 `settings: AppSettings`（**不注入 provider 函数** —— 各面的设置来源本就不同，多一层间接无收益） |
| `renderPdf` 的 `BrowserWindow`+`printToPDF` | `output-skeleton.ts:206-269` | 入参 `printPdf?: PdfPrinter`（pdf 必需，缺则**明确报错不降级**） |
| `mermaidResolver`（**当前无条件注入**） | `output-skeleton.ts:123` | 入参 `mermaidResolver?`，**默省 = 不注入** |
| `runAfterConvert` / `skipAfterConvert` | `output-skeleton.ts:148-156, 281-294` | `onAfterCommit?` 回调；**让位语义不进本层** |

**关键划线：`skipAfterConvert` 禁止进入新层。** 它是 batch-only 的让位 hack（`context.ts:58`），语义是「GUI 的副作用所有权」，与 path→path 转换无关。不划线，新层第一天就会长出 GUI 的形状，此后每个消费点都要传 `skipAfterConvert: true` 来表达「我不想开文件夹」—— 语义反了。

## 背景

`src/core/` 已实测纯净（`node:` 内建恰好 5 处，与门禁白名单 `CORE_NODE_BUILTIN_FILES` 完全一致；`process.platform` / 按平台分支渲染路径零命中），docx 路线亦无宿主依赖。**所以「把 core 暴露出去」的成本不在 core，在装配层与宿主触点。**

实测 `src/main/converter/` 里**只有 `output-skeleton.ts` 一个文件 import electron**。`context.ts` 对 `persist/settings` 只有 `import type`，`preprocess.ts` / `paths.ts` / `artifact-writer.ts` / `image-downloader.ts` 全部零 electron。

⇒ **本决定不是「新增一层」，是把一个文件里的两个函数搬到入参后面。**

三个交付面（CLI / MCP / 库）诉求重叠 —— 都是把 core 暴露出去。台账上 `REQ-045`「CLI 转正」与 `REQ-006`「本地 MCP 库模式」长期零交叉引用，两条号各写一遍层设计必然漂。本 ADR 统一裁定其边界。

## 备选方案

**否决 · 不新建层，让 CLI/MCP 直接调 `emitConvertedArtifact` + 注入。**
四个注入点会散落进 CLI 与 MCP 两处。第三张脸（库模式）来时必然漂。**层不是为了复用，是为了让注入点只有一个声明处。**

**否决 · 把 `main/converter/` 原地重定义为 headless 层，GUI 侧只留 electron 触点。**
三条理由：① 整棵树里只有 `output-skeleton.ts` 一个文件脏，「整层搬家」的收益不存在，却要动 ADR-029 专门论证过的载体命名；② `main/` 这个名字在 `LAYER_RULES` 的 `main-no-renderer`（`check-import-boundary.mjs:123`）里被当作 **GUI 宿主层**语义使用，headless 代码住进去，那条规则的理由文案当场变假；③ 移动比新建更难回退 —— 回退新建是删目录，回退重定义要逐文件恢复 import。

**否决 · 为 CLI 与 MCP 各立一层。**
二者零依赖，只是同一层的两个 adapter。

**否决 · 让 MCP 暴露 pdf。**
pdf 必然要 Electron 宿主（见「后果」第 2 条）。MCP 第一版**只暴露 docx**，pdf 留给 CLI。

**否决 · 第 0 档入口（文件关联 / 右键菜单 / 拖拽）现在做。**
它们全部依赖 CLI，CLI 落地后自然存在。唯一真缺口是「GUI 启动不接收命令行参数」（`docs/evidence/20260808-102900:11`），单独立号，不在本规划内。

**否决 · 库模式与跨平台进本规划的近期步序。**
两者都推到半年或一年后，见「外部依赖」。

## 后果

**1. `merge.ts` 与 `batch.ts` 留在 `main/`，不搬。**
它们自身零直接 electron，但**双重穿越**：`persist/settings.js`（值导入 → `app.getPath('userData')`）+ `output-skeleton.js`（值导入 → `BrowserWindow`/`shell` + 三个 services）。只能在 `output-skeleton.ts` 定去留之后才谈搬迁，且届时改造已非机械。

**2. pdf 与 mermaid 的宿主依赖形态不同，必须分别对待。**
- pdf：`printToPDF` 是唯一打印宿主，`printToPDF` 不可中断（`output-skeleton.ts:257` 自述）。**注入 `printPdf` 即零 Electron**，但缺它时**不降级** —— 降级会让 core 的符号链接逃逸防线变成可静默关闭的开关（ADR-012 语）。
- mermaid：`mermaid-service.ts:362` 在**模块顶层**就 `app.on("will-quit")`，import 该模块本身要求一个活着的 app。⇒ **「headless 的 docx-only 转换」实为「不含 mermaid 的 docx 转换」**。不注入 resolver 时 core 保持 undefined 并按普通代码块渲染（`convert.ts:226-230`，既有契约，零新增代码）。
  **降级必须对 agent 可见**：MCP 返回值须带 `degraded: ["mermaid"]`。静默降级会造出「同样输入、偶尔产出不同」的工具。

**3. 门禁必须同批改造，不能「以后补」。**
`LAYER_RULES` 是 deny-list，`scopeMatches` 兜底（`check-import-boundary.mjs:517`）使新顶层目录**天然落空** —— 新建 `src/convert/` 后没有任何规则的 scope 命中它，`resolveLayer` 算出 `main` 也无人比对 ⇒ **新树的所有反向依赖静默放行**。该文件 `:878-884` 与 `:1004-1006` 自己批评过这一形态。
⇒ 加两条 scope 规则（`convert-no-gui` / `cli-no-renderer`，落点 `:103` 与 `:127` 之后，照抄 `core-no-upward` 形状），**并**把层向治理改为 allow-list：`src/` 顶层名未登记即判红。`selfCheckTreeLayout`（`:1010-1031`）已是「树布局存在性自检」且被 `main` 无条件调用，断言插在 `:1013` 之后；正反锚点照抄 `selfCheckRootComputes`（`:749-857`，内联表 + `expect: 0|1` + 文案模板）。
**「不可逆」的含义是「不能以后再加」** —— 那时已有一堆未登记的越界 import 在代码里，补规则会一次性判红一片。
`cli-no-renderer` 只表达「禁 renderer」不够（deny-list 未列即放行，cli 还能合法 import `../../shared/`）；要堵逃出 src 须照 `smoke-no-outside-src`（`:135`）的 `prefix:../../` 另加一条。
**连带：`:1108-1111` 的摘要行手写枚举每条规则语义，加规则不改不会红但会静默说谎**，须同批同步。

**4. 新树一律不解析仓库路径。**
`resource-dirs.ts:49` 是 `path.resolve(moduleDir, "../../..", "node_modules")`，注释明写「编译产物恒在 `<项目>/dist/main/services/` 下」—— **硬编码输出深度**。文件搬到 `dist/convert/` 后该前提失真，且不报错。
凡需 node_modules 资源的位置（`katexDir` / mermaid 目录）经入参传进来。这条**在搬迁那一步就要生效**，不是跨平台时才付。

**5. 新目录自动进覆盖率分母。**
`package.json:46` 的 c8 用 `--include="dist/**"` + 8 条逐条 exclude，阈值 90/85/90/90。新增 `dist/convert/`、`dist/cli/` 若无验收段触达即判红 —— **这是本规划最先撞的墙，比 import 边界更早**。解法是同批配 `test/convert/` 段，**不是**加 exclude（exclude 是把新代码移出视野，与本 ADR 第 3 条同病）。
注意 `checkSegmentMirrors`（`shared/test-common-surface.js:254`）对新增段目录**零义务** —— 不配不会判红。

**6. `tsconfig.json` / eslint / `build.files` / `repo-manifest` 零改动。**
`include: ["src"]`、`eslint src/ test/ gates/ tools/`、`build.files` 正向仅 `dist/**`（`:101`）—— 三处均由派生式治理自动覆盖新树。`eslint.config.js:33` 已 ignore `dist`。`allowDefaultProject`（`:44`）注释明说「新增子目录自动覆盖」。

**7. 搬移时的两个陷阱。**
- `merge.ts:82` 的 `dirs[0] ?? process.cwd()` 实际不可达（`:116-119` 空数组守卫在前）。**搬迁必须保持守卫在前**，否则行为从「抛 i18n 错误」静默变成「以 cwd 为基准」。
- `context.ts:30-31` 的 `resolverCache`（LRU，上限 16）是唯一带跨调用可变状态的模块，随长驻进程长期存活。行为不变，但 commit message 须点名。

**8. 移动路径与可逆性。**
`artifact-writer.ts` 连带最小（生产调用点 1 处 + 测试 1 处）⇒ 第一个可提交步。
整体可逆性**高**：主体是 move + 四个入参，回退 = 删目录 + 恢复 import。唯一需同步的文档是 ADR-029 的载体命名。

**9. 本条不构成跨平台承诺。**
跨平台**不排入本规划的近期步序**，作为外部事件挂钩：触发点是「ADR-013（发布供应链与明确不签名）何时拍板」。发 macOS 版意味着推翻 ADR-013（未公证的 app 在 macOS 打不开）+ 采购 Apple Developer ID + 改 `check:signature` 门禁（它读 Authenticode，mac 上取不到事实，按 ADR-013 自己的规矩不得当作未签名放行）+ CI 加 macOS runner（每加一个 job 会撞 `pinned-actions.test.js:205` 的 `usages.length === 14`）。**那是组织成本不是工程成本，且在没有第二个消费点时收益无法度量。**
**本层只保留四条零成本的跨平台期权，作为硬性验收判据（可机械判，不是备注）**：不 import electron · 不解析仓库路径 · 不 import `app.getPath` · 不引入 Windows 专属 API。
同理，库模式（摘 `private: true`、写 `exports`、**新增 `declaration` 才有 `.d.ts`** —— 本仓 `tsconfig.json` 无该键）推到半年或一年后。

## 外部依赖

本 ADR 的实施**不依赖**跨平台决策，也不依赖库模式的发布决策。二者各自挂外部事件：跨平台挂 ADR-013 拍板；库模式挂「是否对外发 npm 包」的决策。

## 入口能力矩阵

新增一个入口 = 在这张表加一列，不是重新设计一层。**空缺处即当前真缺口。**

> **本表与 [ADR-066](ADR-066-转换契约类型化.md) 决定 3 的关系**：ADR-066 决定 3（交付面声明能力集、格式由声明派生）**已评估撤步、不做**，见 [`20261007-083000-ADR-066决定3能力声明撤步裁决`](../evidence/20261007-083000-ADR-066决定3能力声明撤步裁决.md)。**本表是「MCP 不提供 pdf」「CLI 的 mermaid 可选」的唯一记载处**（ADR-066 的现状描述只到「能力差异靠函数体字面量」，不列哪些面有哪些能力）—— 读者若被 ADR-066 那条已撤步的表述误导，以本表为准。**顺带一句：这张矩阵本身就已经是那份「清单」** —— ADR-066 设想的结构化声明在本仓并不额外增加信息，只增加载体。

| 能力 | core | convert | 谁提供 | GUI | CLI | MCP | 库 |
|---|---|---|---|---|---|---|---|
| 读文件 | 不做 | 编排 | — | ✅ | ✅ | ✅ | 传路径 |
| 设置 | 入参 | 透传 | — | `loadSettings()` | flag / 默认值 | tool 参数 | 传对象 |
| fs 能力 | 注入 | 编排 | 注入 | `context.ts` | 同 GUI | 同 GUI | 同 GUI |
| pdf 打印 | 不做 | 注入 `printPdf` | 宿主 | Electron | 重入 Electron | 不提供 | 需宿主 |
| mermaid | 注入 | 注入 | 宿主 | 有 | 可选 | **不注入→降级** | 可选 |
| 生命周期 | 调用方 | 一次转换 | — | 应用 | 进程 | **每次 call 新 ctx + 强制 deadline** | 调用方 |
| 结果通道 | 返回值 | 返回值 | — | IPC | stdout / 退出码 | 结构化 | 返回值 |

**MCP 必须设 deadline**：`mermaid-service.ts:56` 是一条串行 promise 链，MCP 没有「用户关窗口」这个天然出口。**CLI 不设 deadline** —— 由人控制，等多久是人的决定。

**图片缓存跨请求污染不存在**：`context.ts:31` 的 cache key 是 `(baseDir, trustedRoots)`，不同 baseDir 不互污；跑满 17 个目录只是 LRU 挤掉最早的 —— 是性能特征，不是正确性问题。若在意长驻内存，**给 MCP 侧单独调小上限，不改共享常量**。

## 关联

- 门禁同批改造：`gates/repo/check-import-boundary.mjs` · 注册表 `gates/probe/gate-probes/registry.mjs`（链顺序在 `package.json:90` 的 `verify:ci`）
- 产物侧判据（`--flavor dist` 当前是死代码，全仓零调用点）：`check:boundary` 只判源码文本，激活产物侧须**独立 npm script**，塞进 `check:boundary` 自身会与 `check-ci-contract.mjs:328-333`「boundary 须在 build 之前」冲突
- 跨平台成本落点与平台耦合面清单：`docs/evidence/`（事实快照，跨平台决策拍板后再升为决定）
- 载体命名需同步：ADR-029（输出骨架抽函数）
- 发布签名现状：ADR-013

## 实施复测（落地后才撞到的约束）

本节记的不是选型论据，而是**决定落地之后才撞到的约束**：每一条要么推翻了上面某条预测，要么给某条决定补上了实施时才显形的具体条件（哪个文件、哪个事件、哪个退出码）。**读者是来改这条决定、或来复用 `src/convert/` 这套装配层的人** —— 选型时的论据对他们没有用处，而这些坑多数已经修完，代码里看不出当初为什么这么写（这正是它们当时静默失败、事后无从查证的直接后果）。按「旧条不改动」的规矩，上面各节一个字不改；凡与上面各节冲突或需要补充之处，**以本节为准**。

条目沿用规划期的**原编号与原日期**（「步序 N」「完成标准 N」均指规划期的划分），便于回溯到当时的提交与台账行；格式沿用原样：现象 → 根因 → 修法 → 复测命令与结果。

### 2026-10-03 · 步序 1 首轮（门禁 + 两个搬迁）

**① ADR-060 后果 5 的「覆盖率墙最先撞」预测落空。**
现象：`verify:ci` 全绿，c8 四道阈值未红。
根因：预测对「真正的新代码」成立，但本轮两个文件是**搬迁**不是新写 —— `test/main/` 三个既有段本就覆盖这两个模块，import 路径改后覆盖率跟着走。ADR 那句「`dist/convert/` 若无验收段触达即判红」**对纯搬迁不成立**，仍对后续 `run.ts` / `context.ts` 成立。
修法：ADR 不改（决策载体，旧条不改动），在此记录口径修正。**下一步 `run.ts` 是新代码，`test/convert/` 段必须在那之前就位。**

**② 规划漏了 `run.ts`，且完成标准 7 依赖步序 2 的产物。**
现象：搬迁清单只列 4 个既有文件，ADR-060 的主体（`emitConvertedArtifact` 抽成 `run.ts` + 四注入点）不在其中；标准 7 写「跑 `node dist/cli/index.js --help`」而 `src/cli/` 是步序 2 才建的。
根因：搬迁清单照搬了 explorer 对「四个候选文件」的可搬性结论，那份调研范围本就不含 `output-skeleton.ts`。
修法：清单补 `run.ts` 为序 0（本步核心）；标准 7 改为「`test/convert/` 段在无 electron 的纯 node 下跑通一次真实 docx 转换」。

**③ 完成标准里混进一条空动作。**
现象：「`merge.ts:82` 的 cwd 兜底须保持守卫在前」被列为同批陷阱项。
根因：`merge.ts` 本轮**不搬**（双重穿越），该约束只在搬迁时成立。
修法：从本步移除；`context.ts` 那批若触及 `merge.ts` 再 reinstate。

**④ 派工漏了测试树类型门禁，子代理夹具带 TS2532。**
现象：全链停在 `tsc -p tsconfig.test.json` —— `test/gates/import-boundary.test.js:961` 的 `problems[0].includes(...)` 在 `noUncheckedIndexedAccess` 下报「Object is possibly 'undefined'」。fix-2 跑过 eslint 与门禁本体，但没跑测试树 `tsc`。
根因：我派的三条单命令自检不含 `npm run typecheck`（`tsc --noEmit` 只查 `src/`，测试树是 `tsconfig.test.json` 另一条命令）。
修法：按本仓既有口径（`check-pointers-e2e.test.js:508` 的 `hits[0] ?? ""`）改为 `String(problems[0]).includes(...)`；复测 `npm run typecheck` exit 0 + 全链绿。
⚠️ 后续派实现泳道若写测试文件，验证清单必须含 `npm run typecheck`（两条 tsc），不能只跑 `tsc --noEmit`。

**⑤ 主会话在共享载体上连续五次 edit 失败，其中一次真删掉了「## 在办」标题。**
现象：`docs/REQ.md` 的「## 在办」被误删，靠 `cat -A` 才定位到。
根因：拿 read 输出的**行号前缀**拼 oldString，且用跨多行的长锚点。
修法：改共享载体只用**最短唯一锚点**或 `cat -A` 核对不可见字符。已修回，`check:docs` 判绿。

**⑥ 并行泳道确实互删过产物。** fix-1 报告 `src/convert/` 整目录一度消失（重建后稳定，tsc 过）。**写域零重叠是必要条件，不充分** —— 共享可变状态（构建产物目录 / 清理脚本）仍会咬人。收尾已复验两文件在位。

### 2026-10-03 · 步序 1 第二轮（context/image-downloader 搬迁 + Batch B 抽 run.ts）

**⑦ 新增测试段目录要改四处，不是一处。** 这是本规划最大的疏漏，ADR-060 后果 5 与规划载体都只写了「配 `test/convert/` 段」。
现象：等式判据报「声明 6 个目录,实测 5 个;缺失 test/convert」，且级联成「每条夹具都失败」，症状离根因很远。
根因：镜像判据（`checkSegmentMirrors`）与等式判据（`checkSurfaceEquality`）是两个独立判据，我只写了前者。实际要改四处：
1. `shared/test-common-surface.js:47` `SEGMENT_DIRS` —— 声明面
2. `check-test-numbering.selftest.mjs` `BASE_SHAPE` —— 实测面副本
3. `check-temp-cleanup.selftest.mjs` `BASE_SHAPE` —— **第二份副本**（同形，漏改则级联失败）
4. `test/gates/contract-single-source.test.js:568` 的字面量 —— 刻意钉死，**不可派生**（派生即恒真，检测力归零）
修法：四处全改，两处副本已加注释互相指认。**步序 2 的 `test/cli/` 会撞同一堵墙。**
⚠️ 这条也说明 ADR-060 后果 5 的表述不完整 —— 但 ADR 是决策载体不改正文，在此记口径修正。

**⑧ ADR 的注入点签名在实现时被细化。** ADR 写 `printPdf?: PdfPrinter`，字面读是 `printPdf(html) → Uint8Array`；实现用**整体搬迁**形态 `printPdf(artifact, preferredPath, ctx, onStage) → Promise<string>`。
理由：`renderPdf` 内含 pdf 两遍法、书签注入、`setPdfMetadata`（其注释明写「pdf-lib 整体重存，必须最后执行，否则会丢弃书签」）、以及末尾那次 `commitArtifact`。按 bytes 形态拆，这串顺序得在 `persistArtifact` 里重组。整体搬迁让顺序逐字不变。
**这是对 ADR 的细化而非违背**，记此备查。

**⑨ 完成标准 5 与本步核心动作自相矛盾。** 原写「`single.ts` 零改动」，而 Batch B 的目的正是把它收成薄适配器（函数体必改）。已改为「导出签名逐字不变 ⇒ 四个调用点零改动」。

**⑩ 派工范围两次漏项，根因是拿子代理的报告当授权依据。** 第一次我漏了 `ipc/register.ts`；第二次 fixer 报了 `register.ts:13` 却漏了三个测试文件的 `dist/` 深导入（`test/core/frontmatter-once.test.js:155` · `test/main/input-budget.test.js:25` · `test/main/preprocess.test.js:17,50,66`）—— 漏因是 `dist/` 路径不带 `src/` 前缀，且前者不在 `test/main/` 段。
**纪律：授权前自己 grep 一遍完整面，不拿子代理的报告替代。** 这次多亏先 grep 才没让它再撞一次墙。

**⑪ 测试段必须在真 node 进程里跑才有意义。** `test/convert/run-headless.test.js` 显式从 env 删掉 `ELECTRON_RUN_AS_NODE` 后 spawn 真 node —— 段本身跑在 `electron.exe` 下，进程内断言证明不了「装配层与宿主无关」，只有真 node 子进程才能。若传递依赖里混进 electron（如 `mermaid-service.ts:362` 的模块顶层 `app.on`），子进程会在 import 期死掉并让段判红。

### 2026-10-03 · 步序 2（CLI）

**① 产物侧判据用「层向规则」表达，而非另写一个闭包遍历器；规则表条数因此多一条。**
现象：规划写「判据为 `dist/cli/index.js` 及其传递闭包中出现 electron 静态引用即判红」，同时又只让补 `cli-no-outside-src`（`prefix:../../`）一条规则。这两条凑不到一起：`prefix:` 只能判相对 specifier，**表达不出「禁裸包 electron」**；而 `cli` scope 下没有任何一条禁 `bare:electron`，规则表按原样新增后，`dist/cli/index.js` 里 `import "electron"` 在产物面**不会**判红 —— 规划要的那条判据形同虚设。
另有一个更隐蔽的洞：`cli-no-renderer` 只禁 renderer，`layer:` 不禁 main ⇒ cli 可以合法 `import ../main/converter/electron-side.js`，把 Electron 从传递闭包外侧拖进来。
修法：不另写闭包遍历器（那会把层的枚举做成一门语言，此后新增 `src/mcp/` 之类还得同步维护枚举），改为**补两条 deny-list 规则**：`cli-no-host`（`bare:electron`）+ `cli-no-outside-src`（`prefix:../../`）。禁 renderer 那条仍在，deny-list 是并集 ⇒ `cli → main → electron` 也被 `cli-no-host` 覆盖。规则表 10 → **12** 条（规划写 10 → 11）。
产物面判据仍由 `--flavor dist` 提供（`check:boundary:dist`，挂 `build` 之后）；规则本身在 src 面即已生效 —— 源码面比产物面早一步，产物面多判的是 type-only import 擦除与 cjs require 形态。已实测判红判绿双向。

**② pdf 的任务与结果都经文件传，不走 stdout。**
现象：先按「子进程 stdout 传结果」写，`spawnSync` 接管道时恒定失败 —— 子进程退出码 0、**stdout 全空、无任何 stderr**，看起来像「任务根本没跑」。重定向到文件则完全正常，故障只在真实调用形态下出现。
修法：结果与任务描述一样走一次性目录里的文件（`convert/cli-pdf-job.ts` 是契约单源）。理由写在该模块的 `writeJobResult` 注释里：stdout 在管道下是异步的，而 `app.exit()` 立即终止进程不等落盘。

**③ pdf 宿主必须显式接管 `window-all-closed`。**
现象：接上结果文件后仍恒定「退出码 0、无结果文件、无 stderr」。调试时挂的 `setInterval` 一次都没触发 —— 不是异常也不是超时，是进程被**同步**结束、事件循环直接排空。
根因：Electron 默认「最后一个窗口关闭即退出」。本宿主**没有常驻窗口**，`renderPdf` 建隐藏打印窗口并在 `finally` 里 `destroy` 它，那一下恰好构成「最后一个窗口关闭」，默认处理器随即结束进程，pdf-lib 注入 / 落盘 / 写结果全部来不及。
修法：入口分支内 `app.on("window-all-closed", () => {})`，结束时机只由 `app.exit(code)` 决定。

**④ `getKatexDir()` 在本宿主下不可用。**
`resource-dirs` 的 KaTeX 一支以 `app.getAppPath()` 为基准，而本宿主以**脚本路径**启动（`electron dist/main/cli-pdf-host.js`），此时 appPath 等于脚本所在目录 ⇒ 公式路径指向不存在的 `dist/main/node_modules/katex/dist`。改按该文件里 Mermaid 的既有做法用模块自身位置定位（三场景一致，打包态即 `app.asar`）。

**⑤ 转换逻辑与进程编排分两层测，否则覆盖率只能用假豁免盖住。**
`cli-pdf-host.ts` 初版在模块顶层就 `app.setPath("userData", …)`、且在函数内 `app.exit` ⇒ 既没法被测试 import（会改掉整段宿主的 userData），也不产生覆盖率（`check:coverage-zero` 判红：两个新文件 0%）。
修法：`convertPdfJob`（只做转换、写结果、**返回**退出码）与入口的 `app.exit` 拆开；userData 重定向与 `window-all-closed` 接管一并移进入口分支。`test/cli/pdf-host.test.js` 在 Electron 宿主里直调 `convertPdfJob` 跑真转换（覆盖 + 可断言），进程编排（spawn / 退出码转发）由 `options.test.js` 的真 node 子进程段负责，两边互补不重叠。

**⑥ `-o` 短选项与 `--format both` 的两处拦截。**
现象一：只实现 `--output` 时，`-o out.docx` 被当成**输入路径** —— 静默少转一个文件且不报错，是脚本面最难查的一类坑。修法：加短选项表；非 `--` 开头且不在表内的 token 一律判用法错，不再当输入路径。
现象二：`--format both` 配 `-o` 时，同一路径被 docx 与 pdf 各提交一次，后到那次撞上前次已占用的路径，报错是「产物格式校验失败(.docx 魔数不符)」这种看不懂的形态。修法：解析期判用法错并提示分开跑两次 —— 替调用方猜后缀等于替他改主意。

**⑦ 退出码 4 的判据依赖三处文案匹配（脆弱，已写明出处）。**
装配层把落盘失败与转换失败都抛成普通 Error、没有错误码，故 CLI 侧只能按文案匹配三处（artifact-writer 的「产物路径已存在」「不支持硬链接」，paths.ts 的「无法创建输出目录」）。已在代码注释里点名三处出处并写明「改文案必须同改这里」，避免它退化成隐式约定。若将来给装配层加错误码，应改为读码；在此之前，「三处文案 + 一处判定」优于「无判定」（脚本至少能区分「重名」与「磁盘满」）。

### 2026-10-03 · 步序 3 开工前

**① 「MCP 进程跑在 Electron 上」的因果接不上，且有两条实测反证。**
现象：本规划步序 3 第一节写「只暴露 docx；pdf 需 Electron 宿主，**用户已拍板接受**，故 MCP 进程跑在 Electron 上」—— 但同节既然只暴露 docx，这条因果就断了：docx 走纯 node 已实测可行（步序 2 的 CLI 壳 `dist/cli/index.js` 本身就是纯 node，pdf 才在**里面**才 spawn Electron）。把「pdf 需要宿主」直接推成「MCP 进程需要宿主」，等于把一个**子能力**的约束当成了**进程形态**的约束。
实测证据（两条，均为开工前实测）：
① **Electron 子进程的 stdout 接到管道时，会在帧前面多吐一个 `\r\n`**（Chromium 噪声）。严格按行解析 JSON 的 MCP 客户端会撞上 —— 这与步序 2 复测 ② 撞的是同一类坑（stdout 在管道下不可靠），方向一致、结论相同：协议通道不能走子进程 stdout。
② **`electron` 是 devDependency、不在 PATH 上**。MCP 客户端配置里写 `electron <path>` 只在开发检出里成立；打包后的用户手上没有那个二进制路径。
裁决：**MCP 进程跑纯 node**（已与用户确认）。关键论证是「**pdf 是能力、不是进程形态**」—— 将来 MCP 要 pdf 时，复用步序 2 已建成的机制：纯 node 侧写任务文件 → spawn `dist/main/cli-pdf-host.js` → 读结果文件。协议通道（stdio + JSON-RPC）永远不碰 Electron。这也让「补 pdf」从「重写 MCP 进程形态」降级成「多加一次 spawn」。
遗留尾巴：真要给 MCP 加 pdf 时，`src/convert/cli-pdf-job.ts` 会被第二个消费方（CLI 与 MCP 共用）⇒ 届时改名为 `pdf-host-job.ts`。**纯机械改名**，但要同批更新引用它的地方。
### 2026-10-04 · 步序 3（MCP）

规划期这一节**只有「开工前」的记录、没有完工记录** —— 载体在 `f831a46` 被改判给另一条需求时流失，判据一度无处可查。判据原文已于 2026-10-04 从 `git show f831a46^:docs/PLAN.md` 取回，全文入档 `docs/evidence/20261004-000218-多层交付面总规划原文.md`。本节补上完工记录。

规划原文自己写的是「**结果（2026-10-03）**：本步全部验收项落地」，三条契约逐条兑现：**只暴露 docx**（pdf 需宿主，不提供）· **不注入 `mermaidResolver`** 且降级在返回值与工具描述里都点名 · **每次 call 新 ctx + 强制 deadline**（串行队列，MCP 没有「关窗口」这个天然出口）。传输层手写最小 JSON-RPC 2.0 over stdio，不引官方 SDK；stdout 只进协议、诊断一律 stderr。落点是**纯 node**（裁决见上面「步序 3 开工前」）。

**独立复核（2026-10-04）**：除读代码外，另有一条**真实客户端链路**实测 —— 经已安装入口经 `cmd.exe` 转发，向该服务端发真实 `initialize` 与 `tools/call` 两帧，收到 2 个 JSON 帧、docx 产物正常生成，stdout 上只有 JSON 帧。这条比「代码在位」强：它证明**装版语境下同样成立**。

### 2026-10-04 · 完成标准 8 条逐条划完（附门禁补齐）

那 8 条整体完成标准在载体流失后一度无法逐条核对。取回原文后逐条核对如下 —— **每条给出可复取的证据，不采信「当时打过勾」**：

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| 1 | 步序 1 的 7 条逐条通过（含纯 node 无 electron 下的真实 docx 转换） | 达成 | 规划原文七条均已勾；第 7 条的实测落在 `test/convert/run-headless.test.js`（显式从环境删掉 `ELECTRON_RUN_AS_NODE` 后 spawn 真 node） |
| 2 | 命令面可跑：单文件 / 多文件 / `--json` / 退出码表各有夹具 | 达成 | 退出码表五道（`ok` / `usage` / `inputUnreadable` / `outputUnwritable` / `convertFailed`）**每一道都有断言**；多文件与 `--json` 在 `test/cli/options.test.js` 内 |
| 3 | pdf 经壳自动重入可用；开发态与打包态两支 Electron 定位各有一测 | 达成 | 见另一条需求「安装版命令行入口」的步序 1（宿主定位双上下文 + 已安装形态宿主拉起） |
| 4 | 产物侧 electron 静态引用判据已挂上链且**判红判绿双向实测** | **本轮补齐** | 见下 |
| 5 | MCP 工具面可调；降级在返回值里可见；卡死调用有 deadline 兜底 | 达成 | 三条契约，见上节 |
| 6 | **四条零成本跨平台期权为硬性验收判据（可机械判）** | **本轮补齐** | 见下 |
| 7 | 载体命名已同步；`check-import-boundary.mjs` 摘要行与新规则一致 | 达成 | 摘要行随每次新增规则同步更新，判据 id 与分母在结论行可见 |
| 8 | 台账状态与实际一致 | 达成 | 本节落笔时划完 |

**第 4、6 条在核对时是真缺口，本轮补门禁补上。**

#### 第 4 条：产物侧判据的判红方向此前零机械证据

`check:boundary:dist` 早已在链内，测试段也确实对真实 `src` / `dist` 双侧跑判定 —— 但那测的是**零 problem 的绿支**。**判红方向既没有 selftest，也没有任何合成违例夹具** ⇒ 无法排除「产物侧判红是死代码」。

补法：加合成违例的产物侧用例（五条判红 + 一条合法产物树复绿），并加一条**同树双 flavor 对照** —— 同一棵沙盒树用产物 flavor 判红、用源码 flavor 判**绿**，证明产物侧的判红可见性是 `cjs` 与扩展名带来的独有效果，不是源码判红的同义词。

#### 第 6 条：四条期权里有两条此前是「约定」而非「判据」

核对时发现：既有的 `faces-no-host` 与 `faces-no-outside-src` 作用域是 `delivery-faces`（只有 cli + mcp），而 `convert-no-gui` 只禁 `layer:main,renderer`、**不含 `bare:electron`** ⇒ **装配层上「不 import electron」与「不解析仓库路径」两条一直是约定，没有判据。**

本 ADR 后果里曾记「补规则会一次性判红一片」。**实测该判断已过时**：装配层对 `electron` 的实际 import 零命中（步序 1 已清干净）⇒ 补规则**零判红，不需要任何豁免表**。

本轮共补四条规则，各配负探针：

| 规则 | 作用域 | 判据 |
|---|---|---|
| `headless-no-app-getpath` | `convert` / `cli` / `mcp` | 禁 `app.getPath` —— 连同 `getAppPath` 与从 `app` 解构路径解析函数，**只禁其一会留同义绕过口** |
| `headless-no-windows-only` | 同上 | 禁读 Windows 专属环境变量、禁以 Windows 专属可执行文件为子进程 |
| `convert-no-host` | `convert` | 禁 `bare:electron` |
| `convert-no-outside-src` | `convert` | 禁相对说明符解析后逃出 `src/` |

**两条取舍值得留下**：

1. **装配层单开规则，不并入三层作用域，也不动 `faces-no-host`。** 并进去会让同一条事实在 cli/mcp 上被两条规则各报一次 —— 两个可改的 id、两种诊断、两份可漂移的副本。规则表少一行的收益，远小于两份 id 漂移的代价。
2. **`convert-no-outside-src` 按「解析结果」判，而非按 `../../` 前缀判。** 两者在该层是扁平单层目录时等价（实测当前无子目录，两者都对），但它仍在长：一旦长出子目录，那里的 `../../core/x` 是**合法的**（落在 `src/core/`），前缀形态会把它判红。**一个随目录生长而误报的判据是负资产。** 已做机械反证：同一段 `../../core/convert.js`，在装配层的子目录里判**绿**、在 cli 的子目录里判**红**。

**刻意不覆盖的两处，理由各不同**：

- `path.win32` / `path.posix` **不判红** —— `core/image/image-path-policy.ts` 的符号链接逃逸判定（ADR-012）靠它们做双向比对，是承重逻辑。新规则**按层施加**正是为了不误伤它，探针里钉了 core 侧判绿锚点。
- `process.platform === "win32"` 守卫**不判红** —— 那是跨平台代码探测平台的正确形态，禁它等于禁跨平台。已钉判绿锚点。

**两处已知边界（如实记，不粉饰）**：

- 环境变量清单按**大小写敏感**匹配，而 Windows 上 `process.env` 本身大小写不敏感 ⇒ 小写形态是已知绕过面。改成大小写不敏感会连带误伤普通用法；**正解是给新层注入路径入参**（即本 ADR 的四个注入点），不是加正则。
- `convert-no-outside-src` 只管相对说明符的解析结果，**不管按目录层级反推路径的形态**（`path.resolve(模块目录, "../../..")`）—— 而本 ADR 后果里点名的正是后者。实测该形态零命中（17 处路径调用全作用于入参），但**门禁对它零覆盖**：那属「自算根」族，已有独立规则而其扫描目录只含 `gates` / `tools` / `test` / `shared`、不含 `src`。**点名留作后续项。**

**同形的潜伏误报源（未改，留后续）**：`faces-no-outside-src` 与 `smoke-no-outside-src` 用的仍是前缀形态。那两面一旦长出子目录，就会误报合法的 `../../core/`。本轮刻意未改（牵动既有夹具），已在代码注释里记为后续项。

#### 判红为零

四条新规则对真实 `src` 与真实 `dist` 均零命中，**未加任何豁免表、未放宽任何既有规则**。装配层与 cli 层各有一处注释提到 `app.getPath`（说明「本层刻意不引」），靠「抹掉注释再判」的遮罩正确判绿 —— 那是纪律的书面来源，不是违反。
