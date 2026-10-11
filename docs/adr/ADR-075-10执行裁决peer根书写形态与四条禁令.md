# ADR-075 · #10 执行裁决：peer 根的书写形态与四条禁令

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-10 |
| 关联 | [ADR-065](ADR-065-renderer功能层注入式重构.md) 定目标（四个功能目录互不 import · 跨功能协作经组合根注入 · 反向注册槽清零），本条只定**执行期**的四条禁令与一处根名书写形态；[ADR-071](ADR-071-两处判据的形态裁决.md) 的「新判据不设豁免 · 先报告后转正」纪律在本条沿用 ｜ 事实底账见 [`20261006-141113-三份只读测绘事实地图与接手须知`](../evidence/20261006-141113-三份只读测绘事实地图与接手须知.md) §五 |

---

## 决定

一、`peer:` 的 forbid 串**必须写两段根**（`renderer/convert,…`），并由 `RENDERER_FEATURE_ROOTS` **派生**成一张 `RENDERER_PEER_ROOTS`，不得在规则体里手写第二份名字。

二、四条实现禁令（每条都附「为什么它看起来更省事」）。

三、提交序列按机制划，可回滚单元 = 阶段①② 整体 + 阶段③④⑤⑥ 整体。

## 背景

阶段①（判据机制扩三样）已由 `8017b50` 落地（`resolveOwner` · `renderer-features` scope · `RENDERER_TOP_DIRS` 未登记目录判据），零行为变化。阶段②开工前逐行读过实现，发现一处**会让规则从建起就恒绿**的形态，若不先裁决，后面每一步都在错误的前提上跑。

### 一、`peer:` 的根名书写形态（实测）

`resolveOwner(file, spec)`（`check-import-boundary.mjs:1332`）把说明符解析后**取前两段**返回：`renderer/convert/events/x.ts` 发 `../../ui/dom-ops.js` ⇒ `renderer/ui`；同 feature 内的 `./selection.js` ⇒ `renderer/convert`。而 `RENDERER_FEATURE_ROOTS`（`:465`）持有的是**裸名** `['convert','settings','ui','wizard']`。

`peer:` 分支（`:1465`）的判定是 `roots.includes(target) && self !== target`。于是：

- forbid 写**裸名**（`peer:convert,settings,ui,wizard`）⇒ 拿 `convert` 去比 `renderer/convert`，**恒假**，规则永远零命中 ⇒ **恒绿**，且它的失效形态恰好是本族最贵的那一种（判据看起来在、真判红时才发现它从没生效过）
- 改分支去比 `target.split('/')[1]` 同样不可取：那会让 `main/ipc` 这类**扫描根之外**的目标也可能撞上裸名（`ipc` 若与某个功能根同名即误判），把「二元语义」换成「名字巧合」

⇒ 唯一稳妥形态是**两段根**（`renderer/convert,…`）。但它不能手写：功能根的名字已经在 `RENDERER_FEATURE_ROOTS` 里手写了一份，手写第二份就是 ADR-065 §后果点名的「白名单一旦开出来就成为下一个藏身处」的同款漂移。故派生：

```js
export const RENDERER_PEER_ROOTS = Object.freeze(
  RENDERER_FEATURE_ROOTS.map((root) => `renderer/${root}`),
);
```

规则体的 forbid 用它拼出（`peer:${RENDERER_PEER_ROOTS.join(',')}`），单一来源仍是 `RENDERER_FEATURE_ROOTS`。

⚠ **本条与 `RENDERER_FEATURE_SCOPE_EXCEPT_FILES`（`:1352` 当前为空）无关**：那是 scope 的逐文件排除面，与根名无关；两处都别混。

### 二、四条实现禁令

1. **不得把跨 feature 回调塞进 `state/` store 新建槽。** 看起来最省事（挂一个槽，四个 feature 都能读），但那是把 ADR-065 §决定明写「要删」的形态再引入一遍，且槽是**隐藏耦合**：依赖不出现在任何调用点，import 图看不见它 ⇒ 门禁判绿而耦合是真的（fail-open）。

   **⚠ 本条的理由在 2026-10-10 订正过一次**：初版写的是「塞进 store 会让 `state/` 长出指向 feature 的出边、当场撞破 `renderer-foundation-no-feature-dep`」。**该理由不成立**，实测证伪：`state/state.ts` 的两个槽（`:65` `recentRefreshHandler` · `:69` `stageChangedHandler`）都是 `(() => void) | null` 的裸字段，**不需要 import 任何东西**，`src/renderer/state/` 下指向四个功能根的 import **实测 0 条** ⇒ 槽不产生 import 边，撞不破那条规则。`renderer.ts:142` 的既有先例正是如此，其注释写明用途：「convert-flow 经 state 调用，不再 import recent-files，打破 recent-files ↔ convert-flow 的 ESM 环」。

   **禁令本身不变，理由换成上面那两条**（ADR-065 要删它 + 槽是门禁看不见的隐藏耦合）。顺带钉一条读法：`recentRefreshHandler` 是 ADR-071 点名豁免的**既有事实**，不是可复制的模式 —— 它之所以合法，是因为「转换成功后刷新最近区块」这个时刻**没有任何调用栈能连到 ui**（异步完成后由 convert 触发）；凡有调用栈可连的场景一律走形参。

   ⇒ 落点：**组合根组装，feature 侧接形参**（ADR-065 §决定原文「以构造参数注入」）。
