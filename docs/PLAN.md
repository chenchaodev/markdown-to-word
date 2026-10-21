# REQ-001 中文排版包深化（中文字号制 + 中英混排间距）

> 开工只需读这三处：相关 ADR 给约束，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

- `docs/adr/ADR-014`：双管线保持独立 —— 共同语义抽成共享纯函数（`src/core/settings/typography.ts`），差异由差异矩阵锁住；本条**不改 docx 渲染**（见下方「docx 侧零改动」）。
- `docs/adr/ADR-034`：两种规模都由 `docs/PLAN.md` 承担（`docs/large/` 已取消）。
- `docs/adr/ADR-028`：持久化 schema 表 —— 本条**不新增持久化键**（字号制是 UI 投影，混排间距常开不设开关）⇒ schema / 预设 / 校验域 / 号段一律不动。
- `docs/adr/ADR-077`：设置抽屉六组边界不动；新控件落在 02 排版组内（落位依据 `docs/design/settings-ia.md` §2 的 02 组第 6 项）。
- `docs/adr/ADR-065`：renderer 四功能目录互不 import —— 主面板与向导各自读 core 的字号表，彼此不引。
- `docs/adr/ADR-047`：CHANGELOG 只写「有意义且别处查不到」的变化。

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处，本文件不复制。

**派发**：core+PDF 泳道 已派 fix-1 · UI 泳道 已派 des-1 · 测试泳道 待派

## 目标

用户在设置面板排版组选「中文字号」即可按号数制（小五…小一）设定正文字号，选中即生效且仍可用 ±0.5 微调；导出的 PDF 与 Word 在中西文、中数字之间自动留出间距，行首开引号不多占半个字宽 —— PDF 与 Word 默认观感一致。

## 下一步

把 `src/core/settings/typography.ts` 的中文字号表与两个反解纯函数落地，并让 `src/core/pdf/template-css.ts` 的 body 规则带上 `text-autospace: normal` 与 `text-spacing-trim: trim-start`，改完跑 `npm run typecheck` 与 `npm run lint`。

## 完成标准

- [ ] 中文字号表（9 档，小五 9 → 小一 24）与两个反解纯函数在 core 落地并有断言；自动断言见 `test/core/typography.test.js`
- [ ] 设置面板与向导的「中文字号」下拉：选中即写 `bodySizePt`、磅值命中表项即回显名称、命中不到显示「自定义」；自动断言见 `test/renderer/`（文件名由实现方定，须在该段声明 `covers`）
- [ ] PDF 模板 CSS 产出 `text-autospace: normal` 与 `text-spacing-trim: trim-start`；自动断言见 `test/core/dual-pipeline-matrix.test.js`
- [ ] `docs/CHANGELOG.md` 的 `[待发版]` 段记两条用户可见变化（PDF 中西文间距 / 行首标点缩排）与字号制入口
- [ ] 人工实测：导出 PDF 打开后，中英混排处有间距、行首「不多出半个字宽

## 修复项复测

- [ ] 无
