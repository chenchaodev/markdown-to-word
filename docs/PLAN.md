# 设置抽屉组内分段、视觉与检索重构

> 开工只需读这三处：相关 ADR 给约束，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

- [ADR-065](adr/ADR-065-renderer功能层注入式重构.md) / [ADR-075](adr/ADR-075-10执行裁决peer根书写形态与四条禁令.md)：renderer 四个功能目录互不 import，跨 feature 协作经组合根注入、feature 侧接形参、deps 类型各 feature 自报；四条禁令——不得把跨 feature 回调塞进 `state/` 新槽、不得在 `renderer-foundation` scope 加 `exceptFiles`、不得用白名单压绿现存跨 feature 边、Esc 关闭链保持同步调用并补钉住末位的断言。本任务新增的搜索与门控全部在 `settings/` 这一个 feature 目录内，不产生跨 feature 边。
- [ADR-024](adr/ADR-024-设置分组与渲染前变换层下沉.md)：它的「设置分组」指 `AppSettings` 的**持久化对象分组**，与抽屉 UI 分组是两件事 —— **改抽屉分组不触发本条**；但 P4 若把水印总闸落成新的持久化键，则触发 §一（新键同时补整文件形状校验与字段级兜底，不得只补其一）与 §四（迁移让存量用户产物逐字节一致）。
- [ADR-064](adr/ADR-064-源码树一职责一文件与内部边界判据.md)：新增 renderer 文件按一职责一文件落位并补文件头注释。
- [ADR-071](adr/ADR-071-两处判据的形态裁决.md)：新判据不设豁免，先报告后转正。P4 若给几何判定层加第三种门控形态，按本条先挂 `pending`。

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「命令」节——命令只存那一处，本文件不复制。

## 目标

用户在设置抽屉里，从「六组平铺、只能顺着找、窄窗下「导出后行为」那一行点不到」变成「组内有段标签、横着打几个字就能定位到任意控件、方向键就能换组、最窄窗下所有控件都可点可见」。

## 下一步

立 `docs/adr/ADR-077-设置抽屉组内分段与检索.md`，把「六组边界不动 · 组内加段标签 · 搜索经声明表 labelKey 做单源 · 水印总闸三档第三档标规划中」四项裁决写进决定本体，改完跑 `npm run check:docs`。

## 完成标准

- [ ] 下面「整体完成标准」一节逐条划完
- [ ] `npm run check:docs` 绿（指针与台账形态）
- [ ] `npm run check:geometry` 全场景绿，含 P4 新增的水印主控态
- [ ] `npm run ui:shots` 六状态人工比对通过，`docs/images/ui-*.jpg` 已重取
- [ ] `npm run verify:ci` 全绿

## 修复项复测

- 无

---

## 步序与泳道

