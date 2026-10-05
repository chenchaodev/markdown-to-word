# PLAN · 源码树「一职责一文件」与测试树「位置即身份」

> 单任务当前状态。**整体完成标准逐条划完才许删**。台账见 [`docs/REQ.md`](REQ.md) 的 REQ-180（源码树 · 本载体的主项）与 REQ-173（测试树 · 下游，被 REQ-180 阻塞）。

## 相关 ADR

- [`ADR-064`](adr/ADR-064-源码树一职责一文件与内部边界判据.md) · 源码树一职责一文件＋11 条内部机器判据＋六阶段方案 T0–T5 —— **本载体主项**
- [`ADR-062`](adr/ADR-062-测试树位置即身份与门禁元框架瘦身.md) · 测试树位置即身份＋L1–L12＋七阶段 P0–P7 —— **下游，被 REQ-180 阻塞**（其 L1 豁免表以 src 路径为键且是 ratchet，反序会产语义模糊的红）

## 验证基线

见 [`docs/DEV-GUIDE.md`](DEV-GUIDE.md)「验证基线」节（单一出处，本文件不复制命令）。

**本载体自定的门槛**：每阶段收尾跑一次 `npm test` 全量；阶段内改动按需筛段（`M2W_ONLY`）；**不跑 `verify:ci` 全链，除非该阶段动了门禁接入点**（T1 挂新门禁进链时才跑）。

## 目标

让一个新写的测试段能在**不读任何文档**的前提下 O(1) 定位到唯一目标文件：路径算出来而不是选出来。同时让 `src/` 的每个文件只承担一份职责、职责可从路径读出。门禁元框架从约 3.6k 行压到约 140 行，并补上真正缺失的命名与归属判据。

## 下一步
**T3 阶段收尾已完成**（全链 `verify:ci` exit 0 ＋ 台账同步）。**当前无任何子会话在跑** —— 本节即为「在跑什么」的显式声明，与 `gates/repo/check-plan-in-progress.mjs` 双向对读；该门禁在「有子步标进行中但本节没声明」时判红。

> ⚠️ 原文此处写的是「收 T0 两条泳道（fix-1 / fix-2）」—— **落后 10 个提交**，写它的时候 T0/T0.0 早已完成（`51f80bb`）。**这不是门禁能抓的形态**：`check-plan-in-progress` 只对读「进行中」标记，而陈旧的「下一步」不是标记。**它靠人读**，所以记在这里。

**接下来的顺序，以及唯一的硬依赖**：

1. **T5 的「按判据分级强制机制」先做** —— 它是 `4b-iii`（L5 转判红）唯一的解锁项。实测 `--enforce` 是 **L4/L5/L7/L8 一刀切**的开关，L4 与 L7 未就位会整体锁住它 ⇒ **不分级就永远转不了判红**。⚠️ 所以 T5 不是排在 T4 之后，而是 `4b-iii` 的**前置**。
2. **T4 豁免表 ratchet** —— L5 那张 `gates/repo/test-layout.cross-import-exemptions.json`：`--write-baseline` 生成 → 逐条补 `reason` ＋ `coveredBy` → 转判红。⚠️ 我先前口述的「T4 ＝ L1 豁免表」**说法有误**：现装判据**只有 L4–L8 五族**，ADR 里的 L1 在代码中**不存在**，T4 动的是 L5 的豁免表。
3. **T5 其余** —— 删沙盒层（前置硬门：7 个 `GATE_IDS` 逐个对账）＋ `registry.mjs` → `gate-index.mjs` ＋ DEV-GUIDE 重写。

**已押后、不在本序列内**：REQ-184（测试段批量拆分与合并专项）· REQ-181（`check:gates` 无链上位置，随 P6 一起定）· REQ-182（`samples/` 准入判据，随 P3）· REQ-183（ADR-197 对策订正，随 ADR-062 下次修订）。
## 措辞纪律（给主会话；**不由门禁强制**）

**宣布下一步时必须同句给出子会话 task id；给不出 id 就明说「待派」，不许写「现在派」。**

- **为什么是这一条**：主会话在汇报里写「现在派 T3-6」而并没有真的调用派发，本载体里 T3-6 的标记是 🔄 —— 事后回看状态与真实在跑的东西**不一致，却没有任何判据会报红**（本轮四次）。子步 7 的 `check:plan-in-progress` 堵住了其中的一半：它对读「标记 🔄 的子步」与一行人工声明；**它判不出「一句话是不是宣称了已派」** —— 那正是门禁的能力边界，这一节就是补它的那一半，只能靠人守。
- **「待派」不是缺陷，是可核对的状态**：写「待派」时那个子步就不该带 🔄 标记；两者同时出现即为矛盾，而矛盾是**看得见的**（`⏸`/`🔄` 一眼可分）。
- **声明行的确切写法**：**整行**以 `当前在跑:` 开头，行首不得有缩进或列表符号（门禁按行首锚定，行内提及不算，否则「声明数恰 0/1」那条判据失效）；全文**只许一行**，多行判 `declaration-ambiguous`。零进行中时写 `当前在跑: 无` 或把整行删掉，两种写法都恒绿
- **取数命令就是判据本体**：`node gates/repo/check-plan-in-progress.mjs`。**它不在 `verify:ci` 上**（`access: "local"`）—— 判据读的是本载体的当前瞬时状态，而有会话在跑期间 🔄 本来就常年存在，红给 CI 看没有意义；调用时机是**开工前与收尾后各跑一次**，由人判断红的原因。它的负向夹具（纯合成文本、不读本载体）**在链上**。



## T3 最后一项的批次划分（子步 8 实测后修正，**与 ADR-062:197/201 的名单不同**）

**ADR 点名的 6 个拆分对象已失效**：`dist-manifest-gate` 实测 **394 行**、`release-artifact-gate` **564 行**已不算大文件；而 `import-boundary` **1611 行**从未被点名却排第 3。**照 ADR 原文派发会拆错对象。**

| 批 | 对象 | 拆/合 | 连带面 | 关键约束 |
|---|---|---|---|---|
| **B1** ⛔不做 | `check-pointers-{e2e,ledger,refs}` | 3 合 1（**用户裁决收益不大，已撤销**） | **0 处**（三份均未被 `registry.mjs` 登记） | **跨文件 case 名零重名**（62 条去重仍 62）⇒ ADR:198 点名的「同名 case 撞车被静默覆盖」失效形态**不成立**。合并后约 1609 行，按三层留分隔注释，将来按层再切是机械操作 |
| **B2** | `import-boundary.test.js` 1611 | 拆 2 | `registry.mjs` ×1 | 10 个编号块边界干净；**本批连带面最便宜的大文件** |
| **B3** | `install-smoke.test.js` 1725 | 拆 3 | **6 处**（registry ×2 ＋ temp-cleanup ALLOWLIST ×1 ＋ node-exec ×2 ＋ packaged-smoke ×1） | helper 区 649 行要在 3 份重复，或抽非段模块（先例：`resolveNode`） |
| **B4** | `observability.test.js` 1348 | 拆 2 | **6 处** | ⚠️ `:366-372` 有跨全文件的 `process.noAsar` 快照。**2026-10-05 裁决：两段都保留，不按「整份跟块 6-10 走」删 smoke 那份** —— 拆分后块 5 会让 smoke-report 去 `existsSync(resources/app.asar)`，那正落在 asar 补丁覆盖面上；删掉它会**改变本段运行期语义**，那是「以清理为名的行为变更」。行号与理由已写进新段文件头。 |
| **B5** | `geometry-gate.test.js` 1213 | 拆 2 | 2 处 ＋ 3 处注释 | 编号块最多（15 个） |
| **B6**（可选） | `settings-controls.test.js` 1306 | 拆 2-3 | **0 处** | 零连带面但收益低；renderer 层段，拆后段数增加＝启动开销增加 |
| **B7**（高风险） | `supply-chain.test.js` 1677 | **待定** | registry ×5 | 🔴 **`run()` 是单个 `withTempDir` 闭包，全文无编号块** ⇒ ADR:197 的失效形态（漏搬一组断言仍全绿）在此**无机械抓手**。若要做**必须先补编号块**再拆，两步走 |

**出批次（附实测理由）**：

- `dist-manifest-gate`（394 行）＋ `release-artifact-gate`（564 行）—— 已不算大文件，拆了收益低于风险（两者 `ref` 各有 2 条登记要改）
- `dual-pipeline-matrix.test.js`（1515 行）—— ADR:216 已明文否决（「它守的是一张矩阵，矩阵就该在一个文件里」）；且拆它必然把 `assertMatrixShape`（14 处 `must`）复制成多份或抽成跨段模块，**两条路都违背单一来源**；且刚被 T3-6 碰过（1 行改动），此刻拆会让两份 diff 混在一份 review 里
- **`M2W_ONLY` 段名改完整相对路径 —— 移出 T3，绑定 P6**。三条实测理由：① **不改零代价**，`EXCLUSIVE_SEGMENTS = ["gate-probes"]` 是**子串包含**匹配（`runner.js:193`/`:168`），段名加 `test/` 前缀后 `.includes("gate-probes")` 仍为 `true`，**无任何现存判据因此变红**；② **收益为零**，`SEGMENT_DIRS` 全是一层且目录名互不相同，basename 无歧义；③ **现在改要重设计 811 行的 `runner-report.test.js`** —— 它的沙盒段在 `test/` 树外，完整相对路径对它无意义，工作量与拆一个大文件同级。⚠️ **ADR:201 对改后形态的描述与实测不符**（写的 `gates/probe/…` 既不含 `test/` 前缀、也不该有 `probe/` 子目录）

## 已知判据缺口（随 T3 一并记账）

- **`check:gates` 不被任何脚本调用** —— 它是独立手跑的门禁。而它正是 **R5b**（`access` 与链上位置双向一致）与 **R5c**（登记进 `PROBE_CARRIER_SCRIPTS` 的必须在链上）的**唯一执行者** ⇒ 这两条规则**只靠人记得跑才生效**。与本轮修掉的「悬空 selftest」、`check:temp-cleanup` 漏 `samples/` 同形状。**未接链是取舍不是缺陷**：接上去会让 7 个探针族（含 `test:smoke`、`test:coverage`）每次 CI 都跑
- **ADR:197 的断言基线取法对 2/9 个候选失效**：`dual-pipeline-matrix` 四类全 0 而真值是 **212 处 `must(`**（照 ADR 对账会**误判通过**）；`check-pointers-refs` 的 79% 藏在 wrapper 内。**实施侧已按逐文件实测口径对账**；ADR 本身是否要改**待用户裁决**（改 ADR 属规则文件改动）
- **ADR:197 的第二道证据（`test:coverage` 的 0% 集合）对本项保护接近于零** —— 实测该集合 5 条**全是 `src/**` 文件，没有一条是测试段** ⇒ 拆测试段不会让它产生任何变化。它能防「覆盖率整体塌陷」，防不住「某段漏搬断言」。**第一道（断言数对账）是唯一有效的那道**
- **`samples/manifest.json` 与 `gates/repo/check-samples.mjs` 均不存在**（ADR:193/118/243 描述的漂移比对属 P3 未做的产出）⇒ 拆分**不因它阻塞**

- **ADR-062:198 的「三份合并为一份」经用户裁决不做**（2026-10-04）。**理由**：合并的唯一收益是省两次 Electron 子进程启动（实测 `runner.js:406` 确实每段起一个进程），但代价是合出 1609 行 —— 正是本仓正在拆的那一类行数量级；而 ADR 点名的失效形态「同名 case 撞车被静默覆盖」经实测**零重名**（62 条去重仍 62），即合并要防的风险本就不存在。**收益小 ＋ 要防的风险不存在 ＋ 代价是更大的文件** ⇒ 不做。✅ **该冲突已消除**：用户裁决「直接改 ADR-062 那三处」，已订正 `:198`（撤销该条并写明实测理由：62 条 case 名跨文件零重名 ⇒ 点名的失效形态不成立）＋ `:197`（名单与两道证据按实测重写）＋ `:210`（理由订正为「守的是一个主体」，并标出「L1 的 `covers`」是目标态非现状）＋ 新增一条「现装状态」说明，一次性覆盖 `:202` 与完成标准 C1 的同类引用


- ⛔ **`gates/smoke/smoke-report/**` 整族链上零覆盖**（571 行）—— `check:smoke-report` 不在 `verify:ci`／`verify:release`／`dist` 任何一条链上，也不在任何 `.selftest.mjs` 里。⚠️ **这是 S0 对账表自己漏掉的**：那份表自称是 `ADR-062:246` 的前置硬门，却按 7 个 `GATE_IDS` 编号，**编号口径不含「不在 `GATE_IDS` 里的门禁族」** ⇒ 覆盖面有缺口，已另开 **REQ-186** 记账。不阻塞 P6（它不在被删的沙盒层里），但 P6 之后元框架瘦身收口时必须一并纳入。
- ⚠️ **对账表自身还有一处判据缺口（2026-10-05 实测，S4 前逐文件对账时抓到）**：它逐族核「承接者存在吗」，**但不核「承接者是否落在待删范围内」** —— 于是 `coverage` 族的承接者 `gates/probe/check-coverage-zero.selftest.mjs` 本身就在 S4 的删除清单里，而对账表仍记 `blocksP6: false`「不阻塞」。⇒ **「S4 前置硬门全清」这句话当时是不成立的**，是 S4-0 把它补成成立的。判据缺口已记在此，待补一条「承接者与门禁本体都不得落在删除范围内」的机器守卫（否则同样的洞会再开一次）。

