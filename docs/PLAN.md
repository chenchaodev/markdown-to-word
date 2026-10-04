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
| **B4** | `observability.test.js` 1348 | 拆 2 | **6 处** | ⚠️ `:366-372` 有跨全文件的 `process.noAsar` 快照，**必须整份跟块 6-10 走** |
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
| **S1b** ⏳ | 补 `smoke` 的**冒烟机制自身**（需 CI 真起一次 Electron） | 同上三档 |
| **S1c** ⏳ | **取 `sandbox.mjs` 的 `snapshotProtectedTree` / `diffProtectedTree`（约 58 行）单独取出，挂在已在链上的 `check:temp-cleanup`**（连同 `PROTECTED_PATHS`）| `check-temp-cleanup` 的判定里出现工作树指纹 ＋ **它能被一条负向夹具判红**（在临时目录里改坏工作树 ⇒ exit≠0）|
| S2 | L11（三档缺一即红）＋ L12（`chain`/`offchain` 两值 ＋ L12c 待转正声明）落地，**先在 `check-test-layout.mjs`** | `--help` 的强制等级行含 L11/L12；selftest 条数增加 |
| S3 | 写 `gate-index.mjs`，**与旧 registry 并存** | 新旧对同一注册表给出相同 code 集合 |
| S4 | 删沙盒层 islands ＋ `gates/` 6 探针 ＋ `check:gates` | **`grep -rn "gate-probes|check-gate-probes"` 零命中** ＋ `gate-index` 仍 exit 0 |
| S5 | ⚠️ 递归化**是前置**，须先单独落地并验证，不得与合并同日做。 合并 `gate-probes.test.js`(293) ＋ `gate-registry-gate.test.js`(555) → `test/gates/repo/gate-index.test.js`；`EXCLUSIVE_SEGMENTS` 删 `gate-probes` | `grep -n "gate-probes" test/harness/runner.js` 零命中 |
| S6 | DEV-GUIDE 接入点表同步 | `grep -n "check:gates" docs/DEV-GUIDE.md` 零命中 |

**S4 是唯一的不可逆点**，被夹在两个可回退步之间（S3 纯新增、S5/S6 可独立回退）⇒ **S1 那三项缺口必须在 S4 之前全部补齐**。

### 裁决（2026-10-04；①–④ 已落进 ADR-062，⑤⑥ 待落）

| # | 裁决 | 依据 |
|---|---|---|
| ① | **取 `sandbox.mjs` 的 `snapshotProtectedTree`/`diffProtectedTree`（约 58 行）** 挂 `check:temp-cleanup` | L11a/L11b 顶替不了「门禁在跑的过程中写坏了真实工作树」那一格；取 58 行符合 `ADR-062:144` 原裁决「保住这一个判据，不保留 301 行的通用沙盒」 |
| ② | **L11 定义改三档缺一即红** | 实测按字面执行会**当场判红 29 项**（有载体 13／无载体 29，其中 9 项就在 `verify:ci` 上） |
| ③ | **同意 P6 的两段合并**（848 行） | 与 `ADR-062:202` 撤掉的那三份（1609 行）**不是同一批**；且这是 **1 主体合 1 段**（不变式要的形态），`:202` 撤的是 **3 主体合 1 段**＝制造偏宽 |
| ④ | **`smoke` 的机制自测要补**（CI 多起一次 Electron） | 它是三个 ⛔ 阻塞项里唯一「不补就不能开始删除」的；P6 一旦开始删除就不可逆，那时沙盒层已没了、再想补依赖的正是它 |
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