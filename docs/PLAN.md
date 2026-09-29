# 波次 4 — frontmatter 单次解析（REQ-069）

> 本文件是**波次 4 的唯一状态载体**，主会话写。执行方**不写** `docs/**` 任何文件（**含 ADR —— 那一条由主会话落**，执行方只交四要素），也不做任何 git 写操作。
> **验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」节（本文件不复述命令）。

## 相关 ADR（一行结论）

- **待建一条**（改 `PreprocessedMarkdown` 类型与 `convert` 签名 ⇒ 命中涉架构「改对外接口」，**开工即建、不等收尾**）。执行方交四要素：决定 · 背景 · 备选方案（至少一个被否决 + 理由）· 后果行 · **不做项**
- [adr-026](adr/adr-026-阶段契约落在core分派点.md) / [adr-027](adr/adr-027-窄契约携带主开关.md) —— core 侧契约形状与分派纪律的先例，新 ADR 须与之口径一致
- [DEV-GUIDE.md](DEV-GUIDE.md)「架构」节 —— **本步改的 `core/convert.ts` 正是文档写明的格式注册表与扩展点**（「未来扩展格式只需在 `core/convert.ts` 注册表登记 renderer」）。改它的签名要一并核对那句话是否仍然成立，并按需更新

## 目标

单文件转换路径上 frontmatter **只解析一次**：已解析结果由 main 透传给 core，`convert` 不再自己 `parseFrontmatter`。

- 台账原推迟理由是「与 schema 步耦合」，**该耦合已随 REQ-061 步 04 解除**
- **不得顺手扩大**：`parseFrontmatter` 另有 3 个消费者不走 `convert`（`pipeline/merge.ts:72` · `markdown/ai-cleanup.ts:81`），本步不统一 → 写进 ADR 不做项

## 步内待决

`src/main/windows/preview.ts:63` 当前**不传 metadata**。改形状会暴露「预览缺失 frontmatter metadata」这一既有差异 —— 开工先查清是有意还是缺陷；若与本步正交，**不顺手改**（那是另一次行为变更）。

## 下一步

等执行方返回后逐条核对完成标准，取其四要素**立即落 ADR**，再回填 [large/01](large/01-非功能需求排期.md) 波次 4 的「结果」列。

## 完成标准

1. 单文件转换路径上 `parseFrontmatter` **只跑一次**，且有**可验证的判据**（计数探针或断言），不是只靠读代码。
2. 10 个测试文件跟改而**断言本身无需改动**（行为等价的举证）；若某处必须改断言，说明那处为何不属行为等价。
3. ADR 已落（开工即建，不等收尾），含四要素与「不做项」；`DEV-GUIDE.md` 那句关于 `core/convert.ts` 作为扩展点的表述按需核对。
4. `npm run typecheck` · `npm run lint` · 筛段 · **`npm run test` 全量** 全绿。**全量不得省** —— 改 core 签名跨段跟改；且上一波正是「只跑筛段就提交」把两处下游断言漏到下一提交才暴露。
5. `docs/REQ.md` 落「已完成」且判断依据有收尾补记。

## 修复项复测

（待填。）

## 并行约束

波次 4 / 5 / 6 **串行**。波次 5 必须排在波次 4 之后 —— 两者同改 `test/segments/dual-pipeline-matrix.test.js`。三者都改 `src/`，而 `npm run test` 自带 `build` ⇒ `dist/` 是共享可变状态，**文件不重叠 ≠ 无冲突**。
