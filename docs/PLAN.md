# PLAN · 源码树「一职责一文件」与测试树「位置即身份」

> 单任务当前状态。**整体完成标准逐条划完才许删**。台账见 [`docs/REQ.md`](REQ.md) 的 REQ-180（源码树 · 本载体的主项）与 REQ-173（测试树 · 下游，被 REQ-180 阻塞）。

## 相关 ADR

- [`ADR-064`](adr/ADR-064-源码树一职责一文件与内部边界判据.md) · 源码树一职责一文件＋11 条内部机器判据＋六阶段方案 T0–T5 —— **本载体主项**
- [`ADR-062`](adr/ADR-062-测试树位置即身份与门禁元框架瘦身.md) · 测试树位置即身份＋L1–L12＋七阶段 P0–P7 —— **下游，被 REQ-180 阻塞**（其 L1 豁免表以 src 路径为键且是 ratchet，反序会产语义模糊的红）

## 验证基线

见 [`docs/DEV-GUIDE.md`](DEV-GUIDE.md)「验证基线」节（单一出处，本文件不复制命令）。

**本载体自定的门槛**：每阶段收尾跑一次 `npm test` 全量；阶段内改动按需筛段（`M2W_ONLY`）；**不跑 `verify:ci` 全链，除非该阶段动了门禁接入点**（T1 挂新门禁进链时才跑）。

## 目标

让一个新写的测试段能在**不读任何文档**的前提下 O(1) 定位到唯一目标文件：路径算出来而不是选出来。同时让 `src/` 的每个文件只承担一份职责、职责可从路径读出。门禁元框架从约 3.6k 行压到约 140 行，并补上真正缺失的命名与归属判据。

## 下一步

**收 T0 两条泳道（fix-1 建 `check-src-layout.mjs` / fix-2 加 6 条 core 内部判据并结清 `prefix:../../` 债），交叉核对后合并提交，并把两条新判据的实测红位写回 ADR-064 的「已知边界」。**

## 完成标准

1. `src/` 19 条取证里 7 条要动的全部落地（i18n 目录化 · cancel 拆分 · image 归并 · util→text 改名 · style 并入 theme · main 四项搬迁 · 11 条新判据在位）
2. 146 个测试文件全部落在镜像路径上；0 个偏宽；0 个文件头自述与物理位置矛盾
3. 沙盒探针层与 `protocol.mjs` 退役，且退役前 7 个 `GATE_IDS` 逐个对账到载体；L11 保住了「门禁自测须在真实工作树跑绿」
4. 一个 agent 只凭被测文件路径即可定位唯一段文件；`npm run where` 可反查
5. DEV-GUIDE「测试体系」节 ≤5 行，规则本体全部在门禁里

---

## 步序与泳道

七阶段。**阶段之间有硬序，不可并行**；全程唯一允许并行的写入是 `gates/` 下两个不同文件。

| 阶段 | 内容 | 状态 |
|---|---|---|
| **T0.0** | 并入 REQ-170：给 `gates`/`shared`/`tools` 三棵非 program 树开 `no-undef`。**实测否决了 ADR 原定的 `tsconfig.gates.json` ＋ `checkJs` 方案**（1028 条噪声 vs 1 条），改判已写回 ADR-064 | ✅ 已提交 `51f80bb` |
| **T0** | 建 src 侧判据，不搬文件：`check-src-layout.mjs`（`src-file-header` 红 6 ＋ `src-no-duplicate-basename` 红 0/白名单 3 组）＋ `check-import-boundary.mjs` 加 4 条内部边界 ＋ 2 条文本判据 ＋ 结清 `prefix:../../` 债。**6 条新判据建时即红，故一律带 `pending: true`**（命中归 `info` 通道、不进 `problems`；T2 逐条删标记即转 fail-closed，**删标记本身就是进度记录**） | ✅ 已完成 |
| **T1** | 建 `check-test-layout.mjs`（L4/L5/L7/L8），report 模式。**实测 45 项**：L4 判红 39（零本层主体 37 ＋ 段 import 段 2）· L5 跨层 60 处/36 段（恒报告）· L7 多 2（`common` `fixtures`）缺 4（`behavior` `harness` `shared` `tools`）· L8 0。⚠️ 其中 20 段是**间接到达本层**（8 段经 `test/` 内非段助手、12 段经路径串/子进程）——位置是对的，属 L4 假阳性，处置见 ADR-062 | ✅ 已完成 |
| **T2** | `src/` 搬迁 5 步，每步自带测试 import 修（**步内不可分割、步间可独立回退**）。⚠️ **86 处 import 重写全部推到 T3**，与 T2 的重写永不交错 | ⏸ |
| **T3** | 测试树搬迁：harness 归位（删 `test/common/paths.js` 的 86 处）＋ `samples/` 归位 ＋ 镜像填充 ＋ 6 拆 3 合 ＋ `behavior/` 归位。`M2W_ONLY` 段名与镜像路径**同批切** | ⏸ |
| **T4** | 豁免表 ratchet：`--write-baseline` 生成 → 逐条补 `reason` ＋ `coveredBy` → 转判红 | ⏸ |
| **T5** | 门禁元框架退役 ＋ 收尾：删沙盒层（**前置硬门：7 个 `GATE_IDS` 逐个对账**）＋ `registry.mjs`→`gate-index.mjs` ＋ DEV-GUIDE 重写 | ⏸ |

