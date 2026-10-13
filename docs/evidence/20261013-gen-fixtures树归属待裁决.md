# gen-fixtures 的树归属:一条已记录但未执行、且现已站不住的决策

> 结论去向:落 REQ.md 行
> 落点:`docs/REQ.md` 的 REQ-209 行「什么条件下重看」列(该问题随 209 第二步落地一并裁决)。
> 本文件是**待裁决问题的取证**:记录问题、已记录的旧决策、它为何站不住、深层成因、候选去处与各自代价。
> 日期:2026-10-13。提问方:用户;取证为只读,未落盘改动。

## 问题

`gates/fixtures/gen-fixtures.mjs` 放在 `gates/`(门禁树)是否合适?该树放的是**判据**(跑一次、要么绿要么红、不改任何东西)。

## 一条已记录但一直没执行的旧决策

`docs/adr/ADR-062-…md:185`(P3 行)逐字写着:

```
| `gates/fixtures/gen-fixtures.mjs` | **移位** `samples/gen.mjs`;删 100% 声明强制与 `SEGMENT_EXEMPTIONS` 双向自检 |
```

⇒ **本仓早已判过它不该留在 `gates/`**,只是这条 P3 计划从未执行到这一行。本文件记录的是「它为什么至今没动」与「现在该不该照它动」。

## 那条旧决策现在站不住:目标位置会撞门禁

- `gates/repo/check-samples.mjs:17` 原文:「『md 里有代码块』与『树里有 .mjs 文件』是**两件事**:前者是样例内容,后者是**代码落错了地方**」⇒ `samples/` 有一道判据**专拒代码文件**,把 `.mjs` 移进去会当场判红。
- 移位还要连带改四处:`check:fixtures` 在 `gates/repo/check-ci-contract.mjs:302` 的 `REQUIRED_CI_STEPS` 里(删/移即链缺步判红)、`gate-index.mjs:247-253` 的 `fixtures` 族、`check-copy-sites.mjs:116-120` 白名单、`check-test-layout.mjs` 的段名册登记。

⇒ 旧决策的**方向**(不该留在 gates/、是工具不是判据)大体成立,但**目标位置 `samples/` 是错的**——样例数据树不该装工具。

## 深层成因:这个文件是「双头」的

它同时干两件身份相反的事:

| 半边 | 行为 | 身份 | 事实 |
|---|---|---|---|
| `npm run gen:fixtures` | **写** 37 个产物 | 生产者 / 工具 | `gen-fixtures.mjs:490-508` 落盘 |
| `npm run check:fixtures --check` | **判**产物漂移 | 消费者 / 门禁 | `:431-488`;且它是 `REQUIRED_CI_STEPS` 成员(`check-ci-contract.mjs:302`) |

⇒ 「放不放进 gates/」这个问题之所以难答,是因为它在问一个**双头文件**的身份,而 `gates/` 这棵树的语义只对其中一半成立。

## 209 两步拆解正在把这个双头解开

- **第一步(已完成)**:图片字节基线 + 「null 合法终态」判据 → `gates/fixtures/check-image-digests.mjs`
- **第二步(实施中)**:契约校验 + 段发现 → `gates/fixtures/check-segment-contracts.mjs`

第二步落地后,`gen-fixtures.mjs` 剩下的只有**产物面**:产物名规则(`planFixtureOutputs`)、撞车检查(`findOutputNameCollisions`)、README 索引(`buildReadme`)、落盘、`--check`。到那时它是一个**自洽整体**:生成自己那份产物 + 判自己那份产物漂移,不再夹带别人的判据 ⇒ **双头问题自然消解**,那时才谈得上给它定位置。

## 候选去处与各自代价(待第二步落地后裁决)

| 候选 | 代价 |
|---|---|
| 移 `samples/gen.mjs`(旧决策原案) | ❌ 撞 `check-samples` 拒代码文件判据;样例树装工具语义错 |
| 移 `tools/` | `tools/` 现装一次性工具(`copy-renderer`/`svg-to-ico`/`where.mjs`/`visual-check`…),生成器半边正属此类 ⇒ 身份相符;但 `--check` 那半是门禁,移到 `tools/` 会让门禁索引的语义变别扭,且 `tools-stay-in-tools` 零跨树出边约束可能与段 import 冲突(需实测) |
| 拆开:生成器去 `tools/`,`--check` 留成 `gates/` 薄门禁 | 语义最干净(生产者与消费者分居两树),但要拆一个文件 + 改四处登记 + 新增门禁载体,改动面最大 |

## 约束:此刻不能动

**第二步(`fix-14`)正在改 `gen-fixtures.mjs`**。在它改一半时搬文件的家 = 并发写同一文件 ⇒ 结果不可归因。⇒ 本问题**等第二步落地、209 整条收掉之后**再裁决,届时以上三个候选按第二步的实际剩余内容重评。

## 已核实的事实清单(供裁决时直接引用)

- `ADR-062:185` 原文如上(旧决策存在且未执行)
- `check-samples.mjs:17` 「代码落错了地方」(samples 拒代码文件)
- `check-ci-contract.mjs:302` `REQUIRED_CI_STEPS` 含 `check:fixtures`(移位即链缺步)
- `gate-index.mjs:247-253` `fixtures` 族指向该模块
- `check-copy-sites.mjs:116-120` 白名单含该文件
- `tools/` 现有成员:`copy-renderer.mjs` · `svg-to-ico.mjs` · `where.mjs` · `visual-check.mjs` · `renderer-coverage-report.mjs` · `req-edit.mjs` · `setup-env.ps1` · `icon.svg/.ico`(一次性工具/资源)
- `gates/` 五棵子树:`artifacts/` · `fixtures/` · `geometry/` · `repo/` · `smoke/` · `supply/`(全为判据)
