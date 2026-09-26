# 验收矩阵

> 规则见全局配置目录 @WORKFLOW-DELIVER.md
> **≤6,000 字符**。**已测项按功能点列,不按批次**;**只列人工项**,可自动断言的只在矩阵给指针;**覆盖方式**如实标注 `自动断言`/`冒烟`/`像素基线`/`人工`。**实测通过 → 移入 `docs/CHANGELOG.md` 一行、清空「当前待测」**;矩阵行改 ✅ 并填验证版本,**行不删**。
> **`ID` 列(`A-0NN`)是矩阵的稳定锚点**:连号、永不复用、永不改写;其他位置引用本矩阵用 `A-0NN`,**不用行号**;下一个可用号查文末「矩阵编号台账」。
> **`工作项` 列**指向 `docs/ROADMAP.md`「候选区」ID。本矩阵的历史功能点在引入工作项号之前交付,未分配工作项号,故填 `—`;`REF-001` 阶段 0 只重建本矩阵结构,不新增功能点行。
> 大型重构期间人工验收项在 `docs/campaigns/REF-001-全库优化收尾/PLAN.md`「人工验收」节,收尾时按归档五步第 4 步一次性回填本矩阵。

## 当前待测（≤5 项；实测通过即移入 `docs/CHANGELOG.md` 并清空）

- [ ] WPS 打开 `output/artifacts/math-structures.docx`:display `∑` 无方框、被加数不丢、上下限排在上下方
- [ ] 同一样例:列表项内 display 公式对齐列表内容栏(不按整页宽居中飘出)
- [ ] 同一样例:引用块灰底连续覆盖整块(表格与代码块同样带底色)
- [ ] Word/WPS 打开公式产物:行内与行间公式的实际排版观感
- [ ] 真实安装后用户视角:开始菜单可启动、可转换、「应用和功能」可卸载

- 自动断言见 `test/segments/math-structures.test.js`、`test/segments/dual-pipeline-matrix.test.js`、`test/segments/geometry-gate.test.js`

> **收口后**本节无待测项时,保留节标题 + 下面这一行,**勿删整节**:「当前无待测项」

## 覆盖矩阵

> 一个功能点一行,**按 `ID` 升序**。状态:✅ 已验 / ⬜ 待测 / ⚠️ 部分覆盖。「验证版本」填实测通过的版本号。**行只增不减**。
> 口径取代:本文件历史条目中与「内置/自定义预设作用域」「本地图片拒绝面」「安装包签名」「测试段隔离」四组相关的旧表述已被现行裁决取代(见 `docs/ADR.md` ADR-010/012/013/014);历史原文查 git,不再在本文件复述。