2. **不得在 `renderer-foundation` scope 上加 `exceptFiles`。** LAYER_RULES 的求值循环不读那个字段（只有 `LAYER_TEXT_RULES` 读），挂上去**静默忽略**；排除只能落在 scope 档（`RENDERER_FEATURE_SCOPE_EXCEPT_FILES`）或规则体显式形态。挂完若发现「怎么没生效」，先查这个。
3. **不得用白名单压绿现存跨 feature 边。** ADR-065 §后果已定：本条立判据必须先拆边再转正。白名单一开就成为下一个 peer mesh 的藏身处。
4. **不得把「Esc 关闭链的末位语义」交给惰性 port。** 改注入后「谁是链的末位」从 import 求值顺序变成参数装配顺序（见底账 §五「最可能出岔子的一处」②）；某个 close 若改成惰性调用，末位语义会变而**没有任何测试变红**。⇒ 该链保持同步调用，且必须补一条钉住末位是谁的断言（不是钉「链路通」）。

### 三、提交序列与可回滚单元

按**机制**划而非按 feature 划：① 判据机制扩 · ② foundation 规则换解析形态 · ③ 新 peer 规则挂 `pending: true`（info 通道列出的现存边清单**就是拆边工作单**）· ④ 逐 feature 拆边（每 feature 一提交、组合根接线随该 feature 同提交）· ⑤ 清反向注册槽 · ⑥ 删 `pending: true` 转正。

**六步已于 2026-10-11 全部落地**（提交序列见本轮各提交正文；工作载体原文已入档 [`20261011-101152-最优架构整改工作载体原文`](../evidence/20261011-101152-最优架构整改工作载体原文.md)）：④ 因交汇点的真实形状拆成五刀（ui 5 → settings 10 → convert 13+3 交汇 → wizard 13 → settings 1），其中 17 条边经 [ADR-076](ADR-076-dom-ops与toast归入基础层.md) 的搬迁消掉而非注入；⑤ 删掉的是 `state.stageChangedHandler`（`recentRefreshHandler` 是 ADR-071 点名豁免的，未动）；⑥ 转正后判红能力有三层证据（合成树 · CLI 退出码 · 真实仓库负向探针）。

**可回滚单元 = ①② 与 ③④⑤⑥ 两块**。理由：`DEV-GUIDE` 要求每个提交跑全量测试，而「拆 feature 边」天然不能在中间态编译通过 ⇒「按 feature 切五个提交」与「每提交绿」不相容；①② 同理（机制与它唯一的在用规则必须一起回退，否则余下的 foundation 规则会孤立地换形态）。

⚠ **每提交绿的判据是 typecheck + 受影响段**，不是全量 `npm run test`——③④ 之间那些中间态本就不该编译通过。全量只在阶段⑥ 转正前跑一次（改判据本体当轮跑全量，见验证基线）。

## 四、端口形态与阶段④ 执行顺序（开工时读码定的，逐 feature 照此办理）

**端口形态：组合根组装 · feature 侧接形参 · deps 类型由各 feature 自报。**

- **不新建共享 ports 文件**。四个功能根是平铺协作的 peer（ADR-065 §决定），共用一份 `ports.ts` 等于给 peer mesh 装一个共享枢纽 —— 那是把 44 条边换成 1 个共享模块加 N 条边，且新文件还会撞 `RENDERER_TOP_DIRS` 那张未登记目录表。各 feature 在自己的文件里声明自己那份 deps 类型（形如 `XxxDeps`），类型即契约，组合根的接线由 `typecheck` 把关。
- **port 传函数本身**（如 `recomputeActionButtons: () => void`），不传整个模块对象。传模块对象等于换一种形式把跨 feature 面全量暴露出去，拆边就白做了。
- **形参挂在「组合根本来就在调的入口函数」上**，不新造 init 层。当前 renderer 的入口本就是零参的 `bind*` / `init*`，改成形参后接线仍集中在 `renderer.ts` 一处（ADR-060「注入点集中在一处」的先例）。

