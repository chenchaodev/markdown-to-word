# REF-001 全库优化收尾

> 规则见全局配置目录 @CAMPAIGN-GUIDE.md
> 大型重构专用(判据 → 全局配置目录 @WORKFLOW-PLAN.md 阶段 0);编号规范 → 全局配置目录 @NUMBERING-GUIDE.md。两者均为单一事实源,本文件不复制规则。
> 四条硬约束:① `#NN` **永不改写**(进 commit 不可变历史),新增只追加到末尾;② 每行必须有**客观可判的退出条件 + 门禁命令**;③ 全部阶段关闭后执行归档五步,然后删除本目录;④ 每阶段收尾核对「人工验收」节,验完的项划掉并标日期。状态不在本文件维护 —— 阶段收尾手工更新同目录 `docs/campaigns/REF-001-全库优化收尾/STATE.md` 四行。

## 背景与目标

全库优化七阶段的实现与自动断言已落地,但收尾层的文档债务尚未处置:指针断链、常驻层容量超限、候选池双源(一份并行的项目级候选池文件 + `docs/ROADMAP.md`)、裁决散落在待撤除的优化计划里、阶段细节外泄进常驻层。阶段 0 把文档层收成可维护的目标形态,阶段 1 承接遗留的 GUI 目视验收。做完的判据:常驻层零断链、零超限、零阶段细节,候选与裁决各有单一真值,阶段细节只在本目录。

- **工作项**:`REF-001`(与 `docs/ROADMAP.md`「候选区」一致)
- **登记日期**:2026-09-26
- **规模**:L

## 裁决

> 只增不改。需长期保留的裁决在归档时**升为 `ADR-00N`**(不是编号继承,是 `D-0N → ADR-00N` 的转换);#06 已就地完成本次升格。
> ⚠️ **同格式异源消歧**:本表 `D-0N` 与已撤除的原优化计划 §1 中同格式的 `D-01~D-12` 是**两套号** —— 后者随 #07 撤除该文件一并升格进 `docs/ADR.md`(ADR-010~ADR-015),引用时必须带出处,不得只写 `D-03`。

