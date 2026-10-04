# PLAN · 测试树位置即身份与门禁元框架瘦身

> 单任务当前状态。**完成标准逐条划完才许删**（大型需求为「整体完成标准」划完）。台账行见 [`docs/REQ.md`](REQ.md) REQ-173 行。

## 相关 ADR

[`ADR-062`](adr/ADR-062-测试树位置即身份与门禁元框架瘦身.md) · 测试树改为「位置即身份」（段路径是源文件路径的机械变换）＋ L1–L12 机器判据，取代 ADR-039/051/052，部分取代 ADR-050。**`src/` 本次冻结不动。**

## 验证基线

见 [`docs/DEV-GUIDE.md`](DEV-GUIDE.md)「验证基线」节（单一出处，本文件不复制命令）。

## 目标

让一个新写的测试段能在**不读任何文档**的前提下 O(1) 定位到唯一目标文件：路径算出来而不是选出来，段名只承载被测主体。门禁元框架从约 3.6k 行压到约 140 行并补上真正缺失的命名/归属判据。

## 下一步

**P1：建 `gates/repo/check-test-layout.mjs` ＋ 自测（12 条负向夹具），`npm run check:test-layout` 先挂本地手动不进链** —— 让门禁把全量违规摊开，输出「镜像缺失 N／位置错位 N／跨层 import N／豁免缺失 N」四段计数。这四段计数是后续全部阶段工作量的唯一权威数字。

## 完成标准

1. `check-test-layout` 的 L1–L12 全部落地，`check:test-layout` 产出四段权威计数并回填 ADR-062 与台账；自测 12 条负向夹具逐条判红且点名。
2. 146 个测试文件全部落在镜像路径上（`src` 6 层 ＋ `gates`/`shared`/`tools` 3 棵），无「文件名承诺了不存在覆盖面」的段，无文件头自述与物理位置矛盾的段。
3. 沙盒探针层与 `protocol.mjs` 退役，且退役前 7 个 `GATE_IDS` 逐个对账到载体；L11 保住了「门禁自测须在真实工作树跑绿」这一条。
4. 一个 agent 只凭被测文件路径即可定位唯一段文件；`npm run where -- <路径>` 可反查镜像段与引用它的 behavior 段。
5. DEV-GUIDE「测试体系」节 ≤5 行，规则本体全部在门禁里。

---

## 步序与泳道

七阶段。**P6 有一道硬前置门**（见下表），它不允许与其他阶段并行。

| 阶段 | 产出物 | 验收判据 |
|---|---|---|
| **P0** 决策落纸 | ADR-062 ＋ evidence ＋ 台账行 ＋ 本文件 ＋ DEV-GUIDE 改写为指针 | `check:docs` 绿；ADR 背景非空 |
| **P1** 先建判据不搬文件 | `check-test-layout.mjs` ＋ `.selftest.mjs`（L1–L12，12 条负向夹具）＋ `test-exemptions.json` 骨架 ＋ `npm run check:test-layout`（本地手动，不进链） | `check:test-layout` exit 1 并给出四段计数（**迁移工作量的唯一权威数字**，回填 ADR ＋ 台账）；selftest exit 0；连跑三次输出一致（walker 不塌缩） |
| **P2** harness 归位 ＋ 删假规则 | `test/common/` → `test/harness/`（17 文件）＋ `dom-stub.js` ＋ 删 `test/common/paths.js`（86 处改直引）＋ `runner-report`/`test-common-helpers`/`electron-mock-coverage` 归位 ＋ `tscheck-coverage` 段升门禁 ＋ `check-test-numbering` → `check-planning-tokens` ＋ 删 `shared/test-common-surface.js` | `npm test` 全绿；`check:planning-tokens` 绿；L7/L8 绿（其余仍红属预期） |
| **P3** `samples/` 归位 ＋ 删 fixtures 契约 | `samples/`（`gen.mjs` ＋ `manifest.json` ＋ `EXEMPT.json` ＋ 三子目录）＋ `check-samples.mjs` ＋ 删 `gates/fixtures/` ＋ 删 111 个 `= null` 与声明强制 ＋ 删孤儿 PDF 与重复图片 ＋ 改 3 处读点 | `check:samples` exit 0（**迁移前后 `samples/docs/` 逐字节相同**）＋ `gen:samples` 幂等 ＋ `npm test` 全绿 |
| **P4** 镜像层填充 ＋ `behavior/` 归位 | 六个 `src` 镜像层 ＋ 20 个 `test/gates/` 段改镜像路径（含 **6 拆分 / 3 合并**）＋ 跨层段搬 `behavior/` ＋ `npm run where` | `npm test` 全绿；L1..L10 绿；**断言调用数逐份对账总和不减**；**`test:coverage` 0% 文件集合逐文件相同**；L5 先只报告，转判红前误伤清单逐条处置 |
| **P5** 豁免表 ratchet | `test-exemptions.json` 填齐（基线由 P1 的 `--write-baseline` 落盘）；能补单测的补，不能补的写 `reason` ＋ `coveredBy` | `check:test-layout` exit 0；豁免项数作为「新增 `src` 模块的净增长上限」记入台账（只紧不松） |
| **P6** 门禁元框架退役 | **前置硬门**：沙盒层 7 个 `GATE_IDS` 逐个「现有载体 → 新载体」对账表，**任一道门禁若无载体先补 `.selftest.mjs`，本阶段才允许开始**。产出：删 `protocol`/`sandbox`/`proc`/`judge`/`report`/`contract` ＋ 6 探针 ＋ `check-gate-probes.mjs`；`registry.mjs` → `gate-index.mjs`；`gate-probes.test.js` ＋ `gate-registry-gate.test.js` 合并为 `gate-index.test.js`；`package.json` 删 `check:gates` | `verify:ci` 全绿且**链长不增**；L11/L12 负向夹具红；`grep -rn "gate-probes" gates/ test/ package.json .github/` 零命中；**对账表每道门禁各跑一次新 selftest 全绿** |
| **P7** 收尾 | DEV-GUIDE「代码地图」重写 `test/` 与 `gates/` 两段；`tools/` 补测试或进豁免 | `verify:ci` 绿；`verify:release` 跑通；链步数/段数/豁免数**写成可重取指针，不写死数值** |

