# 多层交付面：headless 装配层 → CLI → MCP

> **大型需求载体。**台账记「为什么做」，本文件记「做到哪、下一步是什么、怎么才算完」。
> 决策全文见 `docs/adr/ADR-060-多层交付面与headless装配层.md`；跨平台成本落点见其「后果」第 9 条。
> 验证命令唯一载体是 `docs/DEV-GUIDE.md`，本文件只留一行指针、不复制命令。
> 收尾即删。**完成标准逐条划完才许删**（大型需求以「整体完成标准」为准）。

## 目标

把「路径进、路径出」的单文件转换从 GUI 宿主剥离成headless 装配层，使 GUI / CLI / MCP / 库模式共用同一套装配；本规划只推进前两者 + 门禁改造，MCP 与库模式在步序内有界。

## 下一步（一个动作）

步序 1（装配层）与步序 2（CLI）均已落地。**步序 3 · 本地 MCP 模式正在进行中**（`REQ-162`，台账已移「在办」）：docx-only + mermaid 显式降级 —— 降级须在返回值里对 agent 可见，每次 call 新 ctx + 强制 deadline（串行队列，MCP 没有「关窗口」这个出口）。MCP 进程跑**纯 node**（不跑 Electron），理由与实测证据见下方「修复项复测 · 2026-10-03 · 步序 3 开工前」。步序 4（文件关联 / 右键菜单 / 拖拽 / CLI 作为发布 npm bin）已判定不做，见各自在台账的挂靠行。

## 相关 ADR 一行结论

| ADR | 一行结论 |
|---|---|
| [ADR-060](adr/ADR-060-多层交付面与headless装配层.md) | 现行 —— 三层结构 + 四个注入点 + `skipAfterConvert` 禁入新层 + 门禁 deny→allow + 「不构成跨平台承诺」 |
| [ADR-029](adr/ADR-029-main侧输出骨架抽函数.md) | 输出骨架载体命名需随搬迁同步（旧条不改动，只在新条标） |
| [ADR-018](adr/ADR-018-core-pdf-渲染路径不做文件IO.md) | core 宿主能力靠注入、不降级 —— 新层同此路数 |
| [ADR-012](adr/ADR-012-图片信任边界与资源上限.md) | 图片信任边界 —— 新层不引入第二个 fs 边界绕过它 |
| [ADR-013](adr/ADR-013-发布供应链与明确不签名.md) | 现行 —— **跨平台的外部挂钩点，不在本规划内** |

## 验证基线

见 `docs/DEV-GUIDE.md`。

---

# 步序与泳道

四步。**每步一个可独立回退的提交；步骤 1 内部按「一文件一提交」线性推进。**

## 步序 1 · 装配层与门禁改造

**为什么第一步**：门禁改造**不可跳过** —— `LAYER_RULES` 是 deny-list，`scopeMatches`（`check-import-boundary.mjs:517`）使新顶层目录天然落空，新树的所有反向依赖静默放行。「不能以后再加」意味着那时已有一堆未登记的越界 import，补规则会一次性判红一片。

**搬迁清单**（可搬性已实测，见 ADR-060「后果」）：

| 序 | 文件 | 判定 | 连带面 |
|---|---|---|---|
| 0 | **`run.ts`（从 `output-skeleton.ts` 抽出 `emitConvertedArtifact` + 四注入点）** | **本步的核心**，ADR-060 的主体就是它 | 见下方「四注入点」 |
| 1 | `artifact-writer.ts` ✅ 已完成 | **可直接搬**（3 条 node 内建，零跨层） | 生产 1 + 测试 1 |
| 2 | `paths.ts` ✅ 已完成 | **可直接搬**（core 两条均 `import type`） | 生产 5 + 测试 3 处深导入 |
| 3 | `context.ts` | **搬但要注入**（唯一 runtime 跨树是 `createImageResolver` `:25`） | 生产 5 + 测试 4 |
| — | `merge.ts` / `batch.ts` | **搬不了，留 main** | 双重穿越，见 ADR-060 后果 1 |