| ID | 决策 | 理由 | 升 ADR |
|---|---|---|---|
| D-01 | 用户当场指令豁免「archive 只增不改 / 原文留痕」与「CHANGELOG 容量上限」两条全局约束 | 本轮 44 份 archive 需统一重命名(#08)、CHANGELOG 需按发布口径重写,两条约束会直接挡路;豁免由用户当场给出,不由 agent 自定 | ADR-009 |
| D-02 | 那份并行的项目级候选池文件废除,候选池单源落 `docs/ROADMAP.md`「候选区」;文件删除 | 全局 `templates/docs-init/ROADMAP.md` 明写「需求唯一入口 = 候选区(不另建第二份候选池文件)」,项目侧双源与之冲突 | ADR-009 |
| D-03 | 旧的两份全局指南(Windows 平台坑、CHANGELOG 写法)已分别并入 `ENV-GUIDE.md` / `PUBLISH-GUIDE.md`,项目侧**改指**而非补建同名文件 | 两个旧名在全局配置目录已不存在,补建会造成第二份真源;改指是唯一能同时消除断链与双源的做法 | ADR-009 |
| D-04 | 旧小节名以现行全局节名为准(例:全局「提交时」→「提交与推送」、「全局铁律 N」→ 安全底线编号) | 全局文件已改节名与编号,项目侧沿用旧名即为死指针;改指而非保留别名 | ADR-009 |
| D-05 | 验收矩阵的「不删行」判读为「不删功能点行」,不删的是每行下的散文块与已被后续口径取代的重复表述 | 该约束的目的是保住跨迭代验收资产不被清空,散文块与已废表述不在其列;按字面执行则 6,000 字符上限无法达成 | ADR-009 |

## 计划与阶段

> 阶段是计划项的**属性列**,不是独立层级;阶段边界 = 该阶段最后一个计划项完成时。「关联」可空:多数技术债项不来自用户需求。

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #01 | 0 | 立 campaign 骨架 + 编号台账起算 + 删无效自述 —— **已完成 `3ad3514`** | — | PLAN/STATE 就位,三处台账一致 | `node -e "const f=require('fs');for(const p of ['docs/ROADMAP.md','docs/ADR.md','docs/ACCEPTANCE.md']){const t=f.readFileSync(p,'utf8');if(!/台账/.test(t))throw new Error(p+' 缺台账')}console.log('ok')"` |
| #02 | 0 | 断链与死指针修正 —— **已完成 `f75b34e`** | — | 常驻层零悬空指针(#07 撤除 OPTIMIZATION-* 后本门禁覆盖全 `docs/`) | `grep -rn "WINDOWS-GUIDE\|CHANGELOG-GUIDE\|全局铁律\|「提交时」" AGENTS.md docs/ --include=*.md \| grep -vE "docs/(archive\|campaigns)/\|docs/OPTIMIZATION-"` 输出为空 |
| #03 | 0 | STATUS.md 重写 ≤1,200 —— **已完成 `57df1a0`** | #01 | 容量达标 + 四路分流无残留 | `node -e "const n=[...require('fs').readFileSync('docs/STATUS.md','utf8')].length;console.log(n);if(n>1200)process.exit(1)"` |
| #04 | 0 | ACCEPTANCE.md 重建 ≤6,000 —— **已完成 `b877315`** | #03 | 容量达标 + 功能点无丢失 | `node -e "const n=[...require('fs').readFileSync('docs/ACCEPTANCE.md','utf8')].length;console.log(n);if(n>6000)process.exit(1)"` |
| #05 | 0 | ROADMAP.md 重建 + 删 BACKLOG.md —— **已完成 `22d6a1f`** | #04 | 候选区覆盖全部未实现项 | 人工核对:逐条比对 BACKLOG 迁移前的每个候选行在 ROADMAP「候选区」或「已知限制」有落点 |
| #06 | 0 | ADR.md 补齐 ≤8,000/≤15 条 —— **已完成 `788b447`**(后续 `43ee341` 早期 ADR 拆入 `docs/adr/`) | #05 | D-0N 全部有落点(ADR-009~015) | `node -e "const s=require('fs').readFileSync('docs/ADR.md','utf8');const n=[...s].length,c=(s.match(/^### 20/gm)||[]).length;console.log(n,c);if(n>8000\|\|c>15)process.exit(1)"` |
| #07 | 0 | 阶段细节入 campaign + 删 OPTIMIZATION-* —— **已完成 `001409d`**(台账原文快照 `docs/archive/20260926-211455-…` 随本提交留档,见 #23) | #06 | 常驻层无阶段细节 | `ls docs/OPTIMIZATION-PLAN.md docs/OPTIMIZATION-CHECKLIST.md 2>&1 \| grep -c "No such file"` 输出为 `2` |
| #08 | 0 | archive 44 份命名统一 + 删 docs/README 存档清单节 —— **已完成 `75dd880`** | #02 | 零断链 | `git status --short docs/archive/` 全部为 `R`(重命名)且无 `D`/`??` |
| #09 | 0 | 代码/测试注释规划编号清洗 —— **已完成 `2f074ee`** | #07 | 规划编号零残留 | `npm run typecheck && npm run lint && npm run test:smoke` |
| #10 | 0 | 单源去重 5 项 —— **已完成 `e08cee1`** | #09 | 每项 grep 单一命中 | 逐项 `grep -rn "<该事实>" docs/ AGENTS.md` 只命中单一事实源文件 |
| #11 | 0 | docs/README + 根 README + README_EN —— **已完成 `b4b27b6`** | #08,#10 | 容量达标 + 零断链 | `node -e "for(const p of ['docs/README.md','README.md','README_EN.md']){const n=[...require('fs').readFileSync(p,'utf8')].length;console.log(p,n)}"` + `grep` 核对指针 |
| #12 | 0 | 项目 AGENTS.md 重写 ≤2,500 —— **已完成 `0ad9583`** | #11 | 容量达标 + 指针成立 | `node -e "const n=[...require('fs').readFileSync('AGENTS.md','utf8')].length;console.log(n);if(n>2500)process.exit(1)"` |
| #13 | 0 | 新增 scripts/check-docs-contract.mjs —— **已撤销(行保留,计划表是历史记录)**:全局配置目录 `check-pointers.mjs` 已具备项目模式(配置仓 commit `49dd23d`,非本仓历史),容量契约的单一来源是 `docs/README.md` 的容量表 + `AGENTS.md` 的 `≤N 字符` 声明行,再建项目内脚本会造第二份真源;本仓 `scripts/check-docs-contract.mjs` 不存在,门禁改跑 `node "C:/Users/chenc/.config/opencode/tools/check-pointers.mjs"` | #12 | ~~自测通过~~ 改为「全局项目模式 0 错误」 | `node "C:/Users/chenc/.config/opencode/tools/check-pointers.mjs"` |
| #14 | 0 | RESEARCH.md 拆主题二级标题 ≤40,000 —— **已完成**:9 个技术主题二级标题、44 条原条目零删减、PLAN「待升 RESEARCH」16 条升格为正式条目、3 类悬空指针(已撤除文件 / 不存在小节 / archive 旧名 16 处)全修 + ADR-007/008 改指 `docs/adr/` 真实路径;36,212 ≤ 40,000,`check-pointers` 项目模式 0 错误。**提交归属待主会话处理**:结构性改动已被并行 lane 的 `2fff4e3` 顺带提交(非本项编号),压缩增量待提交 | #07 | 容量达标 + 条目不删 | `node -e "const n=[...require('fs').readFileSync('docs/RESEARCH.md','utf8')].length;console.log(n);if(n>40000)process.exit(1)"` + 条目数不减 |
| #15 | 0 | 删 docs/design/book-wizard.md —— **已完成 `f5705b8`**:该设计稿已撤除(原文件不存在),原文留档 `docs/archive/20260926-212110-成书向导设计稿.md` | #11 | grep 零引用 | `grep -rn "book-wizard" . --include=*.md --include=*.html --include=*.ts --include=*.js \| grep -v docs/archive/` 输出为空 |
| #16 | 1 | 原 OPT-1.2 遗留:向导/模态/背景入口的 GUI 验收 | — | 真实窗口下向导与模态期间的背景入口无双触发,遮罩/Esc/关窗三条路径都结算 | 人工实测(PLAN「人工验收」节逐条核对) |
| #17 | 1 | 原 OPT-1 门禁遗留:双击/快捷键/模态/向导/关闭/保存失败的 GUI 实测 | — | 六条路径逐一确认无双触发与悬挂;保存失败保留编辑内容并显示失败反馈 | 人工实测(PLAN「人工验收」节逐条核对) |
| #18 | 1 | 原 OPT-4.1 遗留:真实窗口 GUI/键盘全链路验收 | — | dropZone 与内部控件的冒泡隔离在真实窗口成立,舞台/参数条无抖动 | 人工实测(PLAN「人工验收」节逐条核对) |
| #19 | 1 | 原 OPT-4.2 遗留:冷启动/语言切换/主题切换 GUI 实测 | — | 无白闪与设置跳变;菜单、动态状态、标题栏即时更新 | 人工实测(PLAN「人工验收」节逐条核对) |
| #20 | 1 | 原 OPT-4.3 遗留:预设/取消/复制反馈 GUI 实测 | — | 内置预设按完整交付链生效、取消为中性态、复制反馈复位 | 人工实测(PLAN「人工验收」节逐条核对) |
| #21 | 1 | 原 OPT-4.4 遗留:纯键盘/读屏与深浅主题目视验收 | — | 纯键盘/读屏可走完选择→预览→排序→设置→向导→预检→取消→错误恢复;深浅主题对比度达标 | 人工实测(PLAN「人工验收」节逐条核对) |
| #22 | 1 | 原 OPT-7 遗留:允许版本线内 patch/minor 的逐包裁决 | — | 每个待升依赖有「升/不升」书面结论;可自动判定的部分由 `check:contract` 覆盖,许可本身是人工裁决 | `npm ls <包>` 无 peer 告警 + `npm run typecheck && npm run lint && npm run test:smoke` |
| #23 | 0 | `#07 补充` 留存已撤除的全库优化计划与执行台账原文快照 → `docs/archive/20260926-211455-全库优化计划与执行台账.md` —— **已完成,快照随 `001409d`(#07)一并落盘**;号取 23 是为避开阶段 1 已占用的 #16~#22 | #07 | 快照文件存在且 `docs/archive/` 内无同名重复 | `ls docs/archive/20260926-211455-全库优化计划与执行台账.md` 存在 |

## 人工验收（≤5 条；campaign 期间只写在本节，不写 `docs/ACCEPTANCE.md`）

> **本节是归档五步第 4 步的唯一输入源**(回填 `docs/ACCEPTANCE.md` 覆盖矩阵,`工作项` 列 = 本工作项 ID)。行为等价重构通常**没有**人工验收项:写「无 —— 行为等价,验收判据全部门禁命令」一行,归档第 4 步据本行判断并**不新增行**。有则一行一条,通过后划掉并标 `· <YYYY-MM-DD>`。
> 阶段 0 全部计划项为文档整改,零用户可见变化,人工验收项集中在阶段 1(#16~#21)与下列遗留目视确认。

- [ ] WPS 打开 `output/artifacts/math-structures.docx`:display `∑` 不显示方框、被加数不丢失、上下限排在上下方(自动断言只锁 OOXML 结构,验不了观感)
- [ ] 同一样例:列表项内 display 公式对齐到列表内容栏(不按整页宽度居中飘出列表)
- [ ] 同一样例:引用块灰底连续覆盖整块(表格与代码块同样带底色,无悬空灰带)
- [ ] Word/WPS 打开公式产物:行内/行间公式的实际排版效果与视觉观感
- [ ] 真实安装后用户视角:开始菜单可启动、可转换一份文档、「应用和功能」可正常卸载

## 已完成阶段索引（阶段 0-7，#07 撤除原优化计划与执行台账时留档）

> 逐项完成情况的真值是 `git log --oneline --grep='(#'` 与各阶段提交;本索引只保留「阶段 → 结论 → 证据」一行,**不含阶段细节**(细节查 git 与 `docs/RESEARCH.md`)。

| 阶段 | 结论 | 证据 |
|---|---|---|
| 0 决策/基线/门禁 | 本地完成;远端 lane 证据后置 | `d97e14f`;`check:ci` 契约脚本 + 环境指纹 + 几何/产物/clean 门禁 |
| 1 single-flight/持久化 | 实现与自动断言完成,GUI 遗留转 #16/#17 | `a8aa428` |
| 2 内容/几何/输出 | 完成(D-03 媒体限制由阶段 3 预算承接) | `1180218`、2A/2B 提交 |
| 3 资源/生命周期 | 完成 | `3c429c8` |
| 4 renderer UX | 自动断言完成,GUI 遗留转 #18~#21 | `499a6bc` |
| 5 边界/双管线/测试 | 完成 | `02cfd59`、`004b4ab`、`2cdd08a`、`5c8572d`、`629b3b2`、`529810e`、`583f345` |
| 6 发布/视觉/安装 | 可执行部分完成;远端 lane 与真实装卸的外部证据已补齐/后置 | `00f3ea4`、`91b1d3a`、`ac6fefc`、`10e7fce`、`d8f1429` |
| 7 P2/P3 | 完成;依赖 patch/minor 裁决遗留转 #22 | `verify:ci` 全绿 + 门禁反向探针 + 跨 DPI 基线 |

**提交归属易误判处(查 git log 前先读这段,2026-09-26 记)**

> 上表是本 campaign *收尾*的前身七阶段;本 campaign 计划项的 commit 不在上表,完整映射见上方「计划与阶段」表各行。以下三条是 `git log` 直查会误判的特例。

- **#23 与 #07 同处一条提交 `001409d`**:#23 的快照 `docs/archive/20260926-211455-全库优化计划与执行台账.md`(751 行)原由独立提交 `5c2b155`(`docs(存档): 留存撤除的全库优化计划与执行台账原文快照 (REF-001 #23)`)落盘,后被 **#07 的 amend 吞并**。`5c2b155` 现在**只在 reflog 与对象库**(`HEAD@{14}: commit (amend)`):`git branch --contains 5c2b155` 为空、`git merge-base --is-ancestor 5c2b155 master` 为假 —— **不在 master 可达历史上**。故 `git log --grep='(REF-001 #23)'` 查不到结果是预期行为、不是丢提交;取该快照用 `git show 001409d -- docs/archive/20260926-211455-全库优化计划与执行台账.md`。**用户裁决:不改历史**(不 rebase、不 cherry-pick 复原),只在此注明。
- **#15 = `f5705b8`**(`docs(设计): 撤除已过时的向导设计稿并留档 (REF-001 #15)`):撤除 docs/design 下的向导设计稿(原文件已不存在,故正文不写该路径,免被门禁判死链),原文留档 `docs/archive/20260926-212110-成书向导设计稿.md`。
- **#14 无独立编号提交**:结构性改动(9 主题分节 + 压缩 + 16 条升格)被并行 lane 的 `2fff4e3`(`fix(测试): 二层探针子进程不继承覆盖采集环境…`)顺带提交,`git log --grep='(REF-001 #14)'` 同样查不到;该 lane 另在同一文件插入一条自己的实测条目。

**原「完整问题覆盖索引」(计划 ID ↔ 覆盖的 canonical 问题 ↔ 阶段)与「每个任务的完成定义」的落点**:前者是本 campaign 计划项表(#01~#22)与已落地证据的映射,证据在 git;后者的七条完成定义由本文件硬约束②(客观可判的退出条件 + 门禁命令)与 `docs/DEV-GUIDE.md`「验证基线」节承担。

**原「执行前待办」的落点**:登记 BACKLOG/ROADMAP → 已由 #05 完成(候选区 + 台账);读 `CODE-GUIDE.md` → 项目 `AGENTS.md`「代码结构与质量」行;读 Windows 坑指南 → 已由 #02 改指 `ENV-GUIDE.md`。

## 待升 RESEARCH 的技术事实（#14 承接）

> **本段已清空 —— 16 条全部由 #14 升格为 `docs/RESEARCH.md` 正式条目(结论/理由/验证/来源/关联五段齐备),分布见该文件「依赖与工具链」「Electron 主进程与安全」「测试与门禁」「供应链与发布」四节,时间戳统一 `2026-09-26 21:14:55`。** 本段保留作为占位:**若后续阶段再产生同类库/框架实测事实,先在此留证,再由下一个文档整改项升格(条目只增不删)。
> 另:`docs/RESEARCH.md` 容量契约(≤40,000 字符)与本段的冲突由 #14 收尾时上报,详见该提交的报告。
## 范围外

- 代码、测试、脚本、构建配置与依赖清单的任何行为改动(阶段 0 只动文档;阶段 1 的 GUI 实测发现问题另按模式 1 登记新工作项)
- 发版动作:打 tag、push、改版本号、重写 CHANGELOG 版本条目(由主会话按 `PUBLISH-GUIDE.md` 在阶段 0 完成后单独执行)
- GitHub Actions 远端 lane 实跑证据(需推送授权,不属本 campaign 可自行完成项)
- `docs/archive/` 原文的**内容**修订(仅按 #08 统一文件命名,不改写正文)

## 风险与中止条件

- 连续 2 个阶段门禁未通过 → 暂停并重新裁决范围
- #05(废除那份并行的候选池文件)与 #07(撤除 `OPTIMIZATION-*`)是**不可逆删除**:删前逐条指认候选/裁决/事实的新落点,指不出即停,不得先删后补
- 阶段 1 的 GUI 验收依赖用户目视;用户长时间不可用时按 `CAMPAIGN-GUIDE.md` 四走挂起(须用户确认,agent 不得自行挂起)
