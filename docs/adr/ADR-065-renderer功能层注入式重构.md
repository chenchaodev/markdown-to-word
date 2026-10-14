# ADR-065 · renderer 功能层注入式重构

| 项 | 值 |
|---|---|
| 状态 | 现行。§二「四处反向注册 handler」的计数口径已由 [ADR-071](ADR-071-两处判据的形态裁决.md) 取代 —— 按**跨 feature 的槽**数、不按点位，且 `recentRefreshHandler` 由组合根注册、已是目标形态须保留。§决定里「基础层 = 元素映射(`dom/`)」这一定义已由 [ADR-076](ADR-076-dom-ops与toast归入基础层.md) 扩为「元素映射**与元素操作**」—— `dom-ops.ts` 与 `toast.ts` 实测零 feature import 却建在 `ui/`，把 17 条跨 feature 边引到了它们身上；**本条 §决定的其余部分（四功能目录互不 import · 跨功能协作经组合根注入 · 删除反向注册 handler）不动** ｜ **落地状态（2026-10-11）**：§决定四条里 ①②④ 已全部落地并由机械判据担保（跨 feature import **零条** · `state.stageChangedHandler` 反向注册槽已删 · `renderer-features-no-cross-import` 已转 fail-closed）；**③ 模块级可变状态收敛进 `state/`** 已于 2026-10-13（REQ-241）做完：四处档 A 搬进 `state.settingsSave`，11 处 `export let` 清零，新门禁 `renderer-no-export-let`（`renderer/` 排除 `state/`）建时即绿；三档逐条登记见本条「实施记录」。此前它是独立一步（原 `docs/PLAN.md` #10 右注）。执行期裁决见 [ADR-075](ADR-075-10执行裁决peer根书写形态与四条禁令.md)，其 §二禁令 1 的理由已于同日订正过一次 |
| 日期 | 2026-10-06 |
| 关联 | 与 [ADR-064](ADR-064-源码树一职责一文件与内部边界判据.md) 同源不同层 —— 那条定 `src/` 的文件名与内部目录准入判据，本条只定 `renderer` **功能目录之间**的边；[ADR-060](ADR-060-多层交付面与headless装配层.md) 的「注入点集中在一处」是本条组合根做法的既有先例 ｜ 事实底稿见 [`20261006-104227-最优架构评审事实地图与三处订正`](../evidence/20261006-104227-最优架构评审事实地图与三处订正.md) |

---

## 决定

`src/renderer` 的四个功能目录（`convert` / `settings` / `ui` / `wizard`）**互不 import**；一切跨功能协作经组合根 `renderer/renderer.ts` 以构造参数注入；模块级可变状态收敛进 `state/`；删除四处「反向注册 handler」。

**本条只钉「互不 import」这一条边，不主张 renderer 内部整体分层** —— 四个功能目录是平铺协作的 peer，不是层级。

## 背景

一次全仓架构评审实测出的缺口：**门禁只约束到基础层就停了，peer mesh 完全没有判据，而绕过判据的手段已被发明出来并重复使用。**

**一、现有判据覆盖不到病处。** `check-import-boundary.mjs` 的 `renderer-foundation-no-feature-dep` 只约束 `dom/` 与 `state/` 两层。这两层出边实测为 0 条，是真不变量 —— 任何功能模块都依赖它们、它们不依赖任何功能目录。该规则注释里写明了原因：功能目录之间「对它们断言方向会一加就红」（边数取该规则上方注明的普查命令；⚠️ **那条命令本身有一处口径错**，见事实底稿的订正节，按 feature 根目录折叠重算才是真值）。

**二、税基已经可见 —— 四处「反向注册 handler」是同一件事的四个实例。** 形态一致：feature A 想触达 feature B 又不愿 import，于是往共享对象挂一个回调槽，由组合根接线。`state/state.ts` 的 `recentRefreshHandler` 与 `stageChangedHandler` 两处注释自陈其中一层理由是「打破 ESM 循环依赖」；`convert/file-list.ts` 与 `convert/convert-flow.ts` 各有一处同款。

这不是四个独立的偶然，而是**一个零成本解法被无限重复**：每加一次跨功能交互，成本是「挂一个 handler 槽 ＋ 一行注释解释为什么不是 import」，而没有任何机制会让人停下来问「这是第几个了」。