**四注入点**（`run.ts` 的入参形状，逐项见 ADR-060「决定」表）：`settings` 入参（不再自己 `loadSettings()`）· `printPdf?`（pdf 必需，缺则明确报错不降级）· `mermaidResolver?`（默省 = 不注入）· `onAfterCommit?`（**`skipAfterConvert` 禁止进本层**，GUI 侧自己判让位）。
`output-skeleton.ts` 余下 `renderPdf` + `runAfterConvert` 搬进新文件 `src/main/converter/electron-side.ts`；`single.ts` 收成薄适配器且**导出签名不变**。

**并行泳道**（写域不重叠，且都不进入构建产物的判定已注意）：

| 泳道 | 可写 | 读 |
|---|---|---|
| A · 搬迁 | `src/convert/**` + 四个源文件的 import 行 + 对应测试的 import 行 | — |
| B · 门禁 | `gates/repo/check-import-boundary.mjs` + `gates/probe/gate-probes/registry.mjs` | — |
| C · 测试段 | `test/convert/**`、`test/cli/**` | — |

> **不得并行的判据**：A 与 B 都要跑 `verify:ci`，而该链共享构建产物目录与 c8 覆盖率产物（`output/coverage/`、`.c8-tmp/`）。**并发跑会互删产物且结果不可归因** ⇒ 合并顺序执行，或各自只在单命令级自检后交给主会话跑全链。

**步序 1 完成标准**（逐条可机械判）：

> **进度：7/7 通过（2026-10-03）**，落在 `1fa2f81` · `539f4f7` · `b43ca58` · `284f5de` 四个提交。
> ⚠️ 标准 5 的措辞仍不够诚实，已在下方标注实测偏差 —— **别把它当成四个文件都没动过**。

1. `src/convert/` 存在且**零 `import ... from "electron"`**（grep 判据）✅ 实测零命中
2. `LAYER_RULES` 加了 `convert-no-gui` / `cli-no-renderer` 两条，且 `src/` 顶层名未登记即判红（造含 `omega/` 的合成树，实测判红）✅ 复验：造 `src/omega/x.ts` → exit 1，删掉 → exit 0
3. `check-import-boundary.mjs:1108-1111` 摘要行已同步新规则语义 ✅
4. `test/convert/` 段已配齐且**进入 c8 分母**（不是被 exclude 掉）✅ `SEGMENT_DIRS` 已含 `convert`，覆盖门禁绿
5. `single.ts` 的**导出签名逐字不变**（`convertImpl` 的参数表 + 继续转出 `renderPdf`/`runAfterConvert`）✅ 已复验转出面在（`single.ts:27`）。⚠️ **实测偏差**：四个「调用点」里有**两个其实动了** —— `ipc/register.ts` 与 `windows/preview.ts` 因 `preprocess.ts` 迁移各改了 1 行 import。准确表述是「对 `single.ts` 的调用零改动」，不是「这四个文件零改动」。⚠️ 原写「`single.ts` 零改动」是规划错误：Batch B 的目的正是把它收成薄适配器（函数体必改），该标准与步序 1 的核心动作自相矛盾 |
6. 全量 `verify:ci` 绿 ✅ `CHAIN_EXIT=0`
7. **诚实验收**：`test/convert/` 段在**无 electron 的纯 node 下**跑通一次真实 docx 转换（不经 Electron、不设 `ELECTRON_RUN_AS_NODE`）✅ `[ok] convert/run-headless.test.js`。⚠️ 原写的 `node dist/cli/index.js --help` 是**步序 2 的产物**，标准 7 依赖它才能跑 ⇒ 属规划错误，已改为纯 node 直调 `run.ts` |

**同批必须处理的搬迁陷阱**：

