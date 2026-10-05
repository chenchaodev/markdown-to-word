# 台账维护工具段二收尾：撤销墓碑 · 上限归一 · 段二落位裁决

> 相关 ADR 的结论与依据见 [`docs/evidence/20261005-123518-台账表格维护代价与脚本化方案.md`](evidence/20261005-123518-台账表格维护代价与脚本化方案.md)（本任务的完整方案、耦合面实测与三次落位更正过程都在那份）。判定归属按 ADR-054 决定二「对象在哪」—— 本仓对象上的判据实例归本仓。

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处，本文件不复制；那里也只写命令、不写结果。配置仓另有一条基线：`node tools/check-pointers.mjs` 与 `node --test tools/ledger.test.mjs`。

## 目标

台账不再要求人工用 `~~` 划墓碑（该标记是必须与状态列同步的冗余字段，且无人对读），三个列上限在仓内单点持有，且脚本进模板库的落位问题有明确裁决 —— 三件事做完，`docs/REQ.md` 的形状由「手改表格 + 事后被门禁发现」变成「脚本写入口 + 门禁当场判红」。

## 下一步

把 `docs/evidence/20261005-123518-台账表格维护代价与脚本化方案.md` 的 §7.2 命令表里那个不存在的 `check` 命令删掉（工具只有六条命令；`check` 归门禁的 `check:docs`，早已在 `verify:ci` 上），改完跑 `npm run check:docs`。

## 完成标准

- [x] 墓碑 `~~` 在**规则（五处：全局配置目录 `REQ-RULES.md` 规则 2 ＋ 收尾时 · 全局配置目录 `WORKFLOW.md` 反馈三分类 ＋ 台账收口 · 模板占位行）/ 门禁 R7 / 夹具 / 已作废 30 行数据**同批撤销，且撤销后 `verify:ci` exit 0（2026-10-05）
- [ ] 三个上限常量在 `shared/markdown-table.mjs` **单点持有**，门禁已改为 import 它、本地副本已删（`grep TITLE_LIMIT gates/` 零命中）
- [ ] 台账两处过期表述订正：REQ-160 的理由（写着「仍只出声不判红」「待决定是否升判红」，而 Phase 0 正是做了那个决定）· REQ-194 转「已完成」
- [ ] 段二落位有明确裁决并记入 evidence（模板拷贝清单只有 8 份文档载体、无 `shared/` 与 `tools/` 这件事有答案）
- [ ] 全局配置目录 `REQ-RULES.md`（三步操作的工具标注）已提交，配置仓两条基线绿

## 修复项复测

- [ ] 撤销 R7 后，真实台账已作废节那 30 行 `~~` 保留现状**不判红**（这是 R7 撤销的唯一回归面）
- [ ] 列数守卫升判红后，真实台账仍 exit 0（行数会变，故不复述数值；取数命令见 evidence §二）

---

## 步序与泳道

| 步 | 工作项 | 目标 | 可写文件（不重叠） | 退出条件 | 门禁 | 结果 |
|---|---|---|---|---|---|---|
| #01 | REQ-194 | 删掉 evidence §7.2 里不存在的 `check` 命令，并订正「工具管 check」的相关表述 | `docs/evidence/20261005-123518-…md` | 该节命令表与 `node tools/req-edit.mjs` 的实际输出逐条一致 | `npm run check:docs` | 通过 2026-10-05（连带订正 §7.5 标题：那些判据归门禁） |
| #02 | REQ-194 | 跑一次干净的 `verify:ci`，确认全链绿（上一次的两条红来自另一窗口的未提交文件，已随其提交修掉） | 无（只读） | exit 0 | `npm run verify:ci` | 未开始 |
| #03 | REQ-194 | 提交全局配置目录 `REQ-RULES.md`（三步操作的工具标注，三条纪律声明 + 两条最易撞的坑） | 全局配置目录 `REQ-RULES.md` | 提交存在，且配置仓两条基线仍绿 | 全局配置目录 `node tools/check-pointers.mjs` · `node --test tools/ledger.test.mjs` | 未开始 |
| #04 | REQ-194 | 墓碑 `~~` 撤销**同批**：全局配置仓 **5 处**规则落点（全局配置目录 `REQ-RULES.md` 规则 2 ＋ 收尾时 · 全局配置目录 `WORKFLOW.md` 反馈三分类 ＋ 台账收口 · 模板占位行）＋ 下游 R7 判据 ＋ 其 selftest 夹具 ＋ 已作废 30 行数据 | 全局配置目录 `REQ-RULES.md` · 全局配置目录 `WORKFLOW.md` · 全局配置目录 `templates/docs-init/REQ.md` · `gates/repo/check-pointers.mjs` · `gates/repo/check-docs.selftest.mjs` · `test/gates/check-pointers-ledger.test.js` · `docs/REQ.md` | 五处规则一致撤销；已作废 30 行无 `~~`；判据数 8→7；全链绿 | `npm run verify:ci` | 通过 2026-10-05（`verify:ci` exit 0 · ledger 35 case / e2e 14 case / selftest 35 夹具 全绿） |
| #05 | REQ-194 | 台账订正：REQ-160 理由改为现状（列数守卫已判红）· REQ-194 转「已完成」 | `docs/REQ.md` | 两行表述与实现一致 | `npm run check:docs` · `npm run req:pool` | 未开始 |
| #06 | REQ-194 | 三个上限副本归一：门禁改 `import` `shared/markdown-table.mjs`，删 `check-pointers.mjs` 本地三份 | `gates/repo/check-pointers.mjs` · `shared/markdown-table.mjs` | `grep TITLE_LIMIT gates/` 零命中；单测与全链绿 | `npm run verify:ci` | 未开始 |
| #07 | REQ-194 | 段二落位裁决并记入 evidence（**待用户裁决后才能动手**） | `docs/evidence/20261005-123518-…md` · 全局配置目录 `templates/README.md` | 三条出路有明确选择与理由 | 全局配置目录 `node tools/check-pointers.mjs` | 未开始（**待裁决 3**） |

## 整体完成标准

- [ ] 上面 7 步全部「结果」列不再是「未开始」，且 #04 的规则/门禁两侧同批生效（不留「规则说不许、门禁说必须」的矛盾）
- [ ] `npm run verify:ci` 与配置仓两条基线同时绿
- [ ] REQ-194 可转「已完成」，其「为什么停在这」按已完成节上限降档重写，过程指向那份 evidence

## 怎么回滚

- #01 / #03 / #05 / #07 纯文档：`git revert <commit>` 即可，无外部依赖。
- #04 分两层回滚：配置仓与本仓是两个 git 仓库，**必须各回各的**；若只回滚一侧会立刻制造矛盾（规则改了门禁没改，或反之），此时应**两边一起回**。已作废 30 行的 `~~` 保留原样，所以数据侧无需回滚。
- #06 若 import 引发门禁假红，回滚只需恢复 `check-pointers.mjs` 的三份常量，`shared/markdown-table.mjs` 的导出不动（它是纯新增能力）。
- 全链若因并发读到他人的中间态而报红，那是**采样时刻问题不是回归**（判据：连跑三次报错内容不同）—— 重跑确认，不要顺着它改代码。