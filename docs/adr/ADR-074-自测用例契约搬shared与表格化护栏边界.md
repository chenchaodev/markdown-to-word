# ADR-074 · 自测用例契约搬 `shared/` 与表格化护栏的真实边界

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-09 |
| 关联 | [ADR-068](ADR-068-门禁自测合成根表格化.md) 定「走合成根 harness、不合并段、一条断言都不删」——本条只落**它没说清的三件事**：契约模块的落点、护栏的判据形态、「一条断言都不删」这句话的真实边界 ｜ [ADR-071](ADR-071-两处判据的形态裁决.md) 的「新判据不设豁免 · 先报告后转正」纪律在本条沿用 ｜ 事实底账见 [`20261006-141113-三份只读测绘事实地图与接手须知`](../evidence/20261006-141113-三份只读测绘事实地图与接手须知.md) §三与本轮对 `gates/**/*.selftest.mjs` 的实测 |

---

## 决定

**一、case 契约的真实现搬进 `shared/`，`test/harness/case.js` 降为转出门面。**

`shared/` 侧的 harness 与 `gates/**` 侧的 selftest 都引同一个真实现；门面保留原路径，段侧的 `CASE_MODULE_REL` 与 144 段的判定**一行不改**。

**二、表格化的前置是「判定体有没有注入面」，不是「断言形态像不像」。**

判定体零注入面的**先拆判定体、再迁那一段** —— ⚠ **拆解是「对应段」的前置，不是全批的前置**：判定体已导出的段（`check-src-layout` 的 `checkSrcLayout` + `makeSrcLayoutCtx` 等）不等任何拆解就能迁。按字面读成「先拆完 4 处再迁」会把批次顺序整个搞反；且那 4 处的拆解与 4 个段一一对应、**拆与迁同批做**即可，不需要单独立一步。入参里塞函数/回调的那几类**不进表**，留在原处 —— 那是「该用例装不进表」的判据，不是「harness 要支持回调」的判据。

**三、「一条断言都不删」这句话必须分层承诺，判据只担第一层。**

机器看守的是**case 粒度的增删**（名册两向差集）；case 内部的断言条数与期望值不被削减**靠搬迁手法，不靠机器**。

---

## 背景

ADR-068 定的方向没有变，本条处理的是它读下去会撞到的三处硬约束。三处都是实测出来的，不是推演。

### 一、`createCaseSuite` 的落点挡住了护栏本身

工作载体 #09 那一行写的护栏是「以 `createCaseSuite` 的 case 数为**唯一计数单位**」（载体已收尾删除，原文入档 [`20261011-101152-最优架构整改工作载体原文`](../evidence/20261011-101152-最优架构整改工作载体原文.md)）。但实测：门禁自测**零个**接入统一断言库 —— 20 个 `.selftest.mjs` 的断言机制有 5 种，其中 14 个是同一套「`const failures = []` + 循环 + `process.exit(1)`」的复制，`node:assert` 计数为 0。

要把 case 数当计数单位，就得让 `gates/**` 能引 `test/harness/case.js`。而它今天引不到：`gates/repo/check-import-boundary.mjs:2015` 的 `gates-stay-in-gates` 是 allow-list，允许面只有 `['gates', 'shared', 'test/fixtures']`，判定按**解析后**路径、**按路径段**比前缀（`:2114-2116`）。`test/harness/` 不在其内。

`test/fixtures` 那一项本身已是死条目（ADR-062 P3 把数据区搬到 `samples/`，但 230 处消费全经 `shared/paths.js` 的常量取路径），换不换都与本决定无关 —— 关键是**「测试树的 harness 机制层」从来不在门禁树的允许面内**，这是有意的。

### 二、真正的瓶颈在判定体，不在断言形态

14 个文件共用同一套 `failures[]` 循环，harness 一行就能替掉。替不掉的是这些。⚠ **这四处的拆解与「迁对应那一段」一一对应、同批做**，不是迁完所有段之后再来一遍的统一前置 —— 判定体已导出的段不等它们就能迁：