- `resource-dirs.ts:49` 硬编码输出深度 `../../..` ⇒ 新层一律不解析仓库路径，`katexDir` 等经入参传进
- `merge.ts:82` 的 `dirs[0] ?? process.cwd()` 不可达但**搬迁须保持空数组守卫在前**
- `context.ts:30-31` 的 `resolverCache` LRU 是唯一跨调用可变状态，随长驻进程存活 —— commit message 点名

## 步序 2 · CLI

**验收标准就是「装配层真的够用」** —— 装配层若还需为 CLI 特殊改动，说明步序 1 切错了。

- 形态：`node dist/cli/index.js`，**不摘 `private: true`、不发布**（摘 private 是发布决策，不是代码决策；这样本步**完全可逆**）
- 命令面**最小**：路径进 / 路径出 · `--format` · `--json` · `--template` · 退出码表
- 文件拆两份：`src/cli/index.ts`（入口）+ `src/cli/options.ts`（argv → 设置契约，映射独立判据该有自己的测试段）
- **映射必须走 GUI 那份设置契约**，不自建 flag → renderer 参数表（`docs/evidence/20260925-194556:242` 已预警绕过 renderer 会得到与直接调用不同的结果）
- pdf 由壳**自动重入 Electron**（一条命令两个格式）；定位 Electron 可执行文件分两支：开发态取 `electron` 包导出路径，打包态 `process.execPath`
- 退出码：`0` 成功 / `1` 用法错 / `2` 输入读不到 / `3` 转换失败 / `4` 输出写不了；只清洗不改内容仍 `0`
- 流：stdout 出数据（`--json` 出结构化结果数组，含产物路径、警告 kind、耗时），stderr 出人读诊断
- 新增 `pinOutputPath` 语义：CLI 显式 `-o` 时**禁自动避让** —— GUI 的 `名 (2).docx` 是对的，CLI 里用户写了 `out.docx` 却拿到 `out (2).docx` 是意外
- **同批激活产物侧判据**：`--flavor dist` 当前是全仓零调用点的死代码。激活须**独立 npm script**（塞进 `check:boundary` 自身会与 `check-ci-contract.mjs:328-333`「boundary 须在 build 之前」冲突），判据为 `dist/cli/index.js` 及其传递闭包中出现 electron 静态引用即判红
- **同批补第三条层向规则 `cli-no-outside-src`**（ADR-060 后果 3 末句要求，本轮未加）：`cli-no-renderer` 只表达「禁 renderer」，deny-list 未列即放行 ⇒ cli 仍可合法 import `../../shared/`。照 `smoke-no-outside-src` 的 `prefix:../../` 加一条，规则表 10 → 11 条，`test/gates/import-boundary.test.js` 的 id 清单须同步。**推迟到本步的理由**：`src/cli/` 此刻尚不存在，为不存在的 scope 加规则会让自检的「规则 scope 目录不存在」判红（形同虚设诊断）


**结果（2026-10-03）**：本步全部验收项落地，命令面按最小集交付。

- 形态与面：`node dist/cli/index.js`，未摘 `private`、未发布。选项为 `--format docx|pdf|both` · `-o/--output` · `--template` · `--json` · `--help`。**退出码 0/1/2/3/4 五档各有夹具**（`test/cli/options.test.js` 在真 node 子进程里逐条实跑）
- `--template` 走 `core/settings/presets.ts` 新增的 `presetSettingsPatch`，renderer 的 `applyTemplatePreset` 已改为消费同一函数 ⇒ flag → 设置不再是第二份映射
- pdf 经壳重入：`src/cli/index.ts`（纯 node）拉起 `dist/main/cli-pdf-host.js`（Electron 入口，注入 `renderPdf` 调同一装配层入口）。**任务与结果都经文件传递**，不走 stdout
- `pinOutputPath` 已进装配层：`OutputSkeletonDoc` 增该字段，经 `resolveOutputPath` 与 `commitArtifact` 的 `renameOnConflict:false` 落到 docx 与 pdf **两条**路径（`PdfPrinter` 新增第 5 参把提交选项透传给宿主侧，否则 pdf 会绕开禁避让）
- 流：stdout 只出数据（`--json` 出结构化结果数组，含产物路径/警告 kind/耗时），stderr 出人读诊断
- 门禁：`check:boundary:dist`（`--flavor dist`，挂在 `build` **之后**）已激活并实测判红判绿双向（向 `dist/cli/index.js` 注入 `import "electron"` 即红）。层向规则补两条 —— `cli-no-host`（`bare:electron`）与 `cli-no-outside-src`（`prefix:../../`）—— 规则表 10 → **12** 条

