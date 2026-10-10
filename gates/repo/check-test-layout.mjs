// test 布局门禁(纯文本判定,无产物、幂等,exit 0/1)。
//
// ---- `covers` 是什么、不是什么(2026-10-05 实测后写死)----
// **`covers` 是「被测主体清单」,不是「import 清单」。** 这不是约定而是 L4「声明通道」的
// 存在理由:段可以直接 import 本层主体,也可以**声明**自己测的是本层(判据静态看不见
// 那条路径时用)。⚠️ **因此不要提议「covers 与 import 对读」这一族判据** ——
// 实测两条方向都会大量误伤:「声明了却没 import」88 项 / 26 段(主体靠 `fs.readFileSync`
// 的**字符串路径**到达,`.css`/`.html` 天然不可 import,25 段零 import 命中);
// 「import 了却没声明」15 项,且「真漏声明」与「已审过的故意不声明」在 import 图上**完全同形**
// ——区分它需要判断「这段到底在断言什么」,而那已实测无法机器判(见 REQ-185/REQ-189)。
// 另注:同一族判据换个口径,实测结果能差 6.6 倍 ⇒ 选错口径就会产出一批无法归因的红。
//
// ---- 判据一览(编号 ①–⑯,族数**不复述**:取它跑 `node -e "import('./gates/repo/check-test-layout.mjs').then(m=>console.log(m.CRITERIA.length))`")----
//   ① test-layer-self-hosted(L4):`test/<R>/**/<m>.test.js` 必须 import **至少一个**
//      解析后落在 `<R>/` 对应主体根内的模块。零命中即判红并点名该段。
//   ② test-layer-cross-import(L5):`test/<L>/**` 不得 import **别的层**的
//      `dist/<其它层>/` / `src/<其它层>/` / `<其它层>/`。命中判红,诊断直接给出
//      「搬去 `test/behavior/` 并写 `covers`」的处置指引。
//   ③ test-top-dirs-exact(L7):`test/` 顶层**目录**集合 == 镜像源派生集 ∪ {behavior, harness}。
//      多一个少一个都判红。
//   ⑤ gate-has-carrier(L11):每道门禁都要有**可被证明的载体**。三档缺一即红 ——
//      同名 selftest 载体 或 某个验收段引用它 → pass;都不存在 → 查门禁级豁免表;
//      都没有 → 判红。载体存在的全部意义是「有人能证明它坏掉时门禁会红」。
//   ⑥ gate-chain-membership(L12 / L12c):门禁的**接入点归属**。取值域两值
//      (`chain` / `offchain`),两向核对:`chain` 的真在链上、`offchain` 的不得在链上;
//      `offchain` 可带 `pendingChain` 显式登记「本应进链、因 <理由> 未转正」(L12c)。
//      **已转 fail-closed**(2026-10-05,ADR-062 S3):取值域迁移完成 —— 清单侧
//      `gates/repo/gate-index.mjs` 已两值化,迁移后清掉取值域那一档的剩余命中数为零。
//   ⑦ test-harness-not-segment(L8):`test/harness/` 是**自指层**(主体根 = 它自己);
//      其下的段**必须**声明 `covers` 且至少一个元素指向 `test/harness/**`
//      (未声明 / 空声明 / 元素全指向别处,三者各自判红)。
//   ⑧ gate-module-present(L11b):**清单在册而树里无** —— 门禁本体被删除 / 改名时判红。
//      这一档与 `gate-has-carrier` 的处置不同(补载体 vs 恢复本体或删登记项),故单列一个 id。
//   ⑨ test-dist-artifact-source-mirror(C1 档一):段的**被测 import**落在 `dist/**` 时,
//      该产物的镜像源文件(按 tsc 的 emit 规则反推扩展名)必须在 `src/**` 下**真实存在**。
//   ⑩ test-segment-mirror-same-name(C1 档二):段路径镜像某个真实存在的 `src/**` 源文件时,
//      它的被测 import **必须**落在那同一个源文件的**同名**编译产物上。
//   ⑪ test-layer-gate-subject(C3 / L4 第三档):段住在**非门禁层**却 import `gates/` 树
//      ⇒ 判红,除非在**门禁主体豁免表**登记并给出达标理由(判准与 L5 那张表不同,见下)。
//   ⑫ test-segment-local-assert-impl(REQ-220 #08 族一):段里的**顶层** `function assert(`
//      函数体**自带 `throw`** ⇒ 判红。禁的是断言逻辑的第二份实现,不是「段内出现 assert 这个
//      名字」—— `@returns {asserts cond}` 的委派型窄化壳(体内只调 harness 断言)合规,
//      裁决见 `docs/adr/ADR-071-两处判据的形态裁决.md`。判定面是**段**,不是 `test/**`:
//      `test/harness/case.js` 自己就有一个自带 throw 的顶层 assert,按 test/** 全扫会去红
//      它自己要收敛的那个源。⚠ **本族与 ⑬ 已转 fail-closed**;本文件里仍是 report-only 的只有
//      ③ `test-top-dirs-exact` 与 ⑭ `gates-selftest-named-case`(转正 = 删 `CRITERIA` 那行的 pending)。
//   ⑬ test-segment-named-case(REQ-220 #08 族二):每段必须 import case 契约模块**且**至少
//      有一处 `.case(` 调用 ⇒ 否则判红。两个条件缺一不可(见下「两族的判定面与读盘」)。
//   ⑭ gates-selftest-named-case(REQ-221 #09 族一):**门禁树侧**的同一形态 ——
//      每个 `gates/**/*.selftest.mjs` 必须 import case 契约模块(`shared/case.js` 真实现,
//      门禁树引不到 `test/harness/` 见 ADR-074 决定一)**且**至少有一处 `.case(` 调用。
//      ⚠ **它与 ⑬ 不是同一个 id**:判据面不同(`test/**` vs `gates/**`)、对象不同(段 vs
//      门禁自测)、契约模块路径不同(门面 vs 真实现)。`report(id, line)` 与 `isRegistered`
//      都按单个 id 归因,并表会让「哪一侧没接入」在读数上无法分开。
//   ⑮ gates-selftest-surface-collapsed(REQ-221 #09 扫描面):门禁自测份数掉到下限以下 ⇒ 判红。
//      ⚠ **与 `scan-surface-collapsed` 分立**:处置不同(段侧 walker 失效 vs `.selftest.mjs`
//      发现规则写错 / `gates/` 被搬走),复用会让两者的强制等级读数无法分别归因。
//      而 `scan-surface-missing` **复用**:它的 title 本就写成「读不到(test/ 或 src/)子树」
//      的双树形态,处置两树完全相同。
//   ⑯ gates-selftest-case-roster(REQ-221 #09 族二):**case 名集合 ⟷ 登记名册两向差集**。
//      每份 `gates/**/*.selftest.mjs` 旁有一份同名 sidecar 名册(`<基名>.case-roster.json`),
//      判据按登记表的取名策略从源码抽出实际 case 名,与名册**两个方向**对账:
//      册有源无(册里那条 case 已不存在)/ 源有册无(源码里那条没进册)。
//      ⚠ **它与 ⑭ `gates-selftest-named-case` 判的不是一件事**:⑭ 判「有没有接契约」
//      (import + 至少一处 `.case(`),接了之后**删掉一整个 case 不改变任何可数的东西**
//      ——import 还在、`.case(` 仍 ≥1 处。本族补的正是这个缺口。
//      ⚠ **本族已转 fail-closed**(命中进 problems、参与退出码),⑭ 仍是 report-only。
//      两者**分属不同通道**:本族转正后「未接入」与「名册漂移」在读数上才真的分得开 ——
//      转正前两者都只在 info 通道,一条 info 混着两族语义时无法归因。
//
// ---- ⑯ 本族的三条自述边界(下一个会话读到这里时按这三条判断本族能顶什么)----
//
//   **(一)半齿上限:名册型看守的通病,本族不宣称「断言一条未删」。**
//   「删 case + 同批删册」是**一次**改动,判据看不见(两侧同时变 ⇒ 差集仍为空)。
//   本族能抓的是**单侧**漂移:册里留着而源码已删(有人删了 case 忘了删册)、或源码新增而册没跟。
//   ⚠ **因此不得把「名册在册」读成「断言一条未删有机器保证」** —— 后者不成立。
//   两侧同改要靠别的机制:code review 的 diff 并排可见,以及 ADR-074 后果节的「搬迁四步」。
//
//   **(二)登记表与名册各自的可绕面(两者都不是「写了就一定守住」)。**
//   - **登记表**({@link GATE_SELFTEST_CASE_SOURCES})少一行 ⇒ **判红**(树里有那份自测而表里没有它);
//     但「把策略改错而抽出 0 条」也是红 —— 两向差集天然响(册非空而源侧空 ⇒ 全档「册有源无」)。
//     登记表**不可注入**(与 `CRITERIA` / `LAYER_RULES` 同层):能传参就能把自己摘出去,那是 fail-open。
//   - **名册**(sidecar)自身失效三档**判红而非当空表**:读不到 / 缺 `cases` 数组 / 低于
//     {@link MIN_GATE_CASE_ROSTER} 条下限。⚠ 当空表会让两侧同时为空 ⇒ 差集恒空 ⇒ **恒绿**,
//     而恒绿是纯文本门禁最坏的失效形态。**恒绿防护的顺序因此是「先断非空,再断差集命中」。**
//
//   **(三)反扫放宽的方向:本族判的是「名还在不在」,不是「名对不对」。**
//   期望正则被放宽(把 `/x/` 改成 `/x|y/`)那类削弱**不在本族射程内** —— 本族只数名,
//   一个名配一条被放宽的期望,两边照样相等、照样绿。靠搬迁手法(ADR-074 后果节「搬迁四步」):
//   搬迁时把断言**逐字**带过去,而不是让同一批 case 名配上一份被就地放宽的期望。
//   ⚠ 别因本族兜住了「删一条」就以为它也兜住了「削弱一条」。
//
// ---- 登记表怎么维护(改某份自测的用例档之后,按这三步走)----
//
// **① 先跑本族看它报什么**:`node gates/repo/check-test-layout.mjs`。增删档会报「源有册无」
// (新档)或「册有源无」(删掉的档),两条诊断都点名了具体档名与该改哪一处。
// **② 同批改名册**:把新档名加进 / 把删掉的档名从 `<基名>.case-roster.json` 的 `cases` 删掉。
// **③ 若换的是「名从哪儿抽」**(那份自测改了用例表的名字或形态),同批改
// `GATE_SELFTEST_CASE_SOURCES` 里那一行的 `strategies` —— 本表写的是**名从哪儿抽**,
// 不是「有多少条」,条数对不上时先怀疑策略与源码脱节(那一档会直接判红并点名策略)。
//
// ⚠ **「抽出条数 == 该自测自报分母」是播种/改策略时的核对项,不是常驻门禁**:
// 常驻门禁比的是「名册 ⟷ 源码」两向差集,不比条数 —— 两侧同删时条数相等而差集也为空。
// 逐份取分母的命令(一次跑完 20 份,各跑各的自报末行):
//
//   for f in gates/{fixtures,repo,smoke}/*.selftest.mjs; do node "$f" | tail -1; done
//
// ---- L4 为什么必须判「零命中」而不是只判「import 落在别处」 ----
// 一条只检查「不许 import 别层」的规则,在**一个本层主体都没 import** 的段上会全绿 ——
// 而那正是最该被抓的形态:`test/core/runner-report.test.js`(797 行)import 的是
// `test/harness/runner.js`(测试框架自身),`test/shared/entry-exit-guard.test.js` 测的是
// `shared/entry-guard.mjs`,`test/behavior/contract-single-source.test.js` 零 `gates/` import。
// 「至少一个」这条下界(而非「不许越界」那条上界)才是 L4 的全部内容。
//
// ---- L4 的「本层主体根」是什么 ----
// 主体根按层分两种形态,与镜像源集合的两种来源同构:
//   - `src/` 的直接子目录 R → `src/R/` **与** `dist/R/`(源与产物都算本层主体);
//   - 仓顶层树 R(gates/shared/tools)→ 只有 `R/`。
// 为什么 `src/R/` 与 `dist/R/` 都算:本仓的验收段跑**产物**(`dist/` 是 tsc 输出,
// 覆盖率与 `test:smoke` 的新鲜度门禁都以它为准),而类型引用历史上只能指 `src/`
// (前提已随 ADR-069 失效,见下节)。只认其一会把另一半合法形态判红。
//
// ---- 值 import 与 type-only 引用必须分开(否则合法形态被误判) ----
// ⚠ **下面这三条形态描述写于 `declaration: true`(ADR-069)落地之前,前提已失效**:那时
// `dist/` 不产 `.d.ts`,故测试段里有一批**类型引用只能指 `src/`**(形如
// `@typedef {import("../../src/core/i18n.js").ConvertWarning} Warning`)。产物现在带声明
// 文件,测试的类型引用已全量改指 `dist/`,那类 `src/` typedef 在真实段里已不复存在。
// **判据逻辑未受影响**:下面自述的「src/R 与 dist/R 都算主体根」「type-only 计入 ownHits」
// 「C1 两档排除 type-only」三条对 src→dist 的翻转同样成立,过时的只是「类型只能指 src」
// 这个前提(见 REQ-233)。
// type-only 引用合法且必需(判红等于逼人删掉类型标注),这一点与它指 `src/` 还是 `dist/` 无关。
// 判据因此复用 `check-import-boundary.mjs` 导出的 `isTypeOnlyClause`(词法层已区分
// `import type` 与行内 `type` 说明符),并对 JSDoc 里的 `import("…")` 形态单列一条:
// `import("…")` 出现在**代码**里是运行期动态 import,出现在**注释**里才是类型引用 ——
// 两者字面同形,靠 `lexSource` 的「抹注释」结果区分(代码里那个下标在 code 中仍是
// `import(`,注释里那个已被抹成空格)。
//
// ---- C1 的口径:什么算「被测 import」(C1 两档共用,单一定义) ----
//
// 段的 import 一共五类,只有一类进 C1 两档。**逐类给出排除依据**,不写「显然不是被测的」:
//   ① `node:` 内建 / 第三方包(`electron`／`jszip`／`pdf-lib`／`highlight.js`／`iconv-lite`)
//      —— 裸包名,`extractImports` 的 `add()` 只对 `spec.startsWith(".")` 产出 `resolved`,
//      故它们**天然** `resolved === null`。它们不是被测对象,也不是仓内产物。
//   ② `test/harness/**`(测试助手层)—— **测试框架自身**,L4 已把 `harness` 登记为自指层
//      (主体根 = `test/harness/` 自己)。助手不是被测源;实测 140 段对它有 289 处引用,
//      把它算进「被测」会让分母失真、判据退化成「谁引用助手最多」。
//   ③ 其它段(`test/**/<x>.test.js`)—— L4 的「段 import 段」那一档已经判红;C1 再判一次
//      是同一事实报两遍,只会在归因时让人分不清是哪一档的处置。
//   ④ **type-only 引用** —— 编译期擦除。它不是「段取得被测对象的手段」,而是一句类型标注。
//      ⚠ 仓内确有 73 处 `src/**` 的 type-only 引用与 1 处 `dist/**` 的
//      (`test/main/settings.test.js:104` 的 `typeof import("../../dist/main/persist/settings.js")`),
//      **把它们算进分母会把 C1 变成「类型标注写对没有」的检查** —— 那不是这一族要拦的东西。
//      与 L4/L5 排除 type-only 同款取舍(同一个 `isTypeOnlyClause`,不另立口径)。
//   ⑤ **`src/**` 的值引用** —— C1 两档的**判据对象都是 `dist/**`**,源侧只用来做存在性核对
//      (C1 档二还要用它算「同名产物」)。源侧的值引用本身不构成一档:实测 140 段对 `src/**`
//      的值引用**恒为 0**。⚠ 原注释的理由「tsc 不产 `.d.ts`,故类型只能指 `src/`」已随
//      ADR-069 的 `declaration: true` 失效(现在类型也指 `dist/`);该实测结论本身未被复核,
//      要依赖它须先重测(已登记 REQ-233)。
//
// ⇒ 收敂成一句:**被测 import = 解析后落在 `dist/**` 的值引用**。C1 两档都只认这一类。
//
// ---- C1 两档的分工(为什么不是一个判据) ----
//   档一(`test-dist-artifact-source-mirror`)问的是**产物侧**:这个 `dist/**` 产物背后
//   有没有真源文件。它抓的是「段 import 了一个 src 已删 / 从未存在的产物」——
//   `dist/` 是 gitignored 的(`.gitignore:3`),所以**判据不能问「产物在不在版本控制里」**
//   (那对构建产物恒为否),只能**按构建产物路径反推源路径**再问源文件在不在磁盘上。
//   档二(`test-segment-mirror-same-name`)问的是**段侧**:段路径既然镜像了某个 `src/**`
//   源文件,它的被测 import 就**必须**落在那同一个源文件的同名产物上。它抓的是
//   「段自称在测 X、实际测的是 Y」—— 段名与被测对象脱钩。
//   ⚠ 两档的**处置不同**(补源文件 / 补 import 或改段名),故各占一个 id 而不是合成一档。
//
// ---- C3 与 L5 的分工(为什么不是同一族的第二档) ----
// L5 与 C3 都在同一批边上判,但**问的问题不同**,处置也不同:
//   - L5 问「这次跨层 import 在本段里**是不是只提供数据/常量/规格**」⇒ 处置是搬去
//     `test/behavior/` 并写 `covers`,或登记进 L5 豁免表。
//   - C3 问「这个段**住在这一层**对不对」—— 它伸手进了 `gates/` 树,而 `gates/` 是仓里
//     放门禁判定本体的树。一个段住在 `test/shared/` 却 import 门禁判定本体,**即使那次
//     import 真的只提供数据**,段的位置也已经可疑了(它到底在测 shared 还是在测门禁?)。
// ⇒ **L5 表里已登记的边不豁免 C3**:实测 `test/shared/geometry-gate.test.js →
//   gates/geometry/geometry/driver.mjs` 正是这种形态(L5 表里那条 reason 156 字、
//   已按「只提供规格」合法通过 L5),而 C3 仍判红。C3 的处置是**换层**(搬去 `test/gates/`)
//   或**登记门禁主体豁免表**并说明为什么段住在这一层是对的。
//
// ---- 镜像源集合为什么从磁盘派生(两层来源) ----
//   - `src/` 的直接子目录:**从磁盘列**。这是本门禁派生的一半,新增/合并层自动跟随。
//   - 仓顶层树:**取 `check-import-boundary.mjs` 的 `TREE_DIRS` 去掉 `test` 自身**
//     (`gates` / `shared` / `tools`)。不另列一张表 —— 那正是 ADR 判据反复批过的
//     「两份可漂移的副本」;顶层树集合在仓内已有单源(`TREE_DIRS` 是 ADR-038/043 的
//     树边界登记),本门禁读它而不是重抄一遍。
// ⚠ 这与 `SEGMENT_DIRS`(当前硬编码在 `shared/test-common-surface.js:47`)无关:
// 那张表**将在 T2/P2 被删除**,故本门禁**不得**依赖它 —— 段的发现机制是
// `test/harness/runner.js` 逐目录 `readdir` 过滤 `.endsWith(".test.js")`,**纯 glob、
// 无注册表**,本门禁照此发现,不读任何段目录清单。
//
// ---- 强制等级:判据登记表 `CRITERIA` + 唯一分流漏斗 `report(id, line)` ----
//
// 每一族判据发出形如 `<对象> → <机器 id>:<诊断>` 的一行。**这行进 problems 还是 info,
// 不由任何调用点决定,只由本文件的 `CRITERIA` 表决定** —— 全门禁只有一个分流出口:
//
//   report(id, line)  →  查 CRITERIA  →  `pending === true` ? info : problems
//
// 判定本体里不再有第二处 push 到 problems / info 的代码路径(要加一族判据只能经 report),
// 而 CLI 上**没有任何开关能改变这一档**:命令行一档来自表,不是来自 argv。
//
// **缺标记即 fail-closed**:表里查不到 = 进 problems。漏登记的那一族按 fail-closed 处理,
// 但那正是要防的失效形态 —— 登记表的全部意义是「谁该判红」有一个声明处,漏登记等于那一族
// 的强制等级无人负责。故漏斗查不到时**额外**追加一条 `criteria-unregistered:<id>` 判红:
// 不抛异常(那会把一族的漏登记变成整场崩溃,掩盖其余判红)、不静默归 problems(那样从输出里
// 看不出它漏了)、也不丢弃(那等于让这一族静默消失)。
//
// `pending: true` 是**唯一**的 report-only 标记,且必须同时给非空 `pendingReason`。
// 它**不是形参、不是 CLI 开关**:能传参就能把自己摘出去,那本身是 fail-open ——
// report-only 是一个**声明**,声明只改源码。当前待转正的族数:
//
//   grep -nE '^\s*pending: true,$' gates/repo/check-test-layout.mjs
//
// **切换点 = 删掉那一行的 `pending: true`**(连带它的 `pendingReason`)。
// ⚠ 登记表与源码发出的 id 集合**双向相等**由 selftest 的 `sourceAudit` 一档独立钉住:
// 它读本文件源码(不是夹具副本)抽出全部 `→ <机器 id>:` 的 id,与 `CRITERIA` 两个方向都比 ——
// 漏登记(源码有、表里没有)与僵尸行(表里有、源码已删)各红一次:后者会让上面那条 grep 的
// 命中数说谎,而那正是「还剩几族待转正」的唯一读数。
//
// ---- L5 曾恒报告:为什么曾那样,以及它凭什么能转正 ----
// L5 在 T1 建时**当前即红**,且**已知会误伤合理跨层**:实测
// `test/behavior/heading-scale.test.js` import `dist/renderer/settings/settings-logic.js`
// 做 token 对照,`test/shared/geometry-gate.test.js` import `shared/geometry/*`
// (几何 core 本就归 shared),这类跨层是**有意的**。把这种误伤做成 fail-closed,
// 会逼人去删正确的测试或塞豁免表 —— 那比判红本身更坏。故它当时拿的是 report-only 一档。
//
// **转正的前置条件是「未登记命中归零」,不是字面的「命中数 == 0」**:已登记、reason 达标、
// 且当前仍真的命中(stale 检查通过)的豁免项是**合法现状**,不是待办。所以「命中总数不为零」
// 本身不构成阻塞;构成阻塞的是三条 fail-closed 里任一条为红 —— 未登记命中非零 / reason 不合格
// (空**或**不足 `REASON_MIN_CHARS` 字)/ stale 非零。在那个条件下 L5 已转 fail-closed,即
// `CRITERIA` 里 `test-layer-cross-import`
// 那行**不带** `pending: true`。豁免命中在判定本体里 `continue` 掉、根本到不了分流点,
// 因此豁免表在真仓库上实测不产生任何 info 行 —— 那是设计:表项是「已审过的合法现状」,
// 不是待办噪声。
//
// ---- 形状:判定本体 = `checkTestLayout(ctx)`(可注入、零 IO 副作用) ----
// 与 check-src-layout.mjs / check-copy-sites.mjs 同一范式(全仓门禁判定协议,见
// gates/probe/gate-probes/protocol.mjs):IO 全部经 ctx 注入(读文本 / 列目录 /
// 扫描面下限),`main()` 只做「打印 + 按结论出 0/1」。
//
// ---- 入口守卫:必需,不是整洁问题 ----
// 本模块被门禁注册表 import 当判定本体指针。顶层自执行会**改写宿主进程的 exitCode**
// (验收段在 Electron 里跑,而它 import 本模块的时刻不该决定整场验收的退出码);而注册表
// R4b 会逐项对账「judgment.load 声明」与「顶层是否自执行」的事实。守卫写法与
// check-src-layout.mjs / check-import-boundary.mjs / check-changelog.mjs 同形。
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../../shared/cli.mjs";
import { lexSource } from "../../shared/copy-closure.js";
import { ROOT } from "../../shared/paths.js";
import { isTypeOnlyClause, TREE_DIRS } from "./check-import-boundary.mjs";
// 链展开(递归展开 / 顶层视图)与链根都是**全仓单源**:本门禁不自带一份链解析,
// 也不自带一份链根表(见 chain-expand.mjs 文件头「为什么必须收敛到一处」)。
import { CHAIN_ROOTS, expandChainScriptNames } from "./chain-expand.mjs";
// 门禁索引(L11 载体 / L12 链归属的判定面)。**静态 import,不走 ctx** —— 它是代码里的常量
// 表而非磁盘数据,与 readText/listDir 那套 IO 注入面不同性质。替身由 base.gateRegistry
// 注入(见 makeGateRegistryCtx 的注释),理由同 `l5Exemptions`:自检要在合成根上求值。
//
// 本门禁对索引的**结构**依赖刻意收窄到四项 —— `id` / `access` / `npmScripts` / `modulePath` ——
// (`judgment` / `enforcement` 两个字段本门禁一个都不读:前者是驱动器协议的事,后者是「强制等级
// 表在哪」的指针,与 L11/L12 两条判据无关)。`probes[]` 与 `judgmentNote` 在旧 `registry.mjs` 里
// 就有而本门禁一个都不读:读 `probes[].ref` 会让 L11 退化成「注册表自己声明的载体存在吗」,那
// 正是注册表 R3 的既有职责,两处各判一次同一件事 = 一处可漂移的副本。
//
// ⚠ **S3 已改这一处**(2026-10-05):清单从 `gates/probe/gate-probes/registry.mjs` 换成
// `gates/repo/gate-index.mjs`(ADR-062 的 P6)。**两表并存**:旧表随 S4 整体删除,它承载的
// R1–R5c 与三种驱动器在本步一条不动。双跑一致性由 `gate-index.selftest.mjs` 断言。
import { ACCESS_CHAIN, ACCESS_OFFCHAIN, GATE_INDEX, GATE_INDEX_MODULE_REL as GATE_INDEX_SELF_REL } from "./gate-index.mjs";

/** 被判定的子树(单一来源:扫描面只此一处登记) */
export const TEST_REL = "test";
/** 段的扩展名(发现机制与 `test/harness/runner.js` 的 readdir 过滤逐字一致) */
export const SEGMENT_EXT = ".test.js";
/**
 * 允许存在但**不是镜像源**的两个顶层目录。
 *
 * `behavior` 收跨层测试(一个段横跨多层是它的**定义**,不是错位 —— 故它既不在 L4 的
 * 作用域内,L5 也不对它生效);`harness` 收测试框架自身(runner / assert / 夹具助手),
 * 它不是任何被测层的主体。
 *
 * 为什么这两个名字**必须**登记而不能纯派生:L7 的判据形状是「集合相等」,而这两个目录
 * 在仓内**没有对应的镜像源**(它们对应的是「测试的组织方式」而不是「被测的层」)。
 * 纯派生出的集合里没有它们,不给登记位就恒红。注意这与「登记一份镜像源清单」是相反
 * 性质的常量:镜像源那一半从磁盘派生,这里登记的是**派生之外的豁免位**,两者不会互相漂移。
 */
export const NON_MIRROR_TOP_DIRS = Object.freeze(["behavior", "harness"]);
/**
 * **自指层**的段目录名(L4 主体根 + L8 窄口子的作用域标记)。
 *
 * 「自指」= 它的被测主体就是它自己:测「测试框架自身」的段(`runner-report` /
 * `test-common-helpers` / `dual-pipeline-decision-ledger`)主体全在 `test/harness/**`。
 * 它与 `behavior` 的区别要分清:behavior 是**横跨多层**(被测主体在别处,位置不表达被测层),
 * harness 是**主体在本目录内**(被测代码与测试框架同处一树)。
 *
 * 单列成常量(与 `BEHAVIOR_DIR` 同款理由):L4 的 `rootsOf` 分支与 L8 的窄口子都按它判定,
 * 与 `NON_MIRROR_TOP_DIRS` 里那一项指的是同一个目录 —— 两处各写一份字面量就是一处可漂移
 * 的副本,漂移后果是 harness 段静默失去 L8 约束(无人声明也无人报错)。
 */
