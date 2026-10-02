# ADR-048 · 覆盖率产物并入 `output/`：把「工具默认落点」换成「本仓显式约定」

| 项 | 值 |
|---|---|
| 状态 | 现行；**决定 4 括号内的理由已被 [ADR-059](ADR-059-dump落点的取值钉靠已迁到清理器.md) 更正** ——「取值无 gate 侧对应物故不比对」已不成立（清理器侧现在钉着），**但结论不变**：`requireFlags` 仍只登记 `--temp-directory` 的存在性 |
| 日期 | 2026-10-01 |
| 关联 | [ADR-037](ADR-037-顶层与扫描面一律派生.md)（产物义务集与删除保护区）· [ADR-045](ADR-045-镜像集与交付面按声明并入产物义务集与现状集分界.md) · [ADR-016](ADR-016-门禁链内全量验收只跑一遍.md) |

## 决定

1. c8 的**报告**落到 `output/coverage/`，由 `test:coverage` **显式**传 `--reports-dir=output/coverage`，且**必须用等号形态**（约束见下节）。
2. c8 的 **V8 dump 临时目录必须显式指到保护区外**，由 `test:coverage` 传 `--temp-directory=.c8-tmp`，且**必须用相对路径**（约束见「关键约束二」）。**这两个参数不是冗余，是必须拆开** —— 报告是全部段跑完后一次性写的，dump 是每个子进程退出时边跑边写的，只有前者能进 `output/`。
3. `gates/probe/gate-probes/coverage-gate.mjs` 的 `SUMMARY_RELATIVE` 改为 `output/coverage/coverage-summary.json`。
4. `coverage-baseline.json` 的 `requireFlags` 增登记 `--reports-dir` **与 `--temp-directory`**（后者只需存在性，取值无 gate 侧对应物故不比对）。
5. `auditStatic` 新增一条判据：`--reports-dir` 的**取值**必须等于 `SUMMARY_RELATIVE` 的目录部分 —— 核的是两侧登记的值一致，不只是 flag 存在。
6. 删 `.gitignore` 与 `eslint.config.js` 里的 `coverage` 条目（合并后它们成为死条目）；`.gitignore` 增 `.c8-tmp/`。

## 背景

- `coverage/` 的落点从来不是本仓约定。`package.json` 的 `test:coverage` 从未传 `--reports-dir`，`./coverage` 是 c8 的 `reports-dir` 默认值；仓内三处注释都自述了这个事实（`dev/renderer-coverage-report.mjs:10-11` 与 `:33-34`、`coverage-gate.mjs` 文件头）。**换句话说，根目录多一个目录这件事，本仓从未参与决定。**
- 读取端是硬编码的：改动前 `coverage-gate.mjs` 的 `SUMMARY_RELATIVE` 写死为 `"coverage/coverage-summary.json"`，`auditZeroFiles` 直接 `path.join(ROOT, …)` 取它。
- **两侧之间没有任何机器约束**，唯一耦合是「人记得同时改两处」。而 `parseCoverageScript()` 早已把 c8 参数向量解析进内存（`gates/probe/gate-probes/gates/coverage.mjs:44`），`--reports-dir` 的值就在手边 —— 现在白白不用。
- 漂移的后果形态很坏：不是阈值判红，而是 `--zero` 面报「未找到 `coverage/coverage-summary.json`」，指向路径而不是指向配置。
- 与此同时本仓已有明确的产物单源：`shared/paths.js:25-29` 导出 `ARTIFACTS_DIR` / `SMOKE_DIR` / `FAILURES_DIR`，`gates/repo/repo-manifest.mjs:518-525` 从它反推 artifactRoot 并用 `||` 强制拉回删除保护区。`coverage/` 不在其内。
- 两个目录今天在 `repo-manifest` 眼里**已经是同一类**（gitignored ⇒ artifact，见 `repo-manifest.mjs:112` 的 `classifyProfile`）。差别只在 `output` 被显式拉回保护，`coverage` 属于「工具顺手落在根目录」。故本条是**收敛到既有约定**，不是新造约定。

**实测（本轮，仓库现装 c8）**：`--reports-dir=output/_probe_eq` 生效，c8 自动建目录，`coverage-summary.json` 与 `tmp/` 一起搬过去。

