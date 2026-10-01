# ADR-038 · gates / test / shared 三层与跨树边界

| 项 | 值 |
|---|---|
| 状态 | 部分被 [ADR-043](ADR-043-树边界规则allowlist与shared零跨树出边.md) 取代（**只把表中 `shared/**` 的「无（零出边）」精确为「零跨树出边」**；三层划分 · 其余四条规则 · `test/fixtures/` 只读数据一条不动）；另「不产生断言的产物生产与人工目检分列 `build/` 与 `dev/`」一句中 `clean-artifacts` 的归属部分被 [ADR-049](ADR-049-工具函数下沉shared与clean-artifacts归位.md) 取代（它断言打包配置，已归 `gates/artifacts/`），同一句的两树分列本身部分被 [ADR-050](ADR-050-顶层build与dev合并为tools.md) 取代（`build/` 与 `dev/` 合并为受管树 `tools/`）—— **正文表格内容按规矩未改动** |
| 日期 | 2026-09-30 |
| 取代 | 无 |
| 关联 | [ADR-037](ADR-037-顶层与扫描面一律派生.md) · [ADR-039](ADR-039-门禁自检判据与探针必填.md) · [REQ-110](../REQ.md) |

## 决定

仓库顶层按**断言对象**分三层，并加一条机械边界规则：

| 层 | 断言什么 | 允许 import |
|---|---|---|
| `src/` | 产品代码（`core` → `main` → `renderer`，8 条既有规则不变） | 仅 `src/**` |
| `test/` | 产品行为 | `dist/**`（编译产物）· `shared/**` · `gates/**`（仅驱动器级） |
| `gates/` | 仓库 / 产物 / 流程状态 | `gates/**` · `shared/**` · `test/fixtures/**`（只读数据） |
| `shared/` | 纯机制，**零出边** | 无 |

`scripts/` 改名为 `gates/` 并按断言域分子目录（`repo/` `artifacts/` `coverage/` `fixtures/` `geometry/` `supply/` `smoke/` `probe/`）；不产生断言的产物生产与人工目检分列 `build/` 与 `dev/`。

`test/tools/` 整个取消，每个文件按 [ADR-039](ADR-039-门禁自检判据与探针必填.md) 的跨树 import 事实归位。`test/segments/` `test/main/` `test/renderer/` 三目录**保持扁平**，不再分子目录。

## 背景

`test/` 与门禁树之间存在 **9 条跨树 import**，全部指向纯机制，没有一条指向测试：`scripts/check-geometry.mjs:96` 与 `smoke-proc.mjs:25`、`check-temp-cleanup.mjs:77`、`scripts/geometry/{driver,worker,orchestrator}.mjs` → `test/tools/geometry/{geometry-core,geometry-spec,geometry-page}`、`test/tools/visual-check.mjs:39` → `test/common/entry-guard.mjs`。

也就是说**一个「共享机制」层已经隐含存在，只是没有名字**，它的成员被散落在 `test/common/` 与 `test/tools/`。后果是 `test/` 同时是测试目录和生产门禁的依赖源，而 `scripts/check-import-boundary.mjs` 的 `LAYER_RULES` 8 条规则 scope 全在 `core`/`main`/`renderer`/`preload`/`smoke`，**没有一条 scope 是 `scripts/`** —— 这条依赖既不被守护也不被承认。

其中 `test/tools/geometry/geometry-core.mjs` 是 840+ 行的门禁唯一裁决实现，被 `scripts/geometry/` 三个文件 import。它与 `scripts/geometry/` **不是重复实现**：判据单源在 `geometry-spec.mjs`，scripts 侧只做采样与编排（`check-geometry.mjs:61` 明写「同一套 tolPx」跨缩放档复用）。合并两者会废掉跨档复用不变式。

`src/` 的 8 条机械规则已存在且实测有效（`core` 出边 0 条），本条是把同一种「用机械规则而非约定锁住分层」的做法扩到另外两层。

## 备选方案

| 方案 | 不选的理由 |
|---|---|
| 保持 `scripts/` 现状，只把 `test/tools/` 清空 | 跨树 import 的根因是缺一层，不是杂物抽屉。只清 `test/tools/` 会留下 `scripts/ → test/common/` 那 3 条边，且留下「门禁没有边界规则」这个原状 |
| 把 `test/tools/` 整体并入 `scripts/` | 会把 `smoke/smoke.mjs`（1 行 `export { runSmoke } from "../../../dist/main/smoke.js"`）与 `electron-mock.mjs` 这类测试 harness 混进门禁树，问题从「缺一层」变成「两层都混」 |
| 不设 `shared/`，让 `test/common/` 兼任 | `shared/` 只有 8 个文件，但它的价值是给那 9 条跨树 import 一个**合法名字**。砍掉它，边界规则的第 2 条就写不出来 —— `gates/` 仍会 import `test/common/`，只是换个说法 |
| 给顶层目录改用更好听的命名（如 `tools/` `quality/`） | 纯偏好，且**会让部分文件的职责名不符实**：`clean-artifacts` / `copy-renderer` / `svg-to-ico` / `visual-check` 都不 assert 任何东西，叫 `gates/` 是用好听的名字换掉准确的 `scripts/`。本仓 32 条 `check:`/`gen:` script 已形成强命名习惯，改名收益为负 |
| 测试改为 colocated（与源码同目录） | **物理不可行**，不是成本高。`tsconfig.json` 无 `allowJs`（`eslint.config.js:39` 已记载）⇒ 放进 `src/` 的 `foo.test.js` 被 tsc 静默忽略 ⇒ 不进 `dist/**`（唯一被 `build.files` 收的目录）⇒ 测试 import 不到它；`test/acceptance.mjs` 的发现范围也不含 `src/`。结果是**既不编译、也不被发现、也不进包 —— 不会报错的那种失效** |
| 给 `test/segments/` 再分子目录 | 三目录恒等已被三处锁定（`acceptance.mjs:43` 非递归发现、`gen-fixtures.mjs:5` 同构 scan、`fixture-contract.test.js` 断言）。89 段扁平是**被守卫的属性**，不是待清理的杂乱 |
| 把 `check:contract` 的自检并进 Electron 验收段 | 物理约束：`verify:ci` 的第 1–2 步必须在 `build` 之前、`dist` 不存在时、验收 harness 本身坏掉时仍能运行 —— 它守的是整条门禁链。约束的是**驱动器**，不是门禁逻辑 |

## 后果

- `gates/` 对 `test/{segments,main,renderer,common}/` 的 import 面归零（只剩 `test/fixtures/` 只读数据）。这条规则可由 `check-import-boundary.mjs` 机械判定，判红机制零新建 —— `test/segments/import-boundary.test.js:560` 已在造假源码喂给 boundary 判红，模式现成。
- `test/tools/` 消失后，「两个 geometry」「`test/tools/` 是杂物抽屉」在结构上不再存在。
- 新增顶层 `shared/` 会改变 `build.files` 白名单的覆盖面：现状只断言 asar **产出后**的顶层三项，**没有断言白名单里的项与实际目录一致**。「显式白名单」这个正确选择因此只做了一半，本决定顺带要求补这一条断言。
- 一次性改动面很大（约 70 个文件位置），必须每步独立成提交才能逐步回滚。步序与泳道原在临时载体 `PLAN.md`，REQ-110 收尾时已删（当前态见 `docs/REQ.md` 的 REQ-110 行，历史见 git）。
- `test/common/` 19 个文件里只有 3 个真跨树，其余 16 个零跨界证据留测试树 —— 本决定**不做主观再切分**，避免把「整齐」误当成收益。