export const HARNESS_DIR = "harness";
/**
 * **自指层主体根**的前缀(仓相对 POSIX)。L4 的「本层主体根」与 L8 的「元素须指向本层」
 * 用的是同一个前缀常量 —— 写成两处字面量就会出现「L4 认它、L8 不认它」的裂缝。
 */
export const HARNESS_ROOT = `${TEST_REL}/${HARNESS_DIR}/`;
/**
 * 跨层段的段目录名(L6 的作用域标记)。
 *
 * 单列成常量而不是在 L6 里写字面量 `"behavior"`:判据本体与 `NON_MIRROR_TOP_DIRS` 里那一项
 * 指的是同一个目录,两处各写一份字面量就是一处可漂移的副本 —— 而漂移的后果是 L6 静默
 * 失去作用域(behavior 段不再被要求声明,而没人会注意到)。
 */
export const BEHAVIOR_DIR = "behavior";
/**
 * case 级断言契约模块的**仓库相对 POSIX 路径**(「每段接入具名 case」那一族的判据对象)。
 *
 * 单列成常量而不是在判据本体里写字符串字面量:该族的判据形态是「解析后落在这个路径上的
 * **值引用**」,而路径字面量要同时出现在「常量」与「诊断文案」两处 —— 两处各写一份就是一处
 * 可漂移的副本(常量改了诊断还指向旧路径,而门禁只按常量判 ⇒ 诊断开始说谎)。
 */
export const CASE_MODULE_REL = `${HARNESS_ROOT}case.js`;

/**
 * **门禁自测侧**的 case 契约模块仓库相对 POSIX 路径(判据对象是 `gates/` 树下的 `.selftest.mjs`)。
 *
 * ⚠ **它与 {@link CASE_MODULE_REL} 是两个不同的精确路径,且都不是「另一个」**:
 * ADR-074 后果第一条明写 `caseContractState` 白名单的是**一个精确路径** ——
 * 段若改引 `shared/case.js`,`resolved` 不等值 ⇒ 走「没 import 契约模块」那一档判红。
 * 那条裁决说的是**段侧不许改引真实现**(门面不开绕过形态),**不是**全仓只许有一个契约路径:
 * 门禁树引不到 `test/harness/case.js`(`gates-stay-in-gates` 的允许面里没有 `test/harness`),
 * 它要接同一套契约就必须引 `shared/` 侧的真实现(ADR-074 决定一)。
 * 故这里是**第二个白名单项**,由 `caseContractState` 的形参显式传入 —— 缺省值仍是
 * `CASE_MODULE_REL`,段侧那一族的判定一行不改。
 * @type {string}
 */
export const GATES_CASE_MODULE_REL = "shared/case.js";

/**
 * **门禁层**的段目录名(C3 的作用域排除项 —— `test/gates/**` 的段不参与 C3)。
 *
 * 单列成常量而不是在 C3 里写字面量 `"gates"`:段目录名与 `GATES_TREE` 的树前缀是同一个
 * 名字在两处出现,各写一份字面量时改名只改一半的后果是「C3 突然把门禁段全判红」
 * (实测 31 项)—— 而那正是判据最容易归因失败的一类红。
 *
 * ⚠ 它与 {@link GATES_TREE} 是**两个不同的字面量**(`"gates"` vs `"gates/"`):前者是
 * `test/` 下的**段目录名**,后者是仓根下的**树前缀**。写成同一个常量会让「段目录」
 * 与「树」这两个不同层级的概念共用一个值。
 */
export const GATES_DIR = "gates";
/**
 * 扫描面(段)文件数下限:walker 整体失效(零段)时五族判据会「全绿」,而恒绿是纯文本门禁
 * 最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。取实测值的约 3/4
 * (实测 134 段 → 下限 100),只在「塌缩」这一档报红,不随日常增删段抖动。
 */
export const MIN_SCANNED_FILES = 100;
/**
 * L5 跨层 import 的**豁免表**(数据文件路径,与门禁本体分离 —— 本体里那份会是可漂移的副本)。
 *
 * 形态是 `(段路径, 说明符)` **二元组**,不是段级全放行:一张段级表项就能掩盖该段将来
 * 所有新增的跨层 import,而那正是这张表要拦的东西。粒度收到说明符一级,「同段新增一条
 * 跨层 import」就仍然判红。
 *
 * 表项的合法性由三条 fail-closed 撑着(判据见 judgeL5Exemptions 的注释):未登记判红、
 * reason 不合格判红(空**或**不足 `REASON_MIN_CHARS` 字)、**stale 判红**(登记了却当前不再命中
 * —— ratchet 的全部意义:否则删掉
 * 代码而豁免永远留着,表只会单调增长)。
 *
 * 豁免的判准写在数据文件的 `exemptionCriterion` 字段里(单一来源,改判准只改那一处)。
 */
export const L5_EXEMPTIONS_REL = "gates/repo/test-layout.cross-import-exemptions.json";

/**
 * 门禁索引的模块路径(仓相对 POSIX)。**S3 已把它从 `gates/probe/gate-probes/registry.mjs`
 * 改成 `gates/repo/gate-index.mjs`**;旧表在 S4 整体删除。
 *
 * 单独成为常量而不是在 import 语句与诊断文案里各写一遍:该路径出现在诊断文案里(判红时
 * 点名「哪张表错了」),两处各写一份就是一处会与 import 语句漂移的副本 —— 而漂移的后果是
 * **诊断点名一张表、判据实际读的是另一张**。
 *
 * ⚠ 值从 `gate-index.mjs` **转出**而不是在本文件重写:那张表是自身路径的单一事实源,
 * 两处各写一份则「禁自指」规则(指针不得指向本表)会在 S4 后指向一个错的文件。
 * @type {string}
 */
export const GATE_INDEX_MODULE_REL = GATE_INDEX_SELF_REL;

/**
 * L11 门禁级豁免表(数据文件路径,与门禁本体分离 —— 本体里那份会是可漂移的副本)。
 *
 * 形态是**门禁 id 一元组**(不是 npm script、不是段路径):L11 的判定对象是「一道门禁有没有
 * 载体」,载体挂在门禁上,故键只能是门禁 id。
 *
 * ⚠ **本表是空表**:实测(L11 三档跑在真实仓库上)当前**零命中** —— 在册门禁里一部分有同名
 * selftest 载体、其余被某个验收段引用(见 judgeL11Carrier 的注释),无一落到档 3。表按
 * ADR-062 的形态先建成骨架(键名校验 / 读表 / stale 三档 fail-**closed** 全部就位),
 * 而不是等第一次命中再建 —— 那正是「第一次命中」时最需要它的时刻。
 *
 * ⚠ **它不可从本文件现有的任何常量派生**,故必须新建而不是复用:
 *   - `SEGMENT_DIRS`(段目录名表,与门禁无关,且本文件已明写「不读 SEGMENT_DIRS」);
 *   - `SCAN_TARGETS`(扫描面,与门禁无关);
 *   - `L5_EXEMPTIONS_REL` 那张表(形状是 `(段, 说明符)`、语义是跨层 import,与门禁无交集)。
 * @type {string}
 */
export const GATE_EXEMPTIONS_REL = "gates/repo/test-layout.gate-exemptions.json";

/**
 * C3(`test-layer-gate-subject`)的门禁主体豁免表 —— **一张新表,不复用 L5 那张**。
 *
 * 形态是 `(段路径, 说明符)` **二元组**,与 L5 同款粒度:一张段级表项会让该段将来新增的
 * 任何一条 `gates/` 跨层边都被放行,而那正是这张表要拦的东西。
 *
 * ⚠ **为什么必须新建而不是复用 `L5_EXEMPTIONS_REL`**(理由见文件头「C3 与 L5 的分工」):
 * 两张表**问的不是同一个问题** —— L5 问「这次 import 是不是只提供数据」,C3 问
 * 「这个段住在这一层对不对」。若并表,`test/shared/geometry-gate.test.js` 那条已按
 * 「只提供规格」合法登记的边会**连 C3 一起豁免掉** ⇒ C3 在真实仓库上恒为零命中,
 * 即「建了机制但没有任何一处真的判过红」。那与没有这一族不可区分。
 *
 * ⚠ **本表当前只有一条表项**,是实测判红的现存一处(见数据文件里该表项的 reason)。
 * 后续新增命中时,`--write-l5-exemptions` 那样的生成入口**刻意不提供**:
 * 本表的表项**不是「先豁免后补理由」的正当形态** —— 它登记的是「这个段的层归属是对的,
 * 而门禁主体在这里是被测输入」,写不出这句话就说明该搬段而不是该登记。
 *
 * 表项合法性由三条 fail-closed 撑着:键名写错判红 / reason 不达标判红(空**或**不足
 * `REASON_MIN_CHARS` 字)/ **stale 判红**(登记了却当前不再命中 —— ratchet 的全部意义)。
 *
 * ⚠ **数据文件与本体分离**(与另两张豁免表同款):本体里那份常量会是可漂移的副本,而
 * 本仓反复批过那种副本。表项的演进(段被搬走 / import 被删)因此**表现为对数据文件的
 * 编辑**,而判据本体一行不动 —— 这与「改判据语义」在 diff 上彻底分开。
 *
 * 豁免的判准写在数据文件的 `exemptionCriterion` 字段里(单一来源,改判准只改那一处)。
 * @type {string}
 */
export const GATE_SUBJECT_EXEMPTIONS_REL = "gates/repo/test-layout.gate-subject-exemptions.json";

/**
 * `dist/**` 产物扩展名 → 其镜像 `src/**` 源文件的**候选**扩展名(按 `tsconfig.json` 的
 * `outDir: dist` + `module: NodeNext` 的 emit 规则反推,**不是**一份登记的镜像源清单)。
 *
 * ⚠ **为什么候选是「一组」而不是一个**:`.js` 产物可能来自 `.ts`(常规)、`.tsx`(JSX)或
 * **`.js` 本身**(`allowJs` 形态)。实测仓内 `src/renderer/lang-bootstrap.js` 就是后者 ——
 * 它是 git 跟踪的源文件,而 tsc 把它原样复制到 `dist/renderer/lang-bootstrap.js`
 * (实测两文件字节数相同)。**只认 `.ts` 会把这类合法产物判红**,而 `.js` 的判红才是
 * 本族要抓的「src 已删 / 从未有」形态。`.mjs` ← `.mts`、`.cjs` ← `.cts` 是 NodeNext 的
 * 模块后缀配对。
 *
 * ⚠ **判据据此推的是「源侧」的存在性,不是「产物侧」的在版本控制里**:见头注「C1 档一」。
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ARTIFACT_SOURCE_EXTS = Object.freeze({
  ".js": Object.freeze([".ts", ".tsx", ".js"]),
  ".mjs": Object.freeze([".mts"]),
  ".cjs": Object.freeze([".cts"]),
});

/**
 * `src/**` 源文件扩展名 → 它编译出的 `dist/**` 产物扩展名(C1 档二算「同名产物」用)。
 *
 * 与 {@link ARTIFACT_SOURCE_EXTS} 是**互逆关系**(那份「产物 → 哪些源可能产出它」,
 * 这份「源 → 它产出哪个产物」)。两份方向不同、用途不同,故各写一份;⚠ 若 tsc 的
 * emit 规则变了(新增后缀配对),**两份必须同批改** —— 档一靠前者抓「源不存在」,
 * 档二靠后者算「同名产物」,任一份单独漂移的后果是同一族的两档给出互相矛盾的结论
 * (一份说「产物无源」、另一份说「段没落在同名产物上」)。
 *
 * `.ts` / `.tsx` → `.js`、`.mts` → `.mjs`、`.cts` → `.cjs`、`.js` → `.js`。
 * @type {Readonly<Record<string, string>>}
 */
export const SOURCE_ARTIFACT_EXTS = Object.freeze({
  ".ts": ".js",
  ".tsx": ".js",
  ".mts": ".mjs",
  ".cts": ".cjs",
  ".js": ".js",
});

/** 编译产物树与源树的仓相对前缀(各写一份的代价:两处字面量各改一半 ⇒ 判据静默恒红/恒绿) */
export const DIST_TREE = "dist/";
export const SRC_TREE = "src/";

/**
 * **门禁树**的仓相对前缀(C3 的判据面)。
 *
 * ⚠ **为什么是常量而不是从 `TREE_DIRS` 派生**:`TREE_DIRS` 的四个值是 `gates` / `shared` /
 * `tools` / `test`,「哪一个是门禁树」**不是**那棵树的结构属性、而是它的**角色** ——
 * 判据要问的是「段有没有把手伸进门禁判定的本体」,而 `gates/` 是仓里放门禁本体的位置。
 * 从 `TREE_DIRS` 里挑一个(`topTrees[0]` 之类)会得到一个**随表序漂移**的答案:
 * 表里换一行顺序,C3 的判据面就静默变成 `shared/` —— 而那正是「判据指向了另一棵树」
 * 这一类最难归因的红。写成字面量并在此单列,是刻意的。
 *
 * 另注:**它与 L5 的豁免表覆盖面不同**。L5 判「跨层 import」不限哪棵树;C3 只问 `gates/`。
 * `rootsOf("gates")` 同样是 `["gates/"]`,与本常量一致(两处若漂移,C3 与 L4 的主体根
 * 会对同一段给出不同结论 —— 判据面必须单源)。
 */
export const GATES_TREE = "gates/";

/**
 * **门禁自测扫描根**(仓相对 POSIX 目录名,walker 的起点 —— 与 {@link GATES_TREE} 是同一棵
 * 树的两种形态:后者带尾斜杠是因为它拿去做 `startsWith` 的前缀,walker 要的是能直接
 * `ctx.listDir(relDir)` 的**目录名**,故去掉尾斜杠。**从 `GATES_TREE` 派生而不是另写一份
 * 字面量**:两处各写一个 `gates`,漂移后果是「门禁树搬走了而自测扫描面还指着旧处」——
 * 而那一族在零扫描面下会全绿(见 {@link MIN_SELFTEST_FILES})。
 * @type {string}
 */
export const GATES_SELFTEST_ROOT = GATES_TREE.slice(0, -1);

/**
 * 门禁自测文件的扩展名(判据面的「什么算一份自测」的唯一声明处)。
 *
 * ⚠ **它与 L11 载体派生里那个 `.selftest.mjs` 是同一个扩展名**,故那处也引这个常量而不是
 * 各写一份:「什么算载体」与「什么算自测」是两个概念,但**指的是同一批文件**,漂移会让
 * L11 说「有载体」而自测扫描面看不见它。
 * @type {string}
 */
export const GATES_SELFTEST_EXT = ".selftest.mjs";

/**
 * **case 登记名册 sidecar 的扩展名**(⑯ `gates-selftest-case-roster` 族判据面的另一半)。
 *
 * 形态:与被看护的自测**同名同目录**、只把后缀从 `.selftest.mjs` 换成 `.case-roster.json`
 * (如 `gates/repo/check-docs.case-roster.json` 配 `gates/repo/check-docs.selftest.mjs`)。
 * **同目录而不是全部堆进 `gates/repo/`**:20 份自测分属四棵子树(`repo`/`smoke`/`fixtures`/
 * 未来新增),名册与它的自测同目录 ⇒ 新增自测时名册的位置是**看文件名就知道**的,
 * 而一张集中表会让「谁的名册在哪」变成第二道要人记的知识。
 *
 * ⚠ 派生而非登记:{@link caseRosterRelFor} 由自测路径**算**出名册路径,两处各写一份
 * 「后缀映射」就是一处会与发现规则漂移的副本。
 * @type {string}
 */
export const GATE_CASE_ROSTER_EXT = ".case-roster.json";

/**
 * 名册条数下限(`cases` 数组少于它 ⇒ 判红)。
 *
 * ⚠ **恒绿防护的第一道**:两侧同时为空时两向差集恒为空 ⇒ 本族「全绿」。
 * 那个形态必须被判红而不是放过 —— 名册是「这条 case 存在过」的人工凭证,
 * 空名册不证明任何事,只证明没人填。
 *
 * 取 1(而不是「必须等于源码抽出的条数」):条数相等由两向差集**自然**给出
 * (两个等势集合差集为空 ⇔ 条数相等),下限这一档只负责挡「两侧同时为空」。
 * @type {number}
 */
export const MIN_GATE_CASE_ROSTER = 1;

/**
 * 取名策略登记表在**源码里的位置**的可 grep 锚(只出现在诊断文案里)。
 *
 * ⚠ 它是本文件自身的路径 + 导出名,不是另一个文件 —— 登记表是**判定本体的常量**
 * (形态理由见 {@link GATE_SELFTEST_CASE_SOURCES}),与另三张 sidecar 表不同。
 * 单列成常量而不是在诊断文案里各写一遍:那句文案出现两次以上,两处各写一份
 * 就是一处会与导出名漂移的副本,而漂移的后果是「诊断点名一个不存在的锚」。
 * @type {string}
 */
export const GATE_SELFTEST_CASE_SOURCES_FILE = "gates/repo/check-test-layout.mjs#GATE_SELFTEST_CASE_SOURCES";

/**
 * 一份门禁自测的**取名策略**(⑯ 族登记表 {@link GATE_SELFTEST_CASE_SOURCES} 的行形状)。
 *
 * @typedef {object} GateCaseSource
 * @property {string} file 门禁自测路径(仓相对 POSIX)
 * @property {readonly {kind: string, table?: string, field?: string, wrapper?: string, call?: string}[]} strategies
 *   取名策略列表(一份自测可能同时用几类,如「表内用例走表 + 表外 bespoke 逐条内联」)。
 *   五类取值(⚠ 全部经 `extractGateCaseNames` 落成同一形状:抽出的字符串数组):
 *   - `inline-case`:内联字面量 `suite.case('…')` 的首参;
 *   - `table-field`:某个 `[A-Z_]+ = [...]` **顶层**表里 `field` 字段的字面量值
 *     (`{table:"CASES", field:"name"}` / `{table:"MUTATIONS", field:"id"}`);
 *   - `call-cases-field`:内联在 harness 调用实参里的 `cases: [...]` 数组中 `field`
 *     字段的字面量值(`{call:"runSyntheticRootCases", field:"name"}`)—— 与上一类只差
 *     「表在哪」,不是同一形态;
 *   - `wrapper-first-arg`:本地 wrapper 的首参字面量(`{wrapper:"check"}`)。
 *
 * ⚠ **登记表只准写已实现的 kind**:未实现的 kind 会落进「抽出 0 条 ⇒ 判红」那一档
 * (响而不哑),但那是**误报**不是保护 —— 真需要新形态时,先在 `extractGateCaseNames`
 * 里实现该分支、再登记,并补一条取名层直测夹具钉住它。
 */

/**
 * ⚠ **⑯ 族的取名策略登记表**(判定本体的常量、**不是 CLI 可传项**)。
 *
 * 形态照 `check-html-const-mirror.mjs` 的 `MIRROR_PAIRS` 先例:**登记表是判定本体的常量**。
 * ⚠ 它**刻意不注入 ctx**:能传表就能把自己摘出去,那本身是 fail-open
 * (与 `CRITERIA` / `LAYER_RULES` 同层纪律)。自测靠「在合成树里造同路径的自测 + 同一份名册」
 * 来覆盖各类策略,不需要换表。
 *
 * ⚠ **本表必须逐份齐全:少一行即判红**(树里有那份自测而表里没有它 ⇒ 那一档判红)。
 * 这是「登记表自身漂移」的唯一看守 —— 少登记一个文件等于那一份自测**静默退出本族判定面**,
 * 而症状是「全绿」(与恒绿同族)。反过来多一行(树里已无这份自测)也判红(stale)。
 *
 * 逐行的取名策略怎么定的:{@link extractGateCaseNames} 在本表每一行上跑出的条数与该自测
 * **自己打印的分母**逐份相等(20/20;取数命令见文件头「登记表怎么维护」——
 * ⚠ 那是**指针**而不是条数快照:条数随夹具增删变,把它抄进注释就会变成一处会腐化的数字)。
 * 改动某份自测的用例表(增删档)时,**先跑本族看它报什么**,
 * 再同批改本表 —— 本表里写的是「名从哪儿抽」,不是「有多少条」。
 *
 * @type {readonly GateCaseSource[]}
 */
export const GATE_SELFTEST_CASE_SOURCES = Object.freeze([
  Object.freeze({
    file: "gates/fixtures/gen-fixtures.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CASES", field: "name" }),
      Object.freeze({ kind: "inline-case" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-changelog.selftest.mjs",
    // ⚠ 表驱动档**分三张表**:JUDGE_CASES 走合成根 harness(它自己汇成 case)、
    // JUDGE_GREEN_CASES 是「零问题」判绿档、CLI_CASES 是进程级(退出码 + 输出)。
    // ⚠ CLI_CASES 的档内含 `expect: /…\`## \[\` 版本条目/` 这类**正则字面量**,
    // 而 lexSource 不掩正则 ⇒ 配平必须跳被 `\` 转义的方括号(见 matchingBracket)。
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "JUDGE_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "JUDGE_GREEN_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "CLI_CASES", field: "name" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-ci-contract.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CASES", field: "name" }),
      Object.freeze({ kind: "inline-case" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-copy-sites.selftest.mjs",
    // 纯内联档:逐组一条 `await suite.case('…')`,没有用例表。
    strategies: Object.freeze([Object.freeze({ kind: "inline-case" })]),
  }),
  Object.freeze({
    file: "gates/repo/check-coverage-zero.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CASES", field: "name" }),
      Object.freeze({ kind: "inline-case" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-docs.selftest.mjs",
    strategies: Object.freeze([Object.freeze({ kind: "table-field", table: "CASES", field: "name" })]),
  }),
  Object.freeze({
    file: "gates/repo/check-samples.selftest.mjs",
    // ⚠ 唯一一份**两套字段名**的:基线档取 `CASES.name`,变异实验取 `MUTATIONS.id`
    // (mutation.id 是它的档名,与基线不同源 —— 见那份自测的注释)。
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "MUTATIONS", field: "id" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-src-layout.selftest.mjs",
    // ⚠ **唯一一份「内联表」形态**:表驱动档走三张顶层表,而白名单 / 塌缩那 4 组把
    // `cases: [...]` **就地内联**在 `runSyntheticRootCases({...})` 的实参里 ——
    // 顶层表定位看不见它们,必须单列 `call-cases-field`(缺了它少抽 4 条)。
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "JUDGE_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "JUDGE_GREEN_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "CLI_CASES", field: "name" }),
      Object.freeze({ kind: "call-cases-field", call: "runSyntheticRootCases", field: "name" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-temp-cleanup.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CASES", field: "name" }),
      Object.freeze({ kind: "inline-case" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-test-layout.selftest.mjs",
    // ⚠ 单一表档:全部夹具都在顶层 `CASES` 里(表外两处是夹具**源码字符串**里的
    // `suite.case(`,已被 inString 掩码排除 —— 它们是被判据读的字面量,不是本自测自己的 case)。
    // ⚠ 而**定位**也必须过那道掩码:那份合成 `TABLE_NAME_SELFTEST` 里有一份
    // `const CASES = Object.freeze([` 在字面量内部且排在真表之前(见 arrayLiteralSpans)。
    strategies: Object.freeze([Object.freeze({ kind: "table-field", table: "CASES", field: "name" })]),
  }),
  Object.freeze({
    file: "gates/repo/check-test-numbering.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "JUDGE_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "JUDGE_GREEN_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "CLI_CASES", field: "name" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/check-transform-dispatch.selftest.mjs",
    strategies: Object.freeze([Object.freeze({ kind: "table-field", table: "CASES", field: "name" })]),
  }),
  Object.freeze({
    file: "gates/repo/check-tscheck-coverage.selftest.mjs",
    strategies: Object.freeze([Object.freeze({ kind: "table-field", table: "CASES", field: "name" })]),
  }),
  Object.freeze({
    file: "gates/repo/gate-index.selftest.mjs",
    strategies: Object.freeze([Object.freeze({ kind: "table-field", table: "CASES", field: "name" })]),
  }),
  Object.freeze({
    file: "gates/repo/gen-archive-index.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CHECK_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "PREPARE_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "CLI_CASES", field: "name" }),
    ]),
  }),
  Object.freeze({
    file: "gates/repo/gen-gate-ids-table.selftest.mjs",
    // 纯内联档:逐条 `await suite.case("…")`,零用例表。
    strategies: Object.freeze([Object.freeze({ kind: "inline-case" })]),
  }),
  Object.freeze({
    file: "gates/repo/release-notes.selftest.mjs",
    // 纯内联档:逐条内联(它不进 harness,单引号形态)。
    strategies: Object.freeze([Object.freeze({ kind: "inline-case" })]),
  }),
  Object.freeze({
    file: "gates/smoke/check-build-fresh.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "PURE_CASES", field: "name" }),
      Object.freeze({ kind: "table-field", table: "CLI_CASES", field: "name" }),
      Object.freeze({ kind: "inline-case" }),
    ]),
  }),
  Object.freeze({
    file: "gates/smoke/smoke-proc.selftest.mjs",
    strategies: Object.freeze([
      Object.freeze({ kind: "table-field", table: "CASES", field: "name" }),
      Object.freeze({ kind: "inline-case" }),
    ]),
  }),
  Object.freeze({
    file: "gates/smoke/smoke-report.selftest.mjs",
    // ⚠ **唯一一份 wrapper 档**:它把本地 runner `check()` 接到 `suite.case(name, …)`,
    // 档名全是 `await check('<档名>', body)` 的首参字面量 —— 没有一处内联 `.case(`。
    strategies: Object.freeze([Object.freeze({ kind: "wrapper-first-arg", wrapper: "check" })]),
  }),
]);

/**
 * 扫描面(门禁自测)文件数下限:`.selftest.mjs` 的发现规则写错 / `gates/` 被搬走时,这一族
 * 判据会在零扫描面下「全绿」,而恒绿是纯文本门禁最坏的失效形态(没人会去看一个总是
 * exit 0 的脚本)。取实测值的约 3/4(实测 20 份 → 下限 15),只在「塌缩」这一档报红,
 * 不随日常增删自测抖动。
 *
 * ⚠ **它不可复用 {@link MIN_SCANNED_FILES}**:两者的**分母集合不同**
 * (`test/` 下的 `.test.js` vs `gates/` 下的 `.selftest.mjs`),复用会恒红;而改同一个常量的值
 * 则两棵树共用一个数字,改任一棵会连带改另一棵 —— 那正是本文件里「两处各写一份字面量」
 * 那条纪律的反面。两棵树各有一个下限,是它们分母不同的**记账**,不是重复。
 * @type {number}
 */
export const MIN_SELFTEST_FILES = 15;

/**
 * 门禁「接入点归属」的取值域(ADR-062 L12:两值)。`chain` 的真在链上,`offchain` 的不得在。
 *
 * ⚠ **从 `gate-index.mjs` 转出而不是在这里重写**:取值域是**那张表的字段契约**(它写
 * `access: "chain"` / `"offchain"`),定义权在表那一侧。两处各写一份字面量,表改了取值名
 * 而判定侧没跟上时,判据会把**表里全部登记项**报成「取值域非法」—— 而那正是本门禁最难归因的
 * 一类红(诊断指向每一项,而真因是常量漂移)。登记项数随新增门禁变,要重新取它跑
 * `node -e "import('./gates/repo/gate-index.mjs').then(m=>console.log(Object.keys(m.GATE_INDEX).length))"`。
 */
