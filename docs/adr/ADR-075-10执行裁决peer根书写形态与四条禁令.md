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

1. **不得把跨 feature 回调塞进 `state/` store。** 那看起来是清反向注册槽最省事的实现（挂一个槽，四个 feature 都能读），但它会让 `state/` 长出指向 feature 的出边，当场撞破已 fail-closed 的 `renderer-foundation-no-feature-dep`（`dom/` 与 `state/` 出边 0 是那条规则的全部内容）。⇒ 槽只能落在**组合根**（与 `recentRefreshHandler` 同款），feature 侧改接注入的形参。
2. **不得在 `renderer-foundation` scope 上加 `exceptFiles`。** LAYER_RULES 的求值循环不读那个字段（只有 `LAYER_TEXT_RULES` 读），挂上去**静默忽略**；排除只能落在 scope 档（`RENDERER_FEATURE_SCOPE_EXCEPT_FILES`）或规则体显式形态。挂完若发现「怎么没生效」，先查这个。
3. **不得用白名单压绿现存跨 feature 边。** ADR-065 §后果已定：本条立判据必须先拆边再转正。白名单一开就成为下一个 peer mesh 的藏身处。
4. **不得把「Esc 关闭链的末位语义」交给惰性 port。** 改注入后「谁是链的末位」从 import 求值顺序变成参数装配顺序（见底账 §五「最可能出岔子的一处」②）；某个 close 若改成惰性调用，末位语义会变而**没有任何测试变红**。⇒ 该链保持同步调用，且必须补一条钉住末位是谁的断言（不是钉「链路通」）。

### 三、提交序列与可回滚单元

按**机制**划而非按 feature 划：① 判据机制扩（已完成）· ② foundation 规则换解析形态 · ③ 新 peer 规则挂 `pending: true`（info 通道列出的现存边清单**就是拆边工作单**）· ④ 逐 feature 拆边（每 feature 一提交、组合根接线随该 feature 同提交）· ⑤ 清反向注册槽 · ⑥ 删 `pending: true` 转正。

**可回滚单元 = ①② 与 ③④⑤⑥ 两块**。理由：`DEV-GUIDE` 要求每个提交跑全量测试，而「拆 feature 边」天然不能在中间态编译通过 ⇒「按 feature 切五个提交」与「每提交绿」不相容；①② 同理（机制与它唯一的在用规则必须一起回退，否则余下的 foundation 规则会孤立地换形态）。

⚠ **每提交绿的判据是 typecheck + 受影响段**，不是全量 `npm run test`——③④ 之间那些中间态本就不该编译通过。全量只在阶段⑥ 转正前跑一次（改判据本体当轮跑全量，见验证基线）。

## 后果

- **阶段② 的验收是「双侧零命中 + 一条负向夹具」**：换成 `peer:` 后 `check:boundary`（src）与 `check:boundary:dist`（产物）都必须仍是 0 命中，且必须有一条合成夹具证明它**能**判红（`dom/refs.ts` import `convert/…` ⇒ 命中并点名）——只验「零命中」的那一步，与恒绿不可区分。
  - **阶段② 实测**：双侧各跑一次并与改动前逐字对拍，**src 与 dist 的输出各自与改动前 byte-for-byte 相同**（结论行、pending 汇总行逐字未变，退出码均 0）⇒ 本步确为**零行为变化**。合成夹具两条（`11f` 一层子目录 `dom/refs.ts → ../convert/`，`11g` 深两层 `renderer/state/store/slice.ts → ../../ui/`）均判红并点名源文件、说明符与规则 id；判绿对照覆盖「基础层 → 基础层」与「基础层 → core/」。`11g` 那条正是旧 `prefix:` 形态的**真实漏判**（`../../ui/` 不以 `../ui/` 开头）。
  - **变异实测（证明夹具有牙）**：把派生表改回**裸名**（`map((root) => root)`，即本条决定一要防的那个恒绿形态）后，`selfCheckPeerMesh()` 报 7 项问题（3 条「期望命中实际不命中」+ 4 条派生一致性），测试段 101 个 case 中 50 个转红，其中 `11e`/`11f`/`11g` **各自独立捕获**。⇒「恒绿不可区分」那个验收缺口已由这两条夹具堵上。
  - ⚠ **形态变更带出一处非平凡的代码位置调整**：`RENDERER_FEATURE_ROOTS` 与派生的 `RENDERER_PEER_ROOTS` 必须声明在 `LAYER_RULES` **之前**（规则体的 `forbid` 由后者拼出，而 `const` 在模块求值期处于 TDZ；放在其后则一被 import 就抛 `Cannot access 'RENDERER_PEER_ROOTS' before initialization`）。`RENDERER_TOP_DIRS` 不受此限（仅运行期被读），留在原处。原声明位置留了一行指针注释。
- **`test/gates/import-boundary.test.js` 的两处断言会随阶段②③ 失效**，必须同批改：`:1820` 断言「LAYER_RULES 里不应出现 `peer:` 形态的规则」、`:1860` 断言「LAYER_RULES 无 `peer:` / `renderer-features` 条目」。它们当初钉的是阶段①「刻意不挂规则」，转挂那一刻起该断言的**前提**变了，与 #08 族一转正时改钉通道期望同款。
  - **阶段② 已改**：从「一条 peer 规则都没有」改为「peer 规则**恰好**是 `renderer-foundation-no-feature-dep` 这一条，且其 `forbid` 逐字等于 `peer:${RENDERER_PEER_ROOTS.join(',')}`、`scope` 仍是 `renderer-foundation`」；`renderer-features` 档「仍无规则」那条**保留**（阶段③ 才挂）。钉「恰好」而非「至少」是刻意的：阶段③ 挂第二条时它会当场变红提醒同批改这里。
- **现存跨 feature 边有两组历史读数**（44 与 52），口径不同（前者按文件、后者按边且含更宽的折叠）；权威数字取阶段③ `pending` 模式下 info 通道的实跑输出，不从本条取。
- **动态 `import()` 与拼接 specifier 仍不在覆盖内**（ADR-065 §后果已点名）：「零 import」有一个已知可绕过的口子，转正时在规则注释里保留这句点名，不留给下一个人发现。