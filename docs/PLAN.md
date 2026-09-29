# 波次 6 — 源文本断言转行为断言（REQ-083）

> 本文件是**波次 6 的唯一状态载体**，主会话写。执行方**不写** `docs/**` 任何文件，也不做任何 git 写操作。
> **验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」节（本文件不复述命令）。

## 相关 ADR（一行结论）

- [adr-030](adr/adr-030-水印与页眉裁决及矩阵补行.md) —— 「逐控件基线」与「几何门禁」的记账先例；本波沿用其「判据落链内、截图降为目视辅助」取向
- 本波**不建 ADR**：不动 `src/` 的行为面，不改对外接口；②③ 并入既有门禁脚本的判据面（同一门禁内部扩展职责，非新增门禁）

## 目标

把 `test/renderer/ui-interaction-guards.test.js` 的 **5 条源文本断言**（实为 5 条不是 4 处 —— 第 ③ 条是 3 条正则）改成能真正判红的行为断言。

- `:592` ④ `index.html` convert 分组 HTML 包含关系 → 留原段
- `:652` ② `base.css` 的 `.hidden` 必须带 `!important` → **并入 `check:geometry`**
- `:661` ① `applyStaticTexts()` 须在 `refreshDynamicSettingsText()` 之前 → 留原段。**被读的源是 `src/renderer/settings/settings-bindings-app.ts:48→51`**，台账原写 `settings-panel.ts` 是错的
- `:670-684` ③ `dialogs.css` 配色 ×3 → **并入 `check:geometry`**

## 📌 ②③ 的去处（2026-09-30 用户裁决）

**并进 `check:geometry`** —— 它已在 `verify:ci` 链内且已有控件门控面（40 个控件），最省一个载体。**代价已知**：该门禁职责由「几何」扩到「CSS 令牌恒等」，**必须在头注写清扩展理由**，否则下任会误用其范围。**不新建 token 恒等测试段**（零注册自动发现下新增段会进全量耗时）。

## 下一步

等执行方返回后逐条核对完成标准，回填 [large/01](large/01-非功能需求排期.md) 波次 6 的「结果」列。**本波是整轮最后一波** —— 它落地后进入整轮收尾。

## 完成标准

1. **5 条断言全部脱离源文本形态**，逐条说明新判据。
2. **每条都验「删掉被守护的行为后能红」**，贴「变坏后红」与「还原后绿」两次输出。⚠️ 本仓踩过两次「断言恒真」（步 03-0 与 REQ-080：DOM stub 的 `classList` 初值自带 `hidden`，**把门控整个删掉测试仍绿**）—— 只报绿不算。
3. `check:geometry` 头注已写清职责扩展与理由。
4. `npm run check:geometry` · `npm run typecheck` · `npm run lint` · 筛段 · **`npm run test` 全量** 全绿。**全量不得省**（动了 `scripts/` 与 `test/`）。
5. **源侧零改动优先**：①④ 若只改测试就达成，**不要改 `settings-bindings-app.ts` 或 `index.html`**；确必须改源时说明为什么（属行为面变化，要另记 CHANGELOG）。

## 修复项复测

（待填。）

## 并行约束

本波为最后一波，与前五波无并行关系。**整轮收尾在波次 6 之后**。
