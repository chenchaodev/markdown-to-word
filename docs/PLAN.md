# 波次 1 — 五条低风险并行

> 本文件是**波次 1 的唯一状态载体**，主会话写。五条泳道并行推进，**均不写** `docs/PLAN.md` · `docs/REQ.md` · `docs/LOG.md` · `docs/large/**`，也不做任何 git 写操作。
> **验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」节（本文件不复述命令）。

## 相关 ADR（一行结论）

- [adr-020](adr/adr-020-文档体系迁移.md) —— 归档目录划为「只读历史层」；**1b 要重划这条边界**（旧条不改动，边界反转以新 ADR 标「部分被取代」）
- [adr-024](adr/adr-024-设置分组与渲染前变换层下沉.md) —— 设置 6 分组形状单源于 core；**1a 的工厂放 core 即遵此条**
- 全局配置目录门禁两条：`node tools/check-pointers.mjs` · `node --test tools/ledger.test.mjs`（**1c 在仓外跑这两条**）

## 目标

五条互不重叠的泳道各自闭合一条台账项。全部行为等价或纯门禁增强，**无用户可见变化 ⇒ 本波不写 CHANGELOG**。

## 五条泳道

| 泳道 | 工作项 | 目标 | 可写文件 | 验证方式 |
|---|---|---|---|---|
| 1a | REQ-081 | 共用 `cloneDefaultSettings()` 工厂；6 个分组块全部独立对象 | `src/core/settings/settings-defaults.ts` · `src/renderer/state/state.ts` · `test/main/converter.test.js` · `test/renderer/wizard-open-sync.test.js` · `test/renderer/settings-logic.test.js` | typecheck + lint + 筛段 `converter,wizard-open-sync,settings-logic` |
| 1b | REQ-071 | 修台账 4 处 + 同类死链；重划只读层边界 | `docs/adr/**` · `docs/archive/**` 指针 | `check:docs` + `check:archive-index` |
| 1c | REQ-073 | 全局门禁加「跨仓路径」一档 + CI 不可达豁免 | **仓外** `C:\Users\chenc\.config\opencode\tools\check-pointers.mjs` | 全局仓两条门禁 + 本仓 `check:docs` 对故意死指针判红 |
| 1d | REQ-075 | 截图落定判据：14 处固定 `wait` → 状态表达式 | `test/tools/visual-check.mjs` | typecheck + `ui:shots` 连跑 3 次产物一致 |
| 1e | REQ-057 | 复现并定位计数类时序 flake | `test/main/image-downloader.test.js` · `src/main/services/image-downloader.ts` | typecheck + lint + 筛段 `image-downloader` |

## 下一步

派发五条泳道（后台并行），等全部返回后逐条核对退出条件并回填 [large/01](large/01-非功能需求排期.md) 波次 1 的「结果」列。

## 完成标准

1. 五条泳道各自的退出条件逐条满足，且各自门禁命令实跑通过（结果写进 [large/01](large/01-非功能需求排期.md) 波次 1 结果列，**空 = 未跑**）。
2. 1c 在本仓实测能对**一条故意造的跨仓死指针**判红 —— 先证伪再信绿，且未破坏其他仓的既有行为。
3. 1b 的边界重划落成 ADR（若属反转旧「决定」则新立一条并把 adr-020 标「部分被取代」；若只是澄清「后果」则就地追加，**不改 adr-020 的「决定」节**）。
4. `npm run check:docs` 与 `npm run check:archive-index` 双绿，且台账五类状态计数与实际行数一致。
5. 五条在 `docs/REQ.md` 全部落「已完成」，判断依据在 [LOG.md](LOG.md) 有收尾补记。

## 修复项复测

（待填：本波实测中若发现新缺陷，在此登记并复测。）