## 整体完成标准

划完才许删本文件。逐条划记（勾 = 已达成并有证据）：

- [ ] C1 `check-test-layout` L1–L12 全落地，四段计数已回填 ADR-062 ＋ 台账
- [ ] C2 146 个测试文件全落镜像路径；0 个偏宽（承诺不存在覆盖面）；0 个文件头自述与位置矛盾
- [ ] C3 `samples/` 逐字节迁移完成，fixtures 契约 100% 声明强制与 111 个 `= null` 全删
- [ ] C4 沙盒层退役，7 个 `GATE_IDS` 对账表全绿，L11「真实工作树跑绿」判据在位
- [ ] C5 AI 落笔判据成立：只凭被测路径可定位唯一段；`npm run where` 可反查
- [ ] C6 DEV-GUIDE「测试体系」≤5 行，规则本体全在门禁
- [ ] C7 `verify:ci` 全绿且链长不增；`verify:release` 跑通

## 怎么回滚

每阶段独立可回退 commit，**回滚顺序与实施顺序相反**。

- **P6 对账表是沙盒层退役的唯一保险** —— 回滚 P6 前先确认对账表仍在且全绿。
- **P4 的断言调用数对账表 ＋ `test:coverage` 0% 文件集合是「没漏搬」的客观证据** —— 回滚 P4 前先核对这两份记录。
- **P3 的「迁移前后逐字节相同」是纯搬家的证据** —— 任何一项不同就不是纯搬家，须先查清再继续。
- **P1 的四段计数是后续所有阶段的工作量基线** —— 回滚 P1 前不要回滚 P2 及以后。
- P2/P3/P4 是机械改写（路径变更、搬文件、改 import），`git revert` 即可，无数据迁移。
- ⚠️ **唯一不可 `git revert` 的是删除动作的语义**：沙盒层与 `protocol.mjs` 的文件内容在 git 历史里可取回，但**判据退役（注册表 `probes[]` 概念消失、7/20 未登记改由 L11 路径判定接管）不可回退** —— 回退后必须重跑 P1 才能重建一致性。

## 修复项复测

| 现象 | 首判（可能错） | 复测动作 |
|---|---|---|
| `check:test-layout` 四段计数与 ADR 记录不一致 | P1 门禁的 walker 或豁免表基线有误 | 删 `test-exemptions.json` 重跑 `--write-baseline`，比对两次数值；连跑三次确认输出一致 |
| P4 后 `npm test` 全绿但段数减少 | 拆分漏搬（**最危险的静默失效**） | 比对拆分前后断言调用数总和 ＋ `test:coverage` 0% 文件集合，两者任一变化即定位到漏搬的那份 |
| L5 转判红后大量误伤 | 预判的合理跨层段未列入 `behavior/` | 退回只报告模式，取完整误伤清单逐条处置后再转 |
| `verify:ci` 在 P6 后链长变长 | 新增门禁被误挂进链 | 查 `gate-index.mjs` 的 `access` 字段；`access:"local"` 出现在链上即判红（L12） |
| `M2W_ONLY` 段筛选命中数异常 | 段名改为完整相对路径后 basename 匹配失效 | 复核 `runner.js` 的 `EXCLUSIVE_SEGMENTS` 子串语义；`gate-probes` 那条应随 P6 一并消失 |