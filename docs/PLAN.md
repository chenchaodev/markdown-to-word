# 多层交付面：headless 装配层 → CLI → MCP

> **大型需求载体。**台账记「为什么做」，本文件记「做到哪、下一步是什么、怎么才算完」。
> 决策全文见 `docs/adr/ADR-060-多层交付面与headless装配层.md`；跨平台成本落点见其「后果」第 9 条。
> 验证命令唯一载体是 `docs/DEV-GUIDE.md`，本文件只留一行指针、不复制命令。
> 收尾即删。**完成标准逐条划完才许删**（大型需求以「整体完成标准」为准）。

## 目标

把「路径进、路径出」的单文件转换从 GUI 宿主剥离成headless 装配层，使 GUI / CLI / MCP / 库模式共用同一套装配；本规划只推进前两者 + 门禁改造，MCP 与库模式在步序内有界。

## 下一步（一个动作）

抽出 `src/convert/run.ts`：把 `output-skeleton.ts` 的 `emitConvertedArtifact` 搬进去并落四个注入点（`settings` 入参 · `printPdf?` · `mermaidResolver?` · `onAfterCommit?`），`renderPdf` + `runAfterConvert` 另立 `src/main/converter/electron-side.ts`，`single.ts` 收成薄适配器且导出签名不变。**同批建 `test/convert/` 段**（`run.ts` 是新代码，覆盖率墙对它成立）。

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

1. `src/convert/` 存在且**零 `import ... from "electron"`**（grep 判据）
2. `LAYER_RULES` 加了 `convert-no-gui` / `cli-no-renderer` 两条，且 `src/` 顶层名未登记即判红（造含 `omega/` 的合成树，实测判红）
3. `check-import-boundary.mjs:1108-1111` 摘要行已同步新规则语义
4. `test/convert/` 段已配齐且**进入 c8 分母**（不是被 exclude 掉）
5. `single.ts` 及其全部现有调用点**零改动**
6. 全量 `verify:ci` 绿
7. **诚实验收**：`test/convert/` 段在**无 electron 的纯 node 下**跑通一次真实 docx 转换（不经 Electron、不设 `ELECTRON_RUN_AS_NODE`）—— 这是「装配层真的与宿主无关」的唯一诚实验收，比任何单测都强。⚠️ 原写的 `node dist/cli/index.js --help` 是**步序 2 的产物**，标准 7 依赖它才能跑 ⇒ 属规划错误，已改为纯 node 直调 `run.ts` |

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

## 步序 3 · MCP（docx-only + mermaid 显式降级）

- 只暴露 docx；pdf 需 Electron 宿主，**用户已拍板接受**，故 MCP 进程跑在 Electron 上
- **不注入 `mermaidResolver`** ⇒ 零新增代码（`convert.ts:226-230` 既有契约），且 mermaid 窗口收口的坑自动消失（`dropSession` 只在 `will-quit` / 窗口 `closed`，headless 长驻两者都没有）
- **降级必须对 agent 可见**：返回值带 `degraded: ["mermaid"]`。静默降级会造出「同样输入、偶尔产出不同」的工具
- **每次 tool call 一个新 ctx + 强制 deadline**（`mermaid-service.ts:56` 是串行 promise 链，MCP 没有「用户关窗口」这个天然出口）
- 长驻内存若在意：给 MCP 侧**单独调小**缓存上限，**不改共享常量**
- ⚠️ 降级声明会进工具描述与返回值文案，**对 agent 可见的文案事后撤销比代码贵** ⇒ 开工前先确认降级策略
- **同批把 `mcp` 登记进 `SRC_TOP_LAYERS` + 补它自己的 scope 规则**（已裁定接受「开工第一天门禁红一次」）：本轮 `SRC_TOP_LAYERS` 刻意**不含** `mcp`，判据是「一个名字进 allow-list 的前提是已有 scope 规则覆盖它」—— 登记一个无规则覆盖的名字，等于用「已治理」的假象盖住真实的洞。`src/mcp/` 落地那天门禁会先判红，逼着同批补规则。这是设计意图，不是缺陷

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