- **零注入面、须与迁段同批拆的 3 处**：`check-changelog.mjs:591` 的 `analyze()` 零参（且 `:592` 把 IO 混在判定里、`:617` 的 `main()` 又重读一遍同一文件）· `check-test-numbering.mjs:343` 的 `analyze()` 零参 · `gen-archive-index.mjs` **只有 `main` 一个 export**，其余 helper 全私有且直接摸盘。三处分别卡 `check-changelog.selftest.mjs`（46 条 CASES）· `check-test-numbering.selftest.mjs`（14 条）· `gen-archive-index.selftest.mjs`（9 条）。
- **判定体住在测试侧、须与迁段同批搬的 1 处**：`gate-index.selftest.mjs:129-514` 的五个审计函数（`auditIdUniqueness` 等）全在这个 selftest 文件里，`gate-index.mjs` 只有常量表（4 个 export，全是常量）。不先搬进 `gate-index.mjs`，harness 无处可调。卡 `gate-index.selftest.mjs`（41 条 CASES）。
- **入参里塞函数的 2 处，永久不进表**：`smoke-report.selftest.mjs`（32 档全是回调体）· `check-tscheck-coverage.selftest.mjs`（16 条全是 `run()` / `fn()` 闭包）。这两类不是「表格小一点」，是**入参形态根本不是数据** —— 改写成数据形态要动的是自测的判定逻辑本身，那是另一种改动，不是表格化。

### 三、静态判据抓不住 case 内部的断言削减

ADR-068 承诺「不合并门禁自测段，**一条断言都不删**」。这句话要能被机器看守，得先说清「一条断言」指哪一层：

| 被删的是什么 | 静态判据能否抓住 |
|---|---|
| 一整个 case | **能** —— 抽出的 case 名集合 ⟷ 登记名册，两向差集 |
| 一个 case **内部**少了一条 assert | **不能** —— 没有任何静态量因此改变 |
| 一个 case 的**期望值被放宽** | **不能** —— 同上 |

这直接决定了 harness 的入参形态：「路径→正文 **+ 期望问题清单正则**」里，**期望清单进表不是一个便利，是这条护栏成立的前提**。表若只存「树 + 场景名」而期望写在表外的 bespoke 代码里，那么删一条断言不改变任何可数的东西，护栏是零。

---

## 备选方案

**否决 · 给 `gates-stay-in-gates` 的 allow 加 `test/harness`。** 改动最小，但三条理由：

1. 它在两棵树之间开出**双向**合法边 —— `test-stay-in-test` 的 allow 已含 `gates`（`:2021`），今天 `test → gates` 已有 30+ 条合法边。加这一条后「门禁树不依赖测试树」这条单向不变量消失，而失效形态是**静默的**：`test/harness/**` 是 runner + 断言契约 + electron mock 的所在地，门禁一旦能引它，就会长出「门禁逻辑跑在测试框架上」的边，没有任何判据会说这件事不对。
2. 机制上会**静默通过** —— `selfCheckTreeLayout`（`:2200-2215`）只验 allow 元素首段是不是已登记树名或字面前缀，`'test/harness'` 的首段 `'test'` 在 `TREE_DIRS` 里，自检拦不住。口子开出去时唯一的红灯来自本条裁决，不来自机器。
3. `reason` 串（`:2007`）会开始说谎：它写的是「测试树的**夹具数据**（只读）」，`test/harness` 既不是夹具数据、也不是只读的。

**否决 · `gates/**` 侧另起一套 case 机制。** 会让仓库出现两个 case 计数机制，与 #09 护栏「唯一计数单位」的立意直接冲突。

**否决 · 门面用具名再导出（`export { createCaseSuite } from ...`）。** `test/harness/runner.js:101` 有 `@typedef {import("./case.js").CaseResult}`，而 `CaseResult` 是 `case.js` 的模块级 JSDoc typedef（`case.js:40`）。具名再导出会把类型一起丢掉，typecheck 报 TS2304/TS2694。门面必须用 `export *`。

**否决 · 一次迁完 20 段。** 写域 11346 行加 4 个门禁本体（三个判定体要先拆），且横跨 `check-import-boundary` 的判据面。与 `docs/PLAN.md` 的分相原则冲突 —— #09 的退出条件要能独立核对、独立回滚。

---

## 后果