| 步 | 工作项 | 目标 | 可写文件（不重叠） | 退出条件 | 门禁 | 结果 |
|---|---|---|---|---|---|---|
| #01 | REQ-247 | P0 文档与字典清账 + 立 ADR-077 | `docs/adr/ADR-077-*` · `docs/design/settings-ia.md` · `docs/design/ui-guidelines.md` · `docs/USER-GUIDE.md` · `README.md` · `src/core/i18n/*.ts` · `src/renderer/index.html`（仅组名静态回退与 `obsidianAttachmentFolderDesc` 说明行两处） | 16 条孤儿键清零、两代组名键收敛为一代、组名三处统一为「应用」、zh 字间硬空格删净 | `npm run check:docs` · `npm run check:i18n-keys` | 待 |
| #02 | REQ-247 | P1 视觉 token（零逻辑） | `src/renderer/style/settings.css` · `src/renderer/style/base.css` · `src/renderer/index.html`（行级 class / 内联宽度 / 「即时生效」节点位置） | 抽屉三档加宽、侧栏 112px、行改 grid、控件齐高 32px、`--fs-*` 与控件宽变量落位、13 处内联样式清零 | `npm run check:docs` · `npm run check:src-layout` | 待 |
| #03 | REQ-247 | P2 组内分段 + 可达性（键盘 + 检索） | `src/renderer/settings/settings-controls-table.ts` · `settings-panel.ts` · `settings-drawer.ts` · `src/renderer/dom/refs.ts` · `src/renderer/index.html` · `src/core/i18n/*.ts` · `test/renderer/*` | 五个段标签落位；`aria-selected` + roving tabindex + ↑↓/Home/End 有直测；搜索跨六组过滤且声明表新增 `labelKey` 字段为标签单源 | `npm run typecheck` · `npm test`（renderer 段） | 待 |
| #04 | REQ-247 | P3 `tocMode` 改 seg | `src/renderer/index.html` · `settings-controls-table.ts` · `shared/geometry/geometry-spec.mjs` · `test/renderer/*` | 原生 select 换成两档 seg，无 `.toc-mode-select` 死类残留 | `npm run check:geometry` | 待 |
| #05 | REQ-247 | P4 水印总闸（三档，第三档规划中） | `src/core/settings/*` · `settings-controls-table.ts` · `settings-panel.ts` · `settings-bindings-headerwatermark.ts` · `src/renderer/index.html` · `shared/geometry/geometry-spec.mjs` · `test/**` | 总闸与四字段的条件收起双向判据成立；持久化若新增键则 ADR-024 §一/§四两条兑现；存量 settings.json 读入后产物逐字节一致 | `npm run check:geometry` · `npm run verify:ci` | 待 |

**泳道串行是判定结果不是偷懒**：P1 与 P2 都改 `index.html`；P3 与 P4 都改声明表与 `geometry-spec.mjs`。且真窗口才判红的几何判据要求「重排类改动必须单独成提交」（见下节），本身就不许与其它步混批。

## 整体完成标准

- [ ] 六个组名与组序在 `docs/design/settings-ia.md`、`docs/design/ui-guidelines.md`、`docs/USER-GUIDE.md`、`README.md`、三语字典、`presetCoveredGroupLabels()` 七处一致，`docs/design/ui-mockup.html` 不再是旧 9 段编号
- [ ] 抽屉内任意控件可经搜索定位；搜索标签经声明表 `labelKey` 取，renderer 侧不存在第二份「控件 → 标签」清单
- [ ] 最窄档（≤1080px）下 05 组「导出后行为」三档全部可点可见，宽度经真渲染量测复核而非按 CSS 字面量推算
- [ ] 抽屉可用方向键换组，焦点落点与 ARIA 状态同步
- [ ] 声明表三处条目工厂的 `G` 泛形参仍穿到 `group` 字段——以一条**负向探针**证明（故意写裸 `ControlGroup` 必须转红），不靠「没报错」判定
- [ ] `settings.css` 注释里的组号与 `index.html` 的 `sec-num` 一致（现注释写「06 输出」而输出已归 05）

## 怎么回滚

按步回滚，每步一个可独立回退的提交：

- #01 纯文档与字典，回滚只需还原提交；台账行与号段两格随 `docs/REQ.md` 一起还原。
- #02 纯 CSS 与行级 class，无声明表改动 ⇒ 回滚后几何判据全绿。
- #03 若 `labelKey` 字段引发类型层连带问题，回滚该提交即回到现有声明表形态；搜索框是纯 renderer 表现层，不写盘（不新增 `AppSettings` 键）⇒ 无迁移残留。
- #04 控件定位由 id 改 radio 组名，回滚后 `tocMode` 回到 `<select>`，无持久化影响。
- #05 若总闸落成新持久化键，回滚该步须同时跑一次迁移的反向验证 —— 旧版本读不懂含新键的 `settings.json`，故**回滚 #05 等同回滚一次设置格式版本**，需在发版说明里显式标注，不可当普通回滚处理。