**⚠ 拆边的真实分组不是「按源 feature 四刀」，而是「三刀 + 一处交汇」。** 阶段③ 工作单按源根统计的出边数（`ui`6 / `settings`11 / `convert`13 / `wizard`14）**不可直接当提交单元用**，因为有三处交汇点无法归入任何一个 feature：

| 交汇点 | 位置 | 为什么归不进去 |
|---|---|---|
| `afterModalClosed` | `ui/dialogs.ts` 定义，内部调 convert 的 `updateActionButtons`；调用方是 `settings/settings-preset-actions.ts:64` 与 `wizard/book-wizard.ts:271` | 它是 ui 的**出边**，但改它必须同时改 settings 与 wizard |
| `closePresetSaveDialog` | `settings/settings-preset-actions.ts:60` 定义、`:64` 调 `afterModalClosed`；调用方含 `convert/events/dialogs-events.ts:196`（Esc 链） | 通知在 close 函数**内部**，要去掉 ui 的 import 就得让 close 接形参，而形参必须由 Esc 链传入 |
| `closeBookWizard` | `wizard/book-wizard.ts:263` 定义、`:271` 调 `afterModalClosed`；调用方含 `dialogs-events.ts:207`（Esc 链） | 同上 |

⇒ 三者的调用方全部汇流到 **`convert/events/dialogs-events.ts` 的 Esc 链**，那才是枢纽。**给这三个函数加形参就等于改 Esc 链**，正撞禁令 4（末位语义从 import 求值顺序变成参数装配顺序）。⇒ 交汇点随 **convert 那一刀**一起落地，且必须同时满足禁令 4 的两条（链保持同步调用 + 补一条钉住「谁在末位」的断言）。

**⚠ 因此 ui 那一刀只拆 5 条，不是 6 条。** `ui/dialogs.ts → convert/file-list` 那一条留给 convert 那一刀（连同上面两处交汇点）。理由：ui 的另外 5 条（`recent-files` ×4 + `first-run-guide` ×1）的调用方**只有组合根**（`renderer.ts:16-21`），改动面是 `3 个 ui 文件 + renderer.ts + 2 个测试文件`，**零级联**；把交汇点塞进来会让这一刀同时踩 convert 的 Esc 链与禁令 4。

**实测分组（合计仍是 44）**：`ui` **5** 条 → `settings` **10** 条（它的 11 条里 `settings→ui/dialogs` 那条属交汇点）→ `convert` **13** 条 **+ 3 条交汇**（`ui→convert/dialogs` 1 + `settings→ui/dialogs` 1 + `wizard→ui/dialogs` 1）→ `wizard` **13** 条。**每刀一个提交，组合根接线随该刀同提交。**

**执行顺序：`ui`(5) → `settings`(10) → `convert`(13+3 交汇) → `wizard`(13)。** 先用最小的 ui 立模式（3 个源文件、5 个符号、零级联），后面三刀照同一形态办理。⚠ 升序的代价写在明处：ui 先走 ⇒ 它去动 settings/wizard 的文件，后两者提交时那两个文件已改过一轮；反过来先做 settings/wizard，则它们得先接一个还不存在的形参，耦合更紧。

- **热点警告（来自阶段③ 工作单 §五.1）**：`ui/dom-ops.ts` 单文件被 **15 条**边指向。若拆边时把它留原地当「大家都要的那一个」共享，44 条边只是换成 44 条经组合根注入的形参，**边数一条不降** —— 阶段⑥ 转正才红。这正是禁令 3 存在的理由。

## 后果

- **阶段② 的验收是「双侧零命中 + 一条负向夹具」**：换成 `peer:` 后 `check:boundary`（src）与 `check:boundary:dist`（产物）都必须仍是 0 命中，且必须有一条合成夹具证明它**能**判红（`dom/refs.ts` import `convert/…` ⇒ 命中并点名）——只验「零命中」的那一步，与恒绿不可区分。
  - **阶段② 实测**：双侧各跑一次并与改动前逐字对拍，**src 与 dist 的输出各自与改动前 byte-for-byte 相同**（结论行、pending 汇总行逐字未变，退出码均 0）⇒ 本步确为**零行为变化**。合成夹具两条（`11f` 一层子目录 `dom/refs.ts → ../convert/`，`11g` 深两层 `renderer/state/store/slice.ts → ../../ui/`）均判红并点名源文件、说明符与规则 id；判绿对照覆盖「基础层 → 基础层」与「基础层 → core/」。`11g` 那条正是旧 `prefix:` 形态的**真实漏判**（`../../ui/` 不以 `../ui/` 开头）。
  - **变异实测（证明夹具有牙）**：把派生表改回**裸名**（`map((root) => root)`，即本条决定一要防的那个恒绿形态）后，`selfCheckPeerMesh()` 报 7 项问题（3 条「期望命中实际不命中」+ 4 条派生一致性），测试段 101 个 case 中 50 个转红，其中 `11e`/`11f`/`11g` **各自独立捕获**。⇒「恒绿不可区分」那个验收缺口已由这两条夹具堵上。
  - ⚠ **形态变更带出一处非平凡的代码位置调整**：`RENDERER_FEATURE_ROOTS` 与派生的 `RENDERER_PEER_ROOTS` 必须声明在 `LAYER_RULES` **之前**（规则体的 `forbid` 由后者拼出，而 `const` 在模块求值期处于 TDZ；放在其后则一被 import 就抛 `Cannot access 'RENDERER_PEER_ROOTS' before initialization`）。`RENDERER_TOP_DIRS` 不受此限（仅运行期被读），留在原处。原声明位置留了一行指针注释。