- **`CASE_MODULE_REL`（`check-test-layout.mjs:264`）与 `caseContractState`（`:1048-1061`）一字不改。** 后者判的是 `extractImports(text, file).some(e => e.resolved === CASE_MODULE_REL && !e.typeOnly)` —— **白名单一个精确路径**，不是黑名单所有其他路径。段若改引 `../../shared/case.js`，`resolved` 变成 `shared/case.js` ⇒ 不等值 ⇒ 走 `noCaseImport` 判红。**第二条路径是被拒绝的路径，不是被接受的路径**，因此门面不开绕过形态。
- **`test/harness/runner.js:38` 的运行期 import 与 `:101` 的类型引用都经门面**，运行期一字不改。搬完**必须立刻 `npm run typecheck`** 验这一条（本条的前提是 `export *` 会带 JSDoc typedef，属 TS 行为推断，未在本仓实测）。
- **`test/harness/test-common-helpers.test.js:72` 的 `covers` 含 `test/harness/case.js`，搬完它测的是一个门面。** L8 不会发现 —— L8 只验「covers 非空 + 至少一个元素以 `test/harness/` 开头」，不判存在性（`:2136-2167`）。**处置：同批把 `shared/case.js` 加进那一段的 `covers`，并在头注写明「契约真实现自本条起在 `shared/`，本段经门面测的是它」。** 不处置的后果是 ADR-062「harness 是自指层、主体根 = `test/harness/` 自己」的表述开始失真，而下一个会话读 PLAN 时会据此得出「case 契约属于测试树」的错误结论。
- ⚠ **实现搬进 `shared/**` 会丢掉 lint 整体覆盖 —— 本条最实质的一处代价，三条事实须分开读（2026-10-09 实测）**：
  ① **`no-undef` 这一条，搬迁前后都没有。** `eslint.config.js:95` 的 `files` 块是 `["gates/**/*.mjs","shared/**/*.mjs","shared/**/*.js","tools/**/*.mjs"]`，**不含 `test/**`** ⇒ 搬之前 `case.js` 在 `test/` 下就没有 `no-undef`（实测 `npx eslint --print-config test/harness/runner.js` 得 `no-undef = undefined`）。**所以搬迁不是「判据面扩大」而是「不变」** —— 把它当收益是错的。
  ② **但 lint 的其余部分是真的丢掉了。** `package.json` 的 lint 串是 `eslint src/ test/ gates/ tools/`，**不含 `shared/`** ⇒ `case.js` 从「被 eslint 扫（只是没有 `no-undef`）」变成「**完全不被扫**」。它有两处模块级可变状态（`registered` / `progressSink`）。
  ③ **`eslint.config.js:95` 给 `shared/**` 配的那块是空转的**：配置声明了 `files`，但脚本从不把该目录传进去（实测 `--print-config shared/case.js` 能读到 `no-undef = [2,…]`，而 `npm run lint` 压根不扫这个文件）。
  [docs/DEV-GUIDE.md](../DEV-GUIDE.md) 门禁接入点表称「`lint` 的覆盖面含三棵非 tsc program 的树」—— **与实测不符**，已登记 `REQ-237`。⚠ **本条不修**：改 lint 目标串会让覆盖面扩大、须重跑全链，且不在本工作项写域内。**代偿动作**：搬完单独跑 `npx eslint shared/case.js` —— 它与 `npm run lint` 是两条不同路径（单点传文件 vs 脚本传目录），故那个退出码有信息量。