**与规划的偏差（详见「修复项复测」）**：规则表条数比规划多一条（`prefix:../../` 表达不出「禁裸包 electron」，产物面判据要真成立必须另有 `bare:electron` 一条）；判定点也改为**层向规则**而非另写一个闭包遍历器。

## 步序 3 · MCP（docx-only + mermaid 显式降级）

- 只暴露 docx；pdf 需 Electron 宿主，**用户已拍板接受**，故 MCP 进程跑在 Electron 上
- **不注入 `mermaidResolver`** ⇒ 零新增代码（`convert.ts:226-230` 既有契约），且 mermaid 窗口收口的坑自动消失（`dropSession` 只在 `will-quit` / 窗口 `closed`，headless 长驻两者都没有）
- **降级必须对 agent 可见**：返回值带 `degraded: ["mermaid"]`。静默降级会造出「同样输入、偶尔产出不同」的工具
- **每次 tool call 一个新 ctx + 强制 deadline**（`mermaid-service.ts:56` 是串行 promise 链，MCP 没有「用户关窗口」这个天然出口）
- 长驻内存若在意：给 MCP 侧**单独调小**缓存上限，**不改共享常量**
- ⚠️ 降级声明会进工具描述与返回值文案，**对 agent 可见的文案事后撤销比代码贵** ⇒ 开工前先确认降级策略
- **同批把 `mcp` 登记进 `SRC_TOP_LAYERS` + 补它自己的 scope 规则**（已裁定接受「开工第一天门禁红一次」）：本轮 `SRC_TOP_LAYERS` 刻意**不含** `mcp`，判据是「一个名字进 allow-list 的前提是已有 scope 规则覆盖它」—— 登记一个无规则覆盖的名字，等于用「已治理」的假象盖住真实的洞。`src/mcp/` 落地那天门禁会先判红，逼着同批补规则。这是设计意图，不是缺陷


**结果（2026-10-03）**：本步全部验收项落地。`node dist/mcp/index.js` 起一个只含 `convert_markdown` 的 docx-only server，零 electron。

- 三条契约逐条兑现：**只暴露 docx**（pdf 需宿主，不提供）；**不注入 `mermaidResolver`** 且降级在返回值与工具描述里都点名；**每次 call 新 ctx + 强制 deadline**（120s，见 `tools.ts` 取值理由）。
- 传输层手写最小 JSON-RPC 2.0 over stdio（不引官方 SDK —— 只暴露一个 tool，SDK 的 ajv/zod/express/hono 是纯负担）。stdout 只进协议、诊断一律 stderr、一帧一次 write；串行化保证同一时刻只有一条请求在飞。
- **降级判定抽到 core**：`MERMAID_LANG` + `containsMermaidCode` 与渲染器共用同一个常量 —— 渲染器原本**静默**把 mermaid 围栏按代码块渲染且不产警告，声明方与渲染方各写一份字面量就会「声明降级但其实渲了图」。
- **交付面设置基线抽到 `convert/delivery-settings.ts`**：ADR-060 规定 cli 与 mcp 零依赖 ⇒ 这段逻辑只能写在两层之下，cli 已改为消费同一份。
- 门禁：新增跨面 scope 形态 `delivery-faces` 同时覆盖 `cli/` 与 `mcp/`，三条规则中性改名，**规则表条数不变（仍 12 条）**，未复制三条；`mcp` 已登记进 `SRC_TOP_LAYERS`。
- 测试：`test/mcp/` 一段。传输层十项（含跨 chunk 半包、handler 抛错不终止 server、notification 不回帧）+ tool 真实转换 + 7 类业务失败。

