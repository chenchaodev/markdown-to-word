# ADR-023 · ConvertWarning.params 的键不得同名异型

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-09-27 |

> 取号与字段骨架见 [README.md](README.md)（一决策一文件，号不复用；本文件不改动正文，只由新文件声明取代关系）。

## 背景

触发事件是本轮的一个具体缺陷（同文件「触发事件」行）：给「代码围栏未闭合」加告警时，规格写的是「报出起始行号」，实现沿用了键名 `line`；而既有的「形似表格」告警里 `line` 已是**字符串**（行内容，要回显给用户）。同一个键在两条告警上类型不同不是风格问题 —— `params` 经 `formatWarning` 流向 renderer 插值，渲染层一旦写 `String(w.params.line)`，在表格告警上正常、在围栏告警上会把行号当文本印出来。本条据此定下「键名自带类型语义」的纪律，两处都改为 `lineNo`（number）与 `lineText`（string）。来源：本轮实现过程中的实测缺陷（规格与既有告警键名冲突），本条未记录具体会议或人名。

## 决定

### 2026-09-27 `ConvertWarning.params` 的键不得同名异型(ADR-023)

- 决定：`ConvertWarning.params`（core → main → renderer 的跨进程数据形状）的**同一个键名在任何两条告警上必须是同一语义、同一类型**。落成两条硬要求：① 键名自带类型语义（`*No` = 行号/数字，`*Text` = 文本内容，`*Name` = 名称），不使用裸 `line` / `value` 这类可承载多型的名字；② 新增告警若要复用一个既有键名，必须先核对既有那条的类型与语义。
- 触发事件：本轮给「代码围栏未闭合」加告警时，规格写的是「报出起始行号」，实现沿用了键名 `line`；而既有的「形似表格」告警里 `line` 已是**字符串**（行内容，要回显给用户）。于是同一个键在两条告警上类型不同 —— 这不是风格问题：`params` 经 `formatWarning` 流向 renderer 插值，渲染层一旦写 `String(w.params.line)`，在表格告警上正常、在围栏告警上会把行号当文本印出来。已拆为 `lineNo`（number）与 `lineText`（string），两处都改而不是只改新的那条（只改新的会留下 `line` / `lineNo` 这种近似名，读者仍要靠猜）。
- 备选与后果：
  - **只改新告警那条**（`line` → `lineNo`）—— 否决。近似名不比同名异型好读，且问题只被推后而非消除。
  - **把 params 收进各告警自己的类型**（如 `fence: { lineNo }` / `table: { lineText }`）—— 否决。`params` 是 i18n 插值的通用通道（`tByKey(key, params)`），按告警分支会让插值层要认识每条告警的结构；键名自带类型语义就能在不改结构的前提下消除歧义。
  - 后果：`src/core/i18n/{zh,en,ja}.ts` 三语言占位符同步改名（占位符集合一致性由 `i18n-registry` 段守护）。已确认 `src/renderer/**` 与 `src/main/**` 都不直接读 `params` 键名（只经 `formatWarning` 插值），故无连带改动。
- **遗留的同族问题不在本决策范围内**：`kind` 一名两义（`crossRefNotFound` 是中文类别词且 en/ja 刻意省略占位符，`pathScanLimit` 是触顶维度且 en/ja 保留占位符）—— 同名同型，但**翻译口径相反**，属既有代码，已单独登记待拍板，不在本文件处置。
- 关联：`src/core/pipeline/precheck.ts` · `src/core/i18n.ts`（`formatWarning` / `KeyedWarning`）· `test/segments/precheck.test.js` · `test/segments/i18n-registry.test.js`
