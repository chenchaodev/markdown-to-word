# ADR-059 · dump 落点的取值钉靠已迁到清理器侧

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-02 |
| 更正 | [ADR-048](ADR-048-覆盖率产物并入output单源.md) **决定 4 括号内的理由**（「取值无 gate 侧对应物故不比对」）。**决定本身不变** —— `coverage-baseline.json` 的 `requireFlags` 仍只登记 `--temp-directory` 的存在性 |

## 决定

**一、`--temp-directory` 的取值现在有 gate 侧对应物，位置是清理器，不是覆盖率探针。**

`gates/artifacts/clean-artifacts.mjs` 的 `assertMatchesCoverageConfig()` **逐字**比对 `package.json` 的 `scripts.test:coverage` 里 `--temp-directory=<目录>` 的取值与冻结常量 `COVERAGE_TEMP_DIRS`（`{ c8: '.c8-tmp' }`），不一致即抛错**拒绝执行清理**;调用点在 `cleanCoverageTemp()`。它随 c8 dump 临时目录的清理开关一起落地。

**二、清理器侧那道断言的职责是「删除前挡漂移」，不是持续漂移检测 —— 它只在显式 `--coverage-temp` 时执行，这个形态是对的。**

实测可达性：`--coverage-temp` **无 npm script**、不在 `verify:ci` / `verify:release`、不在 `release.yml`（那里只跑 `clean:dist` / `clean:release`）、`test/` 下 0 处引用 ⇒ **只能人手直接调 `node gates/artifacts/clean-artifacts.mjs --coverage-temp`**。

这不构成缺陷：配置漂移只在**要删的那一刻**才要紧。若 dump 落点被改而常量没同步，那道断言会在删除动作之前抛错拒绝执行 —— 那正是它该出现的时刻。

**三、因此 ADR-048 决定 4 的结论不变；`coverage-gate.mjs` 刻意不覆盖 `--temp-directory` 取值这个决定也继续有效。**

不覆盖的理由从「没有对应物可比」改为「对应物在清理器侧，且**本面不读 dump 目录**」。把同一处取值在本探针里再登记一次，只会造出第二处跨文件、无人对读的登记文本 —— 清理器那份常量判不了这里的漂移。

## 背景

ADR-048 定于 2026-10-01。写下决定 4 的那一刻，「`--temp-directory` 只有存在性校验」是**事实** —— 当时全仓确实没有任何一侧钉它的取值。次日新增 c8 dump 临时目录的清理能力时，清理器为了「拒绝在配置漂移时删错目录」引入了那道取值断言，**顺手把这个事实推翻了**。

⇒ **旧 ADR 里的话不会因为事实变化而自动失效，只会在没人回头核对时一直假着。** 这条要记的不是「清理器多了一道断言」，而是「那道断言让一份已生效的 ADR 少了一半理由」。

## 后果

1. **ADR-048 决定 4 的正文不动**（已推送的决策不改写），只在其状态格标注理由已被本 ADR 更正。
2. **同一处失效理由在仓内共有四个落点，全部同步更正**，口径由本 ADR 统一 —— 漏一处就等于那处还在说假话：

   | 落点 | 载体 |
   |---|---|
   探针注释（① 段） | `gates/probe/gate-probes/coverage-gate.mjs` |
   探针注释（⚠ 段） | 同上 |
   基线 `note` | `gates/probe/gate-probes/coverage-baseline.json` |
   夹具的失败文案 | `test/gates/coverage-gate.test.js` |

   `gates/repo/repo-manifest.mjs` 也提到 `.c8-tmp`，但那是讲隐藏项不探内容的性能取舍，**与本议题无关**，不在此列。
3. **判据不重复**：同一处取值只在一侧钉。将来若有人要在探针里补 `--temp-directory` 的取值比对，本 ADR 是反对依据。

## 不做

- 不给 `coverage-baseline.json` 的 `requireFlags` 补取值比对（理由见决定二）
- 不动 ADR-048 的正文与任何其它决定
- 不动覆盖率探针的判红行为