### T2 的五步与排序理由

| 步 | 内容 | 触点 | 为什么这个顺序 |
|---|---|---|---|
| 1 ✅ | `util/`→`text/`（**只改目录名，4 个文件名不动**） | 实测 **33 处 / 27 文件** | 纯改名零逻辑，先跑通「搬＋修测试＋验」这套动作。⚠️ **原估「3 段」是错的**，原计划的 `settings-*` 改名已移出：实测 `settings-defaults` 有 **66 处真 import** ＋ 8 处 JSDoc ＋ 约 35 处注释提及，且给出的理由「两个文件名无法区分 schema 与 defaults」**不成立** —— 文件名里就写着 `schema` 与 `defaults`，本就可 grep。66 处改写的风险不抵这点收益 |
| 2 ✅ | `cancel.ts` 拆出 `image/request-guard.ts` | 实测 **5 文件**，**测试段零改动** | 边界明确（22–169 vs 172–296）。实测那 3 个测试段只 import 留在原地的导出，故一处未改。⚠️ **跨文件私有符号有两个而非一个**：除派发时点出的 `raceCancel`，还有 `linkAbort`（`cancel.ts:127`，唯一调用方就是 `runImageRequest`）——它跟着那段时序逻辑一起搬，否则留在 `cancel.ts` 就是本文件内无人调用的孤儿。`raceCancel` 经**既有公开门面** `CancellationGuard.race()` 调用（实现即 `return await raceCancel(work, guard)`，逐字等价），故保持模块私有、不导出、**也不复制**一份到新文件 |
| 3 ✅ | `image/` 归并（**`style/` 那半已移出本步**） | 实测 **12 文件** | `markdown/image-size.ts`（163 行，零 import）＋ `image-path-policy.ts`（183 行，只引 `node:path`）搬进 `core/image/`，8 处 src import ＋ 3 处测试段改动，测试段**不搬目录**（T3 才搬）。⚠️ **`style/` 并入 `theme.ts` 已移出**：ADR 声明 `theme.ts` 是 docx 私有（项目 `AGENTS.md` 亦定其为 docx 字体与 eastAsia 的集中配置，32 行零 import 叶子），而 `style/` 的两个文件消费方**横跨两条管线**（水印灰被 `docx/chrome`＋`pdf/template` 同引，89 行 hljs 色板被 `docx/handlers/code-highlight`＋`pdf/template-css` 同引）—— 即 `style/` 本身就是「双管线共享视觉层」，搬进单管线私有文件会造出一条 `pdf → docx/theme.ts` 运行期值依赖；且 ADR 对 89 行的 `hljs-palette.ts` 放哪只字未提 |
| 4 ✅ | 只做三项：`types.ts` 删除 ＋ `output-allowlist.ts` 挪进 `services/` ＋ 建 `core-no-duplicate-export`。**另三项移出本步** | 实测 **6 文件** | ⚠️ 原估「测试耦合最低（`menu` 0 段直接 import）」**估法漏了一整层**：`about-preload` 的耦合根本不在 import 上，而在 `menu.ts:49` 的 `path.join(here, "..", "renderer", …)` **运行时算路径** ＋ `tools/copy-renderer.mjs` 的资产拷贝 ＋ 两个测试段钉住的 dist 位置 ⇒ 移出。**「缩桶」移出**：`main/converter/index.ts` 的 7 个跨层转出背后是**约 10 个测试段经该桶取符号**，属 T3 规模 import 重写。**`main-ipc-no-assembly` 决定不建**（见 ADR-064「已知边界」节的理由） |
| 5 | **`i18n.ts` → `i18n/` 目录** | **29**（24 运行期 ＋ 5 JSDoc 类型标注） | 放最后：最大且有静默失效风险，前四步把流程跑顺了它才是机械重复 |

## 整体完成标准

划完才许删本文件。逐条划记（勾 = 已达成并有证据）：

