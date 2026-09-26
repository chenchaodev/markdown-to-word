# REF-001 全库优化收尾

> 规则见全局配置目录 @CAMPAIGN-GUIDE.md
> 大型重构专用(判据 → 全局配置目录 @WORKFLOW-PLAN.md 阶段 0);编号规范 → 全局配置目录 @NUMBERING-GUIDE.md。两者均为单一事实源,本文件不复制规则。
> 四条硬约束:① `#NN` **永不改写**(进 commit 不可变历史),新增只追加到末尾;② 每行必须有**客观可判的退出条件 + 门禁命令**;③ 全部阶段关闭后执行归档五步,然后删除本目录;④ 每阶段收尾核对「人工验收」节,验完的项划掉并标日期。状态不在本文件维护 —— 阶段收尾手工更新同目录 `STATE.md` 四行。

## 背景与目标

全库优化七阶段的实现与自动断言已落地,但收尾层的文档债务尚未处置:指针断链、常驻层容量超限、候选池双源(`BACKLOG.md` + `ROADMAP.md`)、裁决散落在待撤除的优化计划里、阶段细节外泄进常驻层。阶段 0 把文档层收成可维护的目标形态,阶段 1 承接遗留的 GUI 目视验收。做完的判据:常驻层零断链、零超限、零阶段细节,候选与裁决各有单一真值,阶段细节只在本目录。

- **工作项**:`REF-001`(与 `../../ROADMAP.md`「候选区」一致)
- **登记日期**:2026-09-26
- **规模**:L

## 裁决

> 只增不改。需长期保留的裁决在归档时**升为 `ADR-00N`**(不是编号继承,是 `D-0N → ADR-00N` 的转换);#06 已就地完成本次升格。
> ⚠️ **同格式异源消歧**:本表 `D-0N` 与已撤除的 `docs/OPTIMIZATION-PLAN.md` §1 中同格式的 `D-01~D-12` 是**两套号** —— 后者随 #07 撤除该文件一并升格进 `../../ADR.md`(ADR-010~ADR-015),引用时必须带出处,不得只写 `D-03`。