## 拆分/合并到底有什么架构好处（**已按独立评审订正**，2026-10-04）

⚠️ **本节第一版结论错了两处，已核实后改写**（左列是我原写的，右列是实际）：

| 原写的 | 实际 |
|---|---|
| 「`ADR-062:216` 说矩阵就该在一个文件里」 | **是 `:210`**；`:216` 讲 `LAYER_RULES` 不一致，与此无关 |
| 「隔离粒度是真架构杠杆，拆分在架构上是变慢」 | `ADR-062:209`/`:211` **已量过并签字接受**（「5 段 2.9s，段本身 1.4s」「**明确接受这约 200ms/段**」）⇒ 是已决事项不是杠杆，量级是 rounding error |
| 「主题连贯性优先于行数」当反拆分原则引用 | `:210` 的落点是 **`covers` 不是行数** ⇒ ADR 早就回答了「大段怎么办」 |

**主导约束不是文件大小，是不变式，而且它的方向与拆分相反。**

- `ADR-062:64-65`：段路径 ⟺ 被测源文件路径的**机械变换**。
- `ADR-062:116` **明文删除**「同模块多段口径（文件名带主题后缀）」，理由「它直接生产了 15 个『偏窄』」。
- ⇒ **「按主题后缀切同一主体」这个形态已被判死。** B2/B4/B5 与原 B7 每一个都是这个形态。

**`:210` 的落点**：「不拆。『偏宽』不等于错 —— 它守的是一张矩阵，矩阵就该在一个文件里。**L1 的 `covers` 让它显式声明覆盖面，而不是被拆碎**」。

⇒ **正确问法不是「这些段大不大」，是「这段的主体是一个还是多个」**（主体数＝该段定义性 import 的不同主体模块数）：

| 段 | 行数 | 主体数 | 裁决 |
|---|---|---|---|
| `supply-chain` | 1677 | **4** | **最该拆** —— 4 个镜像路径全部可推导，且**唯一命中「无定位锚点的大段」** |
| `observability` | 1348 | **2**（跨层） | 做 —— 理由是**落地不变式**，不是 review 半径 |
| `geometry-gate` | 1213 | **2**（跨 `shared/` 与 `gates/` 两棵树） | 做 —— 同上，且比上一条更强 |
| `import-boundary` | 1611 | 1（**含混**） | **不做** —— 先做主体认定；拆分会固化成两个同样含混的段 |
| `install-smoke` | 1725 | ≈1（主体是装机流程） | **只去重、不拆分** |

⚠️ **「零编号块 ⇒ 不做」是我判反了**：零编号块意味着切出的两半**都没有定位锚点**，review 半径不是变大而是**无从界定**。**零编号块是最强的拆分信号，不是最弱的。**

**真风险不是漏搬断言，是拆完之后没有机器判据能回答「这个段还在守它该守的东西吗」。** 实测**现装判据只有 L4/L5/L6/L7/L8 五族**，ADR 里的 L1/L2/L3/L9–L12 **在代码中不存在**（`L5_PENDING = true`）。「段↔主体一对一」没有任何机器看守；`covers` 的声明全是单向、无反向索引。

**对 ADR-197 两道证据的订正**：第二道（`test:coverage` 的 0% 集合）**不是无效、是低分辨率** —— `test:coverage` 是 `c8 --include="dist/**"`，度量**被测产物 `dist/`** 而非测试文件，所以拆段丢断言**可以让某个 `dist/` 文件归零**；但 ADR 点名的失效形态「漏搬的那组本来就是重复断言或已被别的段覆盖」**恰好落在这道证据的盲区里**（重复的被漏 ⇒ 一个 `dist/` 文件都不会归零）。
- ~~**`check:test-layout` 在 `verify:ci` 上恒 exit 0**~~ —— **已消除（T5-a）** 实测它的 script 是 `node gates/repo/check-test-layout.mjs`，**没有任何调用点传 `--enforce`**（`package.json` 与 `.github/` 全仓零命中），而 `:901 if (!enforce)` 之后走报告档 **exit 0** ⇒ **一条链上的恒绿门禁**，正是本工作项一直在打的「判据恒绿」形态。**连带两处文案失准**：`:894` 的 ok 消息写「四族」（实际五族 ＋ 8 个机器 id）、`:865` 的 usage 写 `--enforce` 覆盖「L4 / L7 / L8」而实现（`:893`/`:901`）覆盖 problems 全体。**⇒ 我先前把 usage 文案当成了实现，这是第二次犯「文档≠实现」的错。**修法见 T5-a：删 `--enforce`，改由源码内的判据登记表分流（`docs/PLAN.md` T5-a 子步）



## T5-b 分步计划（P6 门禁元框架退役）

**依据**：`ADR-062:246`（P6 前置硬门 ＝ 7 个 `GATE_IDS` 逐个对账）＋ `:281`（回滚前先确认对账表仍在且全绿）＋ `:285`（唯一不可 `git revert` 的是删除动作）。