## 关键约束：必须等号形态

`parseCoverageScript()` 的 flag 收集是「**连续以 `--` 开头的 token，遇首个非 `--` 即停**」（`gates/probe/gate-probes/gates/coverage.mjs:62` 的那个 `while`）。

- `--reports-dir=output/coverage` → 单个 token，以 `--` 开头 → 收进 flags，后续 flag 不受影响。✔
- `--reports-dir output/coverage`（空格分隔）→ 第二个 token 不以 `--` 开头 → **收集在此中断**，其后的 `--check-coverage` 与四个阈值全部丢失 → 静态面 ① `requireFlags` 与 ② 阈值比对**同时判红**，而报错完全不提真正的病因（少了一个 flag），排查会被引向阈值。

这是本仓特有的坑（与 c8 自身行为无关），故写进本 ADR，并在 `package.json` 旁与 `parseCoverageScript` 的注释里各点一次名。

## 关键约束二：`output/` 只放「一次性最后写」的产物，不放「边跑边写」的

**这是本条真正的代价，第一次落地时没料到。**

顶层 `output/` 是 `gate-probes` 段的**工作树零注入指纹集**（`PROTECTED_PATHS` 含 `output`，派生自 `artifactRootsOf`）。该段断言探针运行期间真实工作树指纹前后未变，而 `test/common/runner.js:70-79` 为它写明了两条硬规则：该段必须独占槽位，且**不得用「加开关把它降级成建议项」来绕过** —— 那等于永久删掉沙箱纪律那道守护。同一族假红本仓已实测连废 5 轮（`docs/evidence/20260927-170600-事实-测试与门禁.md:11`）。

于是判据成立：

> **能进 `output/` 的判据是「写入时机」，不是「是不是产物」。** 一次性在末尾写完的产物可以进；子进程每退出一次就写一次的中间态不行 —— 因为探针窗口（14s）就落在 acceptance 执行期间，两者必然重叠。

**实测证据（本轮第一次落地）**：只加 `--reports-dir=output/coverage` 时，全链 `test:coverage` 的 125 段里**恰好那一段红** —— `gate-probes` 报 `protected-tree-mutated`，`changedPaths` 全是 `output/coverage/tmp/coverage-*.json`。**确定性，不是 flake，重跑不会好。** 根因是 c8 的 V8 dump 目录随 `--reports-dir` 一起搬进了 `output/`，而 dump 是边跑边写的。同一份运行里报告阶段本身没问题：`output/coverage/coverage-summary.json` 在 acceptance 全跑完之后才落盘，`check:coverage-zero` 读到它且实测值与基线 `measured` 逐位一致。

**故决定 2 用 `--temp-directory=.c8-tmp`，且必须是相对路径**：

- **相对路径让沙盒 c8 天然隔离。** 探针 `runC8` 用**真实参数向量**在沙盒里跑 c8（`cwd = sandbox`），相对路径 `.c8-tmp` 于是落进沙盒内。若写成系统临时目录的**绝对路径**，所有沙盒 c8 会与外层共用同一目录，而子 c8 会在自身 report 阶段**清空**它 —— 后果是外层所有「文件名排序在 `gate-probes.test.js` 之前」的段，其 V8 覆盖数据整段丢失。这个坑 `gates/probe/gate-probes/gates/coverage.mjs:157-163` 早已用 `NODE_V8_COVERAGE` 的形式注释过，本条是它的另一条入口。
- `.c8-tmp/` 是 gitignored 顶层目录，**不在** `protectedTreePaths`（`artifactRootsOf` 只从 `ARTIFACTS_DIR` / `SMOKE_DIR` 反推出 `['output']`），故探针不监视它。

**判据为何进 `requireFlags`（决定 4）**：删掉 `--temp-directory` 不会让任何 coverage 门禁判红 —— dump 只是悄悄回到 `output/coverage/tmp/`，要等到 `gate-probes` 段在**下一轮** `test:coverage` 里以「工作树被改动」的假红形式暴露，而那条报错完全不提 c8。只登记存在性是这里唯一能兜住的手段；取值不比对，因为 gate 侧没有对应物。

