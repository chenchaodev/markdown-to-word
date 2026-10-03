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