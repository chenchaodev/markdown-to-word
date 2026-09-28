# 步 03 · renderer 设置管道表驱动

> 开工只需读这三处：相关约束给判据，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关约束

- `docs/adr/adr-015`：测试全量纳入类型门禁（**逐文件 `@ts-check` pragma**）
- `docs/design/settings-ia.md`：控件归组与三种门控形态的规范来源。**改结构不得改出与它不符的形态** —— 条件字段整块移除、灰禁只给分档类从属项，这两条是 IA 拍板的
- `docs/large/01-设置契约与主管线收敛.md`：步 03 规格与退出条件
- **步 03-0 已建好的两道护栏**（本步全程靠它们自证）：`test/renderer/settings-controls.test.js` 的 43 控件逐条 hydrate/bind/reset 基线 · `check:geometry` 的抽屉 40 控件位置与可见性判据

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处。本步适用门禁类别见 [large/01](large/01-设置契约与主管线收敛.md) 门禁表的「步 03 结果」列。

## 目标

新增一个设置控件时，renderer 侧的改动从 6 个文件降到「1 个表条目 + 1 个 HTML 控件」，且步 03-0 建好的 43 控件基线与 40 控件几何判据**一条都不红**。

## 下一点

新建 `src/renderer/settings/settings-controls-table.ts`：一个声明表，每条含「设置键路径 → 控件 id → 所属组 → 读控件 → 写控件」，并把 `settings-logic.ts` 的 `SettingsControlValues` 改为从 `AppSettings` 派生；改完跑 `M2W_ONLY='settings-logic,settings-controls' npm run test`。

## 完成标准

- [ ] 新增一个 checkbox 的 renderer 侧改动 = **1 个表条目 + 1 个 HTML 控件**（判据：`settings-controls.test.js` 里断言「每个控件都有表条目」且「每个表条目的 id 都在 `index.html` 里」，两向都查）
- [ ] 步 03-0 的 **43 控件逐条 hydrate/bind/reset 基线全绿**（不是抽样，是全部 43）—— 自动断言见 `test/renderer/settings-controls.test.js`
- [ ] `npm run check:geometry` 全绿：抽屉 40 控件的存在且可见、组归属、**组内视觉序**、无裁切/越界、三种门控双向（收起 5 条 + 灰禁 2 条）—— 即「控件位置与可见性不得变化」由门禁自动判定
- [ ] 依赖门控与「设置值→控件显隐」以**显式登记的例外**表达：3 个手写门控 + 5 处设置值驱动的显隐/双写/副标题合成，**一处不少地登记在表里**；表里**不出现**第二套声明式依赖语言
- [ ] 声明表与 `test/tools/geometry/geometry-spec.mjs` 的 `DRAWER_CONTROLS` 交叉校验通过（两者的抽屉内控件 id 集合一致；差额 3 个抽屉外控件按 B 面的分工归 id 校验判）

## 修复项复测

- [ ] `SettingsControlValues` 从 `AppSettings` 派生后消除既有 2 处差异：缺 `pdfCss`（回填绕过它直接读 `state.settings.pdfCss`）、多两个回填不消费的死字段（`outputDirText` / `headerLogoPath`）
- [ ] 3 个手写门控的**关闭态与开启态双向**行为不变（页眉自定义折叠 + `inert` / AI 清理分档灰禁 / 目录模式 `.hidden` 整块移除），且**收起时不动控件已选值**
- [ ] reset 的**刻意保留白名单**（`theme` / `language` / `customPresets`）与局部 reset（`outputDirReset` 只清 `outputDir`）行为不变；持久化 payload 的键集逐条比对
- [ ] 既有 6 个带钳制与错误回显的控件（边距 ×4 / 字体 ×2 / 字号 / 行距 / 水印角度 / 水印不透明度）钳制口径不变

## 明确不做

- **不新建 ADR**。纯内部结构重构、行为等价，零依赖、零接口/数据格式/分层变更，不命中涉架构任一条。LOG 留一行即可
- **不合并** 6 个 `settings-bindings-*` 文件。规格已定：它们对齐 UI 导航结构（与 `index.html` 的 `data-group` 一一对应），不是抽象维度；表只管每个域内部
- **不碰** `src/renderer/wizard/`（向导侧的门控副本不属本步范围）
- **不把依赖门控做成声明式**。规格已定调：依赖关系是少数情况，强行声明式化会让表里出现第二套 mini 语言
- **不让测试侧 import 生产侧的声明表**。那会给纯规格的 `geometry-spec.mjs` 加一条 build 顺序依赖，而它「判定逻辑可在无 Electron 环境下完整验证」是刻意设计。改为在既有 id 交叉校验段里加一条集合比对

---

> 本步是 [large/01](large/01-设置契约与主管线收敛.md) 的第 6 个批次，本文件是它的**单步**当前状态，做完即删。本步无用户可感知变化（纯内部结构，控件位置与行为由 03-0 的门禁守），按全局写入判据 ② 不写 CHANGELOG；若实现中出现用户可感知的差异，回收尾时补。