- **`test/gates/import-boundary.test.js` 的两处断言会随阶段②③ 失效**，必须同批改：`:1820` 断言「LAYER_RULES 里不应出现 `peer:` 形态的规则」、`:1860` 断言「LAYER_RULES 无 `peer:` / `renderer-features` 条目」。它们当初钉的是阶段①「刻意不挂规则」，转挂那一刻起该断言的**前提**变了，与 #08 族一转正时改钉通道期望同款。
  - **阶段② 已改**：从「一条 peer 规则都没有」改为「peer 规则**恰好**是 `renderer-foundation-no-feature-dep` 这一条，且其 `forbid` 逐字等于 `peer:${RENDERER_PEER_ROOTS.join(',')}`、`scope` 仍是 `renderer-foundation`」；`renderer-features` 档「仍无规则」那条**保留**（阶段③ 才挂）。钉「恰好」而非「至少」是刻意的：阶段③ 挂第二条时它会当场变红提醒同批改这里。
- **现存跨 feature 边有两组历史读数**（44 与 52），口径不同（前者按文件、后者按边且含更宽的折叠）；权威数字取阶段③ `pending` 模式下 info 通道的实跑输出，不从本条取。
  - **阶段③ 实测（权威读数在此，不在上面那行）**：`renderer-features-no-cross-import`（`scope: 'renderer-features'` · `pending: true`）挂上后，**src 侧 44 处、dist 侧 44 处，两侧逐条对拍完全相同**（按「源文件去扩展名 | 目标 feature」建 30 个键比对，差额 0），双侧 `exit 0`。工作单落 [`20261010-230407-10阶段三跨feature边工作单`](../evidence/20261010-230407-10阶段三跨feature边工作单.md)。⇒ **上面那行的「44」恰好与本步 src 侧读数相同，但两者的口径不同**，取数时仍以工作单为准。
  - ⚠ **两侧条数相同的理由与「两侧应当不同」的直觉相反，须写明**：`peer:` 判定走 `resolveOwner`（归一化后取前两段），**文件名不参与判定**，只决定「从侧文件」；两侧目录结构与文件名逐一对应 ⇒ 边集必然相同。真正会让两侧分叉的口子是 **type-only import**（产物侧被编译期整体擦除），而本批 44 条**实测 type-only 为 0**（全是值 import）故两侧齐平。阶段④ 若引入 `import type` 形式的跨 feature 边，两侧就会分叉，工作单须按两处分别记。
- ⚠⚠ **阶段③ 的一处订正：任务书的前提「不豁免组合根这条规则第一跑就会把 ADR-065 目标形态判红」经实测为假** —— `renderer-features` 的命中面是 `renderer/<功能根>/` **前缀**，组合根 `renderer/renderer.ts` 是 `renderer/` 的直属文件，前缀本就不匹配它 ⇒ **它在排除之前就已落在 scope 之外**。实测：带 / 不带 `RENDERER_FEATURE_SCOPE_EXCEPT_FILES` 的登记，该规则双侧命中数**一字不变**（各 44），组合根那 8 条 import 两侧都不报。
  - ⇒ `RENDERER_FEATURE_SCOPE_EXCEPT_FILES` 那一行**当前是防御性登记、不承重**。保留它的理由改写为：它把 ADR-065 的「唯一合法例外」写成机械可读的一条登记;**若**将来把 scope 命中面从「前缀枚举」改成「renderer 下排除基础层/样式层的全部文件」，这一行就是组合根继续合法的唯一依据，否则那次改动会把目标形态判红。
  - ⚠ **反过来说，它也证明不了自己是对的** —— 承重的那块证据是 `selfCheckPeerMesh` 的 `scopeCases` 里「renderer 直属文件不命中」那条（走 `scopeMatches`，命中面若变宽就会翻脸）。代码注释与自检断言均按此实测改写，**不得**写成「不豁免就会第一跑判红」。
- **动态 `import()` 与拼接 specifier 仍不在覆盖内**（ADR-065 §后果已点名）：「零 import」有一个已知可绕过的口子，转正时在规则注释里保留这句点名，不留给下一个人发现。