| ID | 工作项 | 功能点 | 覆盖方式 | 状态 | 验证版本 | 断言/验收指针 |
|---|---|---|---|---|---|---|
| A-001 | — | 文字水印(05 组) | 自动断言 | ✅ | 3.1.0 | `test/segments/watermark.test.js` |
| A-002 | — | 转换预检报告 | 自动断言 | ✅ | 3.2.0 | `test/segments/precheck.test.js` |
| A-003 | — | 目录带页码(域目录/静态、PDF) | 自动断言 | ✅ | 3.3.0 | `test/segments/toc-caption.test.js`、`test/segments/toc-pagenum.test.js` |
| A-004 | — | 合并总目录增强 | 自动断言 | ✅ | 3.4.0 | `test/segments/merge-toc.test.js` |
| A-005 | — | docx 模板导入(浅导入 v1) | 自动断言 | ✅ | 3.5.0 | `test/segments/template-import.test.js` |
| A-006 | — | 流程简化(列表增删/输出目录/进度取消/失败可见性/编码/文案) | 人工 | ✅ | 0.17.1 | 已实测 2026-08-09 |
| A-007 | — | 学术正式化延伸(目录/题注) | 自动断言 | ✅ | 0.18.0 | `test/segments/toc-caption.test.js` |
| A-008 | — | 公式编号 + 交叉引用 | 自动断言 | ✅ | 0.19.1 | `test/segments/eq-numbering.test.js` |
| A-009 | — | Mermaid 渲染导出(双格式/降级/离线) | 自动断言 | ✅ | — | `test/segments/mermaid.test.js` |
| A-010 | — | 题注/章节交叉引用 | 自动断言 | ✅ | — | `test/segments/cross-ref.test.js` |
| A-011 | — | 体验打磨(状态记忆/结果增强/预览模板/顺手项) | 人工 | ✅ | 0.25.0 | 已实测 2026-08-14 |
| A-012 | — | 界面体验优化(点击语义/布局密度/快捷键/追加/chips) | 人工 | ✅ | — | 已实测 2026-08-14 |
| A-013 | — | 预设 JSON 导入导出 | 人工 | ✅ | — | `test/main/presets-import.test.js` |
| A-014 | — | 测试补齐(G1-G8 缺口) | 自动断言 | ✅ | — | `test/segments/utils.test.js` |
| A-015 | — | 公式编号开关 | 自动断言 | ✅ | — | `test/segments/eq-numbering.test.js` |
| A-016 | — | CSS 覆盖 pdf 路线 | 人工 | ✅ | — | `test/segments/pdf-css.test.js` |
| A-017 | — | 界面配置区重构(四子组) | 人工 | ✅ | — | 已实测 2026-08-16 |
| A-018 | — | docx 批注 | 人工 | ✅ | — | 已实测 2026-08-16 |
| A-019 | — | WPS 兼容矩阵 | 人工 | ✅ | — | `docs/WPS-COMPAT.md` |
| A-020 | — | 代码块语法高亮写 docx | 自动断言 | ✅ | — | `test/segments/code-highlight.test.js` |
| A-021 | — | i18n 界面多语言 | 人工 | ✅ | — | `test/segments/i18n-registry.test.js` |
| A-022 | — | UX 体验批(进度/拖放/窗口与输入) | 自动断言 | ✅ | — | `test/renderer/renderer-pure.test.js` |
| A-023 | — | 暗色模式三态 | 自动断言 | ✅ | — | `test/renderer/settings-logic.test.js`、`test/renderer/dark-token-parity.test.js` |
| A-024 | — | 目录结构重组(GUI 回归) | 人工 | ✅ | 1.2.0 | 已实测 2026-08-24 |
| A-025 | — | 审计整改 + i18n 字典拆分 | 人工 | ✅ | 1.3.0 | 已实测 2026-08-24 |
| A-026 | — | 界面改进「布局稳定性」 | 像素基线 | ✅ | — | `test/tools/visual-check.mjs` |
| A-027 | — | 界面改进「设置抽屉化」 | 人工 | ✅ | — | 已实测 2026-08-24 |
| A-028 | — | 界面改进「反馈统一+空态导航+行降噪」 | 人工 | ✅ | — | 已实测 2026-08-24 |
| A-029 | — | 实测修复「响应式+滚动条+chip+主题过渡」 | 人工 | ✅ | — | 已实测 2026-08-24 |
| A-030 | — | 多语言精简(保留 zh/en/ja + 旧值迁移) | 自动断言 | ✅ | — | `test/main/settings.test.js` |
| A-031 | — | 图片控制增强(尺寸属性语法) | 自动断言 | ✅ | 2.1.0 | `test/segments/image-size.test.js` |
| A-032 | — | 表格列宽控制(dash 比例信号) | 自动断言 | ✅ | 2.1.0 | `test/segments/table-width.test.js` |
| A-033 | — | 标题排版粒度(字号/间距三档) | 自动断言 | ✅ | 2.1.0 | `test/segments/heading-scale.test.js` |
| A-034 | — | 页眉页脚自定义(三模式 + logo 内嵌) | 自动断言 | ✅ | 2.1.0 | `test/segments/header-footer.test.js`、`test/main/header-footer-settings.test.js` |
| A-035 | — | 界面重构 v3「印刷付梓」 | 像素基线 | ✅ | 3.0.0 | `test/tools/visual-check.mjs` |
| A-036 | — | 界面改版 v4「常驻文稿台」 | 像素基线 | ✅ | 3.0.0 | `test/tools/visual-check.mjs` |
| A-037 | — | 剪贴板直转 / 拖放增强 | 人工 | ✅ | 3.10.1 | 已实测 2026-08-29 |
| A-038 | — | 成书向导(七步 + 双格式封面) | 人工 | ✅ | 3.10.1 | 已实测 2026-08-29 |
| A-039 | — | 关于页更新提示(状态行/重试/三语) | 自动断言 | ✅ | — | `test/main/about-update.test.js` |
| A-040 | — | GUI 易用反制(预设扩面/向导补全/首启引导) | 人工 | ✅ | 3.10.1 | 已实测 2026-08-29 |
| A-041 | — | 关于窗沙箱与 CSP | 人工 | ✅ | — | 已实测 2026-09-25 |
| A-042 | — | 离线隐私文案区隔 | 人工 | ✅ | 3.12.0 | 已实测 2026-09-25 |
| A-043 | — | 阶段 1 GUI(单触发/取消/保存失败反馈) | 人工 | ✅ | 3.13.0 | 人工已实测 2026-09-26;自动断言见 `test/main/operation-single-flight.test.js` |
| A-044 | — | 阶段 4 GUI(冷启动/语言主题/键盘读屏/三尺寸) | 人工 | ✅ | 3.13.0 | 人工已实测 2026-09-26;自动断言见 `test/renderer/init-barrier.test.js` |
| A-045 | — | 题注 label 按 kind 分命名空间 | 自动断言 | ✅ | 3.13.0 | `test/segments/cross-ref.test.js` |
| A-046 | — | Mermaid 失败原因经既有 warning 通道上屏 | 自动断言 | ✅ | 3.13.0 | `test/main/mermaid-warning-channel.test.js` |
| A-047 | — | 权限弹窗端到端拒绝 | 人工 | ✅ | 3.13.0 | Chromium 无程序化触发 API,自动断言只覆盖 handler(`test/main/session-permission-deny.test.js`) |
| A-048 | — | 真实安装后用户视角 | 人工 | ✅ | 3.13.0 | 已实测 2026-09-26 |
| A-049 | — | 公式结构修复(方框/上下限/容器内公式) | 自动断言 | ⚠️ | 3.13.1 | `test/segments/math-structures.test.js`(结构已锁,观感待目视) |
| A-050 | — | 列表项公式对齐 + 引用块灰底连续 | 人工 | ⚠️ | 3.13.1 | 待测 A-050 |
| A-051 | — | 双击/连点只开一个原生文件窗 | 自动断言 | ✅ | 3.13.0 | `test/renderer/command-entry-guard.test.js` |

## 超限处理

到上限时**按功能域折叠**而非删行:同一功能域多行折为一行
`| A-04 | <被折叠各行的 ID,逗号分隔> | <功能域>(折叠 N 行) | — | — | — | 明细见 archive/… |` —— **`工作项` 列必填全部被折叠行的 ID,不得写 `—`**(写 `—` 会销毁上面「工作项列」的唯一映射)。**`ID` 保留不释放**,按 `ID` 展开可恢复原行。本矩阵全部行的工作项均为 `—`(历史未分配工作项号),故折叠行的该列同样为 `—`,以「被折叠 ID 列表」保留可追溯性。

## 矩阵编号台账

> `ID` 列已用最大值。**只增不减**:作废号留空不复用;加行时先改本行再插矩阵行。

矩阵编号台账：已用 A 000-051 ｜ 下一个 A-052