export { ACCESS_CHAIN, ACCESS_OFFCHAIN };

/**
 * **未转正的旧取值**(`local` / `workflow`)。
 *
 * 单列成常量而不是在判定本体里写字面量:它们是「取值域不合法的证据」,而取值域一旦合法
 * 就该整体消失 —— 让判据能**指名道姓**地说出「哪个旧值还剩几项」,比只报「取值域非法」可归因。
 *
 * ⚠ **`gate-index.mjs` 已无这两个取值**(S3 的迁移完成),本常量当前**只**在两处发挥作用:
 * ① 诊断文案点名旧值;② 并存期的旧 `registry.mjs` 若被谁原样搬进新表,判据会指名道姓地说出
 * 「它是 S3 尚未迁移的旧值」。**不删** —— 删掉它就只剩「取值域非法」一句,读者无从判断
 * 该改字面名还是该改语义。
 * @type {readonly string[]}
 */
export const LEGACY_ACCESS_VALUES = Object.freeze(["local", "workflow"]);

/**
 * L5 豁免表 `reason` 的**最低码点数**。声明出处:`ADR-062` 的 L2「每条豁免须有
 * `reason`(≥20 字)」—— 在此之前这道门槛**只写在 ADR 里、门禁上没有任何机器判据**
 * (判定本体只判 `trim()` 后为空),故「≥20 字」长期是一句无人执行的散文。
 *
 * 单列成常量而不是在判定本体里写裸字面量 `20`:ADR-062:72 是它的声明出处,而门禁里
 * `L5_EXEMPTIONS_REL` / `PENDING_PREFIX` 这类可 grep 的锚是同款做法 —— 判据得追得到它的出处。
 *
 * ⚠ **数字符,不是数字节,也不是数字符宽度**;且数的是**码点**:
 *   - 先 `trim()` 再数 —— 首尾空白不该计入理由的篇幅(缩进排版不是理由)。
 *   - 数码点(`[...s].length`)而非 `String.prototype.length`:后者数的是 UTF-16 **单元**,
 *     一条用非 BMP 字符(emoji / 汉字扩展区)写的理由在 `.length` 下会被算成两倍 ——
 *     门槛就成了可绕过的。本表现有 `reason` 全是 BMP 中文,两者当前相等,但那是数据事实,
 *     不是判据保证。自检里有一格专门拿非 BMP 字符钉住这个口径。
 *
 * @type {number}
 */
export const REASON_MIN_CHARS = 20;

/**
 * `reason` 的有效字数:**先 trim,再数码点**。判定本体与「恰好等于门槛」那格自检的同口径来源
 * (自检经诊断里回显的字数断言,不直接调本函数 —— 用被测实现造夹具会让那一格自证)。
 * @param {string} text 待量的 `reason` 原文
 * @returns {number} trim 后的码点数
 */
const reasonChars = (text) => [...text.trim()].length;

/**
 * ⚠ **判据登记表(强制等级的唯一声明处)**。
 *
 * 一行 = 一个机器 id。**键必须是源码里实际发出的那个 id**(即诊断行里 `→ <id>:` 那一段),
 * 而不是 L4–L8 的编号:按编号建表会漏掉三族不带编号的判据
 * (`scan-surface-missing` / `scan-surface-collapsed` / `l5-exemption-stale` / 豁免表本身
 * 的读表与键名两档),而漏登记的后果就是那一族的强制等级无人负责。
 *
 * 字段:
 *   - `id` —— 漏斗 `report(id, line)` 的查表键,与源码发出的机器 id 逐字相等;
 *   - `title` —— 人读的一行判据名(诊断与自检报告用);
 *   - `pending` —— **缺省即 fail-closed**。`true` = report-only(命中进 info、结构上不参与退出码),
 *     且**必须**同时给非空 `pendingReason`(写不出理由就不该挂待办标记);
 *   - `pendingReason` —— 为什么这一族还不能转判红;也是转正时要先核掉的那条。
 *
 * **不可注入**(与 `LAYER_RULES` 同层):能传参就能把自己摘出去,那本身是 fail-open。
 * 唯一例外是自检用的 `criteriaOverride`,它**只允许删行、不允许加 `pending`** ——
 * 见 `resolveCriteria` 的注释与 selftest 里那两条夹具的说明。
 *
 * ⚠ **它与「哪些族存在」是耦合的**:改判据集合必须同改这张表,反向亦然。漏了任一边,
 * selftest 的 `sourceAudit` 那一档立刻红(它对两个方向都断言)。
 */
export const CRITERIA = Object.freeze([
  Object.freeze({
    id: "scan-surface-missing",
    title: "扫描面读不到(test/ 或 src/ 子树):门禁什么也没查而输出是 exit 0,判红",
  }),
  Object.freeze({
    id: "scan-surface-collapsed",
    title: "扫描面塌缩(段数掉到下限以下):五族判据在零扫描面下会全绿,判红",
  }),
  Object.freeze({
    id: "test-layer-self-hosted",
    title: "L4 段必须自托管(至少一个引用落在本层主体根内,且不得段 import 段)",
  }),
  Object.freeze({
    id: "test-layer-cross-import",
    title: "L5 跨层 import:未登记判红 / 已登记但 reason 为空或不足 20 字判红(走豁免表)",
  }),
  Object.freeze({
    id: "l5-exemption-table",
    title: "L5 豁免表自身失效(读不到 / 缺 entries 数组 / 表项键名写错):整张表静默失效,判红",
  }),
  Object.freeze({
    id: "l5-exemption-stale",
    title: "L5 豁免表项当前不再命中(stale,ratchet):否则表只增不减、失效项永远占位",
  }),
  Object.freeze({
    id: "behavior-covers-declared",
    title: "L6 covers 声明:behavior 段必须声明且非空,每个元素必须在磁盘上真实存在",
  }),
  Object.freeze({
    id: "test-harness-not-segment",
    title: "L8 自指层(harness)下的段必须声明 covers 且至少一个元素指向本层",
  }),
  Object.freeze({
    id: "test-top-dirs-exact",
    title: "L7 test/ 顶层目录集合必须恰好等于镜像源派生集 ∪ {behavior, harness}:多一个缺一个都判红",
    pending: true,
    pendingReason:
      "L7 已知多 0 / **缺 1**(`test/tools/` 空目录已裁决不建)。缺的那一档不是「还没做」而是"
      + "「期望状态里就没有它」—— 把它做成 report-only 是为了让 L7 不挡住其余各族转判红,"
      + "而不是承认 L7 已成立。转正前必须处置缺的那一档(把它移出派生集,或建出真实内容),"
      + "而不是给判据加豁免。",
  }),
  // ---- ADR-062 的 L11 / L12(S2 新增两族,S3 补第三族并给 L12 转正)----
  Object.freeze({
    // ⚠ **L11 的四档共用这一个 id**(载体缺失 / 豁免表读不到 / 表项键名错 / 表项已失效)。
    // 与 L5 拆成 `l5-exemption-table` + `l5-exemption-stale` 两行的取舍相反,理由:
    // L5 那两行要**不同档** —— stale 表项要判红但它是「表项该删」而非「门禁缺载体」;
    // 而 L11 这四档的**结论与处置完全同一件**(这道门禁没有可被证明的载体,补载体或登记豁免),
    // 拆成多行只会让 `--help` 的计数虚增、并在转正时要同批删多行。
    id: "gate-has-carrier",
    title:
      "L11 门禁必有载体:同名 selftest 载体或引用该门禁的验收段,二者皆无且不在门禁级豁免表 → 判红;"
      + "豁免表读不到 / 缺 entries / 表项键名错 / 表项已不再需要(stale)也归本行判红",
  }),
  Object.freeze({
    // ⚠ **单列一族而不是并进上面的 `gate-has-carrier`**:那一族的四档处置**完全同一件**
    // (「这道门禁没有载体」→ 补载体或登记豁免);本档的处置是另一件 —— **恢复门禁本体,
    // 或把登记项删掉**(两者都不是「补载体」)。并进去的话,读者拿到「缺载体,补一份
    // `.selftest.mjs`」的指引去做的事根本解不开这一档(补多少个载体都没用:树里没有那个模块)。
    //
    // **为什么必须有这一档**(S2 明确留下的缺口):判定面曾收窄到「本求值根里真实存在的门禁」
    // (见下方 checkTestLayout 里那段注释),门禁本体被**删除**时它会静默离开判定面。那天靠
    // 旧注册表 R4(`judgment.module` 指针解析不到)与 check-import-boundary 兜着,
    // **但 R1–R5c 全部随 S4 消失**,届时这道缺口无人守。
    id: "gate-module-present",
    title:
      "L11b 清单在册而树里无:索引登记的门禁其 modulePath 在求值根里不存在 → 判红"
      + "(门禁本体被删/改名会让它静默离开 L11 的判定面,而它的载体、链归属同时无人核对)",
  }),
  Object.freeze({
    // L12 与 L12c **共用这一个 id**:L12c 是 L12 的取值域为两值之后才生效的**附加档**
    // (offchain 可带 pendingChain 声明「本应进链、因 <理由> 未转正」),两者的前置与转正时机
    // 完全相同(都要等 S3 的取值域迁移)。拆两行会让「还剩几族待转正」这个唯一进度读数虚增。
    //
    // ✅ **已转 fail-closed(2026-10-05,S3)**:转正的前置是「一次取值域迁移 + 剩余命中为零」,
    // 两条都兑现了 —— 清单侧 `gate-index.mjs` 已把旧表的 `local` / `workflow` 逐条收成
    // `offchain`,迁移后本族清掉取值域那一档的剩余命中数为零(取数命令见 `main()` 的结论行)。
    // 转正只删 `pending: true` 与 `pendingReason`,判定本体一行未改。
    id: "gate-chain-membership",
    title: "L12 链归属:access 取值域只 chain/offchain,chain 的真在链上、offchain 的不得在链上",
  }),
  // ---- REQ-187 的 C1(TS 段口径)与 C3(L4 第三档),2026-10-05 用户裁决 ----
  Object.freeze({
    // ⚠ 档一与档二**各占一个 id**:处置不同(补源文件 vs 补 import / 改段名)——
    // 与 L11 拆 `gate-has-carrier` / `gate-module-present` 同款取舍(见那两行的注释)。
    // 合并会让「补错了东西」在诊断里看不出是哪一档的处置。
    id: "test-dist-artifact-source-mirror",
    title:
      "C1 档一(产物侧):段的被测 import 落在 dist/** 时,该产物的镜像 src/** 源文件必须真实存在"
      + "(按构建产物路径反推,不看 git 跟踪状态 —— dist/ 是 gitignored 的)",
  }),
  Object.freeze({
    id: "test-segment-mirror-same-name",
    title:
      "C1 档二(段侧):段路径镜像某个真实存在的 src/** 源文件时,它的被测 import 必须落在"
      + "那同一个源文件的同名编译产物上(段名与被测对象不得脱钩)",
  }),
  Object.freeze({
    id: "test-layer-gate-subject",
    title:
      "C3(L4 第三档):段住在非门禁层却 import gates/ 树的模块 ⇒ 判红,除非在门禁主体豁免表"
      + "登记并给出达标理由(与 L5 豁免表**分表**:L5 问「是否只提供数据」,C3 问「层归属对不对」)",
  }),
  // ---- REQ-220(#08)的两族:段内零本地顶层断言实现 / 每段接入具名 case(2026-10-07 上链)----
  Object.freeze({
    // ⚠ **判的是「自带 `throw` 的重写体」而不是「段内出现 `assert` 这个名字」**(ADR-071 决定一)。
    // 合规形态是 `@returns {asserts cond}` 的委派型窄化壳:函数体只调 harness 断言、不含自己
    // 的 `throw`。按名字判会把合规壳也判红,而 ADR-071 明确它是保留形态。
    id: "test-segment-local-assert-impl",
    title:
      "段内零本地顶层断言实现:段里的**顶层** function assert( 函数体自带 throw ⇒ 判红"
      + "(禁的是断言逻辑的第二份实现,不是 assert 这个名字;@returns {asserts cond} 的委派型"
      + "窄化壳合规 —— 措辞与形态裁决见 ADR-071)",
    // 2026-10-07 转正:存量段已按目录分四笔清零(判定本体一行未改,只删 pending 两项)。
    // 不开豁免表(ADR-071 决定一:新判据不设豁免)。
    //
    // ⚠ 注意:① 委派型窄化壳是**目标形态而非过渡**。清零的 85 段里有相当比例依赖 `@returns
    // {asserts cond}` 的类型收窄(实测各目录 44%~63%),而 assert.js:198-201 明写公共件
    // 刻意不声明该收窄(TS2775 禁从解构模式调断言函数)⇒ 要让它们彻底并进 createAsserter,
    // 前提是给 harness 的 assert 加窄化签名,那是公共件改动、不在 REQ-220 写域。
  }),
  Object.freeze({
    // ⚠ **判据按「有无 import … case.js」判,且还要求至少一处 `.case(` 调用**,两个条件缺一
    // 不可:只按 import 判 → 有段建了 suite 却只用 describe 从不调 case,它照样过关;
    // 只按「文件里有 createCaseSuite 这三个字」判 → 只在夹具串里合成别的段的段
    // (`test/harness/runner-report.test.js`)会被误算成已接入,分母永远少一段。
    id: "test-segment-named-case",
    title:
      "每段接入具名 case:段必须 import case 契约模块**且**至少有一处 `.case(` 调用 ⇒ 否则判红"
      + "(import 是必要条件不是充分条件 —— 建了 suite 只用 describe 不调 case 的段如实判红,"
      + "该形态是否为合法例外待后续裁决)",
    // 转正只删 `pending: true` 与 `pendingReason`,判定本体一行未改 —— 变的只是命中进
    // 哪个通道。随 pendingReason 一并落定的两条:① 「建了 suite 只用 describe 不调 case
    // 如实判红」是站着的裁决,而它「是否为合法例外待后续裁决」记在本条 title 里;
    // ② **不得**为本族开豁免白名单(ADR-071:5 明写「新判据不设豁免」)。
  }),
  // ---- REQ-221(#09)门禁树侧的一族 + 一档扫描面:判据面扩到 `gates/**`(2026-10-09 上链)----
  Object.freeze({
    // ⚠ **它与上面 `test-segment-named-case` 同款形态但不是同一个 id**:判据面不同
    // (`test/**` vs `gates/**`)、对象不同(段 vs 门禁自测)、契约模块路径不同
    // (`test/harness/case.js` 门面 vs `shared/case.js` 真实现,ADR-074 决定一)。
    // 而 `report(id, line)` 只接**一个** id、`isRegistered` 也按单个 id 统计 ——
    // 并表会让「哪一侧没接入」在读数上无法分别归因。切分先例见 `gate-has-carrier`
    // 与 `gate-module-present` 那一对。
    //
    // ⚠ **形态照抄段侧那一族(两个条件缺一不可)**:只按 import 判 → 建了 suite 却只用
    // describe 的自测照样过关;只按「文件里有 createCaseSuite 这三个字」判 → 夹具串里
    // 合成的形态会被误算成已接入,分母永远少一份。口径细节见 `caseContractState` 的注释。
    id: "gates-selftest-named-case",
    title:
      "门禁树侧每份自测接入具名 case:`gates/**/*.selftest.mjs` 必须 import case 契约模块"
      + `(${GATES_CASE_MODULE_REL})**且**至少有一处 \`.case(\` 调用 ⇒ 否则判红`
      + "(与段侧同名形态那一族**不是同一个 id**:判据面不同、对象不同、契约模块路径不同 ——"
      + "门禁树引不到 test/harness/,它接的是 ADR-074 决定一落在 shared/ 的真实现)",
    // 转正不在本步范围内:ADR-071 决定一的「新判据不设豁免 · 先报告后转正」在本族沿用 ——
    // 存量清零与本族上链分两笔,第一轮带 pending 是合规形态。
    pending: true,
    pendingReason:
      "本族随 #09 的判据面扩到 `gates/**` 同批上链,**先报告后转正**(ADR-071 决定一:"
      + "新判据不设豁免,但可先挂 report-only)。转正的前置是门禁自测接入 case 契约的那一笔"
      + "落地(实测当前 20 份自测**零接入**,而其中多份的断言机制还是 14 份复制的"
      + "`failures[]` 循环 —— 见 ADR-074 背景一)。⚠ 转正前须先处置这几类**装不进表**的形态"
      + "(入参是回调体 / 零注入面的判定体),它们不是「漏接入」而是「还没搬」:"
      + "判据本步不为其开豁免表,也不用降级口径把它们算作已接入。",
  }),
  Object.freeze({
    // ⚠ **与 `scan-surface-collapsed` 分立而不复用**:段侧那一档的处置是「walker 整体失效」,
    // 本档的处置是「`.selftest.mjs` 的发现规则写错 / `gates/` 被搬走」——
    // 前者去查 `ctx.listDir(TEST_REL)`,后者去查扫描根常量与扩展名,拿到诊断的人做的事不同。
    // 而 `report(id, line)` 只接一个 id、`isRegistered` 按单个 id 统计,复用会让强制等级
    // 读数无法分别归因。切分先例同 `gate-has-carrier` / `gate-module-present`。
    //
    // ⚠ `scan-surface-missing` 则**复用**(它不另立):它的 title 本就写成「读不到
    // (test/ 或 src/)子树」的双树形态、处置两树完全相同。
    id: "gates-selftest-surface-collapsed",
    title:
      "门禁自测扫描面塌缩(`.selftest.mjs` 份数掉到下限以下):新族在零扫描面下会全绿,判红"
      + "(下限独立于段侧那一档 —— 两棵树的分母集合不同,共用一个数字会让改任一棵连带改另一棵)",
  }),
  Object.freeze({
    // ⚠ **它与 `gates-selftest-named-case` 判的不是一件事,故不复用那个 id**:那一族判
    // 「有没有接 case 契约」(import + 至少一处 `.case(`),而**接了之后删掉一整个 case
    // 不改变任何可数的东西** —— import 还在、`.case(` 仍 ≥1 处。本族补的正是这个缺口:
    // 「名还在不在」。并表会让「没接入」与「名册漂移」在读数上无法分别归因。
    id: "gates-selftest-case-roster",
    title:
      "case 名集合 ⟷ 登记名册两向差集:每份 `gates/**/*.selftest.mjs` 旁的"
      + "`<基名>.case-roster.json` 与按登记表策略抽出的实际 case 名**两个方向**对账"
      + "(册有源无 = 那条 case 已删但册没删 / 源有册无 = 源码新增的 case 没进册),"
      + "另判「名册缺行(登记表少一行或多了 stale 行)」「名册读不到 / 缺 cases / 低于非空下限」"
      + "与「按策略抽出 0 条」。⚠ **半齿上限**:「删 case + 同批删册」是一次改动、判据看不见"
      + "(两侧同改 ⇒ 差集仍空),本族只抓**单侧**漂移,**不宣称「断言一条未删有机器保证」**;"
      + "⚠ 本族判的是「名还在不在」,**期望正则被放宽那类削弱不在射程内**(靠 ADR-074 后果节"
      + "「搬迁四步」)",
    // ⚠ **已转正**(删 `pending: true` 即 fail-closed)。转正前置:20 份真实名册全部就位
    // 且**逐份非空** —— 这一族上「退出码 0」不足以证明名册齐全(空册同样「全绿」),
    // 故播种时逐份核过「抽出条数 == 该自测自报分母」。
    //
    // ⚠ **半齿上限不因转正而消除**:名册型看守的通病是「删 case + 同批删册」是**一次**
    // 改动,判据看不见(两侧同改 ⇒ 差集仍为空)。本族只抓**单侧**漂移。⚠ **不得把
    // 「名册在册」读成「断言一条未删有机器保证」** —— 两侧同改靠 code review 的并排
    // diff 与 ADR-074 后果节的「搬迁四步」。另一条边界同样不受转正影响:本族判
    // 「名还在不在」而非「名对不对」,期望正则被放宽那类削弱不在射程内。
  }),
  ]);

/**
 * 按 id 查**本轮生效的**登记表(不是模块常量 —— 删行覆盖下两者不同)。
 * 查不到即**判红**(fail-closed),并额外追加一条 `criteria-unregistered:<id>`:
 * 不抛异常(会把一族的漏登记变成整场崩溃,盖住其余判红)、不静默归 problems(那样从输出里
 * 看不出它漏了)、也不丢弃(那等于让这一族的命中静默消失)。
 *
 * ⚠ 那条告警的文案**刻意不写成 ` → <id>:` 形状**:它是「漏斗对自己的告警」而不是一族判据。
 * 若写成那个形状,selftest 的 sourceAudit 会把它当成一个待登记的族抽出来,
 * 而登记它又等于让「漏登记」本身变成一件可配置的事 —— 机制给自己开了个后门。
 * @param {string} id 源码发出的机器 id
 * @param {readonly { id: string }[]} criteria 本轮生效的登记表
 * @param {string[]} sink 判红通道
 * @returns {boolean} 该族是否在登记表里
 */
function isRegistered(id, criteria, sink) {
  if (criteria.some((entry) => entry.id === id)) return true;
  sink.push(
    `判据登记表 → 强制等级漏登记:criteria-unregistered:${id}:源码发出了一族未登记在 CRITERIA 里的判据`
    + ` —— 它的强制等级因此无人负责(缺标记本会按 fail-closed 处理,但那不等于「有人决定过」)。`
    + `在 CRITERIA 里补一行(id 与本处逐字相同,缺 pending 即 fail-closed),`
    + `或确认该族已被删除、连它的 report 调用一起去掉`,
  );
  return false;
}

const USAGE = "用法: node gates/repo/check-test-layout.mjs [--write-l5-exemptions] [--help]";

/**
 * @typedef {object} DirEntry 一个目录项(注入面用的最小形状)
 * @property {string} name
 * @property {boolean} isDirectory
 */

/**
 * @typedef {object} TestLayoutCtx 注入面(IO 与策略全部经它进来,判定本体自身不碰 fs)
 * @property {string} root 求值根
 * @property {(relative: string) => string} readText 读仓库相对文本
 * @property {(relative: string) => DirEntry[]} listDir 列仓库相对目录
 * @property {(relative: string) => boolean} fileExists 判仓库相对路径是否存在(L6 核 covers 元素用)
 * @property {number} minScannedFiles 扫描面段数下限(0 = 关闭该判据,合成夹具用)
 * @property {number} minSelftestFiles 扫描面(门禁自测)份数下限(0 = 关闭该判据,合成夹具用)
 *   —— ⚠ **它与 `minScannedFiles` 不可共用**:两者的分母集合不同(`test/` 下的 `.test.js` vs
 *   `gates/` 下的 `.selftest.mjs`),合成根上两者都在场时共用一个下限会让其中一档恒红。
 *   `0 = 关闭` 是必需的:自检在合成根上求值时若带着真实下限,新族会在**每一条**夹具上判红。
 */

/**
 * @typedef {object} TestLayoutStats 计数(结论行用)
 * @property {number} files 扫描到的全部文件数
 * @property {number} segments 段文件数(进入 L4 / L5 / L8 的面)
 * @property {number} layerSegments 落在镜像源层目录内的段数(L4 / L5 的作用域)
 * @property {number} l4Violations L4 判红条数(零本层主体 + 段 import 段)
 * @property {number} l4NoOwnSubject 零本层主体的段数
 * @property {number} l4SegmentImports 段 import 段的条数
 * @property {number} l5Hits L5 跨层命中数(进哪个通道由 CRITERIA 决定)
 * @property {number} l7Extra 多出的顶层目录数
 * @property {number} l7Missing 缺失的顶层目录数
 * @property {number} l8Violations L8 判红条数
 * @property {number} l11MissingModule L11b「清单在册而树里无」判红条数
 * @property {number} c1Artifacts C1 判据对象(落在 dist/** 的值引用)总数 —— 分母,读数用
 * @property {number} c1MirrorMissing C1 档一判红条数(产物无镜像源)
 * @property {number} c1MirroredSegments C1 档二的判据对象(段路径镜像了某个 src 源文件的段数)
 * @property {number} c1SameNameMissing C1 档二判红条数(镜像段未落在同名产物上)
 * @property {number} c3Hits C3 命中数(非门禁层的段 import 了 gates/ 树的模块)
 * @property {number} c3Unregistered C3 未登记判红条数
 * @property {number} c3ShortReason C3 已登记但 reason 不达标判红条数
 * @property {number} c3Exemptions 门禁主体豁免表项数
 * @property {number} c3Stale 门禁主体豁免表 stale 判红条数
 * @property {number} localAssertImpl 段内自带 throw 的顶层 assert 实现数(族一)
 * @property {number} noNamedCase 未接入具名 case 的段数(族二)
 * @property {number} noCaseImport 其中「没 import 契约模块」的段数(族二的两档可分别归因)
 * @property {number} noCaseCall 其中「import 了却一次没调 `.case(`」的段数
 * @property {number} gateSelftests 门禁自测文件数(新族的分母 = 它的判定面全集)
 * @property {number} gatesNoNamedCase 未接入具名 case 的门禁自测份数(门禁树侧族)
 * @property {number} gatesNoCaseImport 其中「没 import 契约模块」的份数
 * @property {number} gatesNoCaseCall 其中「import 了却一次没调 `.case(`」的份数
 * @property {number} gateRosterChecked 进入名册两向差集判定的门禁自测份数(⑯ 族)
 * @property {number} gateRosterUnlisted 自测份数在取名策略登记表里**没有登记**(少一行)
 * @property {number} gateRosterStale 登记表的行在树里**已无对应自测**(多一行)
 * @property {number} gateRosterTableProblems 名册自身失效(读不到 / 缺 cases / 非空下限)条数
 * @property {number} gateRosterEmptyExtraction 按策略抽出 0 条的份数(策略与源码脱节)
 * @property {number} gateRosterOnlyInRoster 「册有源无」条数(册里那条 case 源码已无)
 * @property {number} gateRosterOnlyInSource 「源有册无」条数(源码里那条 case 没进册)
 * @property {number} gateRosterNames 名册侧 case 名总数(读数用,与判红数不同口径)
 */

/**
 * `import/export … from 'spec'`(含 `import type` 与行内 `type` 说明符)。
 * 跨度 `[^'"]*?` 而非无界:有效 ES 模块语法在 `import` 与 `from` 之间不含引号,
 * 该约束不漏任何真实 import、仍支持跨行,同时避免「`import '副作用'` 之后的另一条
 * import 的 from 被接上」与「文档串里的伪 import 被当真实 import」(同
 * check-import-boundary.mjs 的 FROM_RE,理由见那里的注释)。
 */
const FROM_RE = /(^|\n)[ \t]*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g;
/** 副作用导入 `import 'spec'` */
const SIDE_EFFECT_RE = /(^|\n)[ \t]*import\s+['"]([^'"]+)['"]/g;
/** 动态导入 `import('spec')` —— 运行期形态 */
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * 注入面工厂:补齐缺项,判定本体拿到的永远是完整注入面。
 * @param {Partial<TestLayoutCtx>} [base] 调用方给的注入面
 * @returns {TestLayoutCtx} 完整注入面
 */
