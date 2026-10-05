# 台账维护工具段二收尾：撤销墓碑 · 上限归一 · 段二落位裁决

> 相关 ADR 的结论与依据见 [`docs/evidence/20261005-123518-台账表格维护代价与脚本化方案.md`](evidence/20261005-123518-台账表格维护代价与脚本化方案.md)（本任务的完整方案、耦合面实测与三次落位更正过程都在那份）。判定归属按 ADR-054 决定二「对象在哪」—— 本仓对象上的判据实例归本仓。

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处，本文件不复制；那里也只写命令、不写结果。配置仓另有一条基线：`node tools/check-pointers.mjs` 与 `node --test tools/ledger.test.mjs`。

## 目标

台账不再要求人工用 `~~` 划墓碑（该标记是必须与状态列同步的冗余字段，且无人对读），三个列上限在仓内单点持有，且脚本进模板库的落位问题有明确裁决 —— 三件事做完，`docs/REQ.md` 的形状由「手改表格 + 事后被门禁发现」变成「脚本写入口 + 门禁当场判红」。

## 下一步

七步全部走完。**本载体下一步是删除** —— 全局配置目录 `REQ-RULES.md` 规则 7：`PLAN.md` 只承载执行中状态，做完即删。删除前先确认下面的「整体完成标准」全部满足。

## 完成标准

- [x] 墓碑 `~~` 在**规则（五处：全局配置目录 `REQ-RULES.md` 规则 2 ＋ 收尾时 · 全局配置目录 `WORKFLOW.md` 反馈三分类 ＋ 台账收口 · 模板占位行）/ 门禁 R7 / 夹具 / 已作废 30 行数据**同批撤销，且撤销后 `verify:ci` exit 0（2026-10-05）
- [x] 三个上限常量在 `shared/markdown-table.mjs` **单点持有**，门禁已改为 import 它、本地副本已删（三个上限的**声明**在 `gates/` 零命中，2026-10-05）
- [x] 台账三处过期表述订正：REQ-160 的理由（写着「仍只出声不判红」，而 Phase 0 已升判红）与其重看条件（已消解）· 段二析出为 REQ-210 · REQ-194 转「已完成」（2026-10-05）
- [x] 段二落位有明确裁决并记入 evidence（用户选**①**：落位面从「只有 8 份文档载体」扩到含代码树；连带裁掉两处原文没算到的事实 —— 真实闭包 5 个文件、模板版 `paths.js` 只含 `ROOT`。**落地本身析出为 REQ-210**，2026-10-05）
- [x] 全局配置目录 `REQ-RULES.md`（三步操作的工具标注）已提交，配置仓两条基线绿

## 修复项复测

- [x] 撤销 R7 后，真实台账已作废节那 30 行 `~~` 保留现状**不判红**（`check-pointers.mjs` exit 0，2026-10-05）
- [x] 列数守卫升判红后，真实台账仍 exit 0（`checkLedgerShape` 209 行全判、0 findings；行数会变，故不复述数值，取数命令见 evidence §二）
- [x] 归一后 `checkLedgerShape` 覆盖面**未掉**（`examined` 209/209，与归一前同档；门禁常量改成 import 后仍由 `CARRIER_RULES` 与判红处消费，2026-10-05）
- [x] `shared/markdown-table.mjs` 入类型检查面后 8 条既存潜伏错清零（`typecheck` exit 0，2026-10-05）

## 本轮新增的两条坑（写下是因为下一个人会撞，且现象都**不像**真因）

1. **JSDoc 正文里的 ``` 字面量会截断该注释的 `@param`** —— TS 的 JSDoc 解析器把它当代码块起点，后面的 `@param` 被吞成代码块**内容**，于是该参数类型整个失效并报 TS7006「隐式 any」。**现象与「忘了写 `@param`」完全无法区分**（本轮就先是这么误判的）。判定法：写一个只变这一个变量的对照（正文干净 / 单反引号 / 三反引号三个函数）跑 tsc —— 只有三反引号那个红。已写进 `shared/markdown-table.mjs` 的 `maskFencedLines` 注释里。
2. **`shared/markdown-table.mjs` 此前从未进入类型检查面** —— 它带 `// @ts-check`，但 `tsconfig.test.json` 的 `include` 只有 `test`，而当时**没有任何 `test/` 文件 import 它**（门禁那份还是私有实现，`tools/` 不在 `include` 内）⇒ 它的 8 条 `noUncheckedIndexedAccess` 错一直躺着。#06 让两段测试直接引它，文件才入面、欠账才浮出。**含义：「带 `@ts-check`」不等于「被检查过」**，判据是「有没有人从 `include` 面 import 它」。

