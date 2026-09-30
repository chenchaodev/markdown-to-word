# 仓库自描述与门禁三层重组

> 开工只需读这三处：相关 ADR 给约束，验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

开工时把相关 ADR 的「一句话结论」抄进来，目的是让结论进入上下文；抄完即可，ADR 原文不动。

- `docs/adr/ADR-037`：顶层与扫描面一律从实际内容派生，任何一处不得枚举（待写，见 #00）
- `docs/adr/ADR-038`：`gates/` `test/` `shared/` 三层与跨树边界；`shared/` 零出边（待写）
- `docs/adr/ADR-039`：门禁自检的两条判据 —— 跨树 import 事实 + 探针必填属性（待写）

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处，本文件不复制；那里也只写命令、不写结果。

## 目标

新增一个目录时不再需要同步手改若干处清单，且任何门禁失去自检会立刻变红。

## 下一步

在 `shared/paths.js` 建立项目根与夹具路径的单源，把全仓 26 处 `new URL('..')` / `import.meta.dirname` 自算改为 import 它，并在 `scripts/check-import-boundary.mjs` 加一条规则「出现自算根路径即判红」，改完跑 `npm run check:boundary` 与 `npm run check:contract:selftest`。

## 完成标准

- [ ] 全仓零自算项目根；`check-import-boundary.mjs` 对造出自算根路径的样例判红，自动断言见 `scripts/check-ci-contract.selftest.mjs`
- [ ] 6 处顶层枚举与 4 处测试目录清单全部改派生；新增任意顶层目录不被静默漏扫
- [ ] `9 条 gates/ → test/ 跨树 import` 归零（`test/fixtures/` 只读数据除外），边界规则见 `scripts/check-import-boundary.mjs`
- [ ] 7 项无自检门禁全部补齐（`transform-dispatch` / `test-numbering` / `temp-cleanup` / `docs` / `archive-index` / `contract` / `coverage-zero`）
- [ ] `test/tools/` 清空，跨树文件按「是否存在来自门禁树的 import」判入 `shared/` 或 `gates/`

## 修复项复测

- [ ] 若本次修复涉及的回归项，在这里列出并复测通过；无则写「无」

---

<!-- ===== 以下三节仅「大型需求时才加」，单任务到「修复项复测」为止 ===== -->

## 步序与泳道

<!-- 泳道表只在这里有 —— 别处不留副本。派并行写者时按「可写文件」列切互不重叠的范围。 -->

| 步 | 工作项 | 目标 | 可写文件（不重叠） | 退出条件 | 门禁 | 结果 |
|---|---|---|---|---|---|---|
| #00 | REQ-110 | 三份 ADR 落盘（决策已被四条核实钉死，先立后动） | `docs/adr/ADR-037*` `ADR-038*` `ADR-039*` | 三份齐备且互相无矛盾 | `npm run check:docs` | 未开始 |
| #01 | REQ-110 | 根路径收口单源 + 禁自算门禁 | 新建 `shared/paths.js`；改 import 的 26 处；`scripts/check-import-boundary.mjs` | 全仓零自算；新规则对造坏样例判红 | `npm run check:boundary` | 未开始 |
| #02 | REQ-110 | 补 4 项门禁自检缺口（可与 #01 并行） | 4 个新 `scripts/*.selftest.mjs`；`package.json` | 每个 selftest 对造坏样例判红，接进链后仍绿 | `npm run verify:ci` | 未开始 |
| #03 | REQ-110 | 顶层清单派生，`clean-artifacts` 转 fail-closed | 新建 `gates/manifest.mjs`；`scripts/clean-artifacts.mjs`；`scripts/gate-probes/contract.mjs`；其余枚举点 | 新增顶层目录 0 处静默降级 | `npm run verify:ci` | 未开始 |
| #04 | REQ-110 | 扫描面合并单源；下限语义改等式 | `scripts/check-test-numbering.mjs`；`scripts/check-temp-cleanup.mjs`；`test/acceptance.mjs`；`test/tools/gen-fixtures.mjs` | 声明数 ≠ 实测数即红 | `npm run verify:ci` | 未开始 |
| #05 | REQ-110 | 建 `shared/` 层，迁入跨树纯机制 | 新建 `shared/`（迁入 `entry-guard` / `copy-closure` / `userdata` / `geometry-{core,spec,page}` 等）；改 9 条跨树 import | 跨树边归零 | `npm run check:boundary` | 未开始 |
| #06 | REQ-110 | 边界规则升 5 条 | `scripts/check-import-boundary.mjs`；其 selftest | 造假源码被判红 | `npm run check:boundary` | 未开始 |
| #07 | REQ-110 | 目录重组：`scripts/` → `gates/` `build/` `dev/` | 见 #05 迁入后的空目录；门禁按域分子目录 | 顶层无 `scripts/`，语义按判据归位 | `npm run verify:ci` | 未开始 |
| #08 | REQ-110 | 门禁统一 `check(ctx)` 协议 + 探针必填化 | 各门禁实现；`scripts/gate-probes/` | 缺探针即红 | `npm run verify:ci` | 未开始 |

并行约束：`#01` 与 `#02` 可同时派（写范围不重叠）。`#03`→`#04` 有先后（都消费 `#01` 建立的单源）。`#05`→`#06`→`#07` 必须串行（同一批文件）。`#08` 放最后，避免与目录搬动交叉。

## 整体完成标准

- [ ] 完成标准 5 条逐条划完，且 `verify:ci` 全绿、`npm run check:docs` 通过；三条否决理由（不改顶层名 / 不 colocated / 不给 `scripts/` 补 `@ts-check`）已作为「备选方案」落进 ADR-037 / 038 / 039

## 怎么回滚

八步各自独立成提交，逐步 `git revert <sha>` 即可，不改写历史。目录重组（#05~#07）若需整体退回，因 `build.files` 白名单与 asar 顶层断言同批改动，回滚须三步同 revert 才回到可打包状态 —— 已在提交单元里把 #05 / #06 / #07 各留一个独立提交以便选择。物理约束：`src/` 与 `dist/` 不在本需求触及范围，回滚不影响编译产物形态。