| 步 | 内容 | 机器可判完成判据 |
|---|---|---|
| **S0** ✅ | **只写对账表 ＋ JSON，不删任何东西** | 已完成。7 族齐、`successorState` 与磁盘一致、**`grep -rn "gate-probes"` 命中数与做之前逐字相同**（证明零删除） |
|  **S1a** ✅  |  补 `fixtures` 的**点名能力** ＋ `build-fresh` 的**整个能力**（两个新 selftest，已挂 `verify:ci`）；核实 `dual-matrix` |  两条 selftest 各自不注入时 exit 0、**四个方向的注入各红一次**（改 fixture 内容／把点名能力改成不点名／前拨 src mtime／把判定改成 `if (false)`），并钉住「注入本身失败 ⇒ 也判红」。⚠️ **判据的一处订正**：原写「诊断含预期文件名」**只对 `fixtures` 成立** —— `build-fresh` 的诊断恒为固定文案、不含文件名（实测），该格按「不假装断言」处理。`dual-matrix` 核实为**段内无注入**（负向只在探针侧，段文件头 59-65 自陈）⇒ 维持 `partial`。 |
| **S1d** ✅ | 补 `dual-matrix` 负向的**新承接点**（新建 `test/harness/dual-pipeline-key-coverage.test.js`，判「判定不是恒真断言」）＋ 让 `build-fresh` 的**诊断真的点名文件**（`collectStaleFiles` ＋ `STALE_FILE_LIST_LIMIT`，**接口变更**） | `build-fresh` selftest **13→15 条**全过；新段单跑绿（`M2W_ONLY=dual-pipeline-key-coverage`）。⚠️ **顺带修掉一处注册表说谎**：`build-fresh` 的 `judgment.shaped` 原写 `{ fresh, reason }`，实现实际返回 `string[]`。⚠️ **矩阵段 `test/core/dual-pipeline-matrix.test.js` 一行未改**。 |
| **S1b** ✅ | 补 `smoke` 的**冒烟机制自身**(⚠️ 原写「需 CI 真起一次 Electron」——**该前提已被实测推翻**,见下方裁决④订正) | 新建 `gates/smoke/smoke-proc.selftest.mjs`(403 行 / **22 条纯函数夹具 ＋ 2 条内建档**,判定本体 `smoke-proc.mjs:236-257` **一行未改**),自跑 **24/24 绿**;登记两处(`PROBE_CARRIER_SCRIPTS:96` ＋ `GATE_REGISTRY.smoke.probes[]:527-537`,缺一会被 R3 判 `probe-carrier-orphan`),挂 `verify:ci`。6 个真实变异(摘 marker 过滤 / token 匹配写松 / 点名写成笼统 / 退出码分支写反 / 吞 spawnError 族 / 吞超时族)**6/6 全被拦**。⚠️ **刻意放弃进程级/端到端档**,理由已写进头注 `:26-34`(判定本体无 CLI 可跑;`--smoke` 参数解析住在 `src/main/` 侧,与本族口径不同源)。 |
| **S1c** ✅ | **取 `sandbox.mjs` 的工作树指纹子系统单独取出，挂在已在链上的 `check:temp-cleanup`** | 新建 `gates/repo/protected-tree.mjs`(151 行)；`sandbox.mjs` **301 → 178 行**、被取符号 grep **零命中**；`check-temp-cleanup` 707 → 762 行。夹具 **14 → 16 条全绿且一条未删未失效**，新增两条为「门禁跑的过程中写坏了真实工作树(指纹判红并点名)」与「只增删 `node_modules` 顶层项(哨兵判红)」；`check-import-boundary` **退出码 0**（新增的 `protected-tree → repo-manifest` 边命中既有 `gates-stay-in-gates` 允许面，**无需裁决**）。⚠️ **规模订正**：本行原写「约 58 行」**低估** —— 真正要搬的是 `snapshotProtectedTree`(84-105) ＋ `diffProtectedTree`(113-133) ＋ **未 export 的 `collectProtectedEntries`(41-78)** ＋ `describeChangedFiles`(142-163) ＋ 随之失效的 import/常量。⚠️ **顺带修掉一处真缺陷**：`nodeModulesIntact` 原判「跑前压根没有 `node_modules`」（未装依赖的检出、临时夹具）为不完好；沙盒层只在真实仓库求值故从未暴露，挂到可注入根的门禁上会变成**每条夹具都红**的假红。改为「存在性与项数都未变」。 |
| S2 ✅ | L11（**三档缺一即红**，fail-closed）＋ L12（`chain`/`offchain` 两值 ＋ L12c 待转正声明）落地，**先在 `check-test-layout.mjs`** | `CRITERIA` **9 → 11 条**（新增 `gate-has-carrier` fail-closed ＋ `gate-chain-membership` pending），实测**恰好 2 条 pending**（`test-top-dirs-exact` ＋ `gate-chain-membership`，都带理由）。链展开与链根**全部 import 自 `chain-expand.mjs` 单源，未复制任何一份逻辑或链根表**（`CHAIN_ROOTS` 两处字面一致，`uniq -c` 得 2）。自测 **74 → 104 条**全过（+30）。门禁 exit 0，L11 实测 **档1a 16/39 ＋ 档1b 23/39 ＋ 档2 0 ＋ 档3 0**，**未加任何豁免条目压绿**。⚠️ **执行方推翻了我派发时的两条形态**（详见 ADR-062 的「S2 实测订正」节）：①「两个候选载体」不能是两个路径 —— 多道门禁共用一个验收段是既有事实，路径派生最好的一种也只覆盖 16/39，改为「存在／引用」两形态；② L12 不得逐条核对全部 `npmScripts` —— 与注册表 R5a 明文裁决冲突，只核 `npmScripts[0]`。 |
| S3 ✅ | 写 `gate-index.mjs`，**与旧 registry 并存** | 新表 `gates/repo/gate-index.mjs`(405 行 / **39 项**) ＋ `gate-index.selftest.mjs`(458 行 / 19 格)，两者与旧表**双跑对读**：id 集合**双向**差集、逐条比 `npmScripts`（含顺序，L12 取 `[0]`）／`modulePath`／`judgment.module`，每条差异点名 id ＋ 两个值。5 字段按裁决⑥落地（`npmScripts`／`access`／`modulePath`／`judgment`／`enforcement`），`title`／`command`／`judgmentNote`／`probes:`／`pendingChain:` 在新表里字面出现 **0 次**。**`enforcement` 只有 2 条**（`boundary`→`check-import-boundary.mjs#LAYER_RULES`、`test-layout`→`check-test-layout.mjs#CRITERIA`），其余 37 项**故意不给** —— 豁免表/白名单语义是豁免不是强制等级，编一个指针会让读者以为那里也有分级表。指针断言含**禁自指**（纯文本档）＋ 真 `import()` 且导出名存在（3 格负向）。**`access` 13 项逐条手改** `local`/`workflow`→`offchain`（未用批量正则）；旧表**一行未改**（R5b 三值分支依赖）⇒ 两套取值域并存是刻意的。**L12 转正**（`CRITERIA` 12 条，pending 由 3 降到 **1**，仅剩 `test-top-dirs-exact`）；转正后 L12 `problems = 0`，**未靠加豁免压绿**（迁移前后各跑一次判据核对）。**L11 补「清单有而树里无」那一族 `gate-module-present`**（单列而非并进 `gate-has-carrier`），3 格负向夹具 ＋ 变异实验（`if (indexInRoot)` → `if (false && …)` 恰 1 格失败）。selftest **74→107** 全绿。 |
| **S4-0** ✅ | ⚠️ **S4 的前置，把三处从删除范围里迁出去** —— 主会话 2026-10-05 实测发现，**S4 按原范围不可执行** | ① `coverage-zero` 与 `coverage` 两项的**门禁本体**都是 `gates/probe/gate-probes/coverage-gate.mjs`(581 行)，而 `check:coverage-zero` **在 `verify:ci` 链上** ⇒ 删 `gates/probe/` 等于删掉一道在跑的门禁；② `gate-probes` 的 `modulePath` 是 `gates/probe/gate-probes/registry.mjs`（S3 已用 `gates/repo/gate-index.mjs` 取代它）；③ ⚠️ **`coverage` 族的对账承接者本身就是待删文件** `gates/probe/check-coverage-zero.selftest.mjs`(403 行)，它同时是 `PROBE_CARRIER_SCRIPTS` 里已登记的载体。**完成判据**：迁出后 `npm run check:coverage-zero` 仍 exit 0；且用导入 `gates/repo/gate-index.mjs` 逐项判定，`gates/probe/` 下**不再有任何索引项的 `modulePath`／`judgment.module` 指向的文件**（给出实测输出）。 **S4-0 追加三处连带项**（2026-10-05 主会话逐类实测 `git ls-files` 命中时补记，派发简报漏了）：`test/gates/coverage-gate.test.js:58` 也 **import** `coverage-gate.mjs`（第三个必须改的文件）· `gates/repo/check-copy-sites.mjs:112,117` 白名单两条指向 `gates/probe/` · `gates/repo/check-temp-cleanup.mjs:291-292` 的 `gate-probes-junction-removal` 条目指向 `sandbox.mjs`。 **S4-0 停手与扩围**（2026-10-05）：执行方**正确地拒绝推进** —— 实测 `coverage-gate.mjs`(581 行) **不能整体迁**：直接 2 条沙盒 import（`contract.mjs:27` 的 `ROOT`、`gates/coverage.mjs:28` 的 `parseCoverageScript`），传递拖进 **6 个沙盒模块**；而 `contract.mjs:13` 在**顶层**执行 `topLevel(ROOT)` ⇒ import 即产生 IO。**切口（已实测干净）**：`parseCoverageScript` **沙盒外零消费者** —— 全仓仅 `coverage-gate.mjs:28` 与 `gates/coverage.mjs:93` 两处，两处都在沙盒内 ⇒ 提取它连同 `tokenizeCommand`(`proc.mjs:47`) 到 `gates/repo/` 下新载体，即可让本体的沙盒依赖归零，随后整体迁移变成纯搬运。**`coverage-baseline.json`(92 行) 必须与本体同批迁** —— 它是 `loadBaseline` 的唯一数据源，删了它 `check:coverage-zero` 与其 selftest **双双失效**；且 `selftest:251` 的期望是**硬编码路径正则**（不是派生，与 `:49` 用 `SUMMARY_RELATIVE` 派生的做法不一致）⇒ 基线一迁就假红。**`gate-probes` 那项：改指，不删项**（已裁决）。三条理由：① 删项会让 `gate-index.selftest.mjs` 的双跑对读**少一侧独立来源**，从「两份表互相证伪」退化成「一张表自我确认」，而 S4 后 `registry.mjs` 就没了 ⇒ 那时无人对读；② `check:gate-index:selftest` 这个载体**当前唯一认领者就是 `gate-probes` 那项**，删项 ⇒ R3 判 `probe-carrier-orphan`；③ 该 id 登记的判定面「索引表自身是否成立」在 S4 后仍有意义。⚠️ **新表与旧表的 `modulePath` 必须同批改**，否则旧表内联 judgment 那条例外口径（`gate-index.selftest.mjs:96-105`）判红。 **扩围后落地（2026-10-05，`verify:ci` exit 0）**：切口按上一轮结论做完 —— 抽 `parseCoverageScript` ＋ `tokenizeCommand` 到 `gates/repo/coverage-baseline-io.mjs`(161 行，导出 5 项)，使判定本体的**沙盒传递依赖 7 → 0**（主会话实测：闭包只剩 4 个模块 ＝ 本体 ＋ `shared/paths.js` ＋ 新载体 ＋ `chain-expand.mjs`）；随后整体迁移退化为纯搬运。**迁出三处**：`coverage-gate.mjs`(581→**552**) → `gates/repo/check-coverage-zero.mjs` · `coverage-baseline.json`(92) → `gates/repo/` · `check-coverage-zero.selftest.mjs`(403→**406**) → `gates/repo/`。**主会话实测四条**：① 沙盒依赖 7 → 0 ✅ ② **两张表（39 ＋ 39 项）指向 `gates/probe/` 的指针 ＝ 0** ✅ ③ `coverage-zero`／`coverage`／`gate-probes` 三个改指项**新旧表已对齐** ✅ ④ `M2W_ONLY=coverage-gate` exit 0（18 case）。⚠️ **验收项 ③ 的字面表述被修正**：原写「`gates/coverage.mjs` 与 `proc.mjs` 的沙盒 import 归零」**方向相反** —— 这两个文件**就是**沙盒探针本体（`coverage.mjs` 是 `coverage` 族的探针载体），它们**必须**保留沙盒依赖；该归零的是**判定本体**的沙盒依赖。⚠️ **另一条修正**：执行方上一轮称 `coverage-baseline.json` 不在主会话清单里是**错的**（它在，漏的是给执行方的简报文件清单）；它自己核出后已撤回该说法。**S4 现在的删除清单分三档**：**档 A 可纯删、前置已全部满足**（3 个：迁出的三处旧位）· **档 B 可纯删但 S4 须同批删指向它的登记**（`sandbox.mjs` 的 `check-copy-sites:119` 白名单 ＋ `check-temp-cleanup:292` 条目；⚠️ 后者因 `cold:true` ＋ `gates/` 不在扫描面，**文件消失也不会判红** ⇒ 已加注释防它静默变死登记）· **档 C 属 S5**（两个旧段的代码面 import ＋ 旧 `registry.mjs`）。 | |
| S4 ✅ | 删沙盒层 islands ＋ `gates/` 6 探针 ＋ `check:gates` | ⚠️ **原判据 `grep -rn "gate-probes\|check-gate-probes"` 零命中永不可达成，已改**（2026-10-05 实测：`git ls-files` 里 192 处命中，67 处是**注释**、73 处是**字符串/文件名**、30 余处是 **`docs/` 里的历史决策记录**——改它等于篡改历史，门禁自己都按前缀豁免 `docs/evidence/`）。**改后的可达成判据**（三条同时成立）：① `git ls-files` 的 `.mjs`/`.js` 里**没有任何 `import`/`require` 指向 `gates/probe/` 下的路径**；② `package.json` 无 `check:gates` script；③ `gates/repo/gate-index.mjs` 里无 `modulePath`／`judgment.module` 指向 `gates/probe/`，且 `gate-index` 与其 selftest 仍 exit 0。⚠️ **S4 的判据依赖 S5**：原判据里的 `test/gates/gate-probes.test.js`（文件名本身）与 `runner.js:81` 的 `EXCLUSIVE_SEGMENTS = ["gate-probes"]` 都由 **S5 合并/删除**处理 ⇒ **次序必须是 S5 → S4，不是本表原先写的 S4 → S5**。  **实测（2026-10-05，本工作流唯一不可逆的一步）**：`gates/probe/` 下 **14 个 git 跟踪文件、3611 行全部删除**，`git ls-files gates/probe` 零命中、目录已不存在；`package.json` 的 `check:gates` 已删；**代码面零可执行指向**（grep 模式同时含 `gates/probe/` 与相对式 `probe/gate-probes/`，并跳过注释行 —— 只用前者会漏掉相对路径 import，这是主会话实测踩过的坑）。 `gate-index.selftest.mjs` 的**双跑对读那一臂整条删除**（`auditDualRunConsistency` ＋ 7 条夹具，含内联 judgment 例外口径）—— **未冻结成字面基线**：冻结即「复述表里的状态」，且冻结那份此后无人改动 ⇒ 恒绿的假对照，比没有更坏；也**未留 report-only 的「无法对读」占位**（那同样是恒绿）。判定面换成**本表自身成立性**三条（id 唯一性含「表键 ≡ id」／`npmScripts` 形态／`judgment` 指针真解析），共 31 条夹具全绿。 ⚠️ **执行方推翻了我「`npmScripts` 非空」的字面要求并给证据**：实测 `dual-matrix` 的 `npmScripts` 是 `[]`（它不是 npm script 门禁，是验收段内的一道门禁），逐项要求非空会把既有裁决判红 ⇒ 改为「逐项形态合法 ＋ 表级至少一项带 script」并配反向锚点夹具。 ⚠️ **S4 后另删一残留项**：`gate-index.mjs` 的 `gate-probes` 项登记的唯一 script 就是被删的 `check:gates`、且 `modulePath` 自指本表、全仓无人引用该 id ⇒ 已删（索引 39 → **38 项**）。 对账表 `_schema` 加 `retired` 块：`probe` 字段是**历史记录**、不再是可解析路径；本表不再作 P6 前置硬门，只保留「md 与 JSON 不漂移」这一条自身成立性判据。 |
> **S4 删除前置实测（2026-10-05，主会话亲跑）**：`gates/probe/` 下**已跟踪 17 个文件、未跟踪 0、被忽略 0、无 `.gitignore` 命中**；两个待合并段也各自已跟踪。⇒ **删除内容完全可从 git 历史取回**，`git revert` 能整批回来。这**印证**了 `ADR-062:305` 那句「删除内容在 git 历史里可取回，但**判据的退役不可回退**」—— ⚠️ 主会话先前读到该句被 `cut` 截断的前半截，误判它「是错的」并向用户如此转述；**该句无需订正，是转述错了。**
>
> ⇒ S4 的真实风险**不是**「删了捞不回来」，而是判据退役后重建一致性要重跑 P1。所以 S4 前该做的是：① 先把当前状态提交，让删除落在一个独立 commit 上；② 逐文件列出删哪些、每条对应哪个 `GATE_IDS` 的哪格承接，**查不出承接的就不删**。
| **S5-0** ✅ | ⚠️ **S5 的前置，同时是 REQ-184 的硬前置**（2026-10-05 实测新发现）：ora-2 评审说 `supply-chain` 那 4 个主体的镜像路径「全部可推导」，但今日实测 `test/gates/supply/supply`、`test/gates/smoke`、`test/dist/main`、`test/shared/geometry`、`test/gates/geometry/geometry` **5 条一条都不存在**；而段发现非递归 ⇒ 拆出的段放进这些新目录后**永远不被发现、永不运行，而 L4/L5/L7 与豁免表全绿** | **三处同批**（只改一处会让「生成器段名集合 == runner 发现集」当场判红）：`test/harness/runner.js`（＋204 −34）＋ `gates/fixtures/gen-fixtures.mjs`（＋45 −9）＋ `test/gates/fixture-contract.test.js`（＋267 −11），另 `test/acceptance.mjs` ＋4 传 `rootDir`（**主会话追认的越界写**：`rootDir` 只能从那里传，是派发时文件清单漏了它）。**口径**：段名前缀 ＝ `path.relative(rootDir, dir)`，**缺省或目录不在 rootDir 内（含 `..`）时回落 `basename`** —— 回落是必须的（`runner-report` 的沙盒在 `output/tmp/`，强制相对路径会让段名含 `..`，而段名同时是失败产物目录名 ＋ `M2W_ONLY` 匹配面）。**自带去重**（现装原先没有，且 `runner.js:924` 的 `new Map(name→i)` 会让同名段静默互相覆盖）：去重键 ＝ 段文件的**解析后绝对路径**（按名去重会漏掉嵌套段）；诊断按 `JSON.stringify([kind,name])` 归并，分「重复发现」与「段名撞名」两类，**只告警不抛错但绝不静默**。**夹具落点改判**：派发时我要求放进 `test/harness/runner-report.test.js`，但那个文件不在可写清单内 ⇒ 改放进 `test/gates/fixture-contract.test.js` 第 7 组（它本就 `import { discoverSegments }`，合成树用 `os.tmpdir()` 的 mkdtemp，落在 `test/` 树外，比 `output/tmp/` 更严）。**完成判据全部实测**：旧实现逐字复刻 vs 新实现 **137 vs 137 逐字全等**（显式 `rootDir` 与缺省回落**两条分支都全等**）；段名唯一、多斜杠 0；`issues = []`；`grep -n gate-probes runner.js` 仍 2 处（`EXCLUSIVE_SEGMENTS` 本步不动，删它是 S5 的事）；四个文件 CRLF 与控制字符均为 0；`M2W_ONLY=fixture-contract` 与 `M2W_ONLY=runner-report` 均 exit 0。 |
| S5 ✅ | ⚠️ **S5 真实内容不是合并，是重建**（2026-10-05 逐档比对后改写，原写「合并两段 → `test/gates/repo/gate-index.test.js`」会丢掉 6 格判据） | **为什么改**：`gate-probes.test.js`(294/8 档) 的断言**全部是沙盒专用**（「全程沙盒内完成」「真实工作树指纹未变」「报告可跨机比对」）⇒ 它们断言的正是 S4 要删的东西，**没有承接者**，合并保留等于断言一件已不存在的事。`gate-registry-gate.test.js`(556/**24 档**) 里 **18 档已由 S3 的 `gate-index.selftest.mjs`(19 格，已上链、带变异实验) 承接** —— 导出不存在 ×2 · 判定模块不存在 · 实现文件不存在（已由 `gate-module-present` 覆盖）· 取值域 · 指针禁自指与真 import。**但有 6 格在 S4 之后无人看守**（这才是 S5 的实质）：① **链上新出现的门禁／裸调路径无人登记**（原 `#11`／`#12`，R1／R5a）—— ⚠️ **这就是 `REQ-181` 的实质**，我先前只注意到 R5b，把这条漏了；② **自检载体没人认领／不在链上**（原 `#22`／`#23`，R5c）—— `PROBE_CARRIER_SCRIPTS` 随 S4 一起消失；③ **探针没写理由**（原 `#24`）—— `probes[].why` 已从新表删除；④ **`load` 声明与顶层自执行事实不符**（原 `#16`／`#17`，谎报方向）—— 现有 selftest 只有「注入面缺 `load`」，**没有「谎报」方向**；⑤ **调用面非空**（原 `#2`，发现器退化成空扫描的恒绿防护）；⑥ **契约门禁判定本体在注入根上求值**（原 `#7`）。**完成判据**：① 新段建在 `test/gates/repo/gate-index.test.js` 且被 `discoverSegments` 发现（S5-0 已铺好递归）；② 上述 5 格各有**负向夹具**且真能变红；③ 两个旧段删除后 `npm test` 全绿；④ `runner.js` 的 `EXCLUSIVE_SEGMENTS` 删 `gate-probes`；⑤ **REQ-181 的判断依据随之改写为「R5b 由 L12 交付、R1/R5a/R5c 由本段交付」**。  **这 5 格在 S4 后的承载对象**（派发时须逐条对齐，别拿已消亡的字段当判据）：① 链上新出现的门禁／裸调路径无人登记 ⇒ 两侧都在（`package.json` 的 scripts ＋ `gate-index.mjs` 的 `npmScripts`）；② 自检载体没人认领／不在链上 ⇒ **判据形状要改**（新表**没有 `probes[]`**，等价物是「磁盘上每个 `gates/**/*.selftest.mjs` 都被某门禁的 `npmScripts` 覆盖，且那条 script 真在三条链之一上」）；③ ~~探针没写理由（原 `#24`）~~ —— **不是缺口而是已消亡**（`probes[].why` 已随新表删除 ⇒ 没有对象可查，故实为 5 格）；④ `load` 声明谎报 ⇒ 新表仍有 `judgment.module`／`judgment.export`，谎报方向仍可判；**反方向在新表里没有表达位**（5 字段无 `load`）⇒ 那一条也是已消亡；⑤ 调用面非空（发现器退化成空扫描的恒绿防护）⇒ 仍成立；⑥ 契约门禁判定本体在注入根上求值 ⇒ 仍成立（`gates/repo/check-ci-contract.mjs` 不在删除范围）。 ⚠️ **S4 后 `registry.mjs` 消失 ⇒ 双跑对读少一侧**，`gate-index.selftest.mjs` 的 `auditDualRunConsistency` 退化为单侧自检 ⇒ **本段是 `gate-index.mjs` 唯一的独立对读来源**，这也是 S5 不能省的原因。 **实测（2026-10-05）**：新段 `test/gates/repo/gate-index.test.js`（**884 行 / 24 case**）建成并 24/24 绿，**段名是 `gates/repo/gate-index.test.js`**（`rootDir` 传的是 `test/` ⇒ 前缀为 `gates` 而非 `basename` 的 `repo`，比派发时写的更完整，正是「位置即身份」要的形态）；两个旧段已删；`runner.js` 的 `EXCLUSIVE_SEGMENTS` 清空（**零命中**）。 **5 格逐格有变异实验自证**：变异 ＝ 把该格判定首行改成 `if (true) return []`（恒绿），每格只红自己那 3-4 条、互不串扰。⚠️ **执行方自己纠正了一个方法论错误**：首次变异写成 `if (false) return` —— 那是**空操作不是变异**，导致格①②③「变异后仍全绿」的假阴性；改正后结论才成立。 **`discoverInvocations` 未 import 旧 registry**（它在 `:1015`，不是派发时写的 `:951`），改为段内独立实现 ＋ 载体 script 表从磁盘派生 ⇒ **新段在 S4 后不断链**。 ⚠️ **连带修掉一处既有缺陷**：`test/gates/fixture-contract.test.js:187-193` 原本用 `basename` 把二级段拍平、`:191` 又只比一级 —— 那在零个二级目录时恒等，本段是**本仓第一个二级段**，前提失效即判红；已按该断言注释原文的本意（「生成器在一级+二级都发现得到」）把两侧对齐为「相对扫描目录的 POSIX 路径 ＋ 都含二级」。 |
| S6 ✅ | DEV-GUIDE 接入点表同步 | `grep -n "check:gates" docs/DEV-GUIDE.md` 零命中  **实测（2026-10-05）**：S6 判据 `grep -n "check:gates" docs/DEV-GUIDE.md` **零命中** —— 该行在 S5 与 S4 的载体同步中已撤（`check:gates` 及其门禁已不存在）；`:47` 那句「所以住在 `gates/probe/` 的某一步」的悬空指向已改为「所以判据不按目录归属」。余下命中经逐条核对均为真实存在的对象（`observability.test.js`／`check:install-smoke`／全局配置目录 `tools/AGENTS.md` 的负探针清单）。 |

**S4 是唯一的不可逆点**，被夹在两个可回退步之间（S3 纯新增、S5/S6 可独立回退）⇒ **S1 那三项缺口必须在 S4 之前全部补齐**。

### 裁决（2026-10-04；①–④ 已落进 ADR-062，⑤⑥ 待落）

| # | 裁决 | 依据 |
|---|---|---|
| ① | **取 `sandbox.mjs` 的 `snapshotProtectedTree`/`diffProtectedTree`（约 58 行）** 挂 `check:temp-cleanup` | L11a/L11b 顶替不了「门禁在跑的过程中写坏了真实工作树」那一格；取 58 行符合 `ADR-062:144` 原裁决「保住这一个判据，不保留 301 行的通用沙盒」 |
| ② | **L11 定义改三档缺一即红** | 实测按字面执行会**当场判红 29 项**（有载体 13／无载体 29，其中 9 项就在 `verify:ci` 上） |
| ③ | **同意 P6 的两段合并**（848 行） | 与 `ADR-062:202` 撤掉的那三份（1609 行）**不是同一批**；且这是 **1 主体合 1 段**（不变式要的形态），`:202` 撤的是 **3 主体合 1 段**＝制造偏宽 |
| ④ | **`smoke` 的机制自测要补**（CI 多起一次 Electron） | 它是三个 ⛔ 阻塞项里唯一「不补就不能开始删除」的；P6 一旦开始删除就不可逆，那时沙盒层已没了、再想补依赖的正是它 |

> ⚠️ **裁决 ④ 的前提已被实测推翻（2026-10-05）**：原写「CI 多起一次 Electron」，那是**主会话转述方案评审的未核实断言**。实测切入点定为 `gates/smoke/smoke-proc.mjs#collectSmokeProblems`（`:236-259`，**已 export 的纯函数**，入参 `{code,signal,timedOut,output,spawnError}` → `string[]`）⇒ **纯函数夹具零 Electron 增量**，比原预算更省。裁决本身（「机制自测要补」）**不变且仍成立**；变的只是代价估计。**留档防后人重犯**：这是本会话第三次「转述而未核实」被推翻（前两次：`ADR-062:216` 误引 · 「`build-fresh` 诊断含具体文件名」是假的）。

> ⚠️ **裁决 ④ 的前提已被实测推翻（2026-10-05）**：原写「CI 多起一次 Electron」，那是**主会话转述方案评审的未核实断言**。实测切入点定为 `gates/smoke/smoke-proc.mjs#collectSmokeProblems`（`:236-259`，**已 export 的纯函数**，入参 `{code,signal,timedOut,output,spawnError}` → `string[]`）⇒ **纯函数夹具零 Electron 增量**，比原预算更省。裁决本身（「机制自测要补」）**不变且仍成立**；变的只是代价估计。**留档防后人重犯**：这是本会话第三次「转述而未核实」被推翻（前两次：`ADR-062:216` 误引 · 「`build-fresh` 诊断含具体文件名」是假的）。
| ⑤ | **S5 改 `discoverSegments` 为递归**，段名前缀改相对 `test/` 的路径 | ⚠️ **原 S5 目标路径 `test/gates/repo/` 站不住**：`discoverSegments`（`test/harness/runner.js:181-196`）是 `readdir` **非递归**，而全仓 `test/` 下**零个二级目录** ⇒ 段永远不被发现、永远不跑，**且 L4/L5/L7 与豁免表全都看不见这个矛盾**（那几处的扫描面是递归的）⇒ 静默失效。选「段留一级」则违 ADR-062「位置即身份」的立论；选 `SEGMENT_DIRS` 增 `gates/repo` 则段名前缀只剩 basename（`repo/gate-index.test.js`），丢掉 `gates` 那层身份。 |
| ⑥ | **S3 的注册表留 5 字段**，`modulePath` 与 `judgment.module` 不合一 | 实测两者语义不同：`docs` 那条 `modulePath` 指 `check-docs.mjs`（本体）而 `judgment.module` 指 `check-pointers.mjs`（判定体），注册表注释明写「指针必须指本体而不是转发层」⇒ 压成一个字段会让转发层门禁的指针语义被压缩。ADR-062 那句「≈140 行 / 4 字段」需同步订正。 |

### ⚠️ 本表会让门禁把它的行当子步行（栽了两次，记下来）

给 `PLAN.md` **加一张带状态列的表**，它的每一行都会被 `check-plan-in-progress` 解析成子步行
（首格剥出 id 后补最近含 `T<数字>` 的小节标题前缀）。今天栽了两次：先是 B1–B7 批次表、再是本表。
⇒ **两个后果**：① 表里任何 🔄 都要进「当前在跑」声明行（本表的 `T5-b-S1a` 与 T5 阶段行的 `T` 都得声明）；
② **只想给人看的进度就别在表里放 🔄** —— 用文字「进行中」，否则你会莫名多出两个要维护的 id。

### 已改掉的两处「我原本会照搬」的东西

- 评审的 S0 完成判据「每行 successor 指向的文件存在」**内部矛盾**（S1 才是创建它们的步骤）⇒ 改成 `exists`/`to-create` 两态，落盘时扩成三态。
- 我第一版把 `smoke` 标成 `exists`（理由「承接文件存在」）——**那等于把缺口藏起来** ⇒ 改 `partial`，教训写进 `_schema.note`。

当前在跑: T5

## REQ-184 的五项（测试段拆分/合并专项 · 判据已由独立评审从「行数」改成「主体数」）

> ⚠️ **原「6 拆 3 合」批次（B1–B7）的前提已被独立评审推翻**：按行数拆 = 1 个偏宽段换 3 个偏宽段，**离目标态更远**；合并方向同样撞 `ADR-062:116`（同模块多段口径已被明文删除）。⇒ 正确问法不是「这些段大不大」，是「这几段的**主体是不是一个**」。评审原文逐字落盘在 [`docs/evidence/20261004-205551-测试段拆分合并的架构结论独立评审.md`](evidence/20261004-205551-测试段拆分合并的架构结论独立评审.md)（用户裁决本号按该结论操作）。
>
> 今日实测复核（评审是 10-04 的，段数与文件位置已变）：主体数 4／3／3 **全部成立**；`geometry-gate` 实为**跨两棵树 3 主体**（比评审所述更强）；`observability` 实为 **3 主体**（评审漏数了 `gates/smoke/smoke-report`）；`import-boundary` 的「主体含混」成立；「canonical `test/harness/node-exec.js` 已被正确 import」成立（7 个文件，含 `install-smoke`），且该段仍有 **20 个本地顶层 function** ⇒ 去重确实未做。

| 项 | 段 | 动作 | 机器可判完成判据 |
|---|---|---|---|
| **R1** ✅ | **拆 5 个门禁主体**（原写「拆 4 个」被实测推翻） ⚠️ **原写「拆 4 个主体」错**（2026-10-05 执行方实测推翻）：主体是 **6 个 supply 模块**（`check-supply-chain`:26 · `gen-sbom`:27 · `gen-licenses`:28 · `collect-license-fulltext`:29 · `sca-audit`:38 · `supply-common`:60），评审只数了 `:26-29` 的**连续首块**、漏了后两个 —— 而 `sca-audit` 776 行、`supply-common` **1175 行 / 55 个 export**，承载的段内代码比评审点名的两个还多。评审原文是历史证据不改，订正记在此。**形态：5 段**（`test/gates/supply/supply/` 下 5 个 `<模块>.test.js`，原段删除）⇒ 段数 **136 − 1 + 5 = 140**。**「主体」定义（本步的判定基准）＝ 索引门禁的 `modulePath` 模块**；段可 import **自己的门禁主体 ＋ 同层共享库**，**不得 import 另一个门禁的主体**。在此定义下，原先看着互斥的两条守卫（「每段只守自己那个主体」与「覆盖不许减少」）**同时成立** —— 互斥是我把「主体」说得含糊（未排除共享库）造成的。**`supply-common.mjs` 不独立成段**（裁决）：它在 `gate-index.mjs` 里 **0 命中**、无 npm script ⇒ 不是门禁、L11 对它无载体义务；给它成段需**新写**针对它自身行为的断言（本步是纯搬＋import 改写），空段＝恒绿。**7 条跨主体 case 整条留在所测门禁那段**（不拆 case 体）：#10–#12 → `gen-licenses` · #14–#15 → `collect-license-fulltext` · #20 → `sca-audit` · #21 → `gen-sbom`。**它们全部只跨库、不跨两个门禁** —— 这正是上述定义消解冲突的原因。**`sca-audit` 段只含 #20 一条 case ＝ 诚实的薄段**；而它是 L11 要求的载体（新段名与主体同名且段体 import 它 ⇒ 字面量出现在段里），此前它是 `supply-chain.test.js` 的唯一载体，删掉原段不补它会判红。⚠️ **记一笔有账的风险**：`supply-common.mjs` 有 1175 行 / 55 个 export，却**没有任何一条 case 直接断言它自身** —— 触及它的 12 条全是「穿过它测门禁行为」。L1（镜像完整性）落地时它需要自己的段或在豁免表登记，届时不得默认它已被覆盖。 | 5 条镜像路径下各有段且**每段只 import 自己的门禁主体**（共享库除外）＋ 逐段 import 清单 ＋ **拆分前后覆盖对账**（原段 case 数 vs 五段合计，**合计少于原段即停**）＋ L11 用 `judgeL11Carrier` 对新形态判红 0；L4 全绿、L5 零跨层；段数 140  **实测（2026-10-05）**：段数 **136 → 140**，5 段各住 `test/gates/supply/supply/<模块>.test.js`（**完整相对路径**，非 basename），原段已删，`discoverSegmentsDetailed.issues = []`。**覆盖守恒（主会话独立复核）**：26 case / 285 断言，原段 ＝ 五段合计，**丢失 0 / 新增 0 / 跨段重名 0 / 断言差 0**。执行方自报 24/295 —— 两套计数口径不同，但**两边差值都是 0**。⚠️ 主会话第一遍复核得「+4 差异」并判为覆盖未守恒，**成因是自己的正则**把每段 `function assert(cond, msg) {` 的**定义行**算成一次断言（原段 1 处、五段 5 处，差正好 +4）；排除定义行后归零。**教训：计断言类数值的探针必须排除声明处**，否则会把「函数定义搬了几份」误读成「断言多了几行」。**执行方自查中自己犯过两处错并修掉**（都是靠逐 case 断言体指纹对读抓出的，那一步是这次最有价值的自证）：① 初版把 case #15 的 **5 条真实断言偷换成一句「夹具前提」弱断言** —— 正是派发里禁止的丢覆盖；② 初版把 `...test(item) === false`（在 `some` 回调内）改写成在 `some` 外 —— **语义不同**，虽更符合断言意图，但「不顺手重构断言」优先，已还原原句。**L11 追加验收达成**：动笔前用门禁本体导出的 `judgeL11Carrier` 模拟 5 段形态 → 判红 0（对照 4 段形态判红 1）；动完后真实形态 → `L11 有载体 38 / 无载体判红 0`。**不是想当然。**⚠️ **未获授权的取舍（主会话复核后判为可接受、但留账）**：行数 **1677 → 2178（+501）**，全部来自助手函数跨段复制（L4 禁止段 import 段）。实测 `assert` 的本地定义是**仓里压倒性的既有惯例**（**77 段本地定义 vs 仅 2 段**走 `harness/assert.js`）⇒ 这部分符合惯例；但 `withTempDir`／`makeLockfile`／`runCli` 是 **1 份 → 5 份**。**长期正解是归到 `test/harness/`**（`runCli` 的现成归属是 `test/harness/node-exec.js`、`withTempDir` 是 `temp-resource.js`），但那是**动共享文件、影响数十段的更宽改动**，不在 R1「纯搬＋import 改写」范围内 ⇒ **须另开号登记，不在本步做**。⚠️ **红线报备**：执行方删原段时用了 **`git rm`（已暂存删除）**，触及「子代理不执行任何 git 写操作」—— commit 已由主会话做。 |
| **R2** ✅ | `test/gates/smoke/smoke-report.test.js`(444) ＋ `test/gates/artifacts/pack-size.test.js`(1048) | **拆 2 个主体**（`smoke-report`／`pack-size`） ⚠️ **原写「拆 3 个主体」全错**（2026-10-05 实测推翻） | ✅ 2026-10-05 落地，段数 **142→143**。**第三主体 `smoke` 没有自己的段**：`IMPLEMENTED_SMOKE_MARKER` 只出现在**一处**断言（`:537-540`，在 smoke-report 的块 3 内），`SMOKE_MARKERS`／`collectSmokeProblems` 是夹具构造器；`ADR-062:218` 亦独立记载「observability **2**（跨层）」⇒ **数量对不等于前提对**。**阻塞不是「形态不可行」而是 L5 豁免表按段路径锁着** `dist/main/smoke.js`；用户授权后只改那一条**路径键**（未删 import、未改 `reason` 71 码点、`entries` 仍 26 条未新增表项），并自证「改回旧键 ⇒ 恰好 2 条红回来」。**断言零丢失**：主会话用同一 stripper 从 git HEAD 取原段比对 **184 → 188**，差 **+4**，算术完全对上（共用 helper 函数体被复制成两份，helper **调用点**仍 4、差 0）。`gate-index.mjs` **一字未改**（L11 档 1b 从磁盘派生载体，载体随段自动迁移，实测「有载体 39→39」）。 |
| **R3** ✅ | `test/shared/geometry-gate.test.js`(1214) | **拆 3 个主体**，跨 `shared/` 与 `gates/` 两棵树 | 同上 ⚠️ **2026-10-05 实测**：只有 `shared/geometry/geometry-core.mjs`（964 行）是索引门禁主体；另两个**非索引**模块须先分类 —— `shared/geometry/geometry-page.mjs`（**299 行 / 6 export**）与 `gates/geometry/geometry/driver.mjs`（**389 行 / 21 export**）。分类口径照 R1 的先例：**索引 0 命中 ＋ 无 npm script ⇒ 很可能是库**（`supply-common` 即如此），但**规模不小、不能凭「不是门禁」就断言它是库** ⇒ 须看它有没有独立可断言的行为，有则独立成段、无则作共享库并在载体留账。另注：`driver.mjs` 在 `gates/` 树而本段在 `test/shared/` ⇒ 若它成段，段要落到 `test/gates/geometry/geometry/driver.test.js`（跨顶层目录，S5-0 的递归化已支持）。  **⚠️ 已裁决撤销，不做**（2026-10-05 派发前自查推翻原形态）：原判据「拆 3 个主体，跨 `shared/` 与 `gates/` 两棵树」是**按实现位置**说的，不是按主体。实测：门禁 `geometry` 的 `modulePath` ＝ `gates/geometry/check-geometry.mjs`、`judgment.module` ＝ `shared/geometry/geometry-core.mjs` ⇒ **主体只有一个，就是该门禁本身**（段确实直接断言它的判定本体：`:44-46` import `judgeCssTokens`／`runGeometryGate`，`:434`／`:490` 调用）。`shared/geometry/geometry-page.mjs`（**299 行 / 6 export**，全是**注入脚本构造/解析器**：`buildMeasureScript`／`parseMeasureScript`／`buildViewportSettledScript`／`buildFreezeAnimationScript`／`buildCssTokenScript`／`parseCssTokenScript`）**不是主体**。`gates/geometry/geometry/driver.mjs`（**389 行 / 21 export**，全是**路径/配置常量 ＋ 存活检查**：`entryScriptPath`／`preload`／`ROOT_ARGUMENT`／`LIVENESS_PATHS`／`checkPathLiveness`）**不是主体**。⇒ 按「哪个树的模块」切就是**按实现位置切**，正是 R1 里被否决的那类错误，且更糟（库更大、段会更薄）；给两个库各自独立成段会产出无判定含量的薄段。**裁决：撤销。**⚠️ **结论的限制**：逐 case 断言目标分类器在该段**返回 0 条**（它的 case 声明形态与我的 grep 不同），故上述结论依据是**模块级证据**（索引归属／npm script／导出物性质），**不是**逐 case 断言目标 —— 若日后要更硬的依据，须先读清该段的 case 声明形态。⚠️ **附带测到一条 L4 缺口（本轮未处置）**：该段住在 `test/shared/` 却 import `gates/geometry/geometry/driver.mjs`，而 L11/L12 之外的 **L4 两档（「零本层主体」／「段 import 段」）都不覆盖「段 import 别的层的门禁模块」** —— 它因 import 了同层的 `geometry-core` 而过「零本层主体」。另记：该段的层与它的主体的 `modulePath` 层（`gates/`）不一致。**登记为待补判据，本步不动。** |
| **R4** ✅ | `test/gates/install-smoke.test.js`(1730) | **只去重、不拆**：20 个本地顶层 function 里的进程/沙盒族归到已有的 canonical `test/harness/node-exec.js` | 该段顶层 function 数下降且 `node-exec` 的 import 数上升；**段数不变**；连带按 L8 补 1:1 selftest  **⚠️ 已裁决撤销，不做**（2026-10-05）：20 个本地顶层 function 里**真重复数 = 0** —— 没有一个能与已有共享助手归位而不改语义。执行方全程**零改动**（三个可写文件逐字节未动）。⚠️ **派发前提被推翻**：评审说的「canonical `test/harness/node-exec.js` 已存在且被正确 import ⇒ 有单源可归」**不成立** —— 实测本段**零 import** 它（`grep -E '^import .*node-exec'` 命中 **0**），全文唯一提及在 `:47` 的**注释**里，该注释明写「node 可执行文件解析**刻意不收口**到 `node-exec.js`」。真 import 它的是 **6 个**文件，**不含本段**。⚠️ **主会话的错**：早先那句「被 7 个文件 import（含 install-smoke）」来自 `grep -rln "node-exec" test/` —— **子串匹配把注释当成了 import**。今天在这上面已栽三次（另两次：README 列是否指错路径、段内夹具源码里的 import）。**唯一与共享助手同名的 `resolveNode` 恰好就是语义不同的那个**：`node-exec.js:28-34` 有独立小节「**一处刻意的差异（不要顺手抹平）**」，逐字写明本段候选链多 `process.env.NODE`（它要尊重显式 `NODE=` 覆盖），「抹平会改动 `install-smoke` 的实际行为，属另一个段的语义」；本段 `:47-49` 对称记着同一裁决 ⇒ 合并它 = 抹掉一处**三面记录在案**的刻意决策。**`removeSandbox` 与 `removeTree` 形似而语义不同**：本段版有「`fs.rmSync` 失败 ⇒ 退纯 node 子进程再删」的 Electron asar 兜底（`temp-resource.js` 头注明确写它**不做**该兜底，「只对含 `.asar` 的沙盒有意义」），且收尾用 `assert` 而非返回 outcome ⇒ 合并会丢兜底 ⇒ asar 沙盒删不掉。**净收益最大的一处是 `withCapturedOutput`(`:487`)** —— 另 4 个 gates 段行内复制了同一段捕获逻辑，但**都是行内代码、没提成函数** ⇒ 收口它需**新建助手 ＋ 同批补 1:1 selftest 段** ⇒ **段数 140 → 141**，与「段数不变」直接冲突 ⇒ **须单独立项并显式接受段数变化**，不在本步做。`assert` 按派发指示未归位，且实测方向一致（本地定义是压倒性惯例）。 |
| **R5** ✅ | `test/gates/import-boundary.test.js`(1612) | **不做拆分** —— 段 import `gates/artifacts/check-asar-manifest.mjs` 而注册表 `modulePath` 记 `gates/repo/check-import-boundary.mjs` ⇒ 主体含混，拆会把 1 个含混固化成 2 个含混 | 先做**主体认定**（两处对齐）；那是 R1–R3 同一件事的前置  **⚠️ 已裁决撤销，不做拆分**（2026-10-05 派发前自查推翻前提）。**ora-2 的「主体含混」不成立**：段 import 的 `gates/artifacts/check-asar-manifest.mjs` 与注册表 `modulePath` 记的 `gates/repo/check-import-boundary.mjs` 是**两个各自登记正确的独立索引门禁** —— 前者是 id `asar`（`npmScripts: ["check:asar"]`），后者是 id `boundary`（1992 行 / 37 export）。注册表**没记错**；ora-2 是只看了段的 import 列表、假定注册表只知一个主体。实测段的真 import 只有四处：`harness/paths.js`(ROOT) · `harness/temp-resource.js`(removeTree) · **21 个符号** from `check-import-boundary.mjs` · **恰好 1 个符号 `REQUIRED_ENTRIES`** from `check-asar-manifest.mjs`。段自己的头注 `:3-5` 明写「被测为 `gates/repo/check-import-boundary.mjs` 的判定逻辑 ＋ 真实仓库的声明/产物事实」⇒ **主体唯一**，那个 asar import 是**拿一个常量当夹具数据**、不是测 asar。⇒ **撤销拆分**。残余是一条 **1 符号的跨门禁数据借用**（拿 asar 的 `REQUIRED_ENTRIES` 作依赖审计的判据来源）—— 是耦合、不是第二个主体；判为可接受但**如实留账**。⚠️ **主会话探针翻车留档**：第一版探针把段内**夹具源码字符串**里的 `import { … } from "…"` 也当成真 import（这段本来就是解析 import 语句做边界检查的），产出 71 个 import 块与 `${spec}`、`../../test/common/thing.js` 这类明显是夹具内容的说明符 —— **据此下的任何结论都作废**。第二次只取顶部真 import 区才拿到上表。**教训：解析 import 的探针必须先剥离字符串/模板串，否则会把被测文本当成代码。** |

> ⚠️ **R1–R3 全部以 S5-0（段发现递归化）落地为前置** —— 见 S5-0 行那条实测：三者的新镜像目录今日一条都不存在，而非递归的段发现会让拆出的段**永不运行且门禁全绿**。
> **D1（主体判据）的成本实测 —— 2026-10-05**：137 段里**只有 40 段声明 `export const covers`**（评审记 39，多的 1 个是 S1d 新建那段），**97 段未声明**：`core` 43／`main` 24／`gates` 16／`convert` 6／`renderer` 3／`cli` 2／`shared` 2／`mcp` 1。已有 125 个元素、去重 69，其中 60 个指向 `src`/`dist`、9 个指向仓内树。
>
> ⚠️ **D1 的设计必须容纳「刻意不写 covers」，不能只做「必须声明」** —— `test/harness/dual-pipeline-decision-ledger.test.js:72` 明写「本段**刻意不写** `export const covers`」，理由之一是「零主体、声明 core 即撒谎」。**逼着人写不实声明，比不写更坏**（与 `REQ-185` 的 `coveredBy` 同一判断）。⇒ D1 若要落地，得先有第三态（声明／显式豁免＋理由），否则 97 段里会有一批靠撒谎过关。

### REQ-184 未闭合缺口：「这段该拆成几段」没有机器判据 —— 处置为**流程约定，不建门禁**

> ⚠️ **缺口的准确形态**：判据只能验「`covers` 声明的元素存在」，**验不了它是否真被断言**；
> import 图能验的只是「它访问了谁」，**不等于「它断言了谁」** ⇒ 两者对读也拼不出主体数
> （`covers` 是**被测主体清单、不是 import 清单** —— 那正是 L4 声明通道的存在理由；实测两方向
> 分别误伤 88 项/26 段 与 15 项，且同族换个口径结果差 6.6 倍 ⇒ 该族判据已否决，语义写进
> `gates/repo/check-test-layout.mjs` 文件头并点名「不要提议」，见 `docs/REQ.md` REQ-189）。
>
> **为什么不做成门禁**：门禁版需要「拆分前抓基线」这个**必须人工配合**的步骤，
> **忘了跑基线 ⇒ 基线不存在 ⇒ 无从对读 ⇒ 恒绿** —— 用一个新恒绿去堵一个旧缺口，方向是反的
>（本仓已明写要消灭的那一类：空豁免表恒绿、零覆盖恒绿、`instrument-bypass` 恒绿）。
>
> **选定流程（每次拆分时人工跑一遍，不进门禁）**：
>
> 1. **拆分前**抓原段的 `covers` 并落进提交信息（无 `covers` 的段就如实记「该段无 `covers`，
>    本次无法用声明对读」，**不假装能验**）；
> 2. **拆分后**逐段抓新段的 `covers`，机械对读**并集是否相等**；
> 3. 差异必须由命令**报出来**（丢了哪个元素 / 凭空多出哪个元素），**不许靠肉眼比对**；
> 4. ①②③ 的**可复算原文**贴进提交信息，不是摘要。
>
> **它防得住**：拆分时漏掉某个 `covers` 元素（真丢覆盖）、凭空多出元素（假覆盖）。
>
> **它防不住三件（必须一起说清）**：① **主体数本身对不对** —— 并集相等不等于集合正确，
> R2 那天「三个主体」被实测推翻正是这一类；② 原段本就无 `covers` 的段无从对读；
> ③ 不遵守流程的人 —— 纯靠人守。
>
> **强度与升级触发**：本流程**弱于门禁**（门禁每次跑，本流程只在有人守时有效），
> 换来的是**不引入新的恒绿**、零长期维护。⇒ **真的发生过一次「拆分丢了 `covers` 元素」
> 那天，再把它升级成门禁** —— 那时基线机制的成本才值得。
>
## REQ-187 的三条判据（用户 2026-10-05 逐条裁决，**全部要求机器看守，不接受只有散文**）

> ⚠️ **执行次序**：`R2`（REQ-184 的 `observability` 拆三段）**必须等 C1 与 C3 落地** —— 它的完成判据要跑 `check-test-layout.mjs`，与判据泳道并行会读到中间态的真阳性。**C2 与 C1/C3 可并行**（不同文件）。

| 项 | 内容 | 机器可判完成判据 |
|---|---|---|
| **C1** ✅ | **TS 段口径**：定「段路径镜像 `src/**`、import 侧指向 `dist/**` 同名产物」，并加机器判据锁住这个配对 | 判据两档：① 段住在 `test/<X>/**` 而其被测 import 落在 `dist/**` 时，该段镜像的 `src/<X>/**` 源文件**必须真实存在**；② 镜像 `src/**` 的段，其被测 import **必须**落在同名编译产物上。零判红 ＋ 每档有能变红的负向夹具  **✅ 2026-10-05 落地**：判据 `test-dist-artifact-source-mirror`（产物侧，真实仓覆盖 **170 处**被测 import）＋ `test-segment-mirror-same-name`（段侧）。口径 = **被测 import ＝ 解析后落在 `dist/**` 的值引用**，排除五类各有依据（裸包名/`node:`/第三方包**天然 `resolved === null`，是排除事实不是排除代码** · `test/harness/**`（140 段对它 289 处引用，算进分母会让判据退化成「谁引用助手最多」）· 其它段（L4 已判红）· type-only（73 处 `src/**` ＋ 1 处 `dist/**`，算进分母就变成「类型标注写对没有」）· `src/**` 值引用（实测恒为 0 —— tsc 不产 `.d.ts`，类型只能指 `src/`、值只能指 `dist/`））。⚠️ **档二分母在真实仓只有 4 段** —— 这是「段路径镜像 `src/**`」不变式**当前的实际达成度**（103 个 src 层段里只有 4 段逐段对得上真实源），不是判据写窄；拿 103 当分母会把 99 段判红，而那 99 段的处置是改段名、属改名纪律。**该族是随命名收敛而增大的棘轮，不是广覆盖的网。** |
| **C2** ✅ | **索引路径守卫**：任一索引项的 `modulePath`／`judgment.module` **必须是 git 跟踪的源文件** | 一条同时抓住两个洞 —— 落在待删范围内（今天的 `coverage` 承接者）与指向构建产物（`dist/main/smoke.js`）。落点 `gates/repo/gate-index.selftest.mjs`（该载体已是索引自身成立性的单源），并须有**能变红**的合成表夹具  **✅ 2026-10-05 落地**（随 `4f8936b`）：判据 `auditSourceFilePointers` 在 `gates/repo/gate-index.selftest.mjs`，载体 31 → **41 条**夹具。口径只用「是不是 git 跟踪路径」一个问句，**不叠**「必须是 `.mjs`」「必须在 `gates/` 下」—— 既有事实是 `smoke.modulePath` 指 `src/main/smoke.ts`、`dual-matrix` 指 `test/core/*.test.js`，叠白名单会误伤（已用反向锚点夹具钉住）。用 `git ls-files -z` 读**索引**而非工作树 ⇒ 天然离线、`dist/` 永远不在跟踪集里 ⇒ **结果可复现**（不用 `existsSync` 的理由：它随本机 build 状态翻转）。**离线/异常一律 fail closed 判红**，不降级 report-only（理由与该载体头「删掉后不许留 report-only 的『无法对读』占位」同源）。真实索引 **76 条指针（38 项 × 2 字段）全部跟踪、判红 0**；**未改索引**。 |
| **C3** ✅ | **L4 第三档**：段 import **别的层**的门禁主体 ⇒ 判红，除非豁免表登记并给理由 | 实测现存一处会判红：`test/shared/geometry-gate.test.js` 住 `test/shared/` 却 import `gates/geometry/geometry/driver.mjs`，靠 import 了同层的 `geometry-core` 蒙混过「零本层主体」。**该处要么改段位置、要么登记豁免，二选一须在汇报里说明**  **✅ 2026-10-05 落地**（随 `5a0639a`）：判据 `test-layer-gate-subject` —— `layerSet` 段且层名 ≠ `gates` ⇒ 其值引用落在 `gates/**` 时判红，除非按 `(段, 说明符)` 登记且 `reason` ≥ 20 码点；stale 检测（ratchet）一并有。⚠️ **`test/gates/**` 的段 import 门禁树刻意不参与**（那是 L11 档 1b 的载体形态）—— 实测不加这个作用域排除时真实仓判红 **31 项**、全部是门禁段在测门禁 ⇒ 该作用域差是踩出来并钉进夹具的。**现存一处处置 ＝ 登记豁免、不迁段**（理由三条见 `docs/REQ.md` REQ-187 与提交 `5a0639a`；`docs/PLAN.md` 的 R3 已裁决撤销对该段的拆分，搬段等于推翻那条裁决）。 |

> ⚠️ **三条都不是「补散文」**：C1／C3 改 `gates/repo/check-test-layout.mjs`（同属一条泳道，同一文件），C2 改 `gates/repo/gate-index.selftest.mjs`（另一条泳道，**可并行**）。
> **C1/C2/C3 三条的主会话独立验证**（真变异，非空操作）：C3 未登记短路 ⇒ selftest exit 1、恰 **2/125** 失败；C1 档一恒通过 ⇒ exit 1、恰 **1/125** 失败；两次还原后全绿。C8（REQ-177）另两次：唯一性短路 ⇒ 恰红「两份 ADR-062 判红并点名」，位数短路 ⇒ 恰红两位数形态夹具。C2 的真实索引 76 条指针判红 0。
>
> ✅ **第①笔已闭合（2026-10-05）**：C3 的 `GATE_SUBJECT_EXEMPTIONS` 已搬成数据文件 `gates/repo/test-layout.gate-subject-exemptions.json` C3 的 `GATE_SUBJECT_EXEMPTIONS` 暂置**模块常量**而非数据文件（执行方泳道只可写两个 `.mjs`、禁 `gates/**` 其余文件，无法新建 JSON）—— 判红方向仍 fail-closed，但**与另两张豁免表「数据文件与本体分离」的形态不一致**；迁移路径已就位（常量 ＋ `base.gateSubjectExemptions` 注入面），迁到数据文件是一次纯搬运。**主会话裁决：本步不扩范围，登记为待办。**（与另两张豁免表同形，判定逻辑零改动；「表读不到」裁决为**判红**，理由见 REQ-190）  
> ⚠️ **仍留的一笔**：② C1 档二的分母只有 4 段（见 C1 行内说明），**不是缺陷但也不是广覆盖** —— 若日后要它变成真正的网，得先有一批段改用镜像路径命名，那是改名纪律、不属本族。
>

## 完成标准

1. `src/` 19 条取证里 7 条要动的全部落地（i18n 目录化 · cancel 拆分 · image 归并 · util→text 改名 · style 并入 theme · main 四项搬迁 · 11 条新判据在位）
2. 146 个测试文件全部落在镜像路径上；0 个偏宽；0 个文件头自述与物理位置矛盾
3. 沙盒探针层与 `protocol.mjs` 退役，且退役前 7 个 `GATE_IDS` 逐个对账到载体；L11 保住了「门禁自测须在真实工作树跑绿」
4. 一个 agent 只凭被测文件路径即可定位唯一段文件；`npm run where` 可反查
5. DEV-GUIDE「测试体系」节 ≤5 行，规则本体全部在门禁里

---

## 步序与泳道

七阶段。**阶段之间有硬序，不可并行**；全程唯一允许并行的写入是 `gates/` 下两个不同文件。

| 阶段 | 内容 | 状态 |
|---|---|---|
| **T0.0** | 并入 REQ-170：给 `gates`/`shared`/`tools` 三棵非 program 树开 `no-undef`。**实测否决了 ADR 原定的 `tsconfig.gates.json` ＋ `checkJs` 方案**（1028 条噪声 vs 1 条），改判已写回 ADR-064 | ✅ 已提交 `51f80bb` |
| **T0** | 建 src 侧判据，不搬文件：`check-src-layout.mjs`（`src-file-header` 红 6 ＋ `src-no-duplicate-basename` 红 0/白名单 3 组）＋ `check-import-boundary.mjs` 加 4 条内部边界 ＋ 2 条文本判据 ＋ 结清 `prefix:../../` 债。**6 条新判据建时即红，故一律带 `pending: true`**（命中归 `info` 通道、不进 `problems`；T2 逐条删标记即转 fail-closed，**删标记本身就是进度记录**） | ✅ 已完成 |
| **T1** | 建 `check-test-layout.mjs`（L4/L5/L7/L8），report 模式。**实测 45 项**：L4 判红 39（零本层主体 37 ＋ 段 import 段 2）· L5 跨层 60 处/36 段（恒报告）· L7 多 2（`common` `fixtures`）缺 4（`behavior` `harness` `shared` `tools`）· L8 0。⚠️ 其中 20 段是**间接到达本层**（8 段经 `test/` 内非段助手、12 段经路径串/子进程）——位置是对的，属 L4 假阳性，处置见 ADR-062 | ✅ 已完成 |
|  **T2**  |  `src/` 搬迁 5 步，每步自带测试 import 修（**步内不可分割、步间可独立回退**）。⚠️ **86 处 import 重写全部推到 T3**，与 T2 的重写永不交错  |  ✅ 五步全部落地并逐阶段收尾（`05d41c1` ＋ 五步提交），阶段全链 `verify:ci` exit 0  |
|  **T3**  |  测试树搬迁：harness 归位（删 `test/common/paths.js` 的 86 处）＋ `samples/` 归位 ＋ 镜像填充 ＋ 6 拆 3 合 ＋ `behavior/` 归位。`M2W_ONLY` 段名与镜像路径**同批切**  |  ✅ 主体完成，遗留 4 项各有处置（见子步表）：`3b` ⏸ 裁决不建 `test/tools/`（待有主体再来）· `4b-iii` ⛔ 受阻于 `--enforce` 一刀切，待 T5 的按判据分级强制机制 · `5` ⏸ 剩余两项押后（REQ-184 / P6）· `9` ⛔ 用户裁决不做  |
| **T4** | 豁免表 ratchet：`--write-baseline` 生成 → 逐条补 `reason` ＋ `coveredBy` → 转判红 |  ✅ **T4-a 已完成**（`reason` ≥20 字：`REASON_MIN_CHARS = 20` 具名常量、码点计数 ＋ trim；判定分「空」与「不足」两档；24 条实测 49–194 字故零数据工作量；selftest 71→74，含「恰好等于门槛不得判红」那格）· **`coveredBy` 已押后**（用户裁决，见 REQ-185）· 转判红那半随 T5-a 完成 |
| **T5** | 门禁元框架退役 ＋ 收尾：删沙盒层（**前置硬门：7 个 `GATE_IDS` 逐个对账**）＋ `registry.mjs`→`gate-index.mjs` ＋ DEV-GUIDE 重写 |  🔄 **T5-a 已完成** · **T5-b 进行中（S0 ✅ → S1a 🔄 → S1b → S2 → S3 → S4 → S5 → S6）**。分步与机器可判完成判据见下「T5-b 分步计划」；**S0 对账表**（P6 删除步骤的硬门）见 `docs/evidence/20261004-225514-gate-ids-对账表.md`，结论 **⛔ 3 族阻塞 ＋ ⚠️ 1 族待核实** |

### T2 的五步与排序理由

| 步 | 内容 | 触点 | 为什么这个顺序 |
|---|---|---|---|
| 1 ✅ | `util/`→`text/`（**只改目录名，4 个文件名不动**） | 实测 **33 处 / 27 文件** | 纯改名零逻辑，先跑通「搬＋修测试＋验」这套动作。⚠️ **原估「3 段」是错的**，原计划的 `settings-*` 改名已移出：实测 `settings-defaults` 有 **66 处真 import** ＋ 8 处 JSDoc ＋ 约 35 处注释提及，且给出的理由「两个文件名无法区分 schema 与 defaults」**不成立** —— 文件名里就写着 `schema` 与 `defaults`，本就可 grep。66 处改写的风险不抵这点收益 |
| 2 ✅ | `cancel.ts` 拆出 `image/request-guard.ts` | 实测 **5 文件**，**测试段零改动** | 边界明确（22–169 vs 172–296）。实测那 3 个测试段只 import 留在原地的导出，故一处未改。⚠️ **跨文件私有符号有两个而非一个**：除派发时点出的 `raceCancel`，还有 `linkAbort`（`cancel.ts:127`，唯一调用方就是 `runImageRequest`）——它跟着那段时序逻辑一起搬，否则留在 `cancel.ts` 就是本文件内无人调用的孤儿。`raceCancel` 经**既有公开门面** `CancellationGuard.race()` 调用（实现即 `return await raceCancel(work, guard)`，逐字等价），故保持模块私有、不导出、**也不复制**一份到新文件 |
| 3 ✅ | `image/` 归并（**`style/` 那半已移出本步**） | 实测 **12 文件** | `markdown/image-size.ts`（163 行，零 import）＋ `image-path-policy.ts`（183 行，只引 `node:path`）搬进 `core/image/`，8 处 src import ＋ 3 处测试段改动，测试段**不搬目录**（T3 才搬）。⚠️ **`style/` 并入 `theme.ts` 已移出**：ADR 声明 `theme.ts` 是 docx 私有（项目 `AGENTS.md` 亦定其为 docx 字体与 eastAsia 的集中配置，32 行零 import 叶子），而 `style/` 的两个文件消费方**横跨两条管线**（水印灰被 `docx/chrome`＋`pdf/template` 同引，89 行 hljs 色板被 `docx/handlers/code-highlight`＋`pdf/template-css` 同引）—— 即 `style/` 本身就是「双管线共享视觉层」，搬进单管线私有文件会造出一条 `pdf → docx/theme.ts` 运行期值依赖；且 ADR 对 89 行的 `hljs-palette.ts` 放哪只字未提 |
| 4 ✅ | 只做三项：`types.ts` 删除 ＋ `output-allowlist.ts` 挪进 `services/` ＋ 建 `core-no-duplicate-export`。**另三项移出本步** | 实测 **6 文件** | ⚠️ 原估「测试耦合最低（`menu` 0 段直接 import）」**估法漏了一整层**：`about-preload` 的耦合根本不在 import 上，而在 `menu.ts:49` 的 `path.join(here, "..", "renderer", …)` **运行时算路径** ＋ `tools/copy-renderer.mjs` 的资产拷贝 ＋ 两个测试段钉住的 dist 位置 ⇒ 移出。**「缩桶」移出**：`main/converter/index.ts` 的 7 个跨层转出背后是**约 10 个测试段经该桶取符号**，属 T3 规模 import 重写。**`main-ipc-no-assembly` 决定不建**（见 ADR-064「已知边界」节的理由） |
| 5 | **`i18n.ts` → `i18n/` 目录** | **实测 119 处 / 92 文件**（91 真 import 含 24 type-only ＋ 22 JSDoc `import()` ＋ **6 运行期动态**） | 放最后：最大且有静默失效风险，前四步把流程跑顺了它才是机械重复 |

### T3 的子步（T2 期间实测出的体量决定必须分步；每步自成 commit）

| 子步 | 内容 | 触点 | 状态 |
|---|---|---|---|
| 1 ✅ | `test/common/` → `test/harness/` | 实测 **113 文件改写**（真实 import 273 处 ＋ 字面断言/运行期字符串 3 ＋ 裸名字数组元素 2 ＋ 字面量断言 1 ＋ 合成夹具清单 1 ＋ 散文约 40 处）；17 个文件内容逐字未动 | ✅ 已完成，四族判据实测 L4 39/134、L5 60、L7 多1/缺3、L8 0 |
| 2 ✅ | `test/fixtures/` → **仓库顶层** `samples/`（与 `test/` 平级） | 三子目录 **56 文件逐字节全等**（sha256 全表 ＋ 树哈希） | ✅ 已完成，L7 实测「多 **0**／缺 3」。⚠️ **代码引用 0 处**：230 处消费方全走 `shared/paths.js` 的 `FIXTURES_DIR` 常量，只改那一个常量即全生效；真正要改的是 4 处**绕过常量的硬编码路径**（`path.join(root,"test","fixtures",…)`）。`gates/fixtures`（生成器）**零逻辑改动**，其 `GENERATED_DOCS_DIR` 由常量派生、`IMAGE_DIGEST_BASELINE` 的键是无前缀相对路径 |
| 3 ✅ | 镜像填充：`test/shared/`（2 段真搬）；**`test/tools/` 不建** | 8 个候选段里**只有 2 个该搬**；`test/gates/` 20→18 | ✅ 已完成，L7 实测「多 0／缺 **2**」。`entry-exit-guard` ＋ `geometry-gate` 搬进 `test/shared/`（零真实 import 改动，同深度故路径原样成立）。**L4 真改善**：零本层主体 37→36；**L5 60→58**；总判红 42→39 |
| 3b | `test/tools/` **待有主体再来** | 全仓**无一个段的被测主体是 `tools/`** | ⏸ 唯一真 `tools/` import 是 `dist-manifest-gate` 的 `copy-renderer.mjs` 一行，而它 3 个被测脚本 2 个在 `gates/` ⇒ 镜像规则只对得上 1/3 |
| 4a ✅ | **改挂**「目录名与被测层不符」的段（只动目录、不动断言、不写 `covers`） | 13 个候选**只 4 个真改挂** → `test/convert/`；L4 零本层主体 **36→32**、L5 **58→54**、总判红 40→36 | ✅ 已完成，134 段全绿。⚠️ **执行方先做了一层切分并纠正我**：36 个「零本层主体」里**只有 7 个有跨层直接 import**，另 **29 个是零层 import**（经 harness／子进程／字符串路径间接到达）⇒ 后者属 T1 已实测的「间接到达」组，**不在本步**。我给的 13 段清单里 **4 项与 L4 判红的真实原因不符**：`settings-controls`／`ui-contract-guards`（零静态层 import，运行时按路径加载）、`header-footer-settings`（经 harness 助手到达 main）、`ui-state`（**模板串动态 import 带 query string**，文本层抽取解析不了）—— 它们 L4 红**不是挂错层而是判据看不见主体**，搬目录不会转绿 |
| 4b ✅ | L5 豁免表机制 ＋ 基线（**25 条**）| 29 处命中 → 豁免 25 ／**表外 3** ／空 reason 0 ／stale 0 | ✅ 机制与表已就位（59 条夹具守），**转判红暂缓** —— 前置条件「表外零说不出理由的命中」不成立：那 3 处说得清为什么跨层，但**不该豁免**（真的执行别层实现并对其行为下断言 ⇒ 属 A 档「断言跨层接缝」，归宿是 `behavior/` ＋ `covers`）。处置见 4b-i |
| 4b-i ✅ | 拆出真正的跨层接缝段 ＋ **`check:test-layout` 进 `verify:ci`** | L5 未登记 3→**1**；stale 摘 1 条（25→24） | ✅ `image-seam` 进 `behavior/`。⚠️ 加链的**直接后果**：不同步改 `registry.mjs` 的 `access` 会被 R5b 判 `access-mismatch`，实测两个段当即红 —— **进链与改 access 必须同批** |
| 4b-ii ✅ | 处置剩下 2 处 → **`test/convert/`**（非 `behavior/`） | L5 未登记 1→**0**；命中 25（豁免 24／stale 0） | ✅ ① → `context-mapping.test.js` ② → `header-logo.test.js`，断言调用点守恒（移出 15／移入 15）。⚠️ **我原先的裁决前提被推翻**：①② 的断言对象**本身**就是 `src/convert/context.ts` 的函数 ⇒ **单层**，不是接缝；放进 behavior/ 会造出「不跨层的 behavior 段」而 **L6 抓不到** |
| 4b-iii | **L5 转判红** ＋ 清理 `L5_PENDING` | 前置已达成：未登记 0、stale 0、空 reason 0、**不足 20 字 0**（该门槛 2026-10-04 由 T4-a 补上） |  ✅ 已完成（2026-10-04）：`--enforce` 与 `L5_PENDING` 均已删除，改为 `CRITERIA` 登记表 ＋ 唯一 `report(id, line)` 漏斗；L5 转 fail-closed、L7 留 report-only 且带必填 `pendingReason`。**selftest 74 条全过，其中 6 条是新增的负向夹具**（漏斗未登记即红 / 摘无命中行不产生误红 / 默认 fail-closed 反锚点 / pending 必带 reason / 两个 sourceAudit 变异 / report-only 与 fail-closed 成对） |

| 4c ✅ | 10 个跨层段搬 `test/behavior/` ＋ 建 **L6** ＋ `covers` 扩展到正常段目录 | **L5 54→29**、L4 零本层主体 **32→29**、L7 →「多 0/缺 0」（`test/tools/` 已裁决不建，`discoverSurfaceDirs` 只算含源文件的目录）→「多 0/缺 1」、L6 0 判红、总判红 36→**32** | ✅ 已完成，134 段全绿。L6 三条 fail-closed（缺失／空／**指向不存在**）**用变异实验逐条证明有牙齿**（摘掉任一条，对应夹具立刻翻脸）。`covers` 元素＝**仓库相对 POSIX 路径**，理由：不引入位置耦合（`shared/paths.js` 存在的全部理由就是消灭这类耦合）、可对磁盘真验、不限定 `src/`。⚠️ `covers` 通道**建好但一格未用**（那 29 个间接到达段的声明是 4d），故 L4 数字**未被 L6 掩盖** |

| 5 ⏸ | L4 真违例归位 ＋「6 拆 3 合」 ＋ `M2W_ONLY` 段名与镜像路径**同批切** | L4 判红 **7→5** | ⏸ **仅剩两项**（L4 真违例归位已由 T3-6 做掉）：`clean-artifacts-gate` 搬 `test/gates/`（同一份 `covers` 即刻生效）、`resolveNode` 抽成 `test/harness/node-exec.js`。零本层主体 5→4、段 import 段 2→1。**6 拆 3 合 ＋ `M2W_ONLY` 同批切仍未做** |
| 6 | 三类「主体无处安放」的段各给归宿（改 L4／L8）| 剩余 4 零本层主体 ＋ 1 段 import 段 | ✅ 已完成：**L4 判红 5→0**（零本层主体 4→0 / 段 import 段 1→0），L8 改窄口子，`tscheck-coverage` 转门禁 |
| 7 | **「状态 ↔ 真实在跑」对读判据**：新建 `gates/repo/check-plan-in-progress.mjs`，把「标记为进行中的子步」与「一行人工声明」双向对读 | 子步行的形态（首格剥出 id）＋ 一行人工声明 | ✅ 已完成（门禁建时即红：本载体当时有三处进行中标记而零声明行 —— 这正是要证明它有牙齿的那次实测；把无人做的标记改掉、或补上声明行即转绿。⚠ 本格**不得在解释里再复述那个标记**：判据是「任一格含它即进行中」，解释里写一次会让这一行永远退不出去） |
| 8 | **重新测量「6 拆 3 合」范围**（ADR-062:197 点名的 6 个已失效：`dist-manifest-gate` 实测 **394 行**、`release-artifact-gate` **564 行** 已不算大文件；而 `import-boundary` **1611**、`dual-pipeline-matrix` **1515** 从未被点名）| 段行数排名（≥800）＋ 每候选的拆分边界 ＋ **断言调用数基线**（ADR 对策「总和不得减少」，拆完就取不到了）＋ `check-pointers-*` 三份的 case 名全集与跨文件重名 ＋ `M2W_ONLY` 波及面与 P6 前置依赖 | ✅ 已完成：三条实测推翻了 ADR 原文，见下「T3 最后一项的批次划分」|
| 9 | **B1 ·「3 合」**：`test/gates/` 三份 `check-pointers-*`（e2e/ledger/refs）合并为一份 | **两道机械对账**：case 名集合 **62 条逐条 diff 为空** ＋ 断言判定点数 **185 处**（e2e 50 ＋ ledger 66 ＋ refs 69；refs 的 79% 藏在 `assertEq`/`assertNoErrors` wrapper 内，只数 `assert(` 会少算 54）| ⛔ **不做（用户裁决：合并收益不大）** —— 与 ADR-062:198 冲突，记在「已知判据缺口」第 4 条 |

**子步 1 的三条经验（换目录时最易踩的三类）**：① **同一文件里可能有多处独立登记**，只改已知的那处会让另一处的扫描面指向不存在的目录 ⇒ walker 扫到 0 文件 ⇒ **判据恒绿且不报任何错**（本次是 `shared/test-common-surface.js` 的 `NON_MIRROR_DIR_NAMES` ＋ `SCAN_TARGETS`，后者差点漏）。② **路径的形态比路径本身多**：分段数组 `join(dir, 'test', 'common')`、数组元素裸名 `"common"`、正则转义 `core/util/`、跨行写成 `test/common/`＋换行＋文件名 —— 前两类不在任何一种「子串」形态里，只有全量测试暴露。③ **合成夹具里的路径字面量有断言耦合**，不是可以顺手统一的；执行方改了 5 处后被迫回退。
⚠️ **遗留判据缺口**：`check:temp-cleanup` 的扫描面覆盖 `test/` 但**不含 `samples/`** ⇒ 今后仍有产物落进 `samples/` 时没有任何判据会红。durable 的修法是 ADR-062 P3 的 `check-samples.mjs`（其职责正是「生成物 vs 手工物」的目录准入判据），本步只补了 ignore 规则这条近路。

### T3-4d（分三批，`covers` 声明通道的使用）

| 批 | 段数 | L4 零本层主体 | 状态 |
|---|---|---|---|
| 1 | 10（core 7 ＋ renderer 3）| 29 → **19** | ✅ 纯新增 162 行／删 0 行 |
| 2 | 10（renderer 8 ＋ cli 1 ＋ convert 1）| 19 → **9** | ✅ 纯新增 229 行／删 0 行 |
| 3 | 9（已知麻烦段）| 9 → 5 | ✅ 已完成 |

**两批共 20 段全部判定为「测本层」，无一需另行处置**；两批都是**纯新增、零删除**，没有既有断言被改动。判据侧的四条边界在两批里都未失配：「零 import 的段声明本层 → 判绿」、「声明的元素不落在本层主体根 → L4 仍判红」（批 2 实测该漂移被拦截 `l4NoOwnSubject:1`）。

**批 2 交回一件需另开一处的发现**：`test/cli/pdf-launch.test.js:36` **段 import 段**（`import { resolveNode } from "./options.test.js"`）—— 这是 L4 的**另一格**，与 `covers` 通道无关。段内注释自陈「node 解析器复用同段那份：各写一份『怎么找真 node』正是本仓反复吃过亏的地方」，即**有意为之但与 L4「段是发现与隔离的单位」冲突**。处置需另开（抽进 `test/harness/` 或 `shared/`），不在 4d 范围。


⚠ **L5 转判红被机制锁住（不是判据没做完）**：`L5_PENDING` 的既定语义是「L5 恒报告」，而实测 `--enforce` 把 L4/L5/L7/L8 绑成一个开关、L4 与 L7 未就位 ⇒ 翻常量后链上仍不拦。**此时翻常量会让它变成假话**（说「不 pending」而实际不拦），故已撤回。正确顺序：先按判据分级强制 → 再翻常量。这条已写进子步 4b-iii。

**遗留清理项**：`test/**` 11 处 ＋ `gates/**` 3 处指向**在 `test/common` 时代就不存在**的文件（`userdata.js`、`copy-closure-audit.js` 等）。刻意未改 —— 改了只是把陈旧挪个位置、反而掩盖。须单独清理。

## 整体完成标准

划完才许删本文件。逐条划记（勾 = 已达成并有证据）：

- [ ] C1 `src/` 19 条要动的 7 条全部落地；11 条新判据在位且已从「只报告」转「fail-closed」
- [ ] C2 146 个测试文件全落镜像路径；0 个偏宽；0 个文件头自述与物理位置矛盾
- [ ] C3 `samples/` 逐字节迁移完成；fixtures 契约 100% 声明强制与 111 个 `= null` 全删
- [ ] C4 沙盒层退役；7 个 `GATE_IDS` 对账表全绿；L11「真实工作树跑绿」判据在位
- [ ] C5 AI 落笔判据成立：只凭被测路径即可定位唯一段；`npm run where` 可反查
- [ ] C6 DEV-GUIDE「测试体系」≤5 行；规则本体全在门禁
- [ ] C7 `verify:ci` 全绿且链长**只因新门禁而增**；`verify:release` 跑通。⚠️ 原写「链长不增」，与 T3-7 冲突：那条负向夹具一旦登记进 `PROBE_CARRIER_SCRIPTS`，R5c **强制**它必须在链上（否则判 `probe-carrier-offchain`），而链长必 +1。不登记则夹具**无链上守护** —— 那正是本轮 T3 修掉的「悬空 selftest」失效形态。**故保留链上位置，把标准改成「只因新门禁而增」**（新增 1 步对应新增 1 道守护，不是无节制增长）；门禁**本体**仍 `access:"local"` 不进链（R5b 双向一致）

## 怎么回滚

每阶段独立可回退 commit，**回滚顺序与实施顺序相反**。

- **T5 的 7 个 `GATE_IDS` 对账表是沙盒层退役的唯一保险** —— 回滚 T5 前先确认对账表仍在且全绿。
- **T3 的断言调用数对账表 ＋ `test:coverage` 的 0% 文件集合是「没漏搬」的客观证据** —— 回滚 T3 前先核对这两份记录。
- **T2 每步自成 commit**（5 个），回滚时可只退其中一步而不动其余。
- **T3 的「迁移前后 `samples/docs/` 逐字节相同」是纯搬家的证据** —— 任何一项不同就不是纯搬家，须先查清再继续。
- **T1 的四段计数是后续所有搬迁阶段的工作量基线** —— 回滚 T1 前不要回滚 T2 及以后。
- T2/T3 是机械改写（路径变更、搬文件、改 import），`git revert` 即可，无数据迁移。
- ⚠️ **唯一不可 `git revert` 的是删除动作的语义**：沙盒层与 `protocol.mjs` 的文件内容在 git 历史里可取回，但**判据退役（注册表 `probes[]` 概念消失、7/20 未登记改由 L11 路径判定接管）不可回退** —— 回退后必须重跑 T1 才能重建一致性。

## 修复项复测

首判常常是错的。这张表记「首判可能是什么」与「怎么复测」，避免下一次在同一坑里绕第二遍。

| 现象 | 首判（可能错） | 复测动作 |
|---|---|---|
| T2 某步后 `npm test` 全绿但段数减少 | 拆分/搬迁漏搬（**最危险的静默失效**） | 比对搬迁前后断言调用数总和 ＋ `test:coverage` 的 0% 文件集合，两者任一变化即定位到漏搬处 |
| T0 新判据接进 `verify:ci` 后链红 | 判据建时即红，忘了它要 `--enforce` 才 fail-closed | 查该判据的默认退出码路径；确认链上跑的是只报告形态 |
| L5 转判红后大量误伤 | 预判的合理跨层段未列入 `behavior/` | 退回只报告模式，取完整误伤清单逐条处置后再转判红（L5 覆盖 T1 到 T3 末） |
| T1 判据的「位置错位 N」远小于预期 | 判据只查 import 解析落点，漏了「不 import 任何 src 模块」的段（如框架自测段） | 补「必须 import 至少一个本层被测主体」这条子判据后重跑 |
| T4 豁免表出现语义模糊的红（模块已不存在） | src 在 T2 搬过文件，表的键是旧路径 | 这是 T2 必须先于 T4 的理由；若已发生，重跑 `--write-baseline` 并核对减少项 |
| `verify:ci` 在 T5 后链长变长 | 新增门禁被误挂进链 | 查 `gate-index.mjs` 的 `access` 字段；`access:"local"` 出现在链上即判红 |
| `M2W_ONLY` 段筛选命中数异常 | 段名与镜像路径不同批切，或 basename 语义未改净 | 复核 `runner.js` 的 `EXCLUSIVE_SEGMENTS` 子串语义（`gate-probes` 那条应随 T5 一并消失） |
| T2 搬走 src 文件后 `check:boundary:dist` 红 | 判据坏了 | **dist 侧扫到了 src 已不存在的陈旧产物**。`build` 脚本是 `tsc && copy-renderer.mjs`、本就不清 dist，清 dist 是 `clean:dist` 的职责 → 跑 dist 面前先 `npm run clean:dist`。⚠️ 这是 `verify:ci` 的结构性缺口（`build → check:boundary:dist` 之间无清理步骤），T2 之前 src 只增不减所以从未暴露；留待 T5 重写链时补 |
| 按 `from "` 统计 import 面时漏掉运行期动态 `import()` | **grep `from "` 抓不到 `load()` / `dist()` / `distUrl()` / `path.join(ROOT,"dist",…)` 这些形态**。T2 步 5 实测：真实改写面比 `from "` 统计多 6 处动态 import，漏改的后果**不是 tsc 报错而是段在运行时炸**。搬路径类改动必须全量扫形态，并跑一遍含动态 import 的段 |
| 搬目录后,某个**按路径登记**的东西悄悄失效 | 那个东西看起来无关 | 这一类**比「判据恒绿」更严重**:失效的若是 `.gitignore` 规则,测试产物就从「被忽略」变成「可跟踪」,`git add -A` 会把它**提交进仓**。T3 步 2 实测:`.gitignore` 里 `test/fixtures/manual/*.{docx,pdf}` 两条按路径登记的规则在搬家后失效,一个全量测试跑出的 PDF 被提交进仓(`git check-ignore` 对旧路径仍命中 ⇒ 证明是回归不是新行为)。**扫一遍所有按路径登记的地方**:`.gitignore`、各门禁扫描面、夹具 map key、白名单条目。⚠️ 判据侧的扫描面失效只是恒绿,**ignore 规则失效会主动污染源码树** |
| 某判据在本地与干净克隆上答案不同 | 判据逻辑没问题,是**载体本身不可提交** | 空目录 git 不跟踪 ⇒ 留着它则本地「缺 1」、新克隆「缺 2」。**答案取决于克隆方式的判据就是坏判据**。T3 步 3 实测;两条都不选:① 留空目录(不确定)② 放 `.gitkeep`(为满足判据而造文件,本仓规则反复否决的那类)③ 硬凑一个主体不符的段。**选「让状态回到确定」** —— 移掉空目录、L7 如实报缺,等真有主体再填 |
| 改事实源头后,某个 selftest 悄悄失配 | 改的是夹具输入,`expect` 正则会跟着一起失效 | **按子串做的盲替换只覆盖一种形态**:T2 步 1 实测漏了「正则转义斜杠」(`expect: /…core/util/…/`)与「路径分段数组」(`join(src, 'core', 'util')`)两类。改名/搬路径类改动必须**按形态枚举**再 grep,不能只搜字面路径 |
| 定向检查全绿,但 `verify:ci` 红 | 定向检查覆盖不到链上别处 | **定向绿只证明我修的那几处好了**。T2 收尾实测:两次全链各暴露一个缺陷,且第二个被第一个掩盖(第一轮死在 transform-dispatch,压根没走到 archive-index)⇒ 后面可能还藏着第三层,必须跑到链尾 |
| 某道门禁的 selftest 坏了却没人发现 | selftest 本身有 bug | **它可能连 npm script 都没有**。T2 实测 `check:src-layout:selftest` / `check:test-layout:selftest` 从未建过 ⇒ 无入口、不在链上、`PROBE_CARRIER_SCRIPTS` 里没有 ⇒ R5c「载体必须真挂在链上」无从校验,坏了四个提交都没人发现。**载体是门禁有牙齿的唯一证明,不是可选项** |
| 搬走某文件后某条门禁立刻红 | 判据逻辑坏了 | **该路径被按全路径登记进了某张表**（本轮实测：`CORE_NODE_BUILTIN_FILES` 登记的是 `core/markdown/image-path-policy.ts` 整条路径，且 `test/gates/import-boundary.test.js` 的 9b-2 沙盒夹具用同一个路径当 **map key**，两处必须同批改）。搬文件后必须搜「该路径是否出现在 `gates/` 与 `test/` 的任何登记表、夹具 key、字面路径断言里」，这类耦合不搜不会自己暴露 |