**三、单文件编排面已成瓶颈。** `convert/events/dialogs-events.ts` 一个文件同时编排四个 feature 的交互（完成弹窗、批量汇总弹窗、常驻汇总条、Esc 关闭链、菜单转发）。它的头注把「依赖方向单向：无环」当作卖点写下来 —— 而这条单向性只在它自己这一个切面上成立，全树并不成立。**一个切面成立被当成全局成立**，是这类自述最常见的失效形态。

**四、一处自述已经失效。** `state/state.ts` 文件头自述「全部模块级可变状态收敛于此」，但实测 renderer 有二十余处模块级 `let`/`var` 绑定散在 `state/` 之外（另有十余处 `export let`，那已是跨模块可变导出，更重）。自述与实现矛盾，而自述正是后来者判断「状态该放哪」的唯一依据 —— 一句失效的自述比没有自述更坏，它会让正确的做法看起来像是违规。

> **改造后（REQ-241）该自述已按实测改写**，不是照原样留下、也不是删掉了事：改写后的口径是「**模块级可变状态以 `state/` 为唯一共享落点**」—— feature 模块可持有**文件内私有**的可变绑定（单文件闭环、不跨模块共享），但跨模块共享的那一份只经 store 读写，且 `state/` 之外不得以可变绑定形态导出（`export let` / `export var`，机械判据见 §「实施记录」的新门禁条）。原文的错不在「写了一句自述」，在它把话说满了 —— 满话在部分兑现的那天就是错话，所以改法是**把口径改成与判据同宽**，不是补一句例外说明。

**五、组合根已经在做这件事，只是没有形式。** `renderer/renderer.ts` 的头注自述「组合根：API 契约声明、事件接线与初始化编排」「依赖方向单向（本文件 → dom/state/settings/convert/ui，不反向引用子模块私有符号）」。它已经是全部接线的落点 —— 本条不是新造一个架构，而是**把已经在做的事变成有判据的规则**，并删掉那四处绕开它的反向注册。

**六、要保的不变量已经明确。** `dom/refs.ts` 与 `state/state.ts` 是仅有的两层基础层，出边 0 条。重构后这个不变量必须继续成立 —— 它是「元素映射无业务知识」「纯函数核零 DOM」两条语义的机械守护。

**规模。** renderer 整树四十余个文件（36 个 `.ts` ＋ preload `.cjs` ＋ `lang-bootstrap.js`）。这是「要动一遍」的量级，不是「大改」的量级。

**七、这一层有验收网，但它接不住本条的主要风险。** 覆盖率链的 `--include="dist/**"` 曾配 `--exclude="dist/renderer/**"`（renderer 整层不进分母），该排除已由 `8225c02` 撤销 —— renderer 现在落在全局分母里（台账已登记，ratchet 不另设阈值，回退直接压低全局数字）。⚠ 本节原文写的「重构期间没有覆盖率兜底」**据此失效**。

但**别把这当成风险下降**：真实风险形态变了，不是消失了。注入式重构会让某段测试**单独 import 某个 dist renderer 模块**时，它依赖的 port 尚未装配 —— 该段在装配前返回未定义行为，而全应用跑起来一切正常。这类失败只在这个测试形态下暴露，覆盖率数字**照样是绿的**。所以本条仍必须靠 import 判据与段级 UI 守卫段承接，不能把覆盖率当安全网。

## 实施记录（REQ-241，2026-10-13）

§决定 ③「模块级可变状态收敛进 `state/`」的**逐处裁决与落地**。

**先说清判据到底管什么**：本条只管**跨模块共享**的可变状态与**跨模块可重绑**的导出。单文件内私有的可变绑定（一个 `let` 只被本文件的函数读写、任何别的模块都拿不到它）不在此列 —— 把它也搬进 store 只会让 store 长出一批只服务一个文件的字段，而「单一来源」的收益是零。**这不等同于原 evidence 的「档 C 单文件闭环 16 处」那个计数**：那份底账的 7+4+16=27 与其自报的 35/37 两处加不平，且「档 B」从未点名。本表按实读逐条列，不复用那个计数。

### 退出条件 ①：`state/` 之外零 `export let` / `export var`

实测原有 **11 处**（全在 `wizard/`）：`wizard-runtime.ts` 3（`draft` / `wizardEl` / `currentStep`）、`wizard-steps.ts` 5（封面五控件）、`wizard-steps-delivery.ts` 3（合并源两件 + 格式radio组）。清零手法：