| ID | 决策 | 理由 | 升 ADR |
|---|---|---|---|
| D-01 | 用户当场指令豁免「archive 只增不改 / 原文留痕」与「CHANGELOG 容量上限」两条全局约束 | 本轮 44 份 archive 需统一重命名(#08)、CHANGELOG 需按发布口径重写,两条约束会直接挡路;豁免由用户当场给出,不由 agent 自定 | ADR-009 |
| D-02 | `docs/BACKLOG.md` 废除,候选池单源落 `ROADMAP.md`「候选区」;文件删除 | 全局 `templates/docs-init/ROADMAP.md` 明写「需求唯一入口 = 候选区(不另建 BACKLOG.md)」,项目侧双源与之冲突 | ADR-009 |
| D-03 | `WINDOWS-GUIDE.md` / `CHANGELOG-GUIDE.md` 已并入 `ENV-GUIDE.md` / `PUBLISH-GUIDE.md`,项目侧**改指**而非补建同名文件 | 两个旧名在全局配置目录已不存在,补建会造成第二份真源;改指是唯一能同时消除断链与双源的做法 | ADR-009 |
| D-04 | 旧小节名以现行全局节名为准(例:全局「提交时」→「提交与推送」、「全局铁律 N」→ 安全底线编号) | 全局文件已改节名与编号,项目侧沿用旧名即为死指针;改指而非保留别名 | ADR-009 |
| D-05 | `ACCEPTANCE.md` 的「不删行」判读为「不删功能点行」,不删的是每行下的散文块与已被后续口径取代的重复表述 | 该约束的目的是保住跨迭代验收资产不被清空,散文块与已废表述不在其列;按字面执行则 6,000 字符上限无法达成 | ADR-009 |

## 计划与阶段

> 阶段是计划项的**属性列**,不是独立层级;阶段边界 = 该阶段最后一个计划项完成时。「关联」可空:多数技术债项不来自用户需求。

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #01 | 0 | 立 campaign 骨架 + 编号台账起算 + 删无效自述 | — | PLAN/STATE 就位,三处台账一致 | `node -e "const f=require('fs');for(const p of ['docs/ROADMAP.md','docs/ADR.md','docs/ACCEPTANCE.md']){const t=f.readFileSync(p,'utf8');if(!/台账/.test(t))throw new Error(p+' 缺台账')}console.log('ok')"` |
| #02 | 0 | 断链与死指针修正 | — | 全库零悬空指针 | `grep -rn "WINDOWS-GUIDE\|CHANGELOG-GUIDE\|全局铁律\|AGENTS.md「提交时」" AGENTS.md docs/ --include=*.md \| grep -v docs/archive/` 输出为空 |
| #03 | 0 | STATUS.md 重写 ≤1,200 | #01 | 容量达标 + 四路分流无残留 | `node -e "const n=[...require('fs').readFileSync('docs/STATUS.md','utf8')].length;console.log(n);if(n>1200)process.exit(1)"` |
| #04 | 0 | ACCEPTANCE.md 重建 ≤6,000 | #03 | 容量达标 + 功能点无丢失 | `node -e "const n=[...require('fs').readFileSync('docs/ACCEPTANCE.md','utf8')].length;console.log(n);if(n>6000)process.exit(1)"` |
| #05 | 0 | ROADMAP.md 重建 + 删 BACKLOG.md | #04 | 候选区覆盖全部未实现项 | 人工核对:逐条比对 BACKLOG 迁移前的每个候选行在 ROADMAP「候选区」或「已知限制」有落点 |
| #06 | 0 | ADR.md 补齐 ≤8,000/≤15 条 | #05 | D-0N 全部有落点 | `node -e "const s=require('fs').readFileSync('docs/ADR.md','utf8');const n=[...s].length,c=(s.match(/^### /gm)||[]).length;console.log(n,c);if(n>8000\|\|c>15)process.exit(1)"` |
| #07 | 0 | 阶段细节入 campaign + 删 OPTIMIZATION-* | #06 | 常驻层无阶段细节 | `ls docs/OPTIMIZATION-PLAN.md docs/OPTIMIZATION-CHECKLIST.md 2>&1 \| grep -c "No such file"` 输出为 `2` |
| #08 | 0 | archive 44 份命名统一 + 删 docs/README 存档清单节 | #02 | 零断链 | `git status --short docs/archive/` 全部为 `R`(重命名)且无 `D`/`??` |
| #09 | 0 | 代码/测试注释规划编号清洗 | #07 | 规划编号零残留 | `npm run typecheck && npm run lint && npm run test:smoke` |
| #10 | 0 | 单源去重 5 项 | #09 | 每项 grep 单一命中 | 逐项 `grep -rn "<该事实>" docs/ AGENTS.md` 只命中单一事实源文件 |
| #11 | 0 | docs/README + 根 README + README_EN | #08,#10 | 容量达标 + 零断链 | `node -e "for(const p of ['docs/README.md','README.md','README_EN.md']){const n=[...require('fs').readFileSync(p,'utf8')].length;console.log(p,n)}"` + `grep` 核对指针 |
| #12 | 0 | 项目 AGENTS.md 重写 ≤2,500 | #11 | 容量达标 + 指针成立 | `node -e "const n=[...require('fs').readFileSync('AGENTS.md','utf8')].length;console.log(n);if(n>2500)process.exit(1)"` |
| #13 | 0 | 新增 scripts/check-docs-contract.mjs | #12 | 自测通过 | `node scripts/check-docs-contract.mjs` |
| #14 | 0 | RESEARCH.md 拆主题二级标题 ≤40,000 | #07 | 容量达标 + 条目不删 | `node -e "const n=[...require('fs').readFileSync('docs/RESEARCH.md','utf8')].length;console.log(n);if(n>40000)process.exit(1)"` + 条目数不减 |
| #15 | 0 | 删 docs/design/book-wizard.md | #11 | grep 零引用 | `grep -rn "book-wizard" . --include=*.md --include=*.html --include=*.ts --include=*.js \| grep -v docs/archive/` 输出为空 |
| #16 | 1 | 阶段 1 GUI 验收:向导/模态/背景入口单触发 | — | 用户 GUI 目视确认双击/快捷键/模态/向导/关闭/保存失败六条路径无双触发与悬挂 | 人工实测(PLAN「人工验收」节逐条核对) |
| #17 | 1 | 阶段 1 GUI 验收:设置保存失败可见反馈 | — | 保存失败保留编辑内容并显示失败反馈,恢复后重试成功 | 人工实测(PLAN「人工验收」节逐条核对) |
| #18 | 1 | 阶段 4 GUI 验收:冷启动/语言切换/主题切换 | — | 无白闪与设置跳变;菜单、动态状态、标题栏即时更新 | 人工实测(PLAN「人工验收」节逐条核对) |
| #19 | 1 | 阶段 4 GUI 验收:预设/取消/复制反馈 | — | 真实窗口下预设套用、取消中性态、复制反馈表现正确 | 人工实测(PLAN「人工验收」节逐条核对) |
| #20 | 1 | 阶段 4 GUI 验收:纯键盘与读屏全链路 | — | 纯键盘/读屏可完成选择→预览→排序→设置→向导→预检→取消→错误恢复 | 人工实测(PLAN「人工验收」节逐条核对) |
| #21 | 1 | 阶段 4 GUI 验收:深浅主题目视与对比度 | — | 深浅主题对比度达标,about 主题一致 | 人工实测(PLAN「人工验收」节逐条核对) |
| #22 | 1 | 依赖 patch/minor 升级裁决(允许版本线内) | — | 每个待升依赖有「升/不升」书面结论并按分级过验证基线 | `npm ls <包>` 无 peer 告警 + `npm run typecheck && npm run lint && npm run test:smoke` |

## 人工验收（≤5 条；campaign 期间只写在本节，不写 `../../ACCEPTANCE.md`）

> **本节是归档五步第 4 步的唯一输入源**(回填 `../../ACCEPTANCE.md` 覆盖矩阵,`工作项` 列 = 本工作项 ID)。行为等价重构通常**没有**人工验收项:写「无 —— 行为等价,验收判据全部门禁命令」一行,归档第 4 步据本行判断并**不新增行**。有则一行一条,通过后划掉并标 `· <YYYY-MM-DD>`。
> 阶段 0 全部计划项为文档整改,零用户可见变化,人工验收项集中在阶段 1(#16~#21)与下列遗留目视确认。

- [ ] WPS 打开 `output/artifacts/math-structures.docx`:display `∑` 不显示方框、被加数不丢失、上下限排在上下方(自动断言只锁 OOXML 结构,验不了观感)
- [ ] 同一样例:列表项内 display 公式对齐到列表内容栏(不按整页宽度居中飘出列表)
- [ ] 同一样例:引用块灰底连续覆盖整块(表格与代码块同样带底色,无悬空灰带)
- [ ] Word/WPS 打开公式产物:行内/行间公式的实际排版效果与视觉观感
- [ ] 真实安装后用户视角:开始菜单可启动、可转换一份文档、「应用和功能」可正常卸载

## 范围外

- 代码、测试、脚本、构建配置与依赖清单的任何行为改动(阶段 0 只动文档;阶段 1 的 GUI 实测发现问题另按模式 1 登记新工作项)
- 发版动作:打 tag、push、改版本号、重写 CHANGELOG 版本条目(由主会话按 `PUBLISH-GUIDE.md` 在阶段 0 完成后单独执行)
- GitHub Actions 远端 lane 实跑证据(需推送授权,不属本 campaign 可自行完成项)
- `docs/archive/` 原文的**内容**修订(仅按 #08 统一文件命名,不改写正文)

## 风险与中止条件

- 连续 2 个阶段门禁未通过 → 暂停并重新裁决范围
- #05(废除 `BACKLOG.md`)与 #07(撤除 `OPTIMIZATION-*`)是**不可逆删除**:删前逐条指认候选/裁决/事实的新落点,指不出即停,不得先删后补
- 阶段 1 的 GUI 验收依赖用户目视;用户长时间不可用时按 `CAMPAIGN-GUIDE.md` 四走挂起(须用户确认,agent 不得自行挂起)