- ⚠ **同时 `@ts-check` 从「装饰」变成「真的」** —— `tsconfig.test.json` 的 `include` 只有 `test`，而门面 import 实现 ⇒ 实现必然进程序（实测 `npx tsc -p tsconfig.test.json --listFiles` 命中 `shared/case.js` 一次）。反之若把 harness 直接落 `shared/` 且只有 `gates/**` 引它，`gates/**` 不在任何 tsconfig 的 `include` 内 ⇒ `@ts-check` 形同虚设（同 [docs/DEV-GUIDE.md](../DEV-GUIDE.md) 验证基线节记的 `shared/markdown-table.mjs` 那 8 条欠账的同款陷阱）。**这才是本条在静态检查面上的唯一收益**；`shared/gate-selftest-harness.mjs` 没有这个转机 —— 今天没有任何 `test/**` 引它，它的 `@ts-check` 仍不生效，要等第一个迁段自测落地。
- **实现搬进 `shared/**` 会让 `// @ts-check` 变成真的。** `tsconfig.test.json` 的 `include` 只有 `test`，而门面 import 实现 ⇒ 实现必然在 program 里。反之若 harness 直接落 `shared/` 且只有 `gates/**` 引它，`gates/**` 不在任何 tsconfig 的 include 内 ⇒ `@ts-check` 形同虚设（同 [docs/DEV-GUIDE.md](../DEV-GUIDE.md) 验证基线节记的 `shared/markdown-table.mjs` 那 8 条欠账的同款陷阱）。**门面与实现都要带 `// @ts-check`**（`check-tscheck-coverage` 逐文件查头）。
- **护栏是半齿，且必须写明。** 名册型看守的通病：两侧同改可绕过。删一条 case 并同批删掉册里那行，一次改动就能完成，判据看不见。这一层**不可补强**（任何名册型看守都有这个性质），只能在退出条件里写明，不能在汇报里说成「机器保证了断言一条未删」。
- **新判据的判据面扩到 `gates/**` 时，`scan-surface-missing` 复用、塌缩另立 id。** missing 的 title（`:499`）本就写成「读不到（test/ 或 src/）子树」的双树形态、处置两树相同；塌缩的处置不同（walker 失效 vs `.selftest.mjs` 发现规则写错），复用会让 `report(id, line)`（`:1607`）与 `isRegistered`（`:649`）都无法分别归因。这条切分与 `gate-has-carrier` / `gate-module-present` 拆开的先例同源。
- **`MIN_SCANNED_FILES = 100` 不可复用。** 分母集合不同（`test/**/*.test.js` vs `gates/**/*.selftest.mjs`），复用会恒红；改同一个常量的值则两棵树共用一个数字，改任一棵会连带改另一棵 —— 那正是 `check-test-layout.mjs:293-295` 那条「两处各写一份字面量」的反面。必须另立，口径照抄 `:279-283`（「实测值的约 3/4，只在塌缩这一档报红，不随日常增删抖动」）。
- **合成根里没有 `gates/` 目录**（只有 C3 那几条夹具显式铺了 `gates/repo/*.mjs`）。新 collector 在合成根上会抛，须按 `indexInRoot`（`:1900`）那条**已有**的范畴边界 gate 住 —— 与 L11 / L11b / C3 完全同源，照抄那三处的注释口径。
- **新 collector 泛化 `collectTestFiles`（`:745-762`）而不是另写 walker。** 那 10 行里有两处非平凡约定（跳过 `node_modules`、不吞 `ctx.listDir` 抛错），而它们正是「恒绿」最常见的来源。另写一份就是复制这两条约定并让它们各自漂移。

### 搬迁时「一条断言都没删」怎么兑现

不是「跑绿就算」。四步，次序不可换（依据同 ADR-068 后果节「期望值需要改才能进表 ⇒ 先查清再动」的纪律）：

1. **先冻结旧计数**：`suite.case(` 出现点数（带 `inString` 守卫，照 `caseContractState` 的做法）· 断言调用点数 · 文件行数。写进提交信息。
2. **建名册再搬**：把旧文件里每个 case 的名字**先**抄成名册。名册一旦是搬完之后补的，它只是新代码的复述，零证明力。
3. **逐行对账**：旧 case 名、旧 `expect` 正则、新表该行的 `expect` 正则，三样任一不等即停。
4. **反向扫**：`git diff` 逐 hunk 找「期望正则被放宽」（`/具体串/` 变 `/^/`、`expectCount` 从 2 变 1、`forbid` 在合行时丢失）。

**最容易被伪装成「等价」的三类**：多行合一行时的**期望合并**（旧两条各断言一个问题、新一条用大正则同时覆盖，case 名集合变了才对账 ⇒ 判据只在名字也改时才抓得到）· **`expectCount` 下调**被当成「合并去重」接受 · **把 bespoke case 塞进表里「顺便简化」**（bespoke 存在的理由就是它装不进表，塞进去等于它的判别力被表格的通用形态削掉）。

---

## 判据现状（本条落地后应成立）

- **窄核 harness 落 `shared/`**：入参纯数据（假仓库树「路径→正文」＋「期望问题清单正则」），harness 自己落盘。入参允许传函数即退回通用测试框架 —— 那是 ADR-068 已否决的终点。
- **恒绿防护照 `smoke-proc.selftest.mjs:99-105` 的形态**：先断非空再断命中（「该情形下没有生效」与「措辞不对」是两种失效，混着判会漏掉后者）。
- **不是全部退化为一张表**：真正 bespoke 的留在原处、不进表（ADR-068 后果节）。