⚠️ 连带修正两处**类型与代码不同真**的地方（改代码结构而非加假守卫）：`tableBlocks` 原先「先建空块再 push 行」，把它标成「首元素必有」会当场翻脸 ⇒ 改成建块即放入触发行（产出的块内容逐字相同）；`rangeTable` 与 `sectionByLine` 的下标取值用 `?? ''` 收窄，且**每处都写了它恒不触发的前置守卫**，不留永不触发的假兜底。

---

## 步序与泳道

| 步 | 工作项 | 目标 | 可写文件（不重叠） | 退出条件 | 门禁 | 结果 |
|---|---|---|---|---|---|---|
| #01 | REQ-194 | 删掉 evidence §7.2 里不存在的 `check` 命令，并订正「工具管 check」的相关表述 | `docs/evidence/20261005-123518-…md` | 该节命令表与 `node tools/req-edit.mjs` 的实际输出逐条一致 | `npm run check:docs` | 通过 2026-10-05（连带订正 §7.5 标题：那些判据归门禁） |
| #02 | REQ-194 | 跑一次干净的 `verify:ci`，确认全链绿（上一次的两条红来自另一窗口的未提交文件，已随其提交修掉） | 无（只读） | exit 0 | `npm run verify:ci` | 未开始 |
| #03 | REQ-194 | 提交全局配置目录 `REQ-RULES.md`（三步操作的工具标注，三条纪律声明 + 两条最易撞的坑） | 全局配置目录 `REQ-RULES.md` | 提交存在，且配置仓两条基线仍绿 | 全局配置目录 `node tools/check-pointers.mjs` · `node --test tools/ledger.test.mjs` | 未开始 |
| #04 | REQ-194 | 墓碑 `~~` 撤销**同批**：全局配置仓 **5 处**规则落点（全局配置目录 `REQ-RULES.md` 规则 2 ＋ 收尾时 · 全局配置目录 `WORKFLOW.md` 反馈三分类 ＋ 台账收口 · 模板占位行）＋ 下游 R7 判据 ＋ 其 selftest 夹具 ＋ 已作废 30 行数据 | 全局配置目录 `REQ-RULES.md` · 全局配置目录 `WORKFLOW.md` · 全局配置目录 `templates/docs-init/REQ.md` · `gates/repo/check-pointers.mjs` · `gates/repo/check-docs.selftest.mjs` · `test/gates/check-pointers-ledger.test.js` · `docs/REQ.md` | 五处规则一致撤销；已作废 30 行无 `~~`；判据数 8→7；全链绿 | `npm run verify:ci` | 通过 2026-10-05（`verify:ci` exit 0 · ledger 35 case / e2e 14 case / selftest 35 夹具 全绿） |
| #05 | REQ-194 | 台账订正：REQ-160 理由改为现状（列数守卫已判红）· 段二析出为新号 · REQ-194 转「已完成」 | `docs/REQ.md` | 各行表述与实现一致 | `npm run check:docs` · `npm run req:pool` | 通过 2026-10-05（REQ-160 理由＋重看条件已改 · 新登记 REQ-210「台账脚本进模板库（段二落位）」状态「未开工」· 号段两格同步 · REQ-194 搬进「已完成」节） |
| #06 | REQ-194 | 三个上限副本归一：门禁改 `import` `shared/markdown-table.mjs`，删 `check-pointers.mjs` 本地三份 | `gates/repo/check-pointers.mjs` · `shared/markdown-table.mjs` | **三个上限的「声明」在 `gates/` 零命中**（`grep -rnE '^\s*(export\s+)?const\s+(TITLE_LIMIT\|WHY_LIMIT\|WHY_LIMIT_DONE)' gates/`）—— 判据是**声明**不存在，不是**名字**不出现：消费点（`CARRIER_RULES`、判红处、selftest、两段单测）照常出现这三个名字；单测与全链绿 | `npm run verify:ci` | 通过 2026-10-05（声明零命中 · 三值 `30/250/150` 未动 · C1/C2 文案逐字未变 · `checkLedgerShape` 209 行全判 0 findings） |
| #07 | REQ-194 | 段二落位裁决并记入 evidence（**待用户裁决后才能动手**） | `docs/evidence/20261005-123518-…md` | 三条出路有明确选择与理由 | `npm run check:docs` | 通过 2026-10-05（用户选**①**：落位面扩到含代码树。**本轮只记裁决，段二落地析出为 REQ-210** —— 原表把可写文件写成含全局配置目录 `templates/README.md`，那是「执行段二」才需要动的文件，与「记裁决」不属一件事） |
| #08 | REQ-194 | 门禁侧解析层改 import：删 11 份私有声明（9 个解析函数 + 形状适配器 `blockHeadAndRows` + 只被一处使用的 `stripTicks`），`shared/` 补 `maskFencedLines` / `sectionByLine` 两个 `export`；`isSeparatorRow` 口径按裁决**收窄**回「只 trim」 | `gates/repo/check-pointers.mjs` · `shared/markdown-table.mjs` | 私有声明 grep 零命中；`shared/` 除 `isSeparatorRow` 收窄外零函数体改动；**判定 `push` 行改动数 0**；门禁对真实台账输出不变；**负向夹具双向验过**（窄 41 全绿 / 宽恰好 3 条转红） | `npm run verify:ci` | 通过 2026-10-05（判据 `push` 行 0 改动 · 规则表值未动 · 空节/非登记表两态实测正确 · `isSeparatorRow` 经「放宽→收窄」反转后与 HEAD 行为一致，见下） |

