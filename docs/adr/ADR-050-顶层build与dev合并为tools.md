# ADR-050 · 顶层 `build/` 与 `dev/` 合并为 `tools/`，并补树边界规则

| 项 | 值 |
|---|---|
| 状态 | 部分被 [ADR-062](ADR-062-测试树位置即身份与门禁元框架瘦身.md) 取代 —— 只取代其「两树合并为受管树 `tools/`」的**后果面**：`tools/visual-check.mjs` / `visual-preload.cjs` / `visual-about-preload.cjs`（实测这三件是 geometry 门禁的页面探针，与门禁共用 `shared/geometry/geometry-spec.mjs` 的视口口径与 preload 前缀）迁入 `gates/geometry/`。`copy-renderer` 留在 `tools/`、`tools-stay-in-tools` 树边界规则、路径常量存活性断言一条不动。**正文按规矩未改动** |
| 日期 | 2026-10-02 |
| 取代 | **部分取代 [ADR-044](ADR-044-工具树不纳入树边界治理改由路径常量存活性断言看守.md)** —— 只取代其「工具树（`build/` `dev/`）不纳入树边界治理」这一结论；路径常量存活性断言（`driver.mjs` 的 `root` / `entryScriptPath` / `preload` / `styleDir` 逐个校验）**继续承担**运行时路径依赖的看守职责，一条不动 · **部分取代 [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md)** —— 只取代其「不产生断言的产物生产与人工目检分列 `build/` 与 `dev/`」一句（两树合为 `tools/`）；三层划分、其余四条规则、`test/` 与 `shared/` 两层定位一条不动。**两份旧条目的正文均按规矩未改动** |
| 关联 | [ADR-049](ADR-049-工具函数下沉shared与clean-artifacts归位.md)（①②，本条是其步骤 ③ 的前提）· [ADR-043](ADR-043-树边界规则allowlist与shared零跨树出边.md) · [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md) · [ADR-044](ADR-044-工具树不纳入树边界治理改由路径常量存活性断言看守.md) · [REQ-144](../REQ.md) |

## 决定

1. **顶层 `build/` 与 `dev/` 合并为一棵 `tools/`**，七个文件平铺、无子目录：

   | 文件 | 职责 | 入口 |
   |---|---|---|
   | `tools/copy-renderer.mjs` | 拷 renderer 静态资源到 `dist/renderer` | `npm run build` |
   | `tools/svg-to-ico.mjs` | SVG → ICO | `npm run icons` |
   | `tools/visual-check.mjs` | 视觉自查 | `npm run ui:shots` |
   | `tools/visual-preload.cjs` | 上面那个工具的主窗桩 | 经 `driver.mjs` / `visual-check.mjs` 注入 |
   | `tools/visual-about-preload.cjs` | 关于窗桩 | 同上 |
   | `tools/renderer-coverage-report.mjs` | 被 c8 排除层的只读覆盖率报告 | `npm run report:coverage-renderer` |
   | `tools/setup-env.ps1` | 一次性写 Electron 镜像环境变量 | 手动跑一次 |

   **合并判据是「合并后不产生断言」，不是「都叫工具」。** 两个目录名（产物生产 / 人工目检）描述的是**用途**，不是**依赖形状**；而 `tools/` 要成立的唯一条件是它能套上一条边界规则。判据一旦换成用途，同一棵树下次长出断言时就无话可说 —— 那正是 ADR-044 判断失效时用的形态。

2. **给 `tools/` 补树边界规则**（`gates/repo/check-import-boundary.mjs`）：

   - `TREE_DIRS` 加 `tools: 'tools'`；
   - `TREE_BOUNDARY_LITERAL_PREFIXES` 从 `['dist','build','dev']` 缩到 **`['dist']`**；
   - `TREE_RULES` 加一条 `{ id: 'tools-stay-in-tools', scope: 'tools', allow: ['tools','shared'] }`（allow-list，允许面外一律判红）；
   - `test-stay-in-test` 的允许面里 `'build' 'dev'` 两个元素**同步换成 `'tools'`**（漏改会让 `selfCheckTreeLayout` 的「允许元素首段必须是已登记树名」判红）；
   - `ROOT_COMPUTE_SCAN_DIRS` 的 `'build' 'dev'` 换成 `'tools'`。

   `dist` **留在**字面前缀组：它是编译输出（可被引、自身无出边），与 ADR-044 当年一并归入本组的 `build/` `dev/` 并不同形。本组此后只装真同形的成员，判据名与内容重新对齐。

3. **`tools/` 树零跨树出边**，故其 allow 面只有自身与 `shared/`。「哪个脚本进 CI/release 链」这个信号**不由目录名承载** —— 它住在 `package.json` scripts 与 DEV-GUIDE「门禁接入点」表两处（合并前 `build/` 就已经是混的：`icons` 纯本地、`clean-*` 在链内、`copy-renderer` 在 `verify:ci` 链内）。

## 背景

