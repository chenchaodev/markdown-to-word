# ADR-076 · dom-ops 与 toast 归入基础层

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-10 |
| 关联 | 扩 [ADR-065](ADR-065-renderer功能层注入式重构.md) §决定里「基础层 = 元素映射(`dom/`) + 纯函数核+store(`state/`)」这一定义（那一条只钉 `dom/` 装元素映射，本条把它扩为**元素映射与元素操作**）；执行期的端口形态见 [ADR-075](ADR-075-10执行裁决peer根书写形态与四条禁令.md) §四 ｜ 边数底账见 [`20261010-230407-10阶段三跨feature边工作单`](../evidence/20261010-230407-10阶段三跨feature边工作单.md)（**该文件是搬迁前的快照**，44 条是搬迁前的数字） |

---

## 决定

`src/renderer/ui/dom-ops.ts` 与 `src/renderer/ui/toast.ts` 迁入 `src/renderer/dom/`，文件名不变（`dom/dom-ops.ts` · `dom/toast.ts`）。基础层 `dom/` 的职责从**元素映射**扩为**元素映射与元素操作**。

## 背景

阶段③ 挂上 `renderer-features-no-cross-import` 后，44 条跨 feature 边里有 **17 条指向这两个文件**（`dom-ops` 15 条：settings 7 · convert 6 · wizard 2；`toast` 2 条：settings 2），而它们各自的出边只有 **6 条** —— 这是工作单 §五.1 点名的热点形态：**极可能以「大家都要的那一个」被留在原地共享**，那样 44 条边只是换成 44 条经组合根注入的形参，边数一条不降。

逐行读过两个文件后，事实与「热点模块」的表象不符：

- `dom-ops.ts`（268 行）的 import 只有 `../dom/refs.js`、`../state/state.js`、`../../core/i18n/index.js`
- `toast.ts`（24 行）的 import 只有 `../dom/refs.js`
- ⇒ **两者对四个功能根的 import 实测均为 0 条**

也就是说：它们**已经是基础层在实质上**（零 feature 依赖、且已经依赖 `dom/refs.ts`），却因为建在 `ui/` 里被卷进 peer mesh。`dom/` 目录当前只装着 `refs.ts`，而 `dom-ops.ts` 做的正是对**那些 refs 所指元素**的操作 —— 同类东西分居两个目录，唯一理由是历史上建在了哪里。

## 为什么是搬迁而不是注入

ADR-065 §决定要的是「**跨功能协作**经组合根注入」。`setError` / `setStatus` / `showToast` / `trapFocus` / `rememberFocusOrigin` / `restoreFocusOrigin` / `showFieldError` / `hideFieldError` 这八个工具**不是功能协作**，它们是基础设施：四个 feature 各自需要「设错误行 / 弹 toast / 记焦点原点」，彼此之间并无所求。

按注入路线办，组合根要持有这八个工具并分发进 **4 个 feature 的 8 个文件**（`settings-bindings-{app,convert,headerwatermark,preset,typography}` · `settings-drawer` · `settings-panel` · `settings-preset-actions`），而它们已经在同一个组合根里了。那不是消除耦合，是把耦合搬进组合根并让它长成一个 DOM 工具的 God object —— 而 `renderer.ts` 的既有不变量明写「不反向引用子模块私有符号」，堆进去的东西只会更多。

## 禁令 3 的边界：这个决定会不会变成「搬文件躲判据」

ADR-075 禁令 3 禁的是「用白名单压绿现存跨 feature 边」。本条不是那个形态，机械判据如下 —— **搬得动的文件必然对四个功能根零 import，而这件事本身是 fail-closed 的**：

`renderer-foundation-no-feature-dep`（`peer:` 形态 · 已 fail-closed · 阶段② 换过解析形态）判的正是「基础层的文件不得 import 任一功能根」。所以：

- 若这次搬迁是**躲判据**，那么被搬的文件必然 import 某个 feature（否则躲什么？）⇒ 基础层准入规则当场判红。**这个漏洞在机制上不存在。**
- 反过来，搬迁后 `dom-ops.ts` 对任何 feature 的无知是**真的无知**（零 import，且搬迁后仍必须保持），不是「判据照不到的地方」。

⚠ **给下一个人的可复用量**：若将来有人想把某个 feature 的**业务**模块搬进 `dom/` 来消边数，先问「它对功能根零 import 吗」——不是零就说明它是业务模块，那条规则会替你说不用。

## 后果

- **边数 44 → 22**（在 ui 那 5 条已拆的前提下：39 − 17）。工作单那份 evidence 是**搬迁前的快照**，权威数字取搬迁后判据的实跑输出，不从 evidence 取（与 ADR-075 后果节记的「44 与 52 两说、权威取 pending 实跑」同款处理）。
- **组合根不必持有 DOM 工具包**，`renderer.ts` 的接线面小一圈。
- **各刀的重编**：搬迁后余下 22 条 = settings **2**（其中 1 条属交汇点）· convert **7**+交汇 **3** · wizard **12** · ui **1**（交汇点源侧）。⚠ 阶段③ 工作单的按源根统计**不再等于各刀的实际边数**，取数一律以判据实跑读数为准。
- **`dom-ops.ts` 的两处模块级可变状态（`:167` `trapStack` · `:217` `focusOriginStack`）随文件进基础层**。它们在阶段③ 底账里是「档 A 真跨 feature」那 7 处中的 2 处，其收敛（模块级可变状态收敛进 store，属独立一步）的落点随之要重新裁决 —— 基础层持有可变状态是否可接受，本条**不裁决**，留给那一步。
- **`ui/` 目录的职责随之收窄**：搬走之后 `ui/` 装的是弹窗与最近列表这类真正的 feature 行为，`dom/` 装元素映射与元素操作。`RENDERER_TOP_DIRS` 那张目录表不受影响（只登记顶层目录，这四个功能根本身不动）。
- **搬迁要过 `check-src-layout` 的内部目录准入**（ADR-064），由门禁判，本条不预判它的结论。

### 实施后实测（2026-10-10，REQ-218 #10）

- **`renderer-features-no-cross-import` 命中 39 → 22**（src 侧与 dist 侧同读数，判据实跑输出；规则仍带 `pending: true`，两次退出码均 0）。落差的 17 条与本文 §背景 所列逐条对得上。
- **`renderer-foundation-no-feature-dep` 仍零命中**，判据结论行里「renderer 基础层(dom/state)不反向依赖功能目录」那半句仍在 —— 两个新文件进了基础层后，它对四个功能根依然零 import，ADR-076 §「禁令 3 的边界」说的 fail-closed 前提实测成立。
- 搬迁只改位置与说明符：`dom-ops.ts` 三条 import 里只有 `refs.js` 那条从 `../dom/refs.js` 变为 `./refs.js`，`../state/state.js` 与 `../../core/i18n/index.js` 原样不变（`state/` 与 `core/` 相对新位置深度未变）。`trapStack` / `focusOriginStack` 两处模块级可变状态按上文「本条不裁决」原样随文件进基础层，未作任何改动。
- 余下 22 条的按源根分布以判据实跑为准（§后果第三条已声明工作单的按源根统计不再等于各刀实际边数）。
- `check:copy-sites` 未因本次搬文件报出新的复制点（白名单仍 4 项，扫描 274 个源文件 / 13 处复制原语命中）。