**与规划的偏差**：进程形态由 Electron 改为纯 node（见「修复项复测 · 步序 3 开工前」）；门禁未采用「开工第一天红一次」而是同批补规则 —— 补完即达规划意图，让门禁红一天不产生额外信息。
## 步序 4 · 本规划不做的事（各挂外部事件）

| 事项 | 状态 | 挂钩 |
|---|---|---|
| 库模式（摘 `private`、写 `exports`、**新增 `declaration` 才有 `.d.ts`** —— 本仓 `tsconfig.json` 无该键） | 推到半年或一年后 | 「是否对外发 npm 包」决策 |
| 跨平台 mac/Linux | 不排步 | **ADR-013 何时拍板** |
| 第 0 档入口（文件关联 / 右键菜单 / 拖拽） | 不做，全部依赖 CLI | 唯一真缺口「GUI 启动不接收命令行参数」单独立号 |
| 目录监视 / HTTP 服务 | 不进规划 | 各需一个新号，等真实需求 |

---

# 整体完成标准

**全部划完才许删本文件。**

1. 步序 1 的 7 条完成标准逐条通过（含**纯 node 无 electron 环境**下的真实 docx 转换）
2. `m2w` 最小命令面可跑：docx 单文件 / 多文件 / `--json` / 退出码表，四道退出码各有夹具
3. pdf 经壳自动重入可用；开发态与打包态两支 Electron 定位各有一测
4. 产物侧 electron 静态引用判据已挂上链且判红判绿双向实测
5. MCP 工具面可调；mermaid 文档的降级在返回值里可见；卡死调用有 deadline 兜底
6. **四条零成本跨平台期权为硬性验收判据**（可机械判，不是备注）：新层不 import electron · 不解析仓库路径 · 不 import `app.getPath` · 不引入 Windows 专属 API
7. ADR-029 载体命名已同步；`check-import-boundary.mjs` 摘要行与新规则一致
8. 台账：总规划号标「已完成」，MCP 号与库模式号状态与实际一致（**库模式仍是「未开工」，不是「已完成」**）

## 修复项复测

每条完成标准被推翻时在此记录：现象 → 根因 → 修法 → 复测命令与结果。

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

**⑦ 新增测试段目录要改四处，不是一处。** 这是本规划最大的疏漏，ADR-060 后果 5 与本文件都只写了「配 `test/convert/` 段」。
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

---

# 怎么回滚

| 步 | 可逆性 | 回滚方式 |
|---|---|---|
| 1 装配层 | **高** | 主体是 move + 四个入参 ⇒ 删 `src/convert/` + 恢复 import。唯一需人工回退的是 ADR-029 的文档措辞 |
| 1 门禁 | **中高，但不能「以后再加」** | 规则可删；但若已积累未登记的越界 import，**补规则会一次性判红一片** ⇒ 门禁改造必须与搬迁同批，不留到后面 |
| 2 CLI | **高** | 不摘 `private`、不发布 ⇒ 删 `src/cli/` + 删 script。`--json` 等契约无外部承诺 |
| 3 MCP | **中** | 代码可逆；但**降级文案对 agent 可见**，事后撤销比代码贵 ⇒ 降级策略开工前定 |
| 4 跨平台 | **低** | ADR-013 一旦推翻（采购证书、要公证），回退 = 弃证书 + 改回三处同改 + 门禁回退。**全路径唯一真正难回退的一步** |

**回滚顺序约束**：步序 2、3 依赖步序 1 的装配层 ⇒ 要回滚 1 必须先回滚 2、3。步序 4 无依赖。

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