**一、ADR-038 给 `build/` `dev/` 的定位已随实现漂移。** 它写的是「不产生断言的产物生产与人工目检」。ADR-049 已把 `clean-artifacts.mjs`（断言打包配置）挪进 `gates/artifacts/`，为这句定位开了第一个口子；本条把两棵树合并后，该定位连「两棵树」这个载体都不存在了。

**二、ADR-044 的结论前提已消失。** 它判「不给工具树补边界规则」的三条实测依据里，最硬的一条是「`build/` `dev/` 与 `dist` 同形：被引用，不治理」——而它们**并不同形**：`dist` 是输出（自身无出边），那两棵是**有出边的代码树**。ADR-044 自己的复查条件写着「若将来 `build/` / `dev/` 长出新的职责（例如开始 assert 什么、或新增跨树 import），本决策须重看」；ADR-049 把跨树出边清到零、断言迁走，重看条件已全部触发。

**三、前置条件由 ADR-049 备齐。** ① 把 CLI 原语与文件哈希下沉 `shared/`，② 把 `clean-artifacts.mjs` 归位 `gates/artifacts/` —— 三条原本指向 `gates/` 的跨树出边因此全部指向 `shared/`。**没有 ①②，合并不成立**：`tools/` 会带着三条无判据的出边进 `TREE_RULES`，规则名存实亡。

**四、`visual-*` 三文件的相邻性靠命名表达。** `visual-preload.cjs` 的项目根由 `--m2w-root=` 注入（ADR-040 的教训：桩不自算根，自算会与目录深度耦合并一次坑掉 45 分钟）。注入方取 `path.join(__dirname, "visual-preload.cjs")`，**必须与桩同目录** —— 这一层 import 图看不出来的耦合靠 `visual-` 共享前缀表达。

## 备选方案

1. **否决一：合并成 `tooling/build/` + `tooling/dev/` 两个子目录（保留原有区分）。** **不选**，理由：两棵树各自的出边都已归零，合并**不损失任何判别力**；而子目录会让「这棵树能不能套规则」这件事从一个判据退化成两个 —— 将来任一子目录长出断言，仍要再开一次 ADR。代价是真实的（七文件平铺下 `visual-` 前缀已表达相邻性），但它买的是**当前就有的**收益，付的是**将来还要再付一次**的成本。

2. **否决二：不合并，给 `build/` `dev/` 各补一条边界规则。** **不选**，理由：ADR-044 已用实测数据判这条路「5 个文件、10 条边、零违规」，即规则会写成**恒绿** —— 「扫得到」被误当成「守得住」。ADR-049 把出边清零后补规则不再恒绿，但那时补规则的前提（出边为零）本就是合并的自然结果，两条独立动作没有意义。更关键的是：不合并就得让 ADR-038 那句「分列 `build/` 与 `dev/`」继续留着，为一个用途区分维持两棵顶层树，是拿顶层目录数换注释里的三个字。

3. **否决三：把 `tools/` 也留在字面前缀组（沿用 ADR-044 的豁免）。** **不选**，理由：那等于本条只做改名不做治理。它会让「顶层六棵树里有两棵规则豁免」这个唯一的不一致原样保留，而合并的唯一动机就是消掉它。

## 后果

- **收益**：顶层树从六棵变五棵，且**五棵全部受管** —— 再无「规则豁免的例外」。`tools/` 的每条出边由 `tools-stay-in-tools` 守着，允许面只有 `tools` 与 `shared`；新出边默认判红而非默认放行。
- **收益二：`build/` `dev/` 的目录名不再需要维护正确。** 合并前它们的区分（「产物生产」vs「人工目检」）靠人记，而实际内容早已越界（`dev/` 里有拷资源的 `renderer-coverage-report.mjs`，`build/` 里有断言的 `clean-artifacts.mjs`）。合并后目录名只承诺一件事：**这里放工具**。
- **代价一：ADR-044 与 ADR-038 各被部分取代一句。** 两份旧条目的正文按「旧条不改动只标取代」保持原样，状态行已指向本条。若将来要在旧正文里找「工具树不治理」这句，读到的是状态行而非结论 —— 这是本规则的已知代价（换来的是演进链条完整可追）。
- **代价二：ADR-044 的路径常量存活性断言仍在。** `driver.mjs` 的 `preload` 常量指向 `tools/visual-preload.cjs`，仍有存在性校验。本条不撤销它：那是**运行时路径依赖**（桩文件搬走了就红），与 import 边界是两件事。本条两条判据并存，不是重复。
- **代价三：路径字面量在本条中被改动 20 余处**（`package.json` 4 条 script · `eslint.config.js` 2 处 · `gates/geometry/geometry/driver.mjs` 1 处运行时常量 · `gates/probe/gate-probes/sandbox.mjs` 1 处运行时常量 · 探针注册表与各处注释）。`gates/geometry/geometry/driver.mjs` 与 `gates/probe/gate-probes/sandbox.mjs` 两处是**运行时路径**，不是注释 —— 它们改错只在实跑时红（几何门禁 / 探针沙盒），故验收清单里逐个 `import` 了 `tools/` 全部文件、并单列了「`check-import-boundary` 只判方向不判存在性」这条已知盲区。