**残留不会被下一轮计入（实测两次全链）**：`--temp-directory` 目录跑完并非空的（全链实测 214 个文件 / 约 134M）—— 那是**报告阶段之后才退出**的进程写下的死文件。连续两次全链的 `All files` 四项指标**逐位相同**（93.12 / 88.59 / 93.02 / 93.12），`check:coverage-zero` 均 exit 0 ⇒ 残留不被下一轮计入，不构成静默劣化。c8 在报告阶段会删除它读到的那部分（连续两次最小 harness 实测：跑完 temp 目录恒为 1 个文件而非 2），剩下的属于报告后才落盘那一批。

之所以专门验这一条：`--temp-directory` 是为修「确定性假红」引入的，而 c8 不清理该目录 —— 若残留被计入，覆盖率会虚高，基线 `measured` 锚点随之不可靠（`m - t > headroomPp` 会以「不可达/静默降级」的形式误判红）。**修掉一个假红换来一个可能的静默劣化，不算修好**，故必须两轮实跑对比、不能只看单轮数值恰好对。

## 备选方案

1. **只删 `.gitignore` 的 `coverage/`、保留默认落点** —— 不选。目录还是有主，漂移风险原样保留。
2. **加 `.c8rc.json` 配 `reports-dir`，不改参数向量** —— 不选。引入新配置文件，而 `parseCoverageScript()` 的 `configFiles` 会把它列进去；基线 note 已明确「此处刻意不转抄，转抄即多一处会静默过期且无人判红的文本」，配置文件正是那种转抄。改参数向量面更小，且可被静态面直接判红。
3. **把产物路径做成 `shared/paths.js` 的第三个导出，两侧都 import** —— 不选（本次）。`SUMMARY_RELATIVE` 现在是 gate 的字面常量，而 flags 侧的取值在 `package.json` 里；两侧要一致就必须**比对**，多一个载体不增加判据，只多一处可漂移。若日后 `test:coverage` 之外出现第二个 c8 调用，再议。
4. **只登记 `--reports-dir` 存在、不比对取值** —— 不选。存在但取值错（如 `output/cov`）时静态面全绿、动态面报「找不到 summary」，正是本条要治的病。
5. **只改读取端，不动参数** —— 不选。c8 仍写默认 `./coverage`，gate 去读新路径，数据源直接缺失。
6. **把 `output/coverage` 纳入 CI 的 `upload-artifact` path** —— 不选（本次）。覆盖率产物从来不是诊断留存物，纳入属功能新增，不是本条的一致性修复。

## 后果

**收益**：产物路径从工具默认值变本仓约定，与既有产物单源同处一地；新增判据让「c8 写 A、gate 读 B」在静态面指名判红；`output/` 已在删除保护区内，残留清理有明确落点。

**代价与已知边界**：

- 旧 `coverage/` 目录（含 `tmp/` 的 V8 原始 dump，实测占该目录体积 99% 以上、共 215 个文件）在盘上是未追踪残留。`.gitignore` 的条目删掉后若目录还在，`git status` 会被它污染 —— **删条目与删目录必须同批**。
- `--reports-dir` 进 `requireFlags` 后静态面多一项必需项。方向是**收紧**，不削弱门禁；与已作废的 REQ-095（「覆盖率阈值三处冗余」，墓碑与依据见 `docs/REQ.md` 已作废节）里「双处登记承重，别收拢成推导」的判断一致 —— 关键是不能把两侧改成互相推导，那会让比对恒真。
- 探针 `gates/probe/gate-probes/gates/coverage.mjs:165` 的 `runC8` 用**真实参数向量**在沙盒里跑 c8（`cwd = sandbox`），会跟着把产物写进沙盒内的 `output/coverage/`。断言只看 stdout（`harness:4`、`does not meet global threshold`），json-summary 不参与判定，预期无害；**但若沙盒 c8 因该参数报错，anchor 案（期望 exit 0）会判红** —— 须实跑该探针确认，不靠推断。
- `referenceSandbox.flags` 是 2026-09-26 的历史快照，**刻意不动**（改它等于篡改一次历史实测值）。
- `docs/evidence/` 里数份快照提到 `coverage/tmp/`，按该载体「只增不改」规则不改正文。
- 不写 CHANGELOG：按 [ADR-047](ADR-047-CHANGELOG语体正式化与门禁.md) 第三节，「目录重组 / 门禁细节 / 覆盖率」属明确不写的工程状态类。