### #08 的两处「不是等价替换」（登记在此，因为它们不产生红灯）

1. **`isSeparatorRow` 收窄过一次，方向与 §7.1「取并集」相反。** 归一时**直接采用了 `shared/` 的宽口径**（先剥 `` ` `` 与 `*`），依据是「197 份 md 跑出 0 差异」—— **那个依据是无效的**：语料 100% 是正例、一条带装饰的伪分隔行都没有，对负空间零证明力。实测反例：宽口径下 `` | `---` | `` 被当合法 delimiter 放过，而 GFM 不认它 ⇒ 整块不渲染成表格 ⇒ `checkTableShape` **findings=0（假绿）**；该行落在**表块中段**时更隐蔽 —— `locateRegistry` 跳过它 ⇒ 不进数据行集 ⇒ R 族「号形态错」**零判且零出声**（HEAD 对照：errors=1 → errors=0）。**经用户裁决收窄回「只 trim」**，且**收窄位置必须选 `shared/` 那一层**：第一版在门禁侧加包装，漏掉了 `locateRegistry` 内部那处（它在 `shared/` 里，门禁的包装管不到）。收窄后对 `req-edit.mjs` 零影响（真实台账 4 个块逐字相同）。
2. **`checkTableShape` 的 `rows.length < 2` → `< 1`。** `tableBlocks` 新形状的 `rows` 不含表头，两者语义等价。**照旧形状的数改回去会静默漏判「只有表头+分隔行」的空节** —— 空节是合法态、判 0 错，故那个错**一个红灯都不会有**。

## 整体完成标准

- [x] 上面 7 步全部「结果」列不再是「未开始」，且 #04 的规则/门禁两侧同批生效（不留「规则说不许、门禁说必须」的矛盾）
- [x] `npm run verify:ci` 与配置仓两条基线同时绿（`verify:ci` exit 0 · 配置仓指针门禁 0 错误 26 份 · `ledger.test` 45 pass / 0 fail，2026-10-05）
- [x] REQ-194 已转「已完成」，其「为什么停在这」按已完成节上限降档重写（工具两次拒收超限的写入，正是分档在生效），过程指向那份 evidence

## 怎么回滚

- #01 / #03 / #05 / #07 纯文档：`git revert <commit>` 即可，无外部依赖。
- #04 分两层回滚：配置仓与本仓是两个 git 仓库，**必须各回各的**；若只回滚一侧会立刻制造矛盾（规则改了门禁没改，或反之），此时应**两边一起回**。已作废 30 行的 `~~` 保留原样，所以数据侧无需回滚。
- #06 若 import 引发门禁假红，回滚只需在 `check-pointers.mjs` 恢复三份常量声明并撤掉那行 import，`shared/markdown-table.mjs` 的导出不动（它是纯新增能力）。**连带须回三处指针**：`docs/DEV-GUIDE.md` 代码地图那行 · 本仓 `AGENTS.md` 的「改数值要改四处」第一处 · evidence §7.9 的「段二由门禁改为 import」那句 —— 留着它们会指向一个已撤销的形态。
- 全链若因并发读到他人的中间态而报红，那是**采样时刻问题不是回归**（判据：连跑三次报错内容不同）—— 重跑确认，不要顺着它改代码。