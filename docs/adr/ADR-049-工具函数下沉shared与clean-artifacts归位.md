# ADR-049 · 工具函数下沉 `shared/`，`clean-artifacts` 归位 `gates/artifacts/`

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-02 |
| 取代 | **部分取代 [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md)** —— 只改其「不产生断言的产物生产与人工目检分列 `build/` 与 `dev/`」一句中 `clean-artifacts` 的归属（它断言仓库状态，故归 `gates/artifacts/`）；三层划分、其余四条规则、`test/` 与 `shared/` 两层的定位一条不动 |
| 关联 | [ADR-038](ADR-038-gates-test-shared三层与跨树边界.md) · [ADR-043](ADR-043-树边界规则allowlist与shared零跨树出边.md) · [ADR-044](ADR-044-工具树不纳入树边界治理改由路径常量存活性断言看守.md) · [ADR-037](ADR-037-顶层与扫描面一律派生.md) · [REQ-144](../REQ.md) |

## 决定

1. **工具函数下沉 `shared/`。** 新增两个模块，各只 import `node:` 内建（零跨树出边，合 ADR-043）：

   | 模块 | 符号 |
   |---|---|
   | `shared/cli.mjs` | `parseArgs` · `isMainModule`（另导出 `CLI_USAGE`，即原 `check-dist-manifest.mjs` 的用法文案） |
   | `shared/fsx.mjs` | `toPosix` · `writeFileAtomic` · `hashBuffer` · `hashFile` |

   `gates/artifacts/check-dist-manifest.mjs` 保留它真正的职责（`MANIFEST_SCHEMA` · `DEFAULT_*` · `collectFiles` · `buildManifest` · `serializeManifest` · `parseManifest` · `diffManifests` · `describeRoot` · `main`），并**继续 re-export** 上述 6 个符号；仓内既有调用方**全部改为直接引 `shared/` 那两个模块**（不靠 re-export 兼容）。re-export 因此是给「机制下沉」与「调用方迁移」之间留的可独立回退中点，不是第二条取用路径。

2. **`build/clean-artifacts.mjs` → `gates/artifacts/clean-artifacts.mjs`**（`git mv`，逐处改路径）。它 `assertMatchesBuildConfig` 断言 `package.json` 的打包配置、有专属守护段、在 `verify:release` 链内 —— 按 ADR-038「层按**断言对象**分」属门禁树，留在产物生产树与该层的定位不符。

## 背景

**一、`check-dist-manifest.mjs` 是伪装成门禁的工具库。** 它导出 13 个符号，25 处仓内文件从外部 import，其中大半与 dist 清单无关：门禁探针注册表、自检、供应链三脚本、产物核对、构建守卫全都借它的 `parseArgs` / `isMainModule` / `toPosix`。一个叫「检查 dist 清单」的文件成了全仓 CLI 工具库 —— 这正是 `build/` `dev/` 那两条跨树出边（`copy-renderer.mjs` · `renderer-coverage-report.mjs` → `gates/artifacts/`）的**唯一成因**，而这两条边**零判据**（ADR-044 明确不治理工具树）。

**二、`clean-artifacts.mjs` 断言仓库状态，却住在不产生断言的树里。** ADR-038 给 `build/` `dev/` 的定位是「产物生产与人工目检」。该定位对 `dev/` 成立，对 `build/` **不成立**：`clean-artifacts.mjs` 拿 `package.json` 的 `build.files` / `build.directories.output` 与自己的删除目标对账，配置迁移后不一致即拒绝执行；删除目标取自冻结的 `TARGET_DIRS` 且只接受 `dist`/`release`/`all` 三个关键字，不来自调用方。它是仓库里唯一会 `rmSync` 的脚本，判据完备，且在发布链内（`dist` script 首步）。

**三、ADR-043 的「零出边」不需修订。** 该条已把「零出边」精确为「零**跨树**出边」（树内互依与 `node:` 内建放行）。本决定新增的两个模块只 import `node:` 内建，落在这个精确定义内，故 ADR-043 一字不动。

## 备选方案

1. **否决一：不给 `build/` `dev/` 补边界规则，改为把越界的文件搬进受管树。** 即本决定。这是被采纳的方向，理由是 ADR-044 已经用实测数据否掉了「给工具树立规则」这条路（5 个文件、10 条边、零违规；`TREE_SCAN_EXTENSIONS` 只扫 `.js`/`.mjs`/`.cjs`，而 `src/` 148 个文件里只有 2 个是这三种扩展名 ⇒ 规则会写成 98.6% 恒绿）。既然规则这条路已被否决，剩下的可选项只有「让越界的文件不再越界」—— 而这两处越界一个源于工具库伪装、一个源于文件归错层，都不是「工具树需要被治理」。