export function makeTestLayoutCtx(base = {}) {
  const root = base.root ?? ROOT;
  return {
    root,
    readText: base.readText ?? ((relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8")),
    listDir:
      base.listDir
      ?? ((relative) => readdirSync(path.join(root, ...relative.split("/")), { withFileTypes: true })
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))),
    fileExists: base.fileExists ?? ((relative) => existsSync(path.join(root, ...relative.split("/")))),
    minScannedFiles: base.minScannedFiles ?? MIN_SCANNED_FILES,
    minSelftestFiles: base.minSelftestFiles ?? MIN_SELFTEST_FILES,
  };
}

/**
 * 列出一棵子树下的全部文件(仓库相对 POSIX 路径,已排序),按 `accept` 过滤。
 *
 * ⚠ ctx.listDir 抛错**不在此吞掉**:调用方要把「子树读不到」判红(路径写错时静默按空集
 * 通过,门禁从那一刻起什么也没查,而输出是 exit 0 —— 这是最坏的失效形态)。
 *
 * ⚠ **它是 `collectTestFiles` 与门禁自测扫描面的唯一 walker**,不是新写的一份:那 10 行里
 * 有两处**非平凡**约定 —— 跳过 `node_modules`(它在被扫树里出现时会把上万份依赖文件算进
 * 分母)、**不吞 `ctx.listDir` 抛错**(理由见上)。另写一份就是复制这两条约定并让它们
 * 各自漂移,而漂移的失效形态是**恒绿**:一条 walker 静默收零份,所有族判据一起「全绿」。
 * @param {TestLayoutCtx} ctx 注入面
 * @param {string} root 仓库相对目录(被扫子树的根)
 * @param {(relative: string) => boolean} accept 文件筛选(全收就传恒真)
 * @returns {string[]} 文件相对路径
 */
export function collectFilesUnder(ctx, root, accept) {
  /** @type {string[]} */
  const files = [];
  /**
   * @param {string} relDir 仓库相对目录
   * @returns {void}
   */
  const walk = (relDir) => {
    for (const entry of ctx.listDir(relDir)) {
      if (entry.name === "node_modules") continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory) walk(rel);
      else if (accept(rel)) files.push(rel);
    }
  };
  walk(root);
  return files.sort();
}

/**
 * 列出 `test/` 下的全部文件(仓库相对 POSIX 路径,已排序)。
 *
 * 段侧的发现口径是「全收」:分族在拿到全集之后各自按扩展名切(见 `segments` 那一步),
 * 在 walker 里就按扩展名过滤会把「哪些族按什么口径发现」的知识搬进 IO 层。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {string[]} 文件相对路径
 */
export function collectTestFiles(ctx) {
  return collectFilesUnder(ctx, TEST_REL, () => true);
}

/**
 * 列出 `gates/` 下的门禁自测文件(任意深度下的 `*.selftest.mjs`)。
 *
 * ⚠ **过滤在 walker 里做**:这一族的判据对象**就是**「一份 `.selftest.mjs`」,把它按扩展名
 * 切在 collector 里,判据本体拿到的是它要的形状,分母(`stats.gateSelftests`)读出来也**就是**
 * 分母本身 —— 段侧那种「先全收、再按 SEGMENT_EXT 切」在这里会多出一个可与分母漂移的中间量。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {string[]} 门禁自测文件相对路径
 */
export function collectGateSelftestFiles(ctx) {
  return collectFilesUnder(ctx, GATES_SELFTEST_ROOT, (rel) => rel.endsWith(GATES_SELFTEST_EXT));
}

/**
 * 一份门禁自测的 case 登记名册落在哪(⑯ 族的 sidecar 路径,**派生**)。
 *
 * ⚠ 它是 `GATES_SELFTEST_EXT` → `GATE_CASE_ROSTER_EXT` 的**唯一**换算处:
 * 判定面、名册读表、自测夹具三处都调它 —— 三处各写一份后缀映射就是三处会漂移的副本,
 * 而漂移的失效形态是「名册读不到 ⇒ 判红」或更糟的「名册读到另一份文件」。
 *
 * 非 `.selftest.mjs` 结尾 ⇒ 返回 null(那不是本族的名册载体,不硬造一个路径)。
 * @param {string} selftestRel 门禁自测路径(仓相对 POSIX)
 * @returns {string | null} 名册路径;入参不是自测时 null
 */
export function caseRosterRelFor(selftestRel) {
  if (!selftestRel.endsWith(GATES_SELFTEST_EXT)) return null;
  return `${selftestRel.slice(0, -GATES_SELFTEST_EXT.length)}${GATE_CASE_ROSTER_EXT}`;
}

/**
 * 从某个左括号起配平到**对应的**那个右括号(返回右括号下标;配平不到末尾 ⇒ null)。
 *
 * ⚠ **两层遮罩都要过,缺一层都会静默退化成空集**:
 *   ① `inString` —— 档名里的 `## [待发版]` 这类**字符串内部的方括号**
 *     (`check-changelog` 5 处、其余若干)。不掩码就把深度算错、永远配不平。
 *   ② **转义** —— `lexSource` 掩字符串与注释但**不掩正则字面量**,故正则里的
 *     `\[` 会以「一个真的左方括号」的身份进配平(`check-changelog.selftest.mjs`
 *     的 `expect: /…没有任何 \`## \[\` 版本条目/`,实测让 `CLI_CASES` 整张表抽出 0 条
 *     且**不报错**)。跳过后一字符即可:`\[` 只可能出现在正则里(字符串已被 ① 掩掉,
 *     而裸代码里的反斜杠只出现在正则中),真括号永不被反斜杠前置。
 *
 * ⚠ **两侧括号由入参给齐,不得拿一对括号去配平另一种**:对象字面量 `{…}` 里也有
 * `[]`,用 `[]` 去配 `{` 起点会一路数到某个内嵌数组的 `]` 就收工,span 覆盖到调用之外
 * ⇒ 抽出条数虚高(实测同一份 case 名被收两遍)。
 *
 * @param {string} code `lexSource(...).code`(注释已抹、字符串内容保留)
 * @param {Uint8Array} inString `lexSource(...).inString`
 * @param {number} start 左括号下标
 * @param {string} open 左括号字符(`[` 或 `{`)
 * @param {string} close 右括号字符(`]` 或 `}`)
 * @returns {number | null} 右括号下标;配平不到末尾时 null
 */