- **统一形态 = `export const` 只读门面 + 模块私有 `let`**。可变态仍是模块私有的 `let`，出口是 `export const runtime` / `coverRefs` / `deliveryRefs` 三个门面对象，其成员是 getter。消费方读 `runtime.draft`（始终等于当次赋值后的实时值，与原先的 ESM 实时绑定等价），而 `runtime.currentStep = 5` 在 typecheck 处编译不过 —— 原先是「靠注释说赋值只经 setter」，现在是**机制上做不到**。
- **TDZ 那几处怎么解**：`wizard-steps.ts` 的封面五控件与 `wizard-steps-delivery.ts` 的 `sourcesList` / `sourcesEmpty` / `formatRadios` 是**先声明后赋值（无初值）**，`export let x: T;` 不写初值也合法。改成 `export const` 必须给初值，而它们的值要等 `buildStepCover` / `buildStepMerge` / `buildStepOutput` 现场造 —— 所以**不能给门面字段赋真值，改为门面持 getter、私有 `let` 仍无初值**。`wizard-runtime.ts` 三个本来就带初值，无需此处理。

### 三档逐条登记

**档 A —— 真跨 feature，已收敛（4 处 + 2 处归属重裁）。**

| 位置（原） | 处置 | 理由 |
|---|---|---|
| `settings/settings-save.ts:55` `hooks` | **搬进 `state.settingsSave.hooks`** | 与台账同批搬，见下 |
| `settings/settings-save.ts:65` `settingsSaveRevision` | **搬进 `state.settingsSave.revision`** | 同上 |
| `settings/settings-save.ts:72` `pendingSavePatch` | **搬进 `state.settingsSave.pendingPatch`** | **实质理由**：抽屉与向导写的是**同一份草稿**（该文件自述）。拆成两份时「失败过的字段随下一次保存一并重试」会在跨模块交替写入时**静默丢字段** —— 丢的是只存在于另一份内存里的那部分，没有任何可见症状 |
| `settings/settings-save.ts:75` `pendingSaveFailureText` | **搬进 `state.settingsSave.failureText`** | 「要不要在状态区落未保存提示」的判定就在失败原文上，与 revision / hooks 同批才自洽 |

四处**必须一组同时搬**：台账的三项（revision / pendingPatch / failureText）与反馈触点（hooks）是一条链上的四件事 —— 拆开即「抽屉写失败、向导读不到草稿」或「提示该清时判据已不在」。`SettingsSaveHooks` 的类型声明随之搬到 `state/state.ts`：store 持这个槽，槽的类型与槽同处声明；反过来让 `state/` 去 import 一个 feature 模块的 type，会撞上 `renderer-foundation-no-feature-dep`（基础层不得反向依赖功能目录）。

| 位置 | 处置 | 理由 |
|---|---|---|
| `dom/dom-ops.ts:170` `trapStack` | **不搬，留在 `dom/` 基础层** | 属档 A 的实质（被 settings-drawer · settings-preset-actions · dialogs · book-wizard **四个 feature 交错进出**），但落点是基础层：栈元素是 `HTMLElement`，而 `state/state.ts` 全文零 DOM 引用 —— 搬进 store 等于给 store 长出 DOM 概念，「纯数据 store」这名头衔当场失效。用户 2026-10-13 裁决 |
| `dom/dom-ops.ts:220` `focusOriginStack` | **不搬，留在 `dom/` 基础层** | 同上；且它与 `trapStack` 是**同一条栈语义**（栈序与出栈时机互为前提），拆开搬会让「关抽屉才回 ⚙」这个跨层不变量的两半分居两个文件 |

**档 B —— 派生值 / 缓存，登记为不动（4 处）。**