- [ ] C1 `src/` 19 条要动的 7 条全部落地；11 条新判据在位且已从「只报告」转「fail-closed」
- [ ] C2 146 个测试文件全落镜像路径；0 个偏宽；0 个文件头自述与物理位置矛盾
- [ ] C3 `samples/` 逐字节迁移完成；fixtures 契约 100% 声明强制与 111 个 `= null` 全删
- [ ] C4 沙盒层退役；7 个 `GATE_IDS` 对账表全绿；L11「真实工作树跑绿」判据在位
- [ ] C5 AI 落笔判据成立：只凭被测路径即可定位唯一段；`npm run where` 可反查
- [ ] C6 DEV-GUIDE「测试体系」≤5 行；规则本体全在门禁
- [ ] C7 `verify:ci` 全绿且链长不增；`verify:release` 跑通

## 怎么回滚

每阶段独立可回退 commit，**回滚顺序与实施顺序相反**。

- **T5 的 7 个 `GATE_IDS` 对账表是沙盒层退役的唯一保险** —— 回滚 T5 前先确认对账表仍在且全绿。
- **T3 的断言调用数对账表 ＋ `test:coverage` 的 0% 文件集合是「没漏搬」的客观证据** —— 回滚 T3 前先核对这两份记录。
- **T2 每步自成 commit**（5 个），回滚时可只退其中一步而不动其余。
- **T3 的「迁移前后 `samples/docs/` 逐字节相同」是纯搬家的证据** —— 任何一项不同就不是纯搬家，须先查清再继续。
- **T1 的四段计数是后续所有搬迁阶段的工作量基线** —— 回滚 T1 前不要回滚 T2 及以后。
- T2/T3 是机械改写（路径变更、搬文件、改 import），`git revert` 即可，无数据迁移。
- ⚠️ **唯一不可 `git revert` 的是删除动作的语义**：沙盒层与 `protocol.mjs` 的文件内容在 git 历史里可取回，但**判据退役（注册表 `probes[]` 概念消失、7/20 未登记改由 L11 路径判定接管）不可回退** —— 回退后必须重跑 T1 才能重建一致性。

## 修复项复测

首判常常是错的。这张表记「首判可能是什么」与「怎么复测」，避免下一次在同一坑里绕第二遍。

| 现象 | 首判（可能错） | 复测动作 |
|---|---|---|
| T2 某步后 `npm test` 全绿但段数减少 | 拆分/搬迁漏搬（**最危险的静默失效**） | 比对搬迁前后断言调用数总和 ＋ `test:coverage` 的 0% 文件集合，两者任一变化即定位到漏搬处 |
| T0 新判据接进 `verify:ci` 后链红 | 判据建时即红，忘了它要 `--enforce` 才 fail-closed | 查该判据的默认退出码路径；确认链上跑的是只报告形态 |
| L5 转判红后大量误伤 | 预判的合理跨层段未列入 `behavior/` | 退回只报告模式，取完整误伤清单逐条处置后再转判红（L5 覆盖 T1 到 T3 末） |
| T1 判据的「位置错位 N」远小于预期 | 判据只查 import 解析落点，漏了「不 import 任何 src 模块」的段（如框架自测段） | 补「必须 import 至少一个本层被测主体」这条子判据后重跑 |
| T4 豁免表出现语义模糊的红（模块已不存在） | src 在 T2 搬过文件，表的键是旧路径 | 这是 T2 必须先于 T4 的理由；若已发生，重跑 `--write-baseline` 并核对减少项 |
| `verify:ci` 在 T5 后链长变长 | 新增门禁被误挂进链 | 查 `gate-index.mjs` 的 `access` 字段；`access:"local"` 出现在链上即判红 |
| `M2W_ONLY` 段筛选命中数异常 | 段名与镜像路径不同批切，或 basename 语义未改净 | 复核 `runner.js` 的 `EXCLUSIVE_SEGMENTS` 子串语义（`gate-probes` 那条应随 T5 一并消失） |
| T2 搬走 src 文件后 `check:boundary:dist` 红 | 判据坏了 | **dist 侧扫到了 src 已不存在的陈旧产物**。`build` 脚本是 `tsc && copy-renderer.mjs`、本就不清 dist，清 dist 是 `clean:dist` 的职责 → 跑 dist 面前先 `npm run clean:dist`。⚠️ 这是 `verify:ci` 的结构性缺口（`build → check:boundary:dist` 之间无清理步骤），T2 之前 src 只增不减所以从未暴露；留待 T5 重写链时补 |
| 搬走某文件后某条门禁立刻红 | 判据逻辑坏了 | **该路径被按全路径登记进了某张表**（本轮实测：`CORE_NODE_BUILTIN_FILES` 登记的是 `core/markdown/image-path-policy.ts` 整条路径，且 `test/gates/import-boundary.test.js` 的 9b-2 沙盒夹具用同一个路径当 **map key**，两处必须同批改）。搬文件后必须搜「该路径是否出现在 `gates/` 与 `test/` 的任何登记表、夹具 key、字面路径断言里」，这类耦合不搜不会自己暴露 |