function matchingBracket(code, inString, start, open, close) {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (inString[i] === 1) continue;
    const ch = code[i];
    // ⚠ 转义跳步必须在配平**之前**:正则字面量未被 `lexSource` 掩码(见上)。
    if (ch === "\\") {
      i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

/**
 * 抽一个 `[A-Z_]+ = [` 数组字面量的**下标区间**(含两侧方括号;同一表名取**第一处不在字符串内**的声明)。
 *
 * ⚠ **定位阶段也必须过 `inString` 掩码**,不是只让配平阶段过:一份自测的夹具会把
 * **源码字符串**原样写进自己(如 `check-test-layout.selftest.mjs` 里那份合成
 * `const CASES = Object.freeze([` 的 `TABLE_NAME_SELFTEST`),那份声明在**字面量内部**
 * 且排在真表**之前**。定位不过掩码 ⇒ 抽到夹具里那份、只穿透拿到零星几条
 * (实测 2 条 / 应 160 条),而症状是「抽出条数不对」而不是任何一条判红
 * ⇒ 按错误结果播种名册就等于把假凭证写进仓里。跳过它继续找下一个候选。
 *
 * @param {string} code `lexSource(...).code`(注释已抹、字符串内容保留)
 * @param {uint8Array} inString `lexSource(...).inString`
 * @param {string} table 表名(如 `CASES`)
 * @returns {{ start: number, end: number }[]} 区间下标;找不到该表(或配平不到末尾)时零个
 */
function arrayLiteralSpans(code, inString, table) {
  const decl = new RegExp(`(?:const|let)\\s+${table}\\s*=\\s*(?:Object\\.freeze\\()?\\s*\\[`, "g");
  for (const m of code.matchAll(decl)) {
    // ⚠ 定位过掩码:字面量内部那份同名声明不是本自测自己的表(理由见上)。
    if (inString[m.index] === 1) continue;
    const start = m.index + m[0].length - 1;
    const end = matchingBracket(code, inString, start, "[", "]");
    // ⚠ 配平不到末尾即**零个区间**而不是「继续找下一处同名声明」:配平失败说明这份源码
    // 自身不可解析,再往后找会抽到另一处不相干的声明,把一个真失效形态洗成「抽出若干条」。
    if (end === null) return [];
    return [{ start, end }];
  }
  return [];
}

/**
 * 抽「传给某个 harness 调用的**内联** `cases: [...]` 字面量数组」的下标区间。
 *
 * 形态:像 `await runSyntheticRootCases({ group, judge, cases: [ { name: … } ], suite })`
 * 那样把用例表**就地内联**在实参对象里 —— 与「`const X = [...]` 顶层表」是两种形态,
 * 后者由 {@link arrayLiteralSpan} 覆盖,本函数覆盖前者(`check-src-layout.selftest.mjs`
 * 有 4 处,四类既有策略都覆盖不到 ⇒ 实测少抽 4 条)。
 *
 * ⚠ **先配平到调用的实参对象末尾、再在对象内找 `cases: [`**:直接对全文找
 * `cases\s*:\s*\[` 会命中「某个恰好没有内联 cases 的 harness 调用之前、另一个调用之内」
 * 的跨调用片段,症状同样是「抽出条数不对」而不是判红。
 *
 * @param {string} code `lexSource(...).code`
 * @param {Uint8Array} inString `lexSource(...).inString`
 * @param {string} call harness 函数名(如 `runSyntheticRootCases`)
 * @returns {{ start: number, end: number }[]} 每个内联 `cases:` 数组的区间(按出现顺序)
 */
function callCasesSpans(code, inString, call) {
  /** @type {{ start: number, end: number }[]} */
  const spans = [];
  // 前瞻 `(?<![\w$.])` 排除属性访问与标识符内嵌(与 `wrapper-first-arg` 同款理由)。
  const re = new RegExp(`(?<![\\w$.])${call}\\s*\\(\\s*\\{`, "g");
  for (const m of code.matchAll(re)) {
    if (inString[m.index] === 1) continue;
    const objStart = m.index + m[0].length - 1;
    // ⚠ 实参对象是 `{…}`:必须用花括号配平(用方括号配会收到内嵌 `cases:` 数组的 `]`,
    // span 溢出到调用之外 ⇒ 同一条 case 名被收两遍)。
    const objEnd = matchingBracket(code, inString, objStart, "{", "}");
    if (objEnd === null) continue;
    const inner = new RegExp(`(?:^|[\\s{,])cases\\s*:\\s*\\[`, "g");
    for (const hit of code.slice(objStart, objEnd + 1).matchAll(inner)) {
      const start = objStart + (hit.index ?? 0) + hit[0].length - 1;
      if (inString[start] === 1) continue;
      const end = matchingBracket(code, inString, start, "[", "]");
      if (end !== null) spans.push({ start, end });
    }
  }
  return spans;
}

/**
 * 按登记的取名策略,从一份门禁自测正文抽出它实际的 case 名集合(⑯ 族的「源侧」)。
 *
 * **五类**策略(逐类写清判据形状与它的失效形态,理由见
 * {@link GATE_SELFTEST_CASE_SOURCES} 的表项注释):
 *   - `inline-case` —— `suite.case('字面量', …)` 的首参;`inline-literal`;
 *   - `table-field` —— `[A-Z_]+ = [` **顶层**表内 `field:` 字段的字面量值;`table-field`;
 *   - `call-cases-field` —— **内联**在 harness 调用实参里的 `cases: [...]` 数组中
 *     `field:` 字段的字面量值(与上一类只差「表在哪」:顶层声明 vs 调用实参,
 *     见 {@link callCasesSpans});`call-cases-field`;
 *   - `wrapper-first-arg` —— `wrapper('字面量', …)` 的首参;`wrapper-first-arg`。
 *
 * ⚠ **本函数只实现上面四类**。登记表若出现未实现的 kind,会一路走到末尾「抽出 0 条」
 * 那一档判红 —— 那是误报,不是保护(见 `GATE_SELFTEST_CASE_SOURCES` 头注的告诫)。
 *
 * ⚠ **全部 matchAll 的结果都要过 `inString` 掩码**(与 `caseContractState` /
 * `findTopLevelAssertDecls` 同款):`check-test-layout.selftest.mjs` 里那 11 处
 * `suite.case(` **在夹具源码字符串内部**(被本族读的字面量,不是它自己的 case),
 * 不过掩码会把它们算成源侧的 case 名,与名册一比就报出一堆**假的**「源有册无」。
 * ⚠ **定位阶段同样要过**:见 {@link arrayLiteralSpans} 的注释 —— 只让配平过掩码而
 * 定位不过,会抽到夹具源码串里那份同名声明(实测 2 条 / 应 160 条)。
 *
 * ⚠ **抽不到就是抽不到,不静默返回空数组**:调用方拿到空数组时会先撞「低于
 * {@link MIN_GATE_CASE_ROSTER} 条下限」那一档(判红),而不是拿它去算一个恒空的差集。
 *
 * @param {string} text 门禁自测正文
 * @param {readonly {kind: string, table?: string, field?: string, wrapper?: string, call?: string}[]} strategies 取名策略
 * @returns {string[]} 抽出的 case 名(按出现顺序,未去重)
 */
export function extractGateCaseNames(text, strategies) {
  const lexed = lexSource(text);
  /** @type {string[]} */
  const names = [];
  for (const strategy of strategies) {
    if (strategy.kind === "inline-case") {
      for (const m of lexed.code.matchAll(/\.\s*case\s*\(\s*(['"`])([\s\S]*?)\1/g)) {
        if (lexed.inString[m.index ?? 0] === 1) continue;
        names.push(m[2] ?? "");
      }
    } else if (strategy.kind === "table-field" || strategy.kind === "call-cases-field") {
      const field = String(strategy.field);
      const re = new RegExp(`(?:^|[\\s{,])${field}\\s*:\\s*(['"\`])([\\s\\S]*?)\\1`, "g");
      // ⚠ 两类共用「在给定区间里收 `field:` 字面量值」这半段,只有**区间怎么来**不同:
      // 顶层表走声明定位,内联表走 harness 调用实参定位。区间取不到 ⇒ 抽出 0 条
      // (落进调用方那一档判红),不是静默跳过。
      const spans = strategy.kind === "table-field"
        ? arrayLiteralSpans(lexed.code, lexed.inString, String(strategy.table))
        : callCasesSpans(lexed.code, lexed.inString, String(strategy.call));
      for (const span of spans) {
        for (const m of lexed.code.slice(span.start, span.end + 1).matchAll(re)) {
          const at = span.start + (m.index ?? 0) + (m[1]?.length ?? 0);
          if (lexed.inString[at] === 1) continue;
          names.push(m[2] ?? "");
        }
      }
    } else if (strategy.kind === "wrapper-first-arg") {
      const wrapper = String(strategy.wrapper);
      // 前瞻 `(?<![\w$.])` 排除属性访问与标识符内嵌(`obj.check(` 不是 wrapper 调用)。
      const re = new RegExp(`(?<![\\w$.])${wrapper}\\s*\\(\\s*(['"\`])([\\s\\S]*?)\\1`, "g");
      for (const m of lexed.code.matchAll(re)) {
        if (lexed.inString[m.index ?? 0] === 1) continue;
        names.push(m[2] ?? "");
      }
    }
    // ⚠ **未知 kind 刻意不静默跳过也不抛异常**:它落在下面调用方的「抽出 0 条 ⇒ 判红」那一档
    // (两向差集天然响)。抛异常会把「策略写错」变成整场崩溃,盖住其余判红。
  }
  return names;
}

/**
 * 读一份门禁自测的 case 登记名册 sidecar。**三档 fail-closed**(与另三张表同形):
 * ① 读不到 / 非法 JSON → 判红;② 缺 `cases` 数组 → 判红;③ 低于
 * {@link MIN_GATE_CASE_ROSTER} 条 → 判红(**恒绿防护的第一道**,见该常量注释)。
 *
 * ⚠ **为什么「读不到」必须判红而不是当空名册**:空名册 + 空源侧 ⇒ 差集恒空 ⇒ 本族「全绿」。
 * 那是本族唯一的最坏失效形态 —— 门禁从那一刻起什么也没查而输出是绿的。
 * 三个可数的理由(与 `loadGateSubjectExemptions` 的注释同源):症状仍然看起来「正确」
 * (没有差异)、归因彻底错位(诊断指向 case 而真因是名册不见了)、
 * 「没查过」与「查过且无差异」在门禁上不可区分。
 *
 * ⚠ **不校验表项内容**:名册里写了什么这一族不判(它判的是「名还在不在」不是「名对不对」,
 * 见文件头第(三)条);只要求它是一个非空字符串数组。
 *
 * @param {string} rosterRel 名册路径(仓相对 POSIX)
 * @param {string} root 求值根
 * @returns {{ cases: string[], problems: string[] }}
 */
export function loadGateCaseRoster(rosterRel, root = ROOT) {
  /** @type {string[]} */
  let cases = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(path.join(root, ...rosterRel.split("/")), "utf8"));
  } catch (error) {
    return {
      cases,
      problems: [`case 登记名册读不到或不是合法 JSON:${rosterRel}(${error instanceof Error ? error.message : String(error)})`
        + " —— 名册读不到时若按空册处理,两侧同时为空而差集恒空,本族会「全绿」"
        + "(门禁什么也没查而输出是绿的)。故判红"],
    };
  }
  const list = Array.isArray(raw?.cases) ? raw.cases : null;
  if (list === null) {
    return { cases, problems: [`case 登记名册缺 cases 数组:${rosterRel}`] };
  }
  const names = [];
  for (const [index, item] of list.entries()) {
    if (typeof item !== "string" || item === "") {
      problems.push(`case 登记名册 ${rosterRel}:第 ${index + 1} 项不是非空字符串`
        + ` —— 本族只要求「名还在不在」,故不判名的内容,但表的形状坏了必须说出来`);
      continue;
    }
    names.push(item);
  }
  if (problems.length === 0 && names.length < MIN_GATE_CASE_ROSTER) {
    problems.push(`case 登记名册 ${rosterRel}:只有 ${names.length} 条(下限 ${MIN_GATE_CASE_ROSTER})`
      + " —— 空名册不证明任何 case 存在过,只证明没人填;而两侧同时为空时两向差集恒空"
      + "(这是本族最坏的失效形态:恒绿)。故判红");
  }
  return { cases: names, problems };
}

/**
 * 镜像源派生:层集合 + 每层的「主体根」前缀。
 *
 * 一半从磁盘列(`src/` 的直接子目录),一半取仓内已有的顶层树单源
 * (`TREE_DIRS` 去掉 `test` 自身)。**不读 `SEGMENT_DIRS`**(它将在 T2/P2 被删除,
 * 依赖它等于让本门禁活到那时就断)。
 * @param {TestLayoutCtx} ctx 注入面
 * @returns {{ srcLayers: string[], topTrees: string[], layers: string[], rootsOf: (layer: string) => string[] }}
 */
export function deriveMirrorLayers(ctx) {
  const srcLayers = ctx.listDir("src")
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();
  const topTrees = Object.values(TREE_DIRS).filter((name) => name !== TEST_REL).sort();
  const layers = [...srcLayers, ...topTrees];
  const srcSet = new Set(srcLayers);
  return {
    srcLayers,
    topTrees,
    layers,
    /** @param {string} layer @returns {string[]} */
    rootsOf: (layer) => {
      // `harness` 是**自指层**(T3 步 6):它的被测主体就是它自己 —— 测「测试框架自身」的段
      // (runner-report / test-common-helpers / dual-pipeline-decision-ledger)主体全在
      // `test/harness/**`。它的主体根因此**不是** `harness/`(仓顶层树,收的是门禁脚本)而是
      // `test/harness/`。走的是与 src 镜像层同形的判定路径:一个层一个主体根前缀。
      //
      // 为什么必须单列而不能靠段自己声明:`harness` 同时出现在 `topTrees` 里(它是
      // TREE_DIRS 的四棵顶层树之一),若沿用 `rootsOf` 的默认分支,主体根会算成 `harness/`,
      // 于是 `covers: ["test/harness/runner.js"]` 落在根外 → L4 恒判红。这正是本分支
      // 存在的理由:层名相同不代表主体根相同,主体根必须指向**被测代码所在处**。
      if (layer === HARNESS_DIR) return [HARNESS_ROOT];
      return srcSet.has(layer) ? [`src/${layer}/`, `dist/${layer}/`] : [`${layer}/`];
    },
  };
}

/**
 * 抽一个文件里的全部 import 事实(相对说明符解析到仓库相对 POSIX 路径)。
 *
 * type-only 判定复用 `isTypeOnlyClause`,另加 JSDoc 形态:`import("…")` 出现在**注释**
 * 里是类型引用(编译期擦除),出现在**代码**里是运行期动态 import。两者字面同形,
 * 靠 `lexSource` 的抹注释结果区分:代码里那个下标在 `code` 中仍以 `import(` 开头,
 * 注释里那个已被抹成空格。
 *
 * ⚠ 三处 matchAll 都要过 `inString` 过滤(不止注释那一处):`lexSource` 只抹注释、
 * **保留字符串内容**,故文档串里的 `import("…")` 形状在 code 里与真动态 import 同形,
 * 只有 inString 能分(见 extractImports 内的注释)。
 *
 * @param {string} text 文件原文
 * @param {string} file 文件的仓库相对 POSIX 路径(解析相对说明符的基准)
 * @returns {{ spec: string, typeOnly: boolean, resolved: string | null }[]}
 */
/**
 * 抽一个段声明的 `covers`(ADR-062 L6)。
 *
 * 认的是**字面量数组**:只接受 `export const covers = ["…", …]` 与
 * `export const covers = [...]` 里全是字符串字面量的形态。刻意不解析变量引用
 * (`covers = SOME_LIST`):那会让 L6 的第三条(元素必须真实存在)退化成「追一个值再判」,
 * 而追值就得引入求值器 —— 一旦判据自己开始算,「声明与代码不同步」这类漂移就查不出来了。
 * 判据看不懂的写法按「未声明」处理(behavior 段即判红),不按「声明了但内容未知」放过。
 *
 * 走 `lexSource` 抹注释(与 extractImports 同款取舍):说明文字里写
 * `export const covers = [...]` 不构成声明。
 *
 * @param {string} text 段文件文本
 * @returns {string[] | null} 声明的元素;`null` = 未声明
 */
export function extractCovers(text) {
  const lexed = lexSource(text);
  const DECL_RE = /\bexport\s+const\s+covers\s*=\s*\[([\s\S]*?)\]/g;
  /** @type {string[] | null} */
  let found = null;
  for (const m of lexed.code.matchAll(DECL_RE)) {
    const at = m.index ?? 0;
    if (lexed.inString[at] === 1) continue;
    // 括号里的每个元素都必须是字符串字面量;出现任何非字面量内容(标识符 / 数字 / 嵌套调用)
    // 就判定据看不懂该写法 —— 按「未声明」处理,不在这里猜。
    const inner = m[1] ?? "";
    const stripped = inner.replace(/\/\/[^\n]*/g, "").trim();
    if (stripped === "") {
      found = found ?? [];
      continue;
    }
    const elements = [...stripped.matchAll(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g)];
    const consumed = elements.reduce((sum, el) => sum + el[0].length, 0);
    const punctuation = stripped.replace(/\s+/g, "").replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, "").replace(/,/g, "");
    if (punctuation !== "" || consumed === 0) return null;
    found = elements.map((el) => el[2] ?? "");
  }
  return found;
}

export function extractImports(text, file) {
  const lexed = lexSource(text);
  /** @type {{ spec: string, typeOnly: boolean, resolved: string | null }[]} */
  const out = [];
  const dir = path.posix.dirname(file);
  /**
   * @param {string} spec 说明符
   * @param {boolean} typeOnly
   * @returns {void}
   */
  const add = (spec, typeOnly) => {
    out.push({
      spec,
      typeOnly,
      resolved: spec.startsWith(".") ? path.posix.normalize(path.posix.join(dir, spec)) : null,
    });
  };
  // ⚠ 三处 matchAll 的结果**都要过 inString 过滤**,不只是注释那一处。理由:`lexSource`
  // 只把注释放成空格、**字符串内容原样保留**(那是真 import 的 specifier 本身),所以文档串里
  // 写的 `import("../../dist/core/x.js")` 形状在 `code` 里与真动态 import **完全同形**,
  // 靠 code 区分不出来 —— 只有 inString 能分(串内部的引号是字面量内容,不是词法记号)。
  // 少这一处过滤的后果:段里「示范该怎么 import」的说明串会被当成真实依赖,
  // 既能让 L4 假性通过,也能让 L5 假性命中(同 check-import-boundary 的 insideString 守卫)。
  for (const m of lexed.code.matchAll(FROM_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[4], isTypeOnlyClause(m[2], m[3]));
  }
  for (const m of lexed.code.matchAll(SIDE_EFFECT_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[2], false);
  }
  for (const m of lexed.code.matchAll(DYNAMIC_RE)) {
    if (lexed.inString[m.index] === 1) continue;
    add(m[1], false);
  }
  // JSDoc/注释里的类型引用:在**原文**上匹配,但只收那些在抹注释后消失的下标
  for (const m of text.matchAll(DYNAMIC_RE)) {
    if (lexed.code.startsWith("import(", m.index)) continue;
    if (lexed.inString[m.index] === 1) continue;
    add(m[1], true);
  }
  return out;
}

/**
 * 这个解析后的路径落在**哪一层**(不是本层时)。判据对象是「解析结果的首段目录名」,
 * 与 check-import-boundary 的 `resolveLayer` 同一形状,但这里要认得 `src/<层>/` 与
 * `dist/<层>/` 两种带前缀的形态(本仓的段 import 的是产物)。
 * @param {string} resolved 仓库相对 POSIX 路径
 * @param {{ layers: readonly string[] }} mirror 镜像源派生结果
 * @returns {string | null} 层名;不落在任何层内(如 test/ 内部、node_modules)时 null
 */
export function foreignLayerOf(resolved, mirror) {
  for (const layer of mirror.layers) {
    if (resolved.startsWith(`src/${layer}/`) || resolved.startsWith(`dist/${layer}/`)) return layer;
    if (resolved.startsWith(`${layer}/`)) return layer;
  }
  return null;
}

/**
 * C1 的「被测 import」单一定义(两档共用;五类排除的逐条依据见文件头同名小节)。
 *
 * 收敂成一句:**解析后落在 `dist/**` 的值引用**。裸包名 / `node:` 内建 / 第三方包
 * `resolved === null`;`test/harness/**`(测试框架自身)与其它段(段 import 段已由 L4
 * 判红)不在 `dist/` 下;type-only 引用是编译期擦除的类型标注、不是取得被测对象的手段。
 *
 * ⚠ **这一条不得改成「解析成功即算」**:那会把 289 处 harness 引用与 73 处 `src/**`
 * type-only 引用算进分母,C1 于是退化成「谁引用助手最多 / 类型标注写对没有」的检查。
 * @param {{ resolved: string | null, typeOnly: boolean }} entry `extractImports` 的一条
 * @returns {boolean} 是否是 C1 两档的判据对象
 */
export function isSubjectImport(entry) {
  return entry.resolved !== null && !entry.typeOnly && entry.resolved.startsWith(DIST_TREE);
}

/**
 * 一个 `dist/**` 产物的镜像源文件候选路径(仓相对 POSIX,按声明顺序)。
 *
 * ⚠ 返回的是**一组**候选而不是单个路径:`.js` 产物可能来自 `.ts` / `.tsx` / `.js` 三种源
 * (见 `ARTIFACT_SOURCE_EXTS` 的注释,`src/renderer/lang-bootstrap.js` 是仓内既有的第三种先例)。
 * 调用方逐个问 `fileExists`,**任一命中即算有源** —— 判红只发生在**全都不命中**时。
 * @param {string} artifact 仓相对产物路径(以 `dist/` 开头)
 * @returns {string[]} 镜像源候选路径(产物路径未知后缀时为空数组)
 */
export function mirrorSourceCandidates(artifact) {
  const dot = artifact.lastIndexOf(".");
  if (dot < 0) return [];
  const candidates = ARTIFACT_SOURCE_EXTS[artifact.slice(dot)];
  if (candidates === undefined) return [];
  const stem = artifact.slice(0, dot);
  if (!stem.startsWith(DIST_TREE)) return [];
  return candidates.map((ext) => `${SRC_TREE}${stem.slice(DIST_TREE.length)}${ext}`);
}

/**
 * 段内**顶层**的 `assert` 函数声明(族一的判据对象;ADR-071 定的机器口径)。
 *
 * **只认顶层、不认对象方法** —— 判据形态是「段自己实现了第二份断言逻辑」,而
 * `assert.js` 的 `createAsserter` 那种「返回对象的 `assert` 方法」是 harness 本体的实现,
 * 不在段内、更不是段的第二份实现。少这一条收窄,判据会去红 harness 自己的实现。
 *
 * **只判 `throw` 而不是「有没有叫 `assert` 的函数」**(ADR-071 决定一):合规形态是
 * `@returns {asserts cond}` 的**委派型窄化壳** —— 函数体只调 harness 断言、不含自己的
 * `throw`。故本函数对每个声明返回「函数体是否自带 `throw`」,由调用方决定怎么报。
 *
 * 走 `lexSource` 抹注释(与 `extractImports` / `extractCovers` 同款取舍):说明文字里写
 * `function assert(cond) {}` 不构成声明。**行首锚**保证「顶层」—— 缩进的 `function assert`
 * 是嵌套在别的函数里的局部声明,不在判据面上。
 *
 * @param {string} text 段文件文本
 * @returns {{ line: number, hasThrow: boolean }[]} 逐个顶层 `assert` 声明(1 基行号 + 自带 throw)
 */
export function findTopLevelAssertDecls(text) {
  const lexed = lexSource(text);
  // 行首 + 可选 `export` + 可选 `async`:`export async function assert(` / `export function`
  // / `async function` / `function` 四种形态都在内,少一种就是一个漏判面。
  const DECL_RE = /(^|\n)[ \t]*(?:export\s+)?(?:async\s+)?function\s+assert\s*\(/g;
  /** @type {{ line: number, hasThrow: boolean }[]} */
  const out = [];
  for (const m of lexed.code.matchAll(DECL_RE)) {
    // ⚠ `at` 必须是**声明本身**的下标,不是 `(^|\n)` 那个前缀的下标 —— 后者落在上一行的
    // 换行符上,直接拿来数行号会整段偏移一行。`m[1]` 是前缀(`^` 时为空串,长度 0)。
    const at = (m.index ?? 0) + (m[1]?.length ?? 0);
    if (lexed.inString[at] === 1) continue;
    // 括号配平取函数体。⚠ 必须走 `code` 而非原文:原文里字符串中的 `{`/`}` 会让配平错位
    //(`lexSource` 抹注释但**保留字符串内容**),配平错位就会把函数体截短或延长。
    const open = lexed.code.indexOf("{", at);
    if (open < 0) continue;
    let depth = 0;
    let close = -1;
    for (let i = open; i < lexed.code.length; i += 1) {
      const ch = lexed.code[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { close = i; break; }
      }
    }
    out.push({
      line: lexed.code.slice(0, at).split("\n").length,
      hasThrow: bodyHasOwnThrow(lexed, open, close),
    });
  }
  return out;
}

/**
 * 这个函数体**自带 `throw`** 没有(段内自己实现断言逻辑的机器口径)。
 *
 * ⚠ 三个词法守卫缺一不可,少任何一个都是一类假命中/假放行:
 *   - `inString` —— 段里常写「本段原本的写法是 `if (!cond) throw ...`」这类**说明串**,
 *     照字面数会把「注释掉的重写体」算成「实现了」;
 *   - 前驱非 `.` 且非标识符字符 —— `obj.throw` / `throwError` 这类**不是 throw 语句**;
 *   - 配平边界 —— 只在函数体的 `close` 之内数,段里另一处无关的 `throw` 不算本函数体的。
 * @param {{ code: string, inString: Uint8Array }} lexed `lexSource` 的结果
 * @param {number} open 函数体 `{` 的下标
 * @param {number} close 函数体 `}` 的下标;配平未闭合时传 -1(取到文末)
 * @returns {boolean} 函数体内是否有自己的 `throw`
 */
function bodyHasOwnThrow(lexed, open, close) {
  const end = close < 0 ? lexed.code.length : close + 1;
  const body = lexed.code.slice(open, end);
  for (const m of body.matchAll(/(^|[^\w$.])throw[^\w$]/g)) {
    const at = open + (m.index ?? 0);
    if (lexed.inString[at] === 1) continue;
    return true;
  }
  return false;
}

/**
 * 这个文件**接入了具名 case 契约**没有(两族共用的判据对象)。
 *
 * ⚠ **必须按「有无 `import … <契约模块>`」判,不能按「文件里有没有 `createCaseSuite` 这三个字」判**:
 * `test/harness/runner-report.test.js` 只在**夹具字符串**里合成别的段(它把别的段的 import
 * 行拼出来送进沙盒),自己并不接 case 契约 —— 按字面判会把它误算成已接入,那一族的分母就
 * 永远少一段。`extractImports` 已经带 inString 守卫,故夹具串里的 import 行抽不出来。
 *
 * **`import` 只是必要条件,不是充分条件**:裁决要求「机器能判的先判红」,故本函数还要求
 * 文件内**真的调用了 `case`**。实测有段建了 suite 却只用 `describe` 从不调 `case` ——
 * 它 import 了契约模块却没接契约,机器看得见这一层,就如实报。
 *
 * ⚠ `case` 调用点也要过 inString 守卫:同一批「只在夹具串里出现 `suite.case(…)`」的文件
 * 不能因此被算成已接入(理由同上)。
 *
 * ⚠ **契约模块路径由调用方传入而不是在这里写死**:段侧与门禁树侧的合法契约模块**不同**
 * (`test/harness/case.js` 门面 vs `shared/case.js` 真实现,ADR-074 决定一),而本函数
 * **只认一个精确路径**(不是黑名单所有其它路径 —— 改引另一个路径即「没接入」,如实判红)。
 * 缺省是段侧那条,故段侧调用点的判定一行未改。
 *
 * @param {string} text 段 / 门禁自测文件文本
 * @param {string} file 文件的仓库相对 POSIX 路径(解析相对说明符的基准)
 * @param {string} [moduleRel] 契约模块的仓库相对 POSIX 路径(缺省 = 段侧门面)
 * @returns {{ imported: boolean, caseCalls: number }} 是否 import 了 case 契约 + `case` 调用点数
 */
export function caseContractState(text, file, moduleRel = CASE_MODULE_REL) {
  const imported = extractImports(text, file).some(
    (entry) => entry.resolved === moduleRel && !entry.typeOnly,
  );
  const lexed = lexSource(text);
  let caseCalls = 0;
  // `.case(` 的接收者是 suite 变量(`suite` / `s` / 任何别的名字),故只锚**属性访问**这一
  // 形状,不锚具体接收者名 —— 锚死变量名等于把判据与段的命名习惯绑在一起。
  for (const m of lexed.code.matchAll(/\.\s*case\s*\(/g)) {
    if (lexed.inString[m.index] === 1) continue;
    caseCalls += 1;
  }
  return { imported, caseCalls };
}

/**
 * 一个段的路径镜像了哪个真实存在的 `src/**` 源文件(C1 档二的判据对象)。
 *
 * 形态是 `test/<X>/<rest>.test.js` ⇔ `src/<X>/<rest>.<srcExt>` —— **相对路径逐段对应**,
 * 不是 basename 匹配。后者会把 `test/core/preprocess.test.js` 认成镜像
 * `src/convert/preprocess.ts`(实测仓内确有 `test/convert/preprocess.test.js` 与
 * `src/convert/preprocess.ts`,但它们不在同一层目录下),那是**跨层的巧合同名**。
 *
 * 段深度**不限**:S5-0 的递归化之后段名是完整相对路径(如
 * `gates/supply/supply/gen-sbom.test.js`),逐段对应天然覆盖嵌套形态。
 * @param {string} segment 段路径(仓相对 POSIX,以 `.test.js` 结尾)
 * @param {(relative: string) => boolean} [fileExists] **仓相对**路径的存在性判据
 *   (缺省走真实磁盘 —— 合成根上的自检必须注入 `ctx.fileExists`,见 `makeTestLayoutCtx`)
 * @returns {{ source: string, artifact: string } | null} 镜像到的源文件与它的同名产物;未镜像时 null
 */
export function mirroredSourceOf(segment, fileExists = (relative) => existsSync(path.join(ROOT, ...relative.split("/")))) {
  if (!segment.startsWith(`${TEST_REL}/`) || !segment.endsWith(SEGMENT_EXT)) return null;
  const stem = segment.slice(`${TEST_REL}/`.length, -SEGMENT_EXT.length);
  for (const [sourceExt, artifactExt] of Object.entries(SOURCE_ARTIFACT_EXTS)) {
    const source = `${SRC_TREE}${stem}${sourceExt}`;
    if (!fileExists(source)) continue;
    return { source, artifact: `${DIST_TREE}${stem}${artifactExt}` };
  }
  return null;
}

/**
 * 判定本体(可注入纯函数):五族判据 + 扫描面下界。
 *
 * 全部诊断经唯一出口 `report(id, line)`,进 `problems` 还是 `info` 由 `CRITERIA` 决定
 * (见文件头「强制等级」一节)。判定本体的 IO 注入面**不含**登记表:那是不可注入的模块常量。
 * @param {Partial<TestLayoutCtx> & { criteriaOverride?: readonly { id: string, pending?: boolean }[] }} [base] 注入面(见 makeTestLayoutCtx)
 * @returns {{ problems: string[], info: string[], stats: TestLayoutStats, l5ExemptionCount: number }}
 */
/**
 * 读 L5 豁免表。**只认二元组**,缺字段的表项直接判红而不是被跳过 ——
 * 跳过等于给「写错键名」开了一个静默放行的口。
 * @param {string} [root] 仓库根(默认真实仓库)
 * @returns {{ entries: { segment: string, specifier: string, reason: string }[], problems: string[] }}
 */
export function loadL5Exemptions(root = ROOT) {
  const file = path.join(root, ...L5_EXEMPTIONS_REL.split("/"));
  /** @type {{ segment: string, specifier: string, reason: string }[]} */
  let entries = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { entries, problems: [`豁免表读不到或不是合法 JSON:${L5_EXEMPTIONS_REL}(${error instanceof Error ? error.message : String(error)})`] };
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : null;
  if (list === null) {
    return { entries, problems: [`豁免表缺 entries 数组:${L5_EXEMPTIONS_REL}`] };
  }
  // 条目本身**不**在这里校验键名:那件事由判定本体统一做(它同时要管注入面)。
  // 这里只负责把原样条目交出去 —— 判定本体对「非对象项」也判红,不静默跳过。
  entries = list;
  return { entries, problems };
}

/** 豁免表的键(段路径 + 说明符) */
const l5ExemptionKey = (segment, specifier) => `${segment}\u0000${specifier}`;

/**
 * 生成 L5 豁免表基线(ADR-062:92 的做法:「生成 → 逐条人工补 reason → 转判红」的第一步)。
 *
 * ⚠ **刻意不填 reason**:填占位符等于让「忘了写理由」与「写了理由」在门禁上不可区分 ——
 * 而 reason 不合格正是这张表唯一能机械判红的东西之一。生成出来的表必然因 reason 为空而红,
 * 那是**设计**:逼使用者逐条看过再填。空 reason 是「不足门槛」那一档的**特例**(0 < 20),
 * 故本入口的产物天然红 —— 它是生成入口,不是判据,永远 exit 0。
 * @param {{segment: string, specifier: string}[]} hits 当前命中的 (段, 说明符) 对,已去重
 * @returns {string} 可写入数据文件的 JSON 文本
 */
export function renderL5ExemptionsBaseline(hits) {
  const entries = [...hits]
    .sort((a, b) => (a.segment === b.segment ? a.specifier.localeCompare(b.specifier) : a.segment.localeCompare(b.segment)))
    .map((hit) => ({ segment: hit.segment, specifier: hit.specifier, reason: "" }));
  return `${JSON.stringify(
    {
      _comment: "L5 豁免表 —— **初版**由 `node gates/repo/check-test-layout.mjs --write-l5-exemptions` 生成,"
        + `**每条 reason 必须人工补**:空 reason 会判红(这是刻意的,见门禁本体同名函数注释);`
        + `补的内容还须 ≥${REASON_MIN_CHARS} 字(按码点计)。`
        + " ⚠⚠ **本表此后只能手工追加,绝不可重跑那个生成入口** —— 它是**整表覆写**且只写"
        + "「当前未登记」的命中,重跑会把本表已有的条目连同全部手写 reason 一并删除(无警告、无备份)。"
        + " 新增命中时:先 `git checkout` 本文件,再照同样格式手工补那一条。",
      _schema: {
        key: "entries[].segment + entries[].specifier",
        granularity: "一个表项只覆盖这一条说明符;同段将来新增的跨层 import 仍判红。",
        reason: `必填、且 trim 后 ≥${REASON_MIN_CHARS} **字**(按码点计)。`
          + "写不出合法理由的命中应改 import 或把该段归 test/behavior/,不得进表。",
        ratchet: "表项必须当前仍真的命中,否则判红(stale)。",
      },
      entries,
    },
    null,
    2,
  )}\n`;
}

/* ---------- ADR-062 的 L11 / L12:门禁清单相关的四个面 ---------- */

/**
 * 读 L11 门禁级豁免表。**三档 fail-closed**,与 `loadL5Exemptions` 同形:
 * ① 读不到 / 不是合法 JSON → 判红;② 缺 `entries` 数组 → 判红;③ 表项键名错 → 判红。
 *
 * ⚠ **静默当空表不可接受**:L11 的档 2 是「无载体但在豁免表」,表读不到时全部落档 3 判红 ——
 * 那是「红」的方向,尚属 fail-closed 的正确侧;真正不可接受的是把**非法表**当成空表后
 * 表里那些**合法表项也一起失效**(整张表静默消失,而门禁只是变红,没人知道红的原因是表坏了)。
 * 故这三档各自点明表路径。
 *
 * 条目**不**在这里校验键名(与 L5 同款取舍):校验由判定本体统一做,那样注入面
 * (`base.gateExemptions`)也过同一道校验 —— 否则一条键名写错的注入表项会拿到一个永不命中的键、
 * 被静默跳过。
 * @param {string} [root] 仓库根(默认真实仓库)
 * @returns {{ entries: { gate: string, reason: string }[], problems: string[] }}
 */
export function loadGateExemptions(root = ROOT) {
  const file = path.join(root, ...GATE_EXEMPTIONS_REL.split("/"));
  /** @type {{ gate: string, reason: string }[]} */
  let entries = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      entries,
      problems: [`门禁级豁免表读不到或不是合法 JSON:${GATE_EXEMPTIONS_REL}(${error instanceof Error ? error.message : String(error)})`],
    };
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : null;
  if (list === null) {
    return { entries, problems: [`门禁级豁免表缺 entries 数组:${GATE_EXEMPTIONS_REL}`] };
  }
  entries = list;
  return { entries, problems };
}

/**
 * 读 C3 的门禁主体豁免表。**三档 fail-closed**,与 `loadL5Exemptions` /
 * `loadGateExemptions` 同形:① 读不到 / 不是合法 JSON → 判红;② 缺 `entries` 数组 →
 * 判红;③ 表项键名错 → 判红(由判定本体统一做,那样注入面也过同一道校验)。
 *
 * ⚠ **为什么「表读不到」这一档判红而不是当空表**(这是搬成数据文件**新引入**的一档 ——
 * 落在模块常量形态时它根本不存在,因为表与本体同体、读不到就是编译不过):
 *
 *   - **静默当空表 = fail-open。** 空表会让每一条门禁边落进「未登记」,于是**症状看起来
 *     仍然正确**(判红),但**归因彻底错位**:输出点名的是某一段的层归属有问题,而真因是
 *     豁免表不见了。那正是本仓反复批过的「诊断指向 A、真因是 B」—— 处置指引会把人
 *     领去搬段,搬完表还是红的,而表仍然没人找。
 *   - **「读不到」与「查过了、全无豁免」在门禁上不可区分**:两者都产出「零条表项」。
 *     区别只存在于**门禁没跑的那一次** —— 而门禁恰恰不能靠「它跑过了」来担保,因为
 *     恒绿与恒红一样都是没人看的结果。
 *   - **判红的那一侧至少可归因**:三条读表诊断各自点明表路径与失败原因,读者立刻知道
 *     该去修表;而当空表放过去,门禁只会说「某段 import 了门禁树」。
 *
 * ⚠ 代价是「表被删 ⇒ 整仓红」—— 但那**就是**正确方向:一条已审过的豁免凭空消失时,
 * 门禁必须让人重新看见它,而不是安静地按「没人豁免过」处理。与另两张表同判准。
 *
 * 条目**不**在这里校验键名(与另两张同款取舍):校验由判定本体统一做,否则一条键名写错的
 * 注入表项会拿到一个永不命中的键、被静默跳过。
 * @param {string} [root] 仓库根(默认真实仓库)
 * @returns {{ entries: { segment: string, specifier: string, reason: string }[], problems: string[] }}
 */
export function loadGateSubjectExemptions(root = ROOT) {
  const file = path.join(root, ...GATE_SUBJECT_EXEMPTIONS_REL.split("/"));
  /** @type {{ segment: string, specifier: string, reason: string }[]} */
  let entries = [];
  /** @type {string[]} */
  const problems = [];
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return {
      entries,
      problems: [`门禁主体豁免表读不到或不是合法 JSON:${GATE_SUBJECT_EXEMPTIONS_REL}(${error instanceof Error ? error.message : String(error)})`
        + " —— 表读不到时若按空表处理,每一条门禁边都会落进「未登记」而症状看起来仍然正确,"
        + "但归因指向的是段的层归属而不是表不见了(处置会把人领去搬段,搬完表还是红的)。故判红"],
    };
  }
  const list = Array.isArray(raw?.entries) ? raw.entries : null;
  if (list === null) {
    return { entries, problems: [`门禁主体豁免表缺 entries 数组:${GATE_SUBJECT_EXEMPTIONS_REL}`] };
  }
  entries = list;
  return { entries, problems };
}

/**
 * 门禁索引的注入面归一(真实索引 → 判定本体要的最小形状)。
 *
 * **为什么注入的是「表的内容」而不是「模块路径」**:模块路径是本文件的静态 import(见文件头),
 * 注入路径就得动态 import,而判定本体是**同步**纯函数 —— 动态 import 会把它变成 async,
 * 那会让 CLI 的 `main()` 与链上每个调用点的形态都变。可注入的是**表的内容**,
 * 与 `l5Exemptions` 同一形态:自检在合成根上求值同一批判据,不 spawn、不碰真实工作树。
 *
 * 只取四项(`id` / `access` / `npmScripts` / `modulePath`)的理由见文件头 import 处那段注释
 * —— `judgment` / `enforcement` / `probes[]` 一个都不读。
 *
 * 缺字段**判红而不是跳过**:跳过等于让那道门禁从 L11/L12 两族里凭空消失,而消失形态是
 * 「门禁变绿」而不是「变红」——纯文本门禁最坏的失效形态。
 * @param {readonly Record<string, {id?: string, access?: string, npmScripts?: readonly string[], modulePath?: string}>} | undefined} [source] 注入的索引(缺省即真实 `gate-index.mjs`)
 * @returns {{ gates: readonly { id: string, access: string, npmScripts: readonly string[], modulePath: string, pendingChain?: unknown }[], problems: string[] }}
 */
export function makeGateRegistryCtx(source = undefined) {
  /** @type {{ id: string, access: string, npmScripts: readonly string[], modulePath: string, pendingChain?: unknown }[]} */
  const gates = [];
  /** @type {string[]} */
  const problems = [];
  const table = source ?? GATE_INDEX;
  for (const [key, entry] of Object.entries(table)) {
    if (typeof entry?.id !== "string" || entry.id === "") {
      problems.push(`门禁索引第 ${key} 项缺 id —— 键名写错会让这道门禁在 L11/L12 两族里凭空消失`);
      continue;
    }
    if (typeof entry.access !== "string" || entry.access === "") {
      problems.push(`门禁索引 ${entry.id} 缺 access —— 取值域判据无从核对`);
      continue;
    }
    if (!Array.isArray(entry.npmScripts)) {
      problems.push(`门禁索引 ${entry.id} 缺 npmScripts 数组 —— 链归属判据要拿它与链展开对账`);
      continue;
    }
    if (typeof entry.modulePath !== "string" || entry.modulePath === "") {
      problems.push(`门禁索引 ${entry.id} 缺 modulePath —— 载体判据要拿它推导候选载体路径`);
      continue;
    }
    gates.push({
      id: entry.id,
      access: entry.access,
      npmScripts: entry.npmScripts.filter((name) => typeof name === "string"),
      modulePath: entry.modulePath,
      pendingChain: entry.pendingChain,
    });
  }
  return { gates, problems };
}

/**
 * L11 判定本体(纯函数):三档缺一即红。
 *
 * **两个候选载体,按「存在 / 引用」两形态派生**(不是 ADR-062 原写的「两路径存在性」——
 * 那是 2026-10-04 实测订正掉的形态,理由见该 ADR 的 L11 行):
 *   - 档 1a **同名 selftest 载体**:`<modulePath 同目录>/<stem>.selftest.mjs`,另接受去掉
 *     `check-` 前缀的变体(实测 `check-release-notes.mjs` 的载体叫 `release-notes.selftest.mjs`)。
 *   - 档 1b **引用该门禁的验收段**:`test/**` 下任一段的正文出现该门禁 `modulePath` 的
 *     **无扩展名仓库相对路径**字面子串。
 *   - 档 2 **门禁级豁免表**:`${GATE_EXEMPTIONS_REL}` 里登记了该 `id`。
 *   - 档 3 前两者皆无 → 判红。
 *
 * ⚠ **为什么档 1b 必须是「引用」而不是「路径同形」**:实测纯路径派生只覆盖 16/39,剩 23 项
 * 判红 —— 因为**多道门禁共用一个验收段**是本仓既有事实(`test/gates/supply-chain.test.js`
 * 同时是 `sbom`/`sca`/`licenses`/`fulltext` 四项的载体,`test/gates/observability.test.js`
 * 同时是 `pack-size`/`smoke-report` 两项的载体)。路径派生对「共用段」这一形态**结构性地无解**
 * ⇒ 那正是 ADR-062 原判据会「当场判红 29 项」的机制。引用派生把那 23 项接住,实测零判红。
 *
 * ⚠ **档 1b 的子串口径刻意收窄到「无扩展名的完整仓库相对路径」**(不是 basename、也不是
 * npm script 名):实测三种口径接住的是**同样那 23 项**,但 basename 口径会把 `smoke` 匹配到
 * 14 个段、`gate-probes` 匹配到 9 个(靠的是正文里偶然出现的词)—— 那是**假绿**:
 * 「门禁有载体」与「某段正文里出现过它的名字」不是一回事。收窄后实测段引用命中 30 处
 * (23 项门禁),与注册表 `probes[]` 登记的 segment 类载体对得上。
 *
 * @param {object} input 判定输入
 * @param {{ fileExists: (relative: string) => boolean, segmentBodies?: ReadonlyMap<string, string> }} input.deps 载体存在的两个依据(文件存在性 / 段正文)
 * @param {readonly { id: string, modulePath: string }[]} input.gates 门禁清单(只需 id 与 modulePath)
 * @param {readonly { gate: string, reason: string }[]} [input.exemptions] 门禁级豁免表(注入面)
 * @returns {{ problems: string[], stats: { withCarrier: number, exempted: number, missing: number, stale: number, shortReason: number } }}
 */
export function judgeL11Carrier({ deps, gates, exemptions = [] }) {
  /** @type {string[]} */
  const problems = [];
  const stats = { withCarrier: 0, exempted: 0, missing: 0, stale: 0, shortReason: 0 };
  /** @type {Map<string, { gate: string, reason: string }>} */
  const byGate = new Map();
  for (const [index, entry] of exemptions.entries()) {
    if (typeof entry?.gate !== "string" || entry.gate === "") {
      problems.push(
        `${GATE_EXEMPTIONS_REL} → gate-has-carrier:第 ${index + 1} 项缺 gate`
        + "(键名写错会让整条豁免静默失效 —— 它拿到的键永远命中不上,而门禁因此一直落档 3)",
      );
      continue;
    }
    byGate.set(entry.gate, {
      gate: entry.gate,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  /**
   * @param {string} modulePath
   * @returns {{ noExt: string, carriers: string[] }}
   */
  const derive = (modulePath) => {
    const noExt = modulePath.replace(/\.(mjs|js|ts)$/, "");
    const stem = noExt.split("/").pop() ?? "";
    const dir = noExt.split("/").slice(0, -1).join("/");
    return {
      noExt,
      carriers: [
        `${dir}/${stem}${GATES_SELFTEST_EXT}`,
        `${dir}/${stem.replace(/^check-/, "")}${GATES_SELFTEST_EXT}`,
      ],
    };
  };
  /**
   * @param {string} modulePath
   * @returns {{ selftest: string | null, segments: string[] }}
   */
  const carriersOf = (modulePath) => {
    const { noExt, carriers } = derive(modulePath);
    const bodies = deps.segmentBodies;
    return {
      selftest: carriers.find((candidate) => deps.fileExists(candidate)) ?? null,
      segments: bodies === undefined
        ? []
        : [...bodies.entries()].filter(([, body]) => body.includes(noExt)).map(([file]) => file),
    };
  };
  for (const gate of gates) {
    const { selftest, segments } = carriersOf(gate.modulePath);
    if (selftest !== null || segments.length > 0) {
      stats.withCarrier += 1;
      continue;
    }
    const exemption = byGate.get(gate.id);
    if (exemption !== undefined) {
      stats.exempted += 1;
      const chars = reasonChars(exemption.reason);
      if (chars < REASON_MIN_CHARS) {
        stats.shortReason += 1;
        problems.push(
          `${gate.id} → gate-has-carrier:该门禁无载体、已在门禁级豁免表登记(${GATE_EXEMPTIONS_REL}),`
          + `但 reason 只有 ${chars} 字,不足门槛 ${REASON_MIN_CHARS} 字`
          + " —— 门禁级豁免与 L5 豁免同判准:写不出「为什么这道门禁可以没有载体」时,"
          + "该做的是补载体(一份 `.selftest.mjs`),而不是把它塞进表里",
        );
      }
      continue;
    }
    stats.missing += 1;
    problems.push(
      `${gate.id} → gate-has-carrier:该门禁(${gate.modulePath})既没有同名 selftest 载体`
      + `(${derive(gate.modulePath).carriers.join(" 或 ")})、也没有任何验收段引用它`
      + " —— 无人能证明它被破坏时会红。两条正当出路:① 补一份负向载体(同目录同名 "
      + "`.selftest.mjs`,逐条注入漂移并断言非零退出);② 确有正当理由(该门禁的判定面"
      + `由别的机制覆盖且已审过)则按门禁 id 登记进 ${GATE_EXEMPTIONS_REL} 并写明理由`,
    );
  }
  // ---- stale(ratchet):表项当前不再需要 ----
  // 「不再需要」= 该门禁现在**已经有**载体。留着它,表只会单调增长、失效项永远占位。
  for (const entry of byGate.values()) {
    const gate = gates.find((candidate) => candidate.id === entry.gate);
    if (gate === undefined) {
      stats.stale += 1;
      problems.push(
        `${entry.gate} → gate-has-carrier:门禁级豁免表登记了 ${entry.gate},但门禁清单里没有这一项`
        + " —— 门禁已删,豁免必须同批删掉",
      );
      continue;
    }
    const { selftest, segments } = carriersOf(gate.modulePath);
    if (selftest !== null || segments.length > 0) {
      stats.stale += 1;
      problems.push(
        `${entry.gate} → gate-has-carrier:门禁级豁免表登记了 ${entry.gate},但它现在已有载体`
        + `(${selftest ?? segments.join("、")})—— 表项必须同批删掉`
        + "(载体已补齐,豁免不再是它唯一的依据)",
      );
    }
  }
  return { problems, stats };
}

/**
 * L12 / L12c 判定本体(纯函数):两值取值域 + 链归属两向 + `pendingChain` 显式登记。
 *
 * **链展开复用 `chain-expand.mjs` 的全仓单源**(`expandChainScriptNames`),不重写一份:
 * 扁平 `split('&&')` 只认单层,一旦有人把链上某几步包进子脚本,「门禁在链上」会被静默降级成
 * 「不在链上」而没有任何东西判红(那份重复实现的失效机制,见 chain-expand.mjs 文件头)。
 *
 * 三档:
 *   ① **取值域**:`access` 必须是 `chain` / `offchain`;`local` / `workflow` 是 **S3 的旧取值**
 *      (判红并点名)。⚠ `gate-index.mjs` 已迁移完毕,本档在真实仓库上**恒为零命中** ——
 *      它留着的理由是「旧 `registry.mjs` 的三值若被谁原样搬进新表,判据要指名道姓地说出来」。
 *   ② **链归属两向**:`chain` 的每个 `npmScripts` 都真在 `CHAIN_ROOTS` 的某条链上;
 *      `offchain` 的**一个都不在**。
 *   ③ **L12c**:`offchain` 可带 `pendingChain` 显式登记「本应进链、因 <理由> 未转正」;
 *      带了就要求理由非空且达标(≥`REASON_MIN_CHARS` 字)。
 *
 * ⚠ **`pendingChain` 是 S2 新造的字段**(`gate-index.mjs` 里当前零先例,命名与语义由本判据定义,
 * 不是照抄)。造它的理由:像 `check:src-layout`(判红 + 刻意链外 + 零机器看守)那种状态,
 * 目前只写在注释里,与「有人忘了挂上链」在门禁上不可区分。`pendingChain` 让前者可登记。
 *
 * ⚠ **只核 `npmScripts[0]`(接入点代表脚本),不是全部 script** —— 这是**沿用注册表 R5a 的既有
 * 口径**,不是本判据自选的:`registry.mjs:1235-1237` 已写明「generate/check 成对时 `gen:*` 一侧
 * 与开发侧的 `start` 都不在链上,它们是这道门禁的**另一条入口**,不是接入点的定义;拿全部 script
 * 去核会把『同门禁的多入口』误判成『声明与实际不符』」。实测照「全部 script」核对会多报 3 项
 * (`gen:archive-index` / `gen:gate-ids-table` / `start`),而那三项按仓库既有裁决**本就不该在链上**
 * —— 判据若与注册表 R5a 分歧,两边会给出互相矛盾的结论,而没有一处会告诉你该信谁。
 * (R5b 那个方向看起来是逐 script 的,但它遍历的是**实际被发现的调用点**,`gen:*` 根本不在其中。)
 *
 * @param {object} input 判定输入
 * @param {readonly { id: string, access: string, npmScripts: readonly string[], pendingChain?: unknown }[]} input.gates 门禁清单
 * @param {Record<string, string>} input.scripts package.json 的 scripts 表
 * @returns {{ problems: string[], stats: { onChain: number, offChain: number, legacy: number, badDomain: number, chainNotOnChain: number, offChainOnChain: number, declaredPending: number, shortPendingReason: number } }}
 */
export function judgeL12ChainMembership({ gates, scripts }) {
  /** @type {string[]} */
  const problems = [];
  const stats = {
    onChain: 0,
    offChain: 0,
    legacy: 0,
    badDomain: 0,
    chainNotOnChain: 0,
    offChainOnChain: 0,
    declaredPending: 0,
    shortPendingReason: 0,
  };
  // 链展开:每条链根递归展开一次,取并集。这里问的是「在不在链上」,故重复项去重。
  /** @type {Set<string>} */
  const onChainScripts = new Set(CHAIN_ROOTS);
  for (const root of CHAIN_ROOTS) {
    for (const name of expandChainScriptNames(scripts, root)) onChainScripts.add(name);
  }
  for (const gate of gates) {
    if (gate.access !== ACCESS_CHAIN && gate.access !== ACCESS_OFFCHAIN) {
      stats.badDomain += 1;
      const legacy = LEGACY_ACCESS_VALUES.includes(gate.access);
      if (legacy) stats.legacy += 1;
      problems.push(
        `${gate.id} → gate-chain-membership:access 取值「${gate.access}」不在取值域内`
        + `(只允许 ${ACCESS_CHAIN} / ${ACCESS_OFFCHAIN})`
        + `${legacy ? ` —— 它是 ADR-062 S3 的旧取值(gate-index.mjs 已把它收成 ${ACCESS_OFFCHAIN})` : ""}`
        + "。两值化的理由:三值里 `workflow` 那档(在 CI 上但不在 verify:ci 链上)与二分不对齐,"
        + `使「门禁在不在链上」这个问题没有唯一答案。改法:改 ${GATE_INDEX_MODULE_REL} 里那一项的 access`
        + "(旧 `registry.mjs` 的三值是 S4 前的并存态,它随 S4 整体删除,**不要**改那里)",
      );
      continue;
    }
    if (gate.pendingChain !== undefined) {
      // ⚠ `pendingChain` 只对 `offchain` 有意义:`chain` 意味着它**已经在链上**,
      // 而该字段登记的是「本应进链、因 <理由> 未转正」—— 已进链的门禁再声明「本应进链」
      // 是自相矛盾的声明,判红而不是放过(放过的话,字段就成了任何门禁都能挂的装饰)。
      if (gate.access === ACCESS_CHAIN) {
        problems.push(
          `${gate.id} → gate-chain-membership:access 声明 ${ACCESS_CHAIN} 却带 pendingChain`
          + " —— 该字段登记的是「本应进链、因 <理由> 未转正」,而声明为 chain 意味着它已经在链上。"
          + "删掉 pendingChain,或把 access 改回 offchain",
        );
        continue;
      }
      stats.declaredPending += 1;
      const reason = typeof gate.pendingChain === "string" ? gate.pendingChain : "";
      const chars = reasonChars(reason);
      if (chars < REASON_MIN_CHARS) {
        stats.shortPendingReason += 1;
        problems.push(
          `${gate.id} → gate-chain-membership:声明了 pendingChain,但理由只有 ${chars} 字,`
          + `不足门槛 ${REASON_MIN_CHARS} 字 —— pendingChain 是「本应进链、因 <理由> 未转正」的`
          + "显式登记位;写不出理由时它与「没写」在门禁上不可区分,而那正是它要消灭的失效形态",
        );
      }
    }
    // 接入点 = `npmScripts[0]`(沿用注册表 R5a 的口径,理由见函数头注)
    const accessScript = gate.npmScripts[0];
    if (gate.access === ACCESS_CHAIN) {
      stats.onChain += 1;
      const missing = accessScript === undefined || !onChainScripts.has(accessScript);
      if (missing) {
        stats.chainNotOnChain += 1;
        problems.push(
          `${gate.id} → gate-chain-membership:access 声明 ${ACCESS_CHAIN},但 `
          + `${accessScript === undefined ? "它一个 npm script 都没登记" : `\`${accessScript}\``} `
          + `不在 ${CHAIN_ROOTS.join(" / ")} 任一条链上`
          + " —— 声明在链上而实际不在,是「没人跑它」的最短路径。挂上链,或改声明",
        );
      }
      continue;
    }
    stats.offChain += 1;
    if (accessScript !== undefined && onChainScripts.has(accessScript)) {
      stats.offChainOnChain += 1;
      problems.push(
        `${gate.id} → gate-chain-membership:access 声明 ${ACCESS_OFFCHAIN},但 \`${accessScript}\` `
        + `真在 ${CHAIN_ROOTS.join(" / ")} 上`
        + " —— 声明与事实相反。要么改声明为 chain,要么把它从链上摘下来",
      );
    }
  }
  return { problems, stats };
}

/**
 * 取本轮生效的判据登记表。
 *
 * **默认是模块常量 `CRITERIA`,刻意不可注入**(能传参就能把自己摘出去,那本身是 fail-open)。
 * 唯一例外是自检用的 `criteriaOverride`,且它**只允许删行**:
 * 新增一行或加 `pending: true` 一律抛错 ——
 * 注入口一旦能「加待办标记」,就成了「可配置即假话」的后门,自检夹具就会退化成
 * 「让门禁按我想要的方式过」。这里的判据形状是**子集**而不是任意表。
 *
 * @param {{ criteriaOverride?: readonly { id: string, title?: string, pending?: boolean, pendingReason?: string }[] }} [base]
 * @returns {readonly { id: string, title?: string, pending?: boolean, pendingReason?: string }[]}
 */
function resolveCriteria(base) {
  const override = base.criteriaOverride;
  if (override === undefined) return CRITERIA;
  if (!Array.isArray(override)) throw new Error("criteriaOverride 必须是数组");
  const known = new Map(CRITERIA.map((entry) => [entry.id, entry]));
  const allow = new Set();
  for (const row of override) {
    const original = known.get(row?.id);
    if (original === undefined) {
      throw new Error(`criteriaOverride 只允许删行,不得新增:${String(row?.id)}`);
    }
    // 逐字段对读:允许的是「同一行的一个子集」,不是「重新描述这一行」。
    if ((row.pending ?? false) !== (original.pending ?? false)) {
      throw new Error(`criteriaOverride 只允许删行,不得改 pending:${row.id}`);
    }
    allow.add(row.id);
  }
  return CRITERIA.filter((entry) => allow.has(entry.id));
}

export function checkTestLayout(base = {}) {
  const ctx = makeTestLayoutCtx(base);
  const criteria = resolveCriteria(base);
  /** 机器 id → 该族的强制等级 */
  const channelOf = new Map(criteria.map((entry) => [entry.id, entry.pending === true ? "info" : "problems"]));
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const info = [];
  /**
   * **唯一分流出口**:每条诊断都必须经它进 `problems` 或 `info`,进哪一档由 `CRITERIA` 决定。
   *
   * 查不到该 id ⇒ 按 fail-closed 进 problems **并**额外记一条 `criteria-unregistered:<id>`:
   * 三种「看似合理」的处理都不行 —— 抛异常会把一族的漏登记变成整场崩溃、盖住其余判红;
   * 静默归 problems 则从输出里看不出它漏了;丢弃则那一族的命中静默消失。
   * @param {string} id 源码发出的机器 id
   * @param {string} line 完整诊断行
   * @returns {void}
   */
  const report = (id, line) => {
    const channel = channelOf.get(id);
    if (channel === undefined) {
      // 未登记 ⇒ 诊断本身按 fail-closed 进 problems,并**额外**追一条 criteria-unregistered。
      problems.push(line);
      isRegistered(id, criteria, problems);
      return;
    }
    (channel === "info" ? info : problems).push(line);
  };
  /** @type {TestLayoutStats} */
  const stats = {
    files: 0,
    segments: 0,
    layerSegments: 0,
    l4Violations: 0,
    l4NoOwnSubject: 0,
    l4SegmentImports: 0,
    l5Hits: 0,
    l7Extra: 0,
    l7Missing: 0,
    l8Violations: 0,
    l6Violations: 0,
    l5Unregistered: 0,
    l5ExemptionsEmptyReason: 0,
    l5ExemptionsShortReason: 0,
    l5StaleExemptions: 0,
    l11WithCarrier: 0,
    l11Exempted: 0,
    l11Missing: 0,
    l11MissingModule: 0,
    l11Stale: 0,
    l11ShortReason: 0,
    l11TableProblems: 0,
    l11BadEntries: 0,
    l12OnChain: 0,
    l12OffChain: 0,
    l12BadDomain: 0,
    l12ChainNotOnChain: 0,
    l12OffChainOnChain: 0,
    l12DeclaredPending: 0,
    l12ShortPendingReason: 0,
    c1Artifacts: 0,
    c1MirrorMissing: 0,
    c1MirroredSegments: 0,
    c1SameNameMissing: 0,
    c3Hits: 0,
    c3Unregistered: 0,
    c3ShortReason: 0,
    c3Exemptions: 0,
    c3Stale: 0,
    localAssertImpl: 0,
    noNamedCase: 0,
    noCaseImport: 0,
    noCaseCall: 0,
    gateSelftests: 0,
    gatesNoNamedCase: 0,
    gatesNoCaseImport: 0,
    gatesNoCaseCall: 0,
    gateRosterChecked: 0,
    gateRosterUnlisted: 0,
    gateRosterStale: 0,
    gateRosterTableProblems: 0,
    gateRosterEmptyExtraction: 0,
    gateRosterOnlyInRoster: 0,
    gateRosterOnlyInSource: 0,
    gateRosterNames: 0,
  };

  /** @type {string[]} */
  let files;
  try {
    files = collectTestFiles(ctx);
  } catch (error) {
    report(
      "scan-surface-missing",
      `${TEST_REL}/ → scan-surface-missing:读不到 ${TEST_REL}/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 扫描面为空是最坏的失效形态`
      + "(门禁从这一刻起什么也没查而输出是 exit 0),故判红",
    );
    return { problems, info, stats };
  }
  stats.files = files.length;

  /** @type {{ srcLayers: string[], topTrees: string[], layers: string[], rootsOf: (layer: string) => string[] }} */
  let mirror;
  try {
    mirror = deriveMirrorLayers(ctx);
  } catch (error) {
    report(
      "scan-surface-missing",
      `src/ → scan-surface-missing:读不到 src/ 子树(`
      + `${error instanceof Error ? error.message : String(error)}) —— 镜像源集合派生的输入缺失时,`
      + "L7 只能按空集比对并把全部顶层目录判成「多一个」(恒红且无信息量),故判红",
    );
    return { problems, info, stats };
  }

  const segments = files.filter((file) => file.endsWith(SEGMENT_EXT));
  stats.segments = segments.length;

  // ---- 判据一 L4 + 判据二 L5:逐段判定(两族共用一次读取) ----
  // L4/L5 的作用域层集合 = 镜像源派生集 ∪ {harness}(T3 步 6 的自指层)。
  //
  // ⚠ `harness` **刻意不进 `mirror.layers`**:那个数组的成员要参与 L7 的顶层目录集合
  // 等式(派生集 ∪ NON_MIRROR_TOP_DIRS),把 harness 塞进去会让它同时出现在等式两侧 ——
  // 集合相等判据虽然会去重、结果不变,但 `topTrees` 会多出一项,L7 诊断文案的
  // 「顶层树」清单随之失真(它列的是仓根四棵树,不是 test/ 下的段目录)。
  // 故只在**这里**(L4/L5 的作用域)补一项,派生集本身不动。
  const layerSet = new Set([...mirror.layers, HARNESS_DIR]);
  // L5 豁免表:先读表,再逐条判。表本身的读错/键名错先判红(它们会让整张表静默失效)。
  const { entries: l5Exemptions, problems: l5ExemptionProblems } = base.l5Exemptions
    ? { entries: base.l5Exemptions, problems: [] }
    : loadL5Exemptions(ctx.root);
  for (const problem of l5ExemptionProblems) {
    report("l5-exemption-table", `${L5_EXEMPTIONS_REL} → l5-exemption-table:${problem}`);
  }
  /** 豁免表键 → 表项 */
  const l5ByKey = new Map();
  // 键名校验放在**这里**而不是 loadL5Exemptions 里:注入面(ctx.l5Exemptions)也必须过同一道
  // 校验 —— 否则一条键名写错的注入表项会得到一个永不命中的键、被静默跳过。
  for (const [index, entry] of l5Exemptions.entries()) {
    if (typeof entry?.segment !== "string" || typeof entry?.specifier !== "string") {
      report(
        "l5-exemption-table",
        `${L5_EXEMPTIONS_REL} → l5-exemption-table:第 ${index + 1} 项缺 segment 或 specifier`
        + "(键名写错会让整条豁免静默失效 —— 它拿到的键永远命中不上)",
      );
      continue;
    }
    l5ByKey.set(l5ExemptionKey(entry.segment, entry.specifier), {
      segment: entry.segment,
      specifier: entry.specifier,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  /** 本轮真的命中过的豁免表键(用于 stale 检测) */
  const l5HitKeys = new Set();
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    // 非镜像层目录下的段(behavior / harness / 当前的 common、fixtures)**不参与 L4/L5**:
    // behavior 段的定义就是横跨多层(对它判「不得跨层」是判据反了),harness 不是被测层;
    // 而 common / fixtures 这类非镜像目录由 L7 点名(「多一个顶层目录」),不必再叠一条
    // 无信息量的 L4 判红。
    if (!layerSet.has(layer)) continue;
    stats.layerSegments += 1;
    const own = mirror.rootsOf(layer);
    const source = ctx.readText(file);
    const imports = extractImports(source, file);
    // L4 的**声明通道**(ADR-062:86):段可以直接 import 本层主体,也可以用 covers 声明
    // 自己测的是本层。ADR-062 已否决「改成传递闭包」—— 那会让 `test/core/comments.test.js`
    // 这类段恒绿(它经 harness 助手间接到达 core,闭包一算就是 core 主体,而它其实只是
    // 「借」了 core 的模块)。声明通道与闭包的区别在于:闭包是判据替段推断,声明是段自己
    // 写明,且写错会被 L6 的第三条判红(元素必须在磁盘上真实存在)。
    const covers = extractCovers(source);
    const coversOwn = covers !== null && covers.some((element) => own.some((p) => element.startsWith(p)));

    // L4 上界:至少一个解析后落在本层主体根内的引用。
    // type-only 引用**计入**「至少一个」—— 形如 `@typedef {import("../../src/core/i18n.js")…}`
    // 的类型引用在本仓长期是必需形态,把它判红等于逼人删掉类型标注。⚠ 该举例写于 ADR-069 之前
    // (见文件头),现已改指 `dist/`;**「type-only 计入」这条判据口径不变** —— 它与类型引用
    // 指哪棵树无关,故本条的判据逻辑不需要跟着 ADR-069 改。
    const ownHits = imports.filter((entry) => entry.resolved !== null && own.some((p) => entry.resolved.startsWith(p)));
    if (ownHits.length === 0 && !coversOwn) {
      stats.l4NoOwnSubject += 1;
      stats.l4Violations += 1;
      report(
        "test-layer-self-hosted",
        `${file} → test-layer-self-hosted:该段解析后**没有 import 任何 ${layer} 层的主体**`
        + `(本层主体根 ${own.join(" 或 ")})—— 「不许 import 别层」这类上界规则在它身上会全绿,`
        + `而它恰恰是最该被抓的形态。三条正当出路:搬进真正被测的那一层;`
        + `它测的其实是测试框架/门禁自身 → 归 test/behavior/ 并在 covers 里写明被测对象;`
        + `它经 harness 助手/子进程间接到达本层(判据静态看不见)→ 留在原处并 export const covers `
        + `声明它测的是本层(声明里至少一个元素要落在本层主体根 ${own.join(" 或 ")} 下)`,
      );
    }

    // L4 另一格:段 import 段。段是**发现与隔离的单位**(runner 逐段起子进程),
    // 段之间互相 import 让「一段失败」不再是可归因的最小单位,且被 import 的那段会
    // 在自己的进程里再跑一遍(双跑 + 顺序耦合)。
    const segmentImports = imports.filter(
      (entry) => entry.resolved !== null && entry.resolved.startsWith(`${TEST_REL}/`) && entry.resolved.endsWith(SEGMENT_EXT),
    );
    if (segmentImports.length > 0) {
      stats.l4SegmentImports += 1;
      stats.l4Violations += 1;
      report(
        "test-layer-self-hosted",
        `${file} → test-layer-self-hosted:段 import 段(${[...new Set(segmentImports.map((e) => e.resolved))].join(", ")})`
        + " —— 段是发现与隔离的单位,段间 import 让失败不可归因且让被 import 的段双跑。"
        + "共用部分抽进非段助手(当前在 test/harness/(T3 步 1 已迁),harness/)",
      );
    }

    // L5:跨层。type-only 引用**不算**跨层(编译期擦除,与 check-import-boundary 的
    // allowTypeOnly 钩子同款取舍)。
    //
    // 三条 fail-closed(ADR-062 的 L5 豁免表形态,判据与豁免判准的单一来源都在
    // L5_EXEMPTIONS_REL 那份数据文件里):
    //   ① 未登记的跨层 import 判红 —— 默认形态,不因为「它看起来像顺带的」就放过;
    //   ② reason 不合格判红 —— **分两档**:空(没写)与不足 `REASON_MIN_CHARS` 字(写了但太短)。
    //      两档分开报而不合并成一档:病因不同(忘了写 vs 写得不够),而「见谅」式的一句话
    //      与空白在门禁上原本不可区分 —— 合并就等于让「短理由」继续合法;
    //   ③ stale 判红 —— 登记了却当前不再命中(代码删了/改名了),必须从表里删掉。
    //      这一条是 ratchet 的全部意义:没有它,表只会单调增长,失效项永远留着。
    for (const entry of imports) {
      if (entry.resolved === null || entry.typeOnly) continue;
      if (own.some((p) => entry.resolved.startsWith(p))) continue;
      const target = foreignLayerOf(entry.resolved, mirror);
      if (target === null) continue;
      stats.l5Hits += 1;
      const key = l5ExemptionKey(file, entry.resolved);
      const exemption = l5ByKey.get(key);
      if (exemption !== undefined) {
        l5HitKeys.add(key);
        const chars = reasonChars(exemption.reason);
        if (chars === 0) {
          stats.l5ExemptionsEmptyReason += 1;
          report(
            "test-layer-cross-import",
            `${file} → test-layer-cross-import:命中已在豁免表登记(${entry.resolved}),但 reason 是空的`
            + ` —— 豁免表的存在意义就是「这一次跨层为什么合法」,空理由让表退化成「见谅」。`
            + `补上理由,或把它从表里删掉(那说明它不该被豁免)`,
          );
        } else if (chars < REASON_MIN_CHARS) {
          stats.l5ExemptionsShortReason += 1;
          report(
            "test-layer-cross-import",
            `${file} → test-layer-cross-import:命中已在豁免表登记(${entry.resolved}),`
            + `但 reason 只有 ${chars} 字,不足门槛 ${REASON_MIN_CHARS} 字`
            + ` —— 与「空」分开判:这一档是**写了但没写够**。不到门槛的理由挡不住下一次「先豁免、`
            + `回头再补」,表就退化成一句「见谅」。补到说得出「为什么这次跨层合法」的长度,`
            + `或把它从表里删掉(那说明它不该被豁免)`,
          );
        }
        continue;
      }
      stats.l5Unregistered += 1;
      report(
        "test-layer-cross-import",
        `${file} → test-layer-cross-import:${layer} 层的段 import 了 ${target} 层的主体 `
        + `(${entry.resolved})—— 三条正当出路:① 它只是夹具输入/常量/规格/格式化函数(换个值段仍成立)`
        + ` → 按 (段, 说明符) 登记进 ${L5_EXEMPTIONS_REL} 并写明理由;`
        + `② 本段真的执行别层实现并对它的行为下断言 → 那是被测对象的一部分,`
        + `把该段搬进 test/behavior/ 并在段内写 covers(声明它横跨哪几层);`
        + `③ 主体判错了层 → 搬进真正被测的那一层`,
      );
    }
  }

  // ---- L5 豁免表的 stale 检测(ratchet)----
  // 在段循环**之外**:它要问的是「表里有没有当前不再命中的项」,与哪一段无关。
  for (const [key, entry] of l5ByKey) {
    if (l5HitKeys.has(key)) continue;
    stats.l5StaleExemptions += 1;
    report(
      "l5-exemption-stale",
      `${entry.segment} → l5-exemption-stale:豁免表登记了 (${entry.specifier}),但本次扫描没有命中它`
      + " —— 代码删了或改名了,豁免必须同批删掉。留着它,表只会单调增长、"
      + "失效项永远占着位子(这正是 ratchet 要防的)",
    );
  }

  // ---- C3 的门禁主体豁免表:读表 + 键名校验(stale 检测在段循环之外)----
  //
  // ⚠ **表本体是数据文件**(与判定本体分离,理由见 GATE_SUBJECT_EXEMPTIONS_REL 的注释);
  // 注入面 `base.gateSubjectExemptions` 让自检在合成根上求值同一批判据 ——
  // 与 `l5Exemptions` / `gateExemptions` 两处注入面同款,且**刻意保留**:注入面是判据
  // 在合成根上求值的唯一途径(自检不能 spawn、也不该读真实工作树)。
  const { entries: c3Entries, problems: c3ExemptionProblems } = base.gateSubjectExemptions
    ? { entries: base.gateSubjectExemptions, problems: [] }
    : loadGateSubjectExemptions(ctx.root);
  for (const problem of c3ExemptionProblems) {
    report("test-layer-gate-subject", `${GATE_SUBJECT_EXEMPTIONS_REL} → test-layer-gate-subject:${problem}`);
  }
  stats.c3Exemptions = c3Entries.length;
  /** @type {Map<string, { segment: string, specifier: string, reason: string }>} */
  const c3ByKey = new Map();
  for (const [index, entry] of c3Entries.entries()) {
    if (typeof entry?.segment !== "string" || typeof entry?.specifier !== "string") {
      report(
        "test-layer-gate-subject",
        `门禁主体豁免表 → test-layer-gate-subject:第 ${index + 1} 项缺 segment 或 specifier`
        + "(键名写错会让整条豁免静默失效 —— 它拿到的键永远命中不上)",
      );
      continue;
    }
    c3ByKey.set(l5ExemptionKey(entry.segment, entry.specifier), {
      segment: entry.segment,
      specifier: entry.specifier,
      reason: typeof entry.reason === "string" ? entry.reason : "",
    });
  }
  /** 本轮真的命中过的门禁主体豁免表键(用于 stale 检测) */
  const c3HitKeys = new Set();

  // ⚠ **「本求值根是不是索引描述的那棵树」这条边界**在此**求值一次**、下面 L11/L12 整段复用
  // 同一个值(那边不再重算 —— 两处各算一次的话,将来有人给其中一处加上/去掉别的条件,
  // 就会出现「L11 认为在这棵树上、C3 认为不在」而没有任何东西报红)。
  //
  // ⚠ **C3 的判定与 stale 都受这条边界约束**,理由与 L11 那条**同款、只是换了对象**:
  // 这张表描述的是**真实仓库**,而 `ctx.fileExists` 以**求值根**为准。在一棵只造 `test/`
  // 布局的合成树上,表里那条表项必然 stale(那段不在这儿),于是**每一条合成夹具**都会
  // 多出一条与它无关的 stale 红 —— 症状离根因隔着一整族判据。「它现在 stale」在合成根上
  // **不是事实,是范畴错误**(那棵树根本不是这张表描述的那棵仓)。
  const indexInRoot = ctx.fileExists(GATE_INDEX_MODULE_REL);

  // ---- REQ-187 C1:TS 段口径两档(被测 import 的定义见文件头同名小节)----
  //
  // ⚠ **这一段与上面的 L4/L5 逐段循环刻意分开**,而不是塞进那个循环里:
  // C1 的判据对象是「段 → dist/** 产物」的**边**,L4/L5 的作用域是 `layerSet` 内的段
  // (behavior / harness 不参与)。两者口径不同 —— `test/behavior/**` 段的定义就是横跨多层,
  // 它 import `dist/**` 完全正常,把它算进 C1 的分母会让这一族恒红。
  // 故这里**另起一个只扫 `layerSet` 段的循环**,并复用已读好的段正文?—— 不能复用:
  // 那个循环的 `source` / `imports` 是块内局部变量,而 C1 要在**同一批段**上再走一遍
  // (判据不同 ⇒ 处置不同 ⇒ 两处独立的诊断)。重读一次段正文是刻意的:它让 C1 的每一格
  // 夹具只可能因 C1 判红,不会与 L4/L5 的修复耦合在一起。
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    if (!layerSet.has(layer)) continue;
    const imports = extractImports(ctx.readText(file), file);

    // ---- C1 档一(产物侧):产物背后必须有真源文件 ----
    for (const entry of imports.filter((e) => isSubjectImport(e))) {
      stats.c1Artifacts += 1;
      const candidates = mirrorSourceCandidates(entry.resolved ?? "");
      if (candidates.some((candidate) => ctx.fileExists(candidate))) continue;
      stats.c1MirrorMissing += 1;
      report(
        "test-dist-artifact-source-mirror",
        `${file} → test-dist-artifact-source-mirror:被测 import 落在编译产物 ${entry.resolved},`
        + `但它的镜像源文件全部不存在(${candidates.join(" 或 ")})—— 段的身份是**源文件**、`
        + "编译产物只是取得手段(TS 段的必然形态),产物没有源就是「源已删 / 从未存在 / 路径写错」。"
        + `处置:① 源确实存在但路径不同 → 改 import 到正确的产物路径;`
        + "② 源已删或从未存在 ⇒ 这个段没有可测对象,搬走或随源一起删",
      );
    }

    // ---- C1 档二(段侧):段路径镜像了 src 源文件 ⇒ 被测 import 必须落在同名产物上 ----
    //
    // ⚠ **判据对象是「段路径镜像了某个真实存在的源文件」这件事**,不是「段住在 src 层目录」
    // —— 后者的分母是 103 段而其中 99 段**刻意不按 basename 镜像源**(实测:103 段里只有 4 段
    // 的路径逐段对得上真实源文件)。拿 103 当分母会把 99 段判红,而那 99 段判红的处置
    // 是「改段名」—— 那是**改名纪律**,不属于这一族。分母收窄到「真镜像」的那几段,
    // 这一族问的才是它该问的:「你既然自称镜像 X,那你的被测 import 就得是 X 的产物」。
    //
    // ⚠ **写成 `if (...) { … }` 而不是 `if (未镜像) continue`**:档二的「未镜像」必须**只**
    // 跳过档二自己,不能连带跳掉下面的 C3 —— 用 `continue` 时那一格会让 C3 在所有
    // 非镜像段(实测 140 段里有 136 段)上**静默消失**,而症状是「C3 命中 0 处」这种
    // 看不出根因的读数。两族在同一趟循环里就必须各自用块级门。
    const mirrors = mirroredSourceOf(file, ctx.fileExists);
    if (mirrors !== null) {
      stats.c1MirroredSegments += 1;
      if (!imports.some((entry) => entry.resolved === mirrors.artifact && !entry.typeOnly)) {
        stats.c1SameNameMissing += 1;
        report(
          "test-segment-mirror-same-name",
          `${file} → test-segment-mirror-same-name:段路径镜像了真实存在的源文件 ${mirrors.source},`
          + `但它没有任何被测 import 落在同名编译产物 ${mirrors.artifact} 上`
          + " —— 段名与被测对象脱钩(自称在测 X、实际测的是 Y)。处置:① 段确实在测 X ⇒ 补上对该产物的"
          + "import;② 段在测的是别的东西 ⇒ 把段搬到它真正被测的那一层(段名不必镜像)",
        );
      }
    }

    // ---- C3(L4 第三档):非门禁层的段 import 门禁树 ⇒ 判红,除非已登记 ----
    //
    // ⚠ **`test/gates/**` 的段是门禁段本身**,它们 import 门禁树是**定义的**而非可疑的
    // (L11 的档 1b「验收段引用该门禁」正建立在这一点上:`test/gates/*.test.js` import
    // `gates/repo/check-*.mjs` 是门禁的**载体形态**)。故作用域是「`layerSet` 段 **且**
    // 层名 ≠ `gates`」—— 这与 L4/L5 的作用域(`layerSet` 全体)差一档,差在这一档上,
    // 漏掉它会让 C3 在真实仓库上判红 31 项(实测),而那 31 项全是门禁段在测门禁。
    if (layer === GATES_DIR || !indexInRoot) continue;
    //
    // ⚠ **与 L5 那段循环的 `continue` 无关**:L5 对已登记的边 `continue` 掉了,而 C3 要对
    // **同一条边**独立判一次(`test/shared/geometry-gate.test.js → driver.mjs` 正是这种形态:
    // 它在 L5 表里合法存在,而 C3 仍判红)。两族的处置不同,不能共用一次判定。
    for (const entry of imports) {
      if (entry.resolved === null || entry.typeOnly) continue;
      if (!entry.resolved.startsWith(GATES_TREE)) continue;
      stats.c3Hits += 1;
      const exemption = c3ByKey.get(l5ExemptionKey(file, entry.resolved));
      if (exemption !== undefined) {
        c3HitKeys.add(l5ExemptionKey(file, entry.resolved));
        const chars = reasonChars(exemption.reason);
        if (chars < REASON_MIN_CHARS) {
          stats.c3ShortReason += 1;
          report(
            "test-layer-gate-subject",
            `${file} → test-layer-gate-subject:命中已在门禁主体豁免表登记(${entry.resolved}),`
            + `但 reason 只有 ${chars} 字,不足门槛 ${REASON_MIN_CHARS} 字 —— 与 L5 豁免同判准:`
            + "本表登记的是「这个段的层归属是对的、门禁主体在这里是被测输入」,"
            + "写不出这句话就说明该搬段而不是该登记",
          );
        }
        continue;
      }
      stats.c3Unregistered += 1;
      report(
        "test-layer-gate-subject",
        `${file} → test-layer-gate-subject:${layer} 层的段 import 了门禁树的模块(${entry.resolved})`
        + ` —— 它住在 ${layer}/ 却在测 gates/ 树里的东西,段的位置已经可疑(它到底在测 ${layer} 还是在测门禁?)。`
        + "⚠ **L5 豁免表不能豁免这一族**:L5 问「这次 import 是不是只提供数据」,本族问「段住在这一层对不对」。"
        + `处置:① 段的主体其实在 gates/ ⇒ 搬到 test/gates/ 对应路径;`
        + `② 段的主体确实在 ${layer}/、门禁主体在这里只当被测输入 ⇒ 按 (段, 说明符) 登记进门禁主体豁免表并写明理由`,
      );
    }
  }

  // ---- C3 豁免表的 stale 检测(ratchet):登记了却当前不再命中 ----
  // 与 L5 的 stale 同款:**表项当前仍真的命中才是合法现状**。段被搬走 / import 被删之后,
  // 表项必须同批删掉 —— 否则表只增不减、失效项永远占位,而门禁对它们一声不吭。
  // ⚠ 受 `indexInRoot` 约束(理由见上面 `indexInRoot` 的注释):合成根上「stale」是范畴错误。
  for (const [key, entry] of (indexInRoot ? c3ByKey : [])) {
    if (c3HitKeys.has(key)) continue;
    stats.c3Stale += 1;
    report(
      "test-layer-gate-subject",
      `${entry.segment} → test-layer-gate-subject:门禁主体豁免表登记了 (${entry.specifier}),`
      + "但本次扫描没有命中它 —— 段被搬走或那条 import 删了,豁免必须同批删掉",
    );
  }

  if (stats.segments < ctx.minScannedFiles) {
    report(
      "scan-surface-collapsed",
      `${TEST_REL}/ → scan-surface-collapsed:${TEST_REL}/ 下只扫到 ${stats.segments} 个段文件`
      + `(下限 ${ctx.minScannedFiles})—— walker 可能已失效,而五族判据在零扫描面下会「全绿」`,
    );
  }

  // ---- REQ-221(#09)门禁树侧:扫描面 + 每份自测接入具名 case ----
  //
  // ⚠ **整段受 `indexInRoot` 约束**,解法与 L11 / L11b / C3 **完全同源**(理由见 `indexInRoot`
  // 那条注释,只是换了对象):合成根里**没有 `gates/` 子树**(只有 C3 那几条夹具显式铺了
  // `gates/repo/*.mjs`),新 collector 在那里会抛;而在一棵只造 `test/` 布局的合成树上,
  // 「`gates/` 里没有自测」**不是事实而是范畴错误**(它不是门禁索引描述的那棵树)。
  // ⇒ 「`gates/` 读不到」经**复用的** `scan-surface-missing` 判红(它那一条 title 本就写成
  // 双树形态、处置两树相同),而**整段判定面**在索引模块不在场时整段不适用。
  if (indexInRoot) {
    /** @type {string[]} */
    let gateSelftests;
    try {
      gateSelftests = collectGateSelftestFiles(ctx);
    } catch (error) {
      report(
        "scan-surface-missing",
        `${GATES_SELFTEST_ROOT}/ → scan-surface-missing:读不到 ${GATES_SELFTEST_ROOT}/ 子树(`
        + `${error instanceof Error ? error.message : String(error)}) —— 门禁自测的扫描面为空时`
        + "新族会「全绿」(零分母时没有任何一份自测被判红,而那正是恒绿这一最坏失效形态)",
      );
      gateSelftests = [];
    }
    stats.gateSelftests = gateSelftests.length;

    // 塌缩另立 id(处置与段侧那一档不同,理由见 CRITERIA 里那两行的注释)。
    if (gateSelftests.length < ctx.minSelftestFiles) {
      report(
        "gates-selftest-surface-collapsed",
        `${GATES_SELFTEST_ROOT}/ → gates-selftest-surface-collapsed:${GATES_SELFTEST_ROOT}/ 下只扫到 `
        + `${gateSelftests.length} 份 ${GATES_SELFTEST_EXT} 自测(下限 ${ctx.minSelftestFiles})`
        + `—— ${GATES_SELFTEST_EXT} 的发现规则可能写错、或门禁树被搬走了,而新族在零扫描面下会「全绿」`,
      );
    }

    // ---- 族:每份门禁自测接入具名 case(与段侧同名形态那一族**不同 id**)----
    //
    // ⚠ **读盘**:这里对每份自测读一次正文。与段侧那两族同款理由(同一批文件读两次会让
    // 「是否命中」不可复现),故**不复用**任何别的循环已读好的文本 —— 那些正文都读在块内
    // 局部变量里,循环一结束就没了。
    for (const file of gateSelftests) {
      const contract = caseContractState(ctx.readText(file), file, GATES_CASE_MODULE_REL);
      if (contract.imported && contract.caseCalls > 0) continue;
      stats.gatesNoNamedCase += 1;
      if (!contract.imported) {
        stats.gatesNoCaseImport += 1;
        report(
          "gates-selftest-named-case",
          `${file} → gates-selftest-named-case:该门禁自测没有 import case 契约模块 ${GATES_CASE_MODULE_REL}`
            + " —— 门禁自测也要接入具名 case:createCaseSuite 建 suite、逐条 suite.case(...) 登记用例,"
            + "case 数才能成为护栏的唯一计数单位(否则这一族的分母是「文件数」而不是「用例数」,"
            + "而删掉一整个 case 不改变任何可数的东西)。⚠ 门禁树**引不到** "
            + "test/harness/case.js(`gates-stay-in-gates` 的允许面里没有它,ADR-074 已否决给它加 allow),"
            + `故这一侧接的是落在 shared/ 的真实现。处置:import ${GATES_CASE_MODULE_REL} `
            + "并把断言收进 suite.case(...) 之内",
        );
      } else {
        stats.gatesNoCaseCall += 1;
        report(
          "gates-selftest-named-case",
          `${file} → gates-selftest-named-case:该门禁自测 import 了 case 契约模块 ${GATES_CASE_MODULE_REL},`
            + "但正文里没有任何 `.case(` 调用(只建了 suite 或只用裸断言)—— import 了契约却不接进去,"
            + "等于「声明了却不用」,case 级粒度名存实亡。处置:把断言收进 suite.case(...) 之内",
        );
      }
    }

    // ---- 族:case 名集合 ⟷ 登记名册两向差集(与上面「有没有接」那一族**不同 id**)----
    //
    // ⚠ **整段与上一节同受 `indexInRoot` 约束**(理由同款,不重述):合成根里没有 `gates/`,
    // 「这份自测的 case 名册是什么」在那棵树上不是事实而是范畴错误。
    //
    // ⚠ **读盘**:名册与自测正文各读一次。与上一节同款理由(同一批文件读两次会让
    // 「是否命中」不可复现),且名册**必须**现读 —— 它是本族判定面的另一半,不读就是恒绿。
    const sourceByFile = new Map(GATE_SELFTEST_CASE_SOURCES.map((entry) => [entry.file, entry]));
    const selftestSet = new Set(gateSelftests);
    const liveSourceRows = GATE_SELFTEST_CASE_SOURCES.filter((entry) => selftestSet.has(entry.file));
    // ⚠ **本族整段判定面收窄在「这一棵树与登记表有交集」之后**(=liveSourceRows 非空),
    // 与 C3 / L11b / L5 的 stale 收窄同款范畴边界:登记表描述的是**真实仓库**那 20 份自测,
    // 而自检在合成根里铺的自测(`check-demo.selftest.mjs` 之类)与它**零重合** ——
    // 那不是「少登记了一行」而是「这张表描述的不是这棵树」。
    // ⇒ 收窄之后:真实仓上 20 行全在 ⇒ 本族照常判;合成根上零重合 ⇒ 本族整段不适用。
    // ⚠ **收窄本身开的那个洞**(20 份**全部**被删/改名 ⇒ 交集为空 ⇒ 本族静默)由
    // `gates-selftest-surface-collapsed` 兜住(份数掉到下限以下即判红),不是无人守。
    // 自检要验本族时铺的是**在册路径**(如 `gates/repo/check-docs.selftest.mjs`)的合成正文,
    // 那样交集非空、本族正常生效 —— 见 selftest 里那几档的做法。
    if (liveSourceRows.length === 0) {
      // 整段不适用,不做任何报告(静默是**正确**方向:那一族此刻没有判定面)。
    } else {
      // ① 登记表少一行:树里有这份自测而表里没有它 ⇒ 它**静默退出本族判定面**。
      //    这是「登记表自身漂移」的唯一看守(少一行 = 少一个被看护的文件,且症状是全绿)。
      for (const file of gateSelftests) {
        if (sourceByFile.has(file)) continue;
        stats.gateRosterUnlisted += 1;
        report(
          "gates-selftest-case-roster",
          `${file} → gates-selftest-case-roster:该门禁自测在取名策略登记表 ${GATE_SELFTEST_CASE_SOURCES_FILE} 里`
            + "**没有登记行** —— 它因此静默退出本族的判定面(case 名集合与名册两向差集无人核对),"
            + "而症状是「全绿」。处置:在登记表里补一行,`strategies` 写明名从哪儿抽"
            + "(五类:内联 `suite.case('…')` 字面量 / 顶层表的 `name:`(或变异实验表的 `id:`)字段 /"
            + " 内联在 harness 调用实参里的 `cases:` 数组的 `name:` 字段 / 本地 wrapper 首参)",
        );
      }
      // ② 登记表多一行(stale):树里已无这份自测(改名 / 删除 / 搬走)⇒ 判红。
      //    与 L5 / C3 的 stale 同款取舍:ratchet 的全部意义就是防「表项只增不减」。
      //
      // ⚠ **但这一档额外收窄在「这一棵树完整」之后** —— 即 `minSelftestFiles > 0`
      // 且**扫到的份数已达下限**。理由与 `scan-surface-collapsed` 同源:「表里这一行
      // 当前不在树上」是**关于这棵树完整性**的断言,而一棵只铺了 1 份自测的合成树
      // 根本谈不上完整(合成根上铺的那份与另外 19 行零重合)。少这一条收窄,
      // 每一条只铺一份在册自测的夹具都会被另外 19 条 stale 顶住 —— 症状离根因
      // 隔着一整族判据,且**每档夹具验的到底是哪一族再也分不清**。
      // ⇒ 真实仓(20 份 ≥ 下限 15)照常判;合成根默认(`minSelftestFiles: 0`)不适用。
      const treeIsComplete = ctx.minSelftestFiles > 0 && gateSelftests.length >= ctx.minSelftestFiles;
      for (const entry of treeIsComplete ? GATE_SELFTEST_CASE_SOURCES : []) {
        if (selftestSet.has(entry.file)) continue;
        stats.gateRosterStale += 1;
        report(
          "gates-selftest-case-roster",
          `${GATE_SELFTEST_CASE_SOURCES_FILE} → gates-selftest-case-roster:登记表登记了 ${entry.file},`
            + "但该门禁自测在本次扫描的树里不存在 —— 它已改名 / 被删 / 被搬走,"
            + "登记项必须同批改成新路径(否则表项只增不减、失效项永远占位)",
        );
      }
      // ③ 两向差集本体:逐份读自测正文与名册,两个方向各报。
      for (const file of gateSelftests) {
        const source = sourceByFile.get(file);
        if (source === undefined) continue;
        stats.gateRosterChecked += 1;
        const rosterRel = /** @type {string} */ (caseRosterRelFor(file));
        const roster = loadGateCaseRoster(rosterRel, ctx.root);
        if (roster.problems.length > 0) {
          stats.gateRosterTableProblems += roster.problems.length;
          for (const problem of roster.problems) {
            report("gates-selftest-case-roster", `${rosterRel} → gates-selftest-case-roster:${problem}`);
          }
          // ⚠ **名册自身失效时不继续判差集**:那一档已经判红,再拿一个空册去比只会
          // 报出满屏「册有源无」,把真因(表坏了)埋在一堆派生症状里(诊断指向 A、真因是 B)。
          continue;
        }
        stats.gateRosterNames += roster.cases.length;
        const names = extractGateCaseNames(ctx.readText(file), source.strategies);
        // ⚠ **恒绿防护的第二道 + 「策略与源码脱节」那一档**:抽出 0 条时名册非空 ⇒ 全档
        // 「册有源无」。不单独点破的话,读的人会以为「那 N 条 case 全被删了」,
        // 而真因是登记表里的策略名写错了(表名/字段名/包装器名),改策略即可。
        if (names.length === 0) {
          stats.gateRosterEmptyExtraction += 1;
          report(
            "gates-selftest-case-roster",
            `${file} → gates-selftest-case-roster:按登记的取名策略抽出 **0 条** case 名`
              + `(策略 ${source.strategies.map((s) => `${s.kind}${s.table === undefined ? "" : `:${s.table}${s.field === undefined ? "" : `.${s.field}`}`}${s.wrapper === undefined ? "" : `:${s.wrapper}`}`).join(" + ")})`
              + " —— 策略与源码脱节(表名 / 字段名 / 包装器名写错,或取名那一档整个被删了)。"
              + `若取名那一档确实已不存在,应把它同批删掉并从 ${GATE_SELFTEST_CASE_SOURCES_FILE} 撤登记;`
              + "⚠ 这与「那份自测的 case 全被删光」在读数上同形,而后者不该由本族来报"
              + "(`gates-selftest-named-case` 那一族报的是「有没有接」,不是「有多少条」)",
          );
          continue;
        }
        const inRoster = new Set(roster.cases);
        const inSource = new Set(names);
        for (const name of roster.cases) {
          if (inSource.has(name)) continue;
          stats.gateRosterOnlyInRoster += 1;
          report(
            "gates-selftest-case-roster",
            `${rosterRel} → gates-selftest-case-roster:名册登记了 case「${name}」,`
              + `但 ${file} 里按策略抽不出它 —— 那条 case 已被删除(或改了档名)而名册没同批删。`
              + "处置:档确实已删 ⇒ 同批删名册这一条;档只是改了名 ⇒ 同批把名册改成新名",
          );
        }
        for (const name of inSource) {
          if (inRoster.has(name)) continue;
          stats.gateRosterOnlyInSource += 1;
          report(
            "gates-selftest-case-roster",
            `${file} → gates-selftest-case-roster:源码里有 case「${name}」,但名册 ${rosterRel} 没登记它`
              + " —— 新增 / 改名的那一档没进册(名册是「这条 case 存在过」的人工凭证,漏登记它"
              + "就等于这条 case 在名册侧不存在)。处置:把该档名补进名册的 cases 数组",
          );
        }
      }
    }
  }

  // ---- 判据三 L7:顶层目录集合相等 ----
  // 只数**目录**:`test/acceptance.mjs`(段入口,已登记在注册表 TOOLCHAIN_FILES)不是一层,
  // 计入即恒红 —— 与 check-import-boundary 的 analyzeSrcTopLayers 同一取舍。
  const actualDirs = ctx.listDir(TEST_REL).filter((entry) => entry.isDirectory).map((entry) => entry.name).sort();
  const expectedDirs = [...new Set([...mirror.layers, ...NON_MIRROR_TOP_DIRS])].sort();
  const actualSet = new Set(actualDirs);
  const expectedSet = new Set(expectedDirs);
  for (const name of actualDirs) {
    if (expectedSet.has(name)) continue;
    stats.l7Extra += 1;
    report(
      "test-top-dirs-exact",
      `${TEST_REL}/${name} → test-top-dirs-exact:${TEST_REL}/ 顶层多出目录「${name}/」`
      + ` —— 顶层目录集合必须恰好等于镜像源派生集(${mirror.srcLayers.join("/")} + 顶层树 `
      + `${mirror.topTrees.join("/")})∪{${NON_MIRROR_TOP_DIRS.join(", ")}}。`
      + "非镜像目录要么迁进对应层,要么内容整体搬进 test/behavior/(跨层)或 test/harness/(测试框架自身)",
    );
  }
  for (const name of expectedDirs) {
    if (actualSet.has(name)) continue;
    stats.l7Missing += 1;
    report(
      "test-top-dirs-exact",
      `${TEST_REL}/${name} → test-top-dirs-exact:${TEST_REL}/ 顶层缺目录「${name}/」`
      + ` —— 少一个与多一个同样是集合不等的两档:派生集里有的层必须有自己的段目录,`
      + "否则该层的段会散在别处,而「一段对应一层」的不变量无从核对",
    );
  }

  // ---- 判据五 L6:行为段的 covers 声明(ADR-062:76)----
  //
  // **`covers` 元素是什么、为什么是那个形态**(ADR-062 只给了语义,形态由本判据定):
  // 元素是**仓库相对 POSIX 路径**,指向被测模块在磁盘上的真实位置(如
  // `src/core/cancel.ts`、`test/harness/electron-mock.mjs`、`gates/smoke/smoke-proc.mjs`)。
  // 三条理由:
  //   ① **可解析且能真验** —— L6 的第三条(指向不存在的模块即判红)要求判据手里有一个
  //      权威的「这个路径存不存在」口径;仓库相对路径直接对磁盘判,不需要任何猜测。
  //   ② **不引入位置耦合** —— 若用段文件相对的 `../../src/…`,段一换目录声明就得跟着改。
  //      本仓刚在 T3 步 3/4a 搬了 15 个段,那种写法会产生 15 处纯机械的声明漂移,
  //      而 `shared/paths.js` 存在的全部理由就是消灭这一类耦合(见其文件头)。
  //   ③ **不限定在 src/** —— 跨层段的主体未必是 src 模块:`electron-mock-coverage`
  //      守的是 `test/harness/electron-mock.mjs` 的导出集,`packaged-smoke` 还守
  //      `gates/smoke/smoke-proc.mjs`。故只要求「在磁盘上存在」,不加目录前缀限制 ——
  //      加了就得为「主体不是 src」单开例外,而那正是本条要覆盖的一半场景。
  // 判绿条件:behavior 段**必须**声明且非空、每个元素都存在;正常段目录**不强制**声明,
  // 但一旦声明就同样受「非空 + 元素存在」约束(否则声明通道本身就能撒谎)。
  for (const file of segments) {
    const layer = file.split("/")[1] ?? "";
    const isBehavior = layer === BEHAVIOR_DIR;
    const declared = extractCovers(ctx.readText(file));
    if (declared === null) {
      // 只有 behavior 段缺声明才判红:正常段目录的 covers 是**可选的声明通道**
      // (给「零层 import、经 harness/子进程间接到达本层」那批段用的,ADR-062:86),
      // 强制所有段写声明会把「没写」与「写了但撒谎」混成同一档,反而降低判据的分辨率。
      if (!isBehavior) continue;
      stats.l6Violations += 1;
      report(
        "behavior-covers-declared",
        `${file} → behavior-covers-declared:behavior 段未 export const covers`
        + " —— 它的定义就是横跨多层(位置不表达被测层),被测对象只能靠声明自证。"
        + "缺声明时「它到底测什么」无从核对,L6 与 L4 都失去抓手",
      );
      continue;
    }
    if (declared.length === 0) {
      stats.l6Violations += 1;
      report(
        "behavior-covers-declared",
        `${file} → behavior-covers-declared:covers 是空数组`
        + " —— 空声明与缺声明在判据上等效:两者都没说清被测对象,却只有一种能判红",
      );
      continue;
    }
    for (const element of declared) {
      if (ctx.fileExists(element)) continue;
      stats.l6Violations += 1;
      report(
        "behavior-covers-declared",
        `${file} → behavior-covers-declared:covers 元素「${element}」在磁盘上不存在`
        + " —— 元素是仓库相对 POSIX 路径,判据直接对磁盘核对。"
        + "这是本条唯一挡得住「随便写个字符串就过」的判据:声明里混进不存在的路径,"
        + "要么是写错,要么是把还没打算实现的东西算成已覆盖",
      );
    }
  }

  // ---- 判据四 L8:自指层(harness)下的段必须声明 covers 且指向本层 ----
  //
  // ---- 为什么从「一律禁止」窄化成「声明 + 指向本层」(T3 步 6)----
  //
  // 旧形态是「`test/harness/` 下不得出现 `*.test.js`」,理由是「harness 收的是测试框架
  // 自身,而它在 harness/ 下没有任何被测层可归属」。**后半句今天不成立了**:`harness` 已
  // 登记为**自指层**(段目录,主体根 = `test/harness/` 自己),测「测试框架自身」的段
  // (`runner-report` / `test-common-helpers` / `dual-pipeline-decision-ledger`)主体就在
  // 它下面。旧形态与新事实直接冲突:那三个段要么被禁(则测试框架自身无人测,断言集恒真
  // 就没人发现),要么违规(则门禁逼人把它们挪去一个主体并不在那里的目录 —— 回到挂错层)。
  //
  // 窄化后的三条 fail-closed(每条都有 selftest 夹具):
  //   ① **未声明 covers → 判红**:不许「段悄悄住在 harness 里」。声明是 harness 段存在的
  //      前提,不是可选注释 —— 否则「它测的到底是什么」无从核对。
  //   ② **covers 为空 → 判红**:与 L6 对 behavior 段同款(空声明与缺声明等效)。
  //   ③ **covers 没有任何元素指向本层(`test/harness/`)→ 判红**:这是开口子的**牙齿**。
  //      只写「有个声明」就能过关的话,`covers: ["src/core/whatever.ts"]` 会把 harness 段
  //      变成绕过 L4 的后门 —— 那与不窄化没有区别。必须至少一个元素真的落在
  //      `test/harness/**`,即「它确实在测测试框架自身」。
  //
  // ⚠ 判红文案里**不再**有「没有任何被测层可归属」—— 那句话描述的是被本步推翻的旧事实。
  for (const file of segments) {
    if (!file.startsWith(HARNESS_ROOT)) continue;
    const declared = extractCovers(ctx.readText(file));
    if (declared === null) {
      stats.l8Violations += 1;
      report(
        "test-harness-not-segment",
        `${file} → test-harness-not-segment:${HARNESS_DIR}/ 下的段未 export const covers`
          + ` —— ${HARNESS_DIR} 是**自指层**:测「测试框架自身」的段主体就在它下面`
          + `(如 \`${HARNESS_ROOT}runner.js\`),位置即被测层。不声明就没有任何东西能核对`
          + "「这一段到底在测什么」—— 旧形态之所以禁掉 harness 下的段,正是因为「测测试框架"
          + "自身的段无处安放」,而那个前提已随自指层的登记失效。补声明,并让至少一个元素落在"
          + ` \`${HARNESS_ROOT}\` 下`,
      );
      continue;
    }
    if (declared.length === 0) {
      stats.l8Violations += 1;
      report(
        "test-harness-not-segment",
        `${file} → test-harness-not-segment:${HARNESS_DIR}/ 下的段 covers 是空数组`
          + " —— 空声明与缺声明在判据上等效:两者都没说清被测对象,却只有一种能判红",
      );
      continue;
    }
    if (!declared.some((element) => element.startsWith(HARNESS_ROOT))) {
      stats.l8Violations += 1;
      report(
        "test-harness-not-segment",
        `${file} → test-harness-not-segment:${HARNESS_DIR}/ 下的段 covers 没有元素指向本层`
          + `(要求至少一个元素以 \`${HARNESS_ROOT}\` 开头,实际 ${declared.join(", ")})`
          + " —— 自指层的段必须真的在测测试框架自身;声明别处的主体会让本条开口子变成"
          + "绕过 L4 的后门(那与当初一律禁止没有区别)",
      );
    }
  }

  // ---- REQ-220(#08)的两族:段内零本地顶层断言实现 + 每段接入具名 case ----
  //
  // ⚠ **为什么这两族挂在 `segments` 上、而不是遍历 `files` 或自写 walker**:段是「被测一段」
  // 这个单位,`segments`(在 segments 计算那一步已按 SEGMENT_EXT 切出)就是它的全集;而
  // `test/harness/case.js` 本身**真的**有一个顶层 `export function assert` 且自带 `throw`
  // (它就是 case 契约模块的实现本体),`test/harness/` 下还有一批非段助手文件。
  // 按 `test/**` 全扫,第一族会去红它自己要收敛的那个源 —— 这不是「误伤宽了」,是判据指向了
  // 错误的判定面:被禁的是「**段内**自己实现一遍断言逻辑」,不是「仓里有断言实现」。
  //
  // ⚠ **读盘**:这两族对**每一个段**都要读正文,而 L6/L8 那些循环是就地读的、没有缓存
  // (见下面 L11 那段的读盘纪律说明:同一批文件读两次会让命中不可复现)。故这里**自己读一遍**,
  // 而不是「复用 L6/L8 已读的文本」—— 那两个循环把正文读在块内局部变量里,循环一结束就没了。
  // 这里只读一次、只在自己的循环里用,不与别的循环共享,故不构成「同一批文件被读两次」的
  // 那种不可复现风险(那一档的风险来自「两次读到的内容可以不同」,而这里只有一次读)。
  for (const file of segments) {
    const source = ctx.readText(file);

    // ---- 族一:段内零本地顶层断言实现(禁的是自带 `throw` 的第二份实现)----
    //
    // 措辞与形态裁决见 ADR-071 决定一:判「函数体是否自带 `throw`」而不是「有没有叫 assert
    // 的顶层函数」—— 后者会把 `@returns {asserts cond}` 的委派型窄化壳一起判红,而那正是
    // ADR-071 明确保留的合规形态(`assert.js` 的指引原话就是「在段内包一层调用本 helper」)。
    for (const decl of findTopLevelAssertDecls(source)) {
      if (!decl.hasThrow) continue;
      stats.localAssertImpl += 1;
      report(
        "test-segment-local-assert-impl",
        `${file}:${decl.line} → test-segment-local-assert-impl:这一行的**顶层** assert 函数体自带 throw`
          + " —— 判据禁的是断言逻辑的第二份实现,不是「段内出现 assert 这个名字」。"
          + "处置:把函数体改成委派型窄化壳(`@returns {asserts cond}` + 只调 harness 断言、"
          + "体内不含自己的 throw),而不是给这一段开豁免(ADR-071 决定一:新判据不设豁免)",
      );
    }

    // ---- 族二:每段接入具名 case ----
    //
    // ⚠ 两个条件都要断:**import 了契约模块** 且 **至少调过一次 `.case(`**。只断 import 会
    // 让「建了 suite 却只用 describe 从不调 case」的段过关(裁决:机器能判的先判红);
    // 只按「文件里有没有 createCaseSuite 这几个字」判会把「只在夹具串里合成别的段」的段误算
    // 成已接入,分母永远少一段。口径细节见 `caseContractState` 的注释。
    const contract = caseContractState(source, file);
    if (contract.imported && contract.caseCalls > 0) continue;
    stats.noNamedCase += 1;
    if (!contract.imported) {
      stats.noCaseImport += 1;
      report(
        "test-segment-named-case",
        `${file} → test-segment-named-case:该段没有 import case 契约模块 ${CASE_MODULE_REL}`
          + " —— 段必须接入具名 case:createCaseSuite 建 suite、逐条 suite.case(...) 登记用例,"
          + "runner 与入口报告才有 case 级粒度(否则一段失败只报一个匿名错误)。处置:import "
          + `${CASE_MODULE_REL} 并把断言收进 suite.case(...) 之内`,
      );
    } else {
      stats.noCaseCall += 1;
      report(
        "test-segment-named-case",
        `${file} → test-segment-named-case:该段 import 了 case 契约模块 ${CASE_MODULE_REL},`
          + "但正文里没有任何 `.case(` 调用(只建了 suite 或只用 describe)—— import 了契约却"
          + "不接进去,等于「声明了却不用」,case 级粒度名存实亡。处置:把断言收进"
          + "suite.case(...) 之内。⚠ 按「机器能判的先判红」裁决如实报出:该形态是否算合法例外"
          + "待后续裁决,判据本步不为其开豁免(ADR-071:5「新判据不设豁免」)",
      );
    }
  }

  // ---- ADR-062 L11 / L11b / L12:门禁必有载体 + 清单在册而树里无 + 链归属 ----
  //
  // 三族的判定面都在**门禁索引**上,而索引的注入面刻意只取四项字段(理由见文件头)。
  // 段的正文在这里**只读一次**:L11 的档 1b 要拿它判「有无验收段引用该门禁」,而段列表
  // 上面已经算出来了 —— 重读一遍会让同一批文件在一次判定里被读两次(IO 翻倍,且两次读到
  // 的内容理论上可以不同,那种不一致会让「档 1b 是否命中」变得不可复现)。
  const { gates: allGates, problems: gateRegistryProblems } = base.gateRegistry === undefined
    ? makeGateRegistryCtx()
    : makeGateRegistryCtx(base.gateRegistry);
  stats.l11BadEntries += gateRegistryProblems.length;
  for (const problem of gateRegistryProblems) {
    report("gate-has-carrier", `${GATE_INDEX_MODULE_REL} → gate-has-carrier:${problem}`);
  }
  // ---- 判定面收窄到「本求值根里真实存在的门禁」+ 反向一档 L11b ----
  //
  // ⚠ **收窄不是省事的过滤,是一条范畴边界**:门禁索引是模块常量(描述**真实仓库**),而
  // `ctx.fileExists` / `ctx.readText` 都以**求值根**为准。拿真实索引去问一棵合成根
  // (自检在临时目录里造的那棵)会让 L11 把每一项门禁全判成「无载体」—— 那不是真违例,
  // 是**跨树比对**(合成根里本来就没有 `gates/`,它是一棵只造 `test/` 布局的合成树)。
  // 载体与门禁本体必须在**同一棵树**里,「这道门禁坏掉时有人会红吗」这个问题才有意义。
  //
  // ⚠ **但收窄本身会开一个洞:门禁本体被删除时它静默离开判定面。** S2 把这个洞记为
  // 「残余缺口」,理由是「今天有旧注册表 R4 兜着」—— 而 **R1–R5c 全部随 S4 消失**,
  // 届时无人守。故 L11b 补上反向一档:索引在册而树里无 → 判红。
  //
  // ⚠ **L11b 自身也必须收窄,否则它会恒红**:合成根上「索引在册的每一项都不在树里」是
  // **事实**而不是违例(那棵树里根本没有 `gates/`,它不是门禁索引描述的那棵仓)。
  // 分界线取「**索引模块自己在不在本求值根里**」:它在了,才说明这棵树是索引描述的那棵树,
  // 那一档的「缺」才是真缺;它不在,整段(判定面 + L11b + L11 + L12)与本轮无关 ——
  // 这与下面「判定面非空才读豁免表与 package.json」是同一条边界,只是这里要判的是
  // 「树的身份」而不是「门禁的数量」。
  //
  // ⚠ `indexInRoot` **在 C3 那节就已经求值过一次**(见那里同名注释:两处各算一次的话,
  // 将来有人只给其中一处加条件,就会出现「L11 认为在这棵树上、C3 认为不在」而无红)。
  const gates = indexInRoot ? allGates.filter((gate) => ctx.fileExists(gate.modulePath)) : [];
  if (indexInRoot) {
    for (const gate of allGates) {
      if (ctx.fileExists(gate.modulePath)) continue;
      stats.l11MissingModule += 1;
      report(
        "gate-module-present",
        `${GATE_INDEX_MODULE_REL} → gate-module-present:${gate.id} 在索引里在册,但门禁本体 `
        + `${gate.modulePath} 在本求值根里不存在 —— 它已静默离开 L11/L12 的判定面:`
        + "它的载体无人核对、它挂没挂链上也无人核对。两条正当出路:① 把 ${gate.modulePath} 恢复回来"
        + "(改名了就同批把索引里的 modulePath 改成新名字);② 这道门禁确实已删 ⇒ 把这一项从索引里删掉,"
        + "别让索引留着一个指向空处的登记项",
      );
    }
  }

  // L11 的门禁级豁免表:三档 fail-closed(读不到 / 缺 entries / 表项键名错 / stale)。
  //
  // ⚠ **整段(读表 + 判定 + L12)只在判定面非空时跑**,与上面那条范畴边界同源:没有门禁就没有
  // 「这道门禁有没有载体」这件事,于是那张表与 package.json 都与本轮无关 —— 而在合成根上
  // 去读它们会命中「读不到 → 判红」那一档,凭空让每条既有夹具先被 L11 判红。
  if (gates.length > 0) {
    const { entries: gateExemptions, problems: gateExemptionProblems } = base.gateExemptions
      ? { entries: base.gateExemptions, problems: [] }
      : loadGateExemptions(ctx.root);
    for (const problem of gateExemptionProblems) {
      stats.l11TableProblems += 1;
      report("gate-has-carrier", `${GATE_EXEMPTIONS_REL} → gate-has-carrier:${problem}`);
    }
    /** @type {Map<string, string>} 段相对路径 → 段正文 */
    const segmentBodies = new Map(segments.map((file) => [file, ctx.readText(file)]));
    const l11 = judgeL11Carrier({ deps: { fileExists: ctx.fileExists, segmentBodies }, gates, exemptions: gateExemptions });
    stats.l11WithCarrier = l11.stats.withCarrier;
    stats.l11Exempted = l11.stats.exempted;
    stats.l11Missing = l11.stats.missing;
    stats.l11Stale = l11.stats.stale;
    stats.l11ShortReason = l11.stats.shortReason;
    for (const problem of l11.problems) report("gate-has-carrier", problem);

    // L12 / L12c:链归属。scripts 表经 `ctx.readText` 读 package.json(零新增 ctx 字段)。
    let scripts = {};
    try {
      scripts = JSON.parse(ctx.readText("package.json")).scripts ?? {};
    } catch (error) {
      stats.l12BadDomain += 1;
      report(
        "gate-chain-membership",
        `package.json → gate-chain-membership:读不到或不是合法 JSON(${error instanceof Error ? error.message : String(error)})`
        + " —— 链展开的输入缺失时,「门禁在不在链上」只能按空表判定并把**全部**门禁判成不在链上,"
        + "恒红且零信息量,故判红",
      );
    }
    const l12 = judgeL12ChainMembership({ gates, scripts });
    stats.l12OnChain = l12.stats.onChain;
    stats.l12OffChain = l12.stats.offChain;
    stats.l12BadDomain += l12.stats.badDomain;
    stats.l12ChainNotOnChain = l12.stats.chainNotOnChain;
    stats.l12OffChainOnChain = l12.stats.offChainOnChain;
    stats.l12DeclaredPending = l12.stats.declaredPending;
    stats.l12ShortPendingReason = l12.stats.shortPendingReason;
    for (const problem of l12.problems) report("gate-chain-membership", problem);
  }

  return { problems, info, stats, l5ExemptionCount: l5ByKey.size };
}

/**
 * CLI 主体:读盘 → 判定 → 打印 → 按 `problems` 出 0/1(判定逻辑全在 checkTestLayout 里)。
 *
 * ⚠ **没有 `--enforce`,也没有任何「只报告不拦」的开关**。该开关一旦存在,
 * 「哪些族进哪档」的知识就同时存在于登记表与命令行两处 —— 又一处可漂移的副本,
 * 而命令行那一处还是运行期可变的那一处。强制等级只由 `CRITERIA` 声明。
 * @param {string[]} [argv] 参数数组
 * @returns {number} 退出码
 */
/**
 * `--write-l5-exemptions`:把当前命中的 (段, 说明符) 对去重后写成豁免表基线。
 *
 * **只写不判**:它读真实仓库、覆盖数据文件、exit 0。刻意**不**预先填 reason ——
 * 填占位符会让「忘了写理由」与「写了理由」在门禁上不可区分。生成出来的表因 reason 为空
 * 必然判红(空是「不足 20 字」那一档的特例),那是设计:逼使用者逐条看过、补上理由
 * 或把那条从表里删掉。**该产物在门禁上红是预期结果,不是本入口的缺陷** —— 它 exit 0。
 *
 * ⚠ 它是**生成入口**,不是判据:任何人都能跑它把表洗成当前形状 ⇒ 它绝不能进 verify:ci
 *   (package.json 的链里没有它,别加)。
 *
 * ⚠⚠ **它只收「当前未登记」的命中,却整表覆写** —— 表里只要已有一条豁免,重跑就会把
 *   已登记条目连同全部手写 reason 一起删掉,无警告、无备份。表已有条目时别跑它。
 * @returns {number} 退出码
 */
function writeL5ExemptionsBaseline() {
  const { info, stats } = checkTestLayout();
  /** @type {Map<string, {segment: string, specifier: string}>} */
  const hits = new Map();
  // 未登记的跨层命中进哪一档由 CRITERIA 决定。两个通道都扫,否则一旦该族在登记表里
  // 换了档,这个生成入口就生成不出东西 —— 而那正是它最需要工作的那一天。
  for (const line of [...info, ...checkTestLayout().problems]) {
    const m = /^(\S+) → test-layer-cross-import:.*层的主体 \(([^)]+)\)/.exec(line);
    if (m === null) continue;
    hits.set(l5ExemptionKey(m[1], m[2]), { segment: m[1], specifier: m[2] });
  }
  const target = path.join(ROOT, ...L5_EXEMPTIONS_REL.split("/"));
  writeFileSync(target, renderL5ExemptionsBaseline([...hits.values()]), "utf8");
  console.log(
    `[test-layout:baseline] 已写入 ${L5_EXEMPTIONS_REL}:${hits.size} 条未登记的跨层 import`
    + `(本次 L5 命中 ${stats.l5Hits} 处;已登记的 ${stats.l5Hits - hits.size} 处不在其中)`
    + `\n  ⚠ reason 一律留空 —— 请逐条人工补(补的内容须 ≥${REASON_MIN_CHARS} 字);`
    + `补不出来的那些说明**不该被豁免**,把它们从表里删掉。`
    + `\n  ⚠ 本入口 exit 0,但它写出的表在门禁上必然判红(空 reason)—— 那是刻意的,见本函数注释。`,
  );
  return 0;
}

export function main(argv = []) {
  /** @type {Record<string, string | boolean>} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ["help", "write-l5-exemptions"], usage: USAGE });
  } catch (error) {
    // 未知参数一律失败:静默按默认跑一遍报绿就是「假通过」
    console.error(`[test-layout:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options["write-l5-exemptions"] === true) {
    return writeL5ExemptionsBaseline();
  }
  if (options.help === true) {
    // ⚠ 两个计数**由 CRITERIA 派生**,不写死:写死的数字在加一族/删一族那天会静默说谎,
    // 而「还剩几族 report-only」正是待转正进度唯一的读数。
    const failClosed = CRITERIA.length - CRITERIA.filter((entry) => entry.pending === true).length;
    const reportOnly = CRITERIA.length - failClosed;
    console.log(
      [
        USAGE,
        "  --write-l5-exemptions  把当前未登记的跨层 import 写成豁免表基线(reason 留空待人工补,",
        `                        人工补的内容须 ≥${REASON_MIN_CHARS} 字)。只写不判,绝不进 verify:ci。`,
        "  ⚠⚠ **它是整表覆写,且只写「当前未登记」的命中** —— 表里只要已有一条豁免,重跑就会把",
        "                        已登记条目连同**全部手写 reason 一起删掉**,且**不警告、不留备份**。",
        "                        表已有条目时**不要重跑**:先 `git checkout -- gates/repo/"
          + "test-layout.cross-import-exemptions.json`,",
        "                        再照本节说的「追加」手工补那一条(表项的键是 (段, 说明符) 二元组)。",
        `  强制等级(由本文件 CRITERIA 派生):${failClosed} 族 fail-closed(命中即非零退出) /`
        + ` ${reportOnly} 族 report-only(命中只报告,结构上不计退出码)。`,
        // ⚠ report-only 的族**逐个点名**:只给一个计数的话,「哪几族待转正」这件事就得回到源码里
        // 逐条翻 —— 而那个 grep 锚数的是**行数**,不告诉你**是哪几族**。计数与名单都由表派生。
        ...(reportOnly === 0
          ? []
          : [`    report-only 族(逐个点名,同样由 CRITERIA 派生):`
            + CRITERIA.filter((entry) => entry.pending === true).map((entry) => entry.id).join(" · ")]),
        "  ⚠ 没有 --enforce:命令行不能改变任何一族的强制等级,那是 fail-open 的口子。",
        "    待转正的族数 = `grep -nE '^\\s*pending: true,$' gates/repo/check-test-layout.mjs` 的命中行数。",
      ].join("\n"),
    );
    return 0;
  }
  const { problems, info, stats, l5ExemptionCount } = checkTestLayout();

  /**
   * 一族的「强制等级」后缀 —— **由 {@link CRITERIA} 派生,不写死**。
   *
   * ⚠ **为什么不能写死**(2026-10-09 实测踩到):#08 把两族转正时删掉了 `CRITERIA` 那两行的
   * `pending: true`,却没删结论行里硬编的 `(report-only…)` 字面量 ⇒ 门禁**实际是 fail-closed**、
   * 退出码也真的非零,而输出却写着「命中只报告,不计退出码」。**诊断开始说谎**,读的人会得出
   * 「#08 的转正没生效」的错误结论。写死的等级标签与写死的计数是同一类病:在「加一族 / 删一族 /
   * 转正一族」那天静默说谎,而「还剩几族待转正」正是唯一进度读数。
   * @param {string} id 判据族 id
   * @returns {string} 该族当前强制等级的结论行片段
   */
  const enforcement = (id) => (CRITERIA.find((entry) => entry.id === id)?.pending === true
    ? "(report-only:命中只报告,不计退出码)"
    : "(fail-closed:命中即非零退出)");

  const counts = [
    `L4 test-layer-self-hosted 判红 ${stats.l4Violations} 项`
    + `(零本层主体 ${stats.l4NoOwnSubject} / 段 import 段 ${stats.l4SegmentImports};`
    + `层内段 ${stats.layerSegments} / 共 ${stats.segments} 段)`,
    `L5 test-layer-cross-import 命中 ${stats.l5Hits} 处`
      + `(豁免 ${l5ExemptionCount} 条 / 未登记判红 ${stats.l5Unregistered} / 空 reason 判红 ${stats.l5ExemptionsEmptyReason}`
      + ` / 不足 ${REASON_MIN_CHARS} 字判红 ${stats.l5ExemptionsShortReason}`
      + ` / stale 判红 ${stats.l5StaleExemptions})`,
    `L7 test-top-dirs-exact 多 ${stats.l7Extra} / 缺 ${stats.l7Missing}`
      + enforcement("test-top-dirs-exact"),
    `L6 behavior-covers-declared 判红 ${stats.l6Violations} 项`
      + `(behavior 段缺 covers / covers 为空 / covers 元素在磁盘上不存在;`
      + `covers 同时是正常段目录「零层 import」时的 L4 声明通道)`,
    `L8 test-harness-not-segment 判红 ${stats.l8Violations} 项`,
    `L11 gate-has-carrier 判红 ${stats.l11Missing + stats.l11Stale + stats.l11ShortReason + stats.l11TableProblems + stats.l11BadEntries} 项`
      + `(有载体 ${stats.l11WithCarrier} / 豁免 ${stats.l11Exempted} / 无载体判红 ${stats.l11Missing}`
      + ` / 豁免表失效 ${stats.l11TableProblems} / 表项键名错 ${stats.l11BadEntries}`
      + ` / reason 不足 ${REASON_MIN_CHARS} 字判红 ${stats.l11ShortReason} / stale 判红 ${stats.l11Stale})`
      + `;L11b gate-module-present 判红 ${stats.l11MissingModule} 项(索引在册而树里无:门禁本体被删/改名)`
      + "(判定面 = 本求值根里索引模块在场的那些门禁;合成根上索引模块不在场 ⇒ L11/L11b/L12 整段不适用)",
    `L12 gate-chain-membership 判红 ${stats.l12BadDomain + stats.l12ChainNotOnChain + stats.l12OffChainOnChain} 项`
      + `(chain ${stats.l12OnChain} / offchain ${stats.l12OffChain}`
      + ` / 取值域外判红 ${stats.l12BadDomain}`
      + ` / chain 却不在链判红 ${stats.l12ChainNotOnChain} / offchain 却在链判红 ${stats.l12OffChainOnChain}`
      + ` / pendingChain 声明 ${stats.l12DeclaredPending}、其中理由不足 ${stats.l12ShortPendingReason})`,
    `C1 test-dist-artifact-source-mirror 判红 ${stats.c1MirrorMissing} 项`
      + `(被测 import 落在 dist/** 共 ${stats.c1Artifacts} 处,按构建产物路径反推的镜像源全部不存在者判红)`,
    `C1 test-segment-mirror-same-name 判红 ${stats.c1SameNameMissing} 项`
      + `(段路径镜像了真实源文件的段共 ${stats.c1MirroredSegments} 段,未落在同名编译产物上者判红)`,
    `C3 test-layer-gate-subject 命中 ${stats.c3Hits} 处`
      + `(豁免 ${stats.c3Exemptions} 条 / 未登记判红 ${stats.c3Unregistered}`
      + ` / 不足 ${REASON_MIN_CHARS} 字判红 ${stats.c3ShortReason} / stale 判红 ${stats.c3Stale})`,
    `段内本地断言实现 test-segment-local-assert-impl 判红 ${stats.localAssertImpl} 项`
      + "(顶层 assert 函数体自带 throw;@returns {asserts cond} 的委派型窄化壳合规)"
      + enforcement("test-segment-local-assert-impl"),
    `具名 case test-segment-named-case 未接入 ${stats.noNamedCase} 段`
      + `(未 import 契约模块 ${stats.noCaseImport} / import 了却一次没调 .case( ${stats.noCaseCall};`
      + `分母是全部 ${stats.segments} 段)` + enforcement("test-segment-named-case"),
    `门禁自测接入具名 case gates-selftest-named-case 未接入 ${stats.gatesNoNamedCase} 份`
      + `(未 import 契约模块 ${stats.gatesNoCaseImport} / import 了却一次没调 .case( ${stats.gatesNoCaseCall};`
      + `分母是 ${GATES_SELFTEST_ROOT}/** 下全部 ${stats.gateSelftests} 份 ${GATES_SELFTEST_EXT})`
      + enforcement("gates-selftest-named-case"),
    `case 名 ⟷ 登记名册 gates-selftest-case-roster 判红 ${
      stats.gateRosterUnlisted + stats.gateRosterStale + stats.gateRosterTableProblems
      + stats.gateRosterOnlyInRoster + stats.gateRosterOnlyInSource
    } 项(参与判定 ${stats.gateRosterChecked} 份 / 名册侧 case 名 ${stats.gateRosterNames} 条`
      + ` / 登记表缺行 ${stats.gateRosterUnlisted} / stale 行 ${stats.gateRosterStale}`
      + ` / 名册自身失效 ${stats.gateRosterTableProblems} / 抽出 0 条 ${stats.gateRosterEmptyExtraction}`
      + ` / 册有源无 ${stats.gateRosterOnlyInRoster} / 源有册无 ${stats.gateRosterOnlyInSource};`
      + `分母是全部 ${stats.gateSelftests} 份自测)`
      + ` ⚠ 半齿上限:「删 case + 同批删册」是一次改动、判据看不见 —— 本族只抓**单侧**漂移`
      + enforcement("gates-selftest-case-roster"),
  ].join(";");
  const named = problems.map((problem) => problem.split(" → ")[0] ?? problem);

  for (const line of info) console.log(`[test-layout:pending] ${line}`);

  if (problems.length === 0) {
    console.log(`[ok] test 布局判据通过:${counts}`);
    return 0;
  }

  for (const problem of problems) console.error(`[test-layout:fail] ${problem}`);
  console.error(
    `[test-layout:fail] test 布局判据不成立,共 ${problems.length} 项:${counts}。`
    + `点名文件:${named.join(", ")}。`,
  );
  return 1;
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。守卫右侧用 `isMainModule`(代码位置自比,
// 不是由仓根反推自身路径 —— 仓根是 cwd 派生的环境值,而本门禁刻意以「cwd 指合成目录、
// argv[1] 指仓内本体」被调用,两者恒不相等)。
if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