| 位置 | 处置 | 理由 |
|---|---|---|
| `convert/file-list.ts:124` `persistedSessionKey` | 不动 | 纯去重缓存：判据是「内容与上次**成功写盘**的一致」，真实单源是磁盘上的 ui-state 与内存里的 `state.selectedFiles`。进 store 会造出「store 状态 ↔ `selectedFiles`」双源，而这两源的同步没有任何时刻能对齐（写失败时刻两者本就该不一致） |
| `dom/dom-ops.ts:57` `statusTone` | 不动 | 真实单源是 DOM 上的 class（`status--ok` / `status--error` 由 `setStatusTone` 写、由 CSS 读）。本变量只是「上次写的是什么」的回读，用于跳过重复写；它不是状态的源头，进 store 反而多一处要同步的副本 |
| `ui/recent-files.ts:61` `lastStageHasFiles` | 不动 | ⚠ **它不是「当前有无文件」的派生值**，而是上一次「通知时刻」的舞台态**快照**，与当前 `state.selectedFiles` 可能短暂不同（正是这个短暂不同构成「空→有」跃迁的判据）。把它当派生值「优化」成 `state.selectedFiles.length > 0` 的直接比较，会把 REQ-239 钉住的那条语义（只在跃迁那次收起、其余尊重手动）**连根删掉** ——  Repo 里没有第二条判据拦得住这种「优化」，故此处必须写明它是快照而非派生值 |
| `wizard/wizard-fields.ts:71` `wizardIdSeq` | 不动 | wizard 内部 id 唯一性保障（递增计数器， warn 用的 id 不能撞）。它与任何跨模块状态无关，搬进 store 等于给 store 加一个「向导专用自增列」 |

**档 C —— 单文件闭环，显式登记为不动（27 处 = 下表 8 + `ui/dialogs.ts` 6 + `book-wizard.ts` 2 + wizard 11）。**

`commandBusyProbe`（`convert/file-list.ts:220`）· `toastTimer`（`dom/toast.ts:13`）· `activePrecheck`（`convert/convert-flow.ts:89`）· `chainCovered`（`convert/convert-flow.ts:101`）· `drawerTrap`（`settings/settings-drawer.ts:20`）· `presetSaveTrap`（`settings/settings-preset-actions.ts:59`）· `fileDialogInFlight`（`convert/events/selection.ts:91`）· `guideEl`（`ui/first-run-guide.ts:28`）· `ui/dialogs.ts` 6 处（`completeDialogTrap` · `batchDialogTrap` · `copyFeedbackTimer` · `precheckTrap` · `precheckResolve` · `precheckPromise`）· `book-wizard.ts` 2 处（`releaseTrap` · `triggerBtn`）· wizard 11 处 `export let`（已按退出条件 ① 改为 const 门面，其后的模块私有 `let` 归本档）。

判据是**消费方是否跨出本文件**：这 27 处里，陷阱句柄（`*Trap`）全部指向 `trapStack`，但**持有句柄的只有打开它的那个模块自己**（打开 = 注册、关闭 = 释放，同一处代码的两半）；`ui` / `recent-files` / `first-run-guide` 三处的可变绑定同理。它们不需要单一来源，因为不存在「两个写入点」—— 只有一个。

### 新门禁

`gates/repo/check-import-boundary.mjs` 的 `LAYER_TEXT_RULES` 新增 **`renderer-no-export-let`**（建时即绿、不带 `pending`）：

- **scope = `renderer-outside-state`**（`renderer/**` 排除 `renderer/state/`），**不是** `src/renderer/` 之外。两条理由：① 判据对象是 renderer 的模块级可变状态，core / main / 新三层不在 ADR-065 范围内，纳入会让 reason 与 scope 不一致；② `state/` 自身是 store 的落点，它内部是否出现可变绑定由别的纪律管。两种 scope 在实测树上判定面完全一致（store 内部零命中），选窄的那个因为它准确表达了判据对象。
- **只抄 `i18n-dom-no-export-let` 的第一个 pattern**（`export\s+(?:let|var)`）。第二个（`export\s*\{[^}]*\}`）**刻意不抄**：那一条的成立前提是「core/i18n/ 的唯一公开桶是 index.ts，再导出全部由它承担」，renderer 没有这个前提 —— `pure.ts` / `settings-logic.ts` / `settings-panel.ts` / `about.ts` 四处 `export { … }` 全是正当的值再导出（实测），照抄即四处假阳性，消它只能开豁免表。残留缺口登记在规则注释里：`let x = 1; export { x };` 这种绕一步的写法判不到（要跨语句符号追踪，ADR-064 :236 已登记为超出本仓门禁能力）。
- 双向自检夹具已进 `selfCheckTextLayerRules`：违例方向 2 条（`let` / `var`）、判绿方向 3 条（const 只读门面 / `state/` 自身豁免 / renderer 之外的同一形态）。
- 变异自证：在 `ui/recent-files.ts` 注入一个 `export let` ⇒ 判红、退出码 1，输出点名该文件与注入行的行号（行号随注入位置变，故此处不钉具体数字），撤掉后复绿、退出码 0。