2. **否决二：留手不动，只补边界规则把现状合法化。** 即把 `build/` `dev/` 的出边登记成「已知例外」或把 `gates/artifacts/` 加进工具树的 allow-list。**不选**，理由与 ADR-044 判 `③ 登记运行时路径依赖` 否决时同源：它把「现状被描述过」当成「现状被论证过」，且例外表是恒绿温床 —— 下一条新出边会自动落进同一张表，无人判红。ADR-044 自己的复查条件写得很清楚：「若将来 `build/` / `dev/` 长出新的职责（例如开始 assert 什么、或新增跨树 import），本决策须重看」。本决定正是那个复查条件被触发的时刻。

3. **否决三：让 `check-dist-manifest.mjs` 继续 re-export，25 处调用方一处不改。** **不选**，因为它不解决问题：三条跨树出边（`copy-renderer` · `renderer-coverage-report` → `gates/artifacts/`）一条不少，步骤 ③ 合并成 `tools/` 时仍会带着对 `gates/` 的出边，而合并的前提正是「跨树出边为零」。re-export 保留了（作为可回退中点），但调用方仍全部直改。

4. **否决四：`parseArgs` 顺手把 `USAGE` 参数化（usage 由调用方传入）。** **不选（本次）**：`supply-common.mjs` 的 `parseSupplyArgs` 已经是这个形态，说明该问题**已被识别**，但改这一处要连带改全部调用方的诊断文案与相关断言，属独立一条而非本条的附带面。已在 `shared/cli.mjs` 文件头把该耦合显式登记为「已知遗留」，避免它被当成新引入的缺陷。

## 后果

- **收益**：`shared/` 拿到它名分相符的两块机制（CLI 解析 · 文件哈希与原子写）；`gates/artifacts/check-dist-manifest.mjs` 回到「只断言 dist 清单」；`clean-artifacts` 与其余产物核对门禁同住一层，ADR-038 的分列意图恢复成立（`build/` 剩下的两个脚本确实不 assert 任何东西，ADR-044 对它的结论继续有效）。步骤 ③ 合并 `build/` + `dev/` 为 `tools/` 时，这三处出边已全部指向 `shared/`，跨树出边归零的前提成立。

- **代价一：两处沙盒复制集必须同步扩容。** `check-dist-manifest.mjs` 被 `test/segments/install-smoke.test.js` 与 `gates/probe/gate-probes/gates/dist-manifest.mjs` 逐字节复制进沙盒执行。它新增对 `shared/cli.mjs` · `shared/fsx.mjs` 的依赖 ⇒ 两处复制集都得带上这两个模块，否则沙盒里 `ERR_MODULE_NOT_FOUND`，整段以「脚本起不来」的形式红。副本闭包门禁（`contract-single-source`）在本次实施中**当场判红两次**并点名了这件事，机制有效。

- **代价二：install-smoke 段少复制一个脚本。** 沙盒内 3 个产物脚本原先都经 `check-dist-manifest.mjs` 取 CLI 原语，改直引 `shared/` 后该副本在 install-smoke 沙盒里**零入边**，副本闭包门禁判它「死副本」—— 这是准确诊断（复制它已无意义），故从 `SANDBOX_ARTIFACT_SCRIPTS` 移除。

- **代价三：门禁探针那份副本改走入口登记。** `dist-manifest` 探针仍需逐字节跑 `check-dist-manifest.mjs`（它是被测对象），但它在副本集内已无入边，故登记进 `SANDBOX_ENTRY_EVIDENCE`。该登记受机械抽查（复制行之外须有一行同时出现文件名与执行类调用词），为此把 `runScript` 的调用收成单行并写出字面量文件名 —— 一处**为满足门禁判据而写的形状**，已就地注释说明。

- **不修订 ADR-043**（新增模块零跨树出边，落在其精确定义内）；**不修订 ADR-044**（`build/` `dev/` 仍不纳入树边界治理，本决定只减少了它们的出边，没有增加治理面；`build/` 现存两个脚本仍不 assert 任何东西，ADR-044 的结论继续成立）。

- **代价四：`parseArgs` 的用法文案改由调用方传入。** 下沉时若把 dist 清单门禁的 `--help` 文案一并搬进 `shared/cli.mjs`，机制层就**知道了某个门禁的参数表** —— 所有复用方参数写错时都会看到一段与自身无关的说明。那不是消除耦合，是把它从门禁树搬进机制树，且比下沉前更糟：原先它是 `check-dist-manifest.mjs` 的**私有** `const`，只有一个使用者。故 `parseArgs` 的 `spec` 增可选入参 `usage`，由各门禁各传各的；不传则诊断只报未知项本身（附一段别人的说明比不附更糟）。仓内已验证：`clean-artifacts.mjs` 早前正是因此另写了一份 `parseArgs`，本次把它并回共享实现。

- **步骤 ③ 尚未执行** —— `build/` + `dev/` → `tools/` 及其边界规则（`TREE_DIRS` / `TREE_BOUNDARY_LITERAL_PREFIXES` / `TREE_RULES` 三处改动）是独立一步。①②完成后那三条出边已全部指向 `shared/`，跨树出边归零的前提成立。