### `trapStack` / `focusOriginStack` 的归属裁决（原 ADR-076 悬案）

[ADR-076](ADR-076-dom-ops与toast归入基础层.md) §后果那条「基础层持有可变状态是否可接受，本条不裁决，留给那一步」在此结清：**裁决为「留在 `dom/` 基础层可接受」**（用户 2026-10-13）。判据不只是「方便」—— 见档 A 表里那两行的理由（栈元素是 `HTMLElement`，store 不能长 DOM 概念）。连带项同步作废：evidence 里「`trapStack` 搬迁须与 `dom/dom-ops.ts` 新增 `state/` import 同提交」那条口径已销掉（不搬 ⇒ 没有新 import ⇒ 那条约束无对象）。

## 备选方案

**否决 · 只加判据不拆边。** 会立刻判红现存的功能目录间边，必须先拆才能加规则才能转正 —— 实际就是拆，只是多花一轮红，且那一轮红会被当成「门禁坏了」而不是「判据说对了」。

**否决 · 保留现状，把 peer mesh 当成正式设计写进文档承认它。** 承认之后没有任何成本下降：下一次跨功能交互仍然是「挂一个 handler 槽 ＋ 一条注释」。把既成事实写成设计，等于把「没人管」升格成「有意为之」，而这条 mesh 的唯一成因是当初没有任何机制要求它不是这样。

**否决 · 引入前端框架或 DI 容器。** 为一个离线桌面工具的 UI 编排引入运行时依赖，与本仓「core 纯度 ＋ 依赖钉死」的既有取向不符；而且要的东西（feature 间零 import）是机械可判的事实，不需要框架来提供 —— 框架只会用另一种方式把同一张 mesh 藏起来。

**否决 · 允许 feature 间 import，只禁止方向反转（允许单向分层）。** 实测那几条单向边不是设计意图而是历史沉淀，且「哪条边合法」需要逐边登记判据白名单，而白名单的维护成本高于「全都不许」。

**否决 · 只删四处反向注册 handler，不加判据。** 那四处是症状里最显眼的一处，删掉它们之后 peer mesh 一条边不少，只是从「挂槽」变成「直接 import」—— 形态更短，机制同样没有。下一次跨功能交互照样零成本发生。

**否决 · 拆出 renderer 内部的分层目录（如 `renderer/core/` 与 `renderer/features/`）。** 一次全仓评审对 `src/core` 给出的判据结论正好相反：那边内部几乎是一片 DAG，为一片近乎无环的图断言方向是**为它并不存在的病开药**。renderer 这边确实有环，但「环」的正确治法是断环，不是重新画层。

## 后果

**代价。** renderer 全树文件要逐个重接，模块级可变状态要大搬家；组合根 `renderer/renderer.ts` 会明显变长 —— **这是有意的**，它变长正是「接线集中在一处」的可见证据，不是失控。

**收益。** 「feature 间零 import」成为可机械判定的**永久护栏**（不是「一加就红」的临时判据），且新增跨功能交互的成本从「挂一个 handler 槽」降回「加一个 port 参数」。

**以后会受它约束的。** ① 任何「feature A 需要 feature B 的能力」的诉求，实现形态被限定为「在 port 上加一个方法」，而非 import；② 模块级可变状态的落点只有一个，判据可写成「`state/` 之外零 `export let`」；③ 本条立判据时必须**先拆边再转正**，不允许用白名单压绿 —— 白名单一旦开出来就成为下一个 peer mesh 的藏身处。

**判据形态。** 「feature 间零 import」可复用现有 import 图扫描器（`npm run owners` / `npm run where` 与之共用同一套），表达为一条 scope 覆盖四个功能目录、`forbid` 指向彼此的规则 —— 与现有 `renderer-foundation-no-feature-dep` 同一形态，只是 scope 与 `forbid` 的方向相反。**不需要新造门禁文件。**

**已知会失效的一处。** 动态 `import()` 与字符串拼出的 specifier 不在现有扫描器的覆盖内 —— 判据扫的是静态 `import ... from`。本条不为此开新机制（超出本仓门禁架构的常规能力），但它意味着「零 import」这个不变量有一个已知的、可被绕过的口子，应在规则注释里点名，而不是留给下一个人去发现。