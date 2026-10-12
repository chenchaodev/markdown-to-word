# 183 及之后待办全量执行计划

> 相关 ADR 给约束,验证基线给命令,下一步是要动的那个动作。工作项号与状态在 [REQ.md](REQ.md) 台账 —— 本文件不写编号纪律。

## 相关 ADR

- `docs/adr/ADR-062-测试树位置即身份与门禁元框架瘦身.md`:L1(段↔主体一对一)与 P3(删 fixtures 生成器)未落地;对账第二道证据待补(:197 已订正过一次,缺的是白名单补充)。REQ-183 / 196 / 209 的依据。
- `docs/adr/ADR-064-源码树一职责一文件与内部边界判据.md`:gates 树 no-undef 兜底的覆盖面表述与实测不符(shared/ 今日脱扫)。REQ-237 的依据。
- `docs/adr/ADR-065-renderer功能层注入式重构.md`:③ 模块级可变状态收敛进 state/ 未做。REQ-241 的依据;ADR-076 把 dom-ops 搬进基础层后,trapStack / focusOriginStack 归属需在该步重裁。
- `docs/adr/ADR-066-转换契约类型化.md`:能力声明按 YAGNI 撤步、清单留在 convert.ts 头注 ⇒ REQ-224 已是一个布尔常量而非结构性缺失。
- `docs/adr/ADR-073-c8扫描面收窄到只收js产物.md`:`--include` 取值无对读。REQ-231 的依据。
- `docs/adr/ADR-074-自测用例契约搬shared与表格化护栏边界.md`:门禁树侧 named-case 族已转 fail-closed(REQ-240,P1-L1 交付);迁移后 case 内判定失败被自身 catch 错标(REQ-238,P1-L6 未做)。

**验证基线**:见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处,本文件不复制;那里也只写命令、不写结果。

## 目标

183 及之后登记的 29 条工作项,逐条经过「开工前重验 → 执行或裁决作废 → 终态」闭环后全部关闭;期间每一批收尾全量门禁链绿,台账无长期滞留行。

## 开工前重验(每条 REQ 的硬门)

台账记录与当前代码已有较大变动:**每条 REQ 开工前必须重新确认**,两点都过才翻「在办」并动第一个文件;任一点不过 → 提请用户裁决后走「已作废」留墓碑,不硬做:

1. **必要性**:对照该行「为什么停在这 / 什么条件下重看」与当前代码实测,确认任务仍存在、仍值得做;
2. **改动合理性**:确认本计划中该步的改动范围、判据、口径与当前代码未漂移(文件、行号、门禁现状以实测为准)。

## 下一步

P3 三条泳道全部完成并通过全链 verify:ci(201 / 202 / 203 / 204 逐条翻已完成)。两条子代理顶回均成立并已采纳:204 的档四经实测是活夹具(换成 shared/ 会让 7a/7b 由红转空数组)、202 的 offchain 理由(挂链会让本地与 CI 跑判据不同的门禁)经实测推翻后改判 chain。下一步:等用户确认 P4(213 / 211 / 210 / 212 / 193)开工,届时先按「开工前重验」硬门逐条核对再翻在办。

## 完成标准

- [ ] 29 条全部到达终态(已完成或已作废),无一条停在在办;每条开工前均有重验结论(写入该行或 evidence)
- [ ] 每条完成时「为什么停在这」按已完成档(≤150 字)重写,不原样搬运
- [ ] 每批收尾由主会话跑一次全量门禁链并通过;子代理汇报只写「未跑链」,不写成通过
- [ ] 不再必要的条经用户裁决走已作废,墓碑写明理由与重看条件
- [ ] 「整体完成标准」逐条划完才删本文件

## 修复项复测

- [ ] 无

---

<!-- ===== 以下三节仅「大型需求时才有的三节」 ===== -->

## 步序与泳道

> 每一步开工前先过「开工前重验」硬门。泳道按「可写文件」列切互不重叠的范围;同批内泳道并行,批与批之间顺序执行。表格单元格内不写竖线(REQ-193 实测:竖线即使包在反引号里也会被 markdown 切格)。

| 步 | 工作项 | 目标 | 可写文件(不重叠) | 退出条件 | 门禁 | 结果 |
|---|---|---|---|---|---|---|
| P1-L1 | REQ-240 | 门禁树侧 named-case 族转 fail-closed:删 pending 两行 + selftest 夹具通道切换 | `gates/repo/check-test-layout.mjs` 与其 `.selftest.mjs` | ⑭ 族进 problems 通道;合成夹具逐条过(没接契约且期望 exit 0 的档补契约或并期望);真实树 0 命中 exit 0 | check-test-layout selftest · `npm run check:docs` | 通过 2026-10-11 |
| P1-L2 | REQ-183 | ADR-062 补私有断言器白名单表并订正对账节口径 | `docs/adr/ADR-062-*.md` | 白名单覆盖 must( 与 createAsserter 壳与 harness assert,每条带定义处与计数法;台账行订正由主会话收口 | `npm run check:docs` | 通过 2026-10-11(候选漂移订正:check-pointers-refs 已无文件,按现树重建) |
| P1-L3 | REQ-236 | runner 接线 assertHostRequirementsAlive(opt-in flag,默认 false) | `test/harness/runner.js` · `test/acceptance.mjs` · `test/harness/runner-report.test.js` · `test/harness/segment-host-requirements.mjs` | 沙盒 runAll 零影响;负向夹具判红且点名 | `M2W_ONLY=runner-report npm test` · `node gates/repo/check-test-layout.mjs` · `npm run typecheck` | 通过 2026-10-11 |
| P1-L4 | REQ-197 | 退出钩子前缀 `[fail]` 改 `[temp-leak]`;头注同步;残留归因 | `test/harness/temp-resource.js` | 新前缀与 `[fail]`/`[case-fail]` 不撞;归因有结论 | `M2W_ONLY=test-common-helpers npm test` · `npm run typecheck` | 通过 2026-10-11(归因并入终态行:9 个全空目录壳,原记 16 已漂移) |
| P1-L5 | REQ-199 | 超时敏感段改 arrived 确定性等待 | `test/convert/image-request-budget.test.js` | 请求到达从竞态变等待;其余墙钟依赖为零 | `M2W_ONLY=image-request-budget npm test` 连跑 3 次 · `npm run typecheck` | 通过 2026-10-11 |
| P1-L6 | REQ-238 | catch 收窄到只包夹具构造(两份自测) | `gates/repo/check-docs.selftest.mjs` · `gates/repo/check-tscheck-coverage.selftest.mjs` | 断言失败不再被贴夹具标签;消息文本逐字保留 | `npm run check:docs:selftest` · `npm run check:tscheck-coverage:selftest` · `npm run typecheck` | 通过 2026-10-11(变异自证过;范围实为 2 份,非旧记「同款」) |
| P2-L1 | REQ-205 | 三个助手副本收口进 `test/harness/`(实测 6 段,非台账 5) | `test/harness/supply-helpers.js` 新建 · `test/harness/test-common-helpers.test.js` 加 selftest case · `test/gates/supply/supply/` 下 6 个 `.test.js` | 6 段无残留私有助手定义;33 处调用点改引;gen-sbom 签名分叉同批改;净 −210~−240 段行;5 个段名禁改(gate-index 字面量) | `M2W_ONLY=test-common-helpers` 与 supply 段 · `npm run typecheck` | 通过 2026-10-12(净删 293 行,6 段 59/59 + selftest 21/21) |
| P2-L2 | REQ-206 | 捕获逻辑 7 份具名函数 + C 族 2 处收口,显式接受段数 144→145 | `test/harness/console-capture.js` 新建 · `test/harness/console-capture.test.js` 新建 · A/B 族 6 个 gates 段 · `test/main/mermaid-service.test.js` · `test/main/converter.test.js` | 7 函数改调参数化助手(`warn`/`error` 两布尔);C 族显式全关;新段 L8 covers / fixtures=null / 具名 case 齐 | 新段 + 受改 8 段 · `node gates/repo/check-test-layout.mjs` · `npm run typecheck` | 通过 2026-10-12(受改 8 段 371/371 + 新段 7/7;键名改写 66 处) |
| P2-L3 | REQ-207 · REQ-208 | `mirroredSourceOf` 下沉 shared 成单源;`tools/where.mjs` + script;测试体系节 13 行压 ≤5 行 | `shared/` 新文件 · `gates/repo/check-test-layout.mjs` 与其 selftest(仅随迁)· `tools/where.mjs` 新建 · `package.json` 加一行 · `docs/DEV-GUIDE.md` | 下沉无行为变化(门禁与 selftest 全绿);反查负向 5 形实跑;节压到 ≤5 行且 `:236` 回指改指 `test/` | `node tools/where.mjs` 负向 · `npm run check:docs` · `npm run lint` | 通过 2026-10-12(负向 5 形全对;节 11→5 行;门禁 165/165) |
| P2-L4 | REQ-209 | 暂缓:删除链 17 项与两项保护损失重估中(用户裁决 C) | 不动(待拆项:图片字节基线抽独立小门禁 + 生成链路去留单独裁) | 见台账行重验记录 | 无 | 暂缓 2026-10-11 |
| P3-L1 | REQ-201 · REQ-203 | .gitattributes 同批收口:`:37` 改定点措辞 + `:6-26` 前缀改指 `samples/` 让规则复活(裁决走第三条,非删非改说明) | `.gitattributes` 单文件 | 同文件内两种 EOL 口径不再并存;`git check-attr` 复验 samples/ 图片回 binary、md 回 lf;`.svg` 无 NUL 哑弹解除;是否需 `renormalize` 实测后决定 | `git check-attr` 逐条实测 · `npm run check:docs` | 通过 2026-10-12(相反口径实为两处非一处;7 图 binary 回 set、svg 哑弹解除;index 零 i/crlf 故无需 renormalize) |
| P3-L2 | REQ-202 | 字面量 LF 锚点防复发门禁(新门禁 + 负向夹具 + 上链),以 **12 处实测潜在雷**(台账记「收敛到 1 处」不成立)为正例基线 | `gates/repo/` 新门禁 + `.selftest.mjs` + case-roster · `gate-index.mjs` · `package.json` · `check-test-layout.mjs` 的 selftest 用例源登记 | 12 处已知点作正例判红且误伤为零;归一原语收口**不在本项**(5 份重复实现,shared 零出边致层向死结) | 新门禁 selftest(照 check-samples 变异档样板) · `npm run check:test-layout:selftest` | 通过 2026-10-12(侦察 12 处高估,真雷 1 处;上 verify:ci 第 20/21 位;26 档自检 + 13 内建探针;offchain 理由经实测推翻后改判 chain) |
| P3-L3 | REQ-204 | 陈旧路径按四档清理:零风险文案 / 改指 `shared/` / 整段重写 temp-resource 论证 / import-boundary 三对夹具↔正则同改 | `test/**` · `gates/**` | **26 处**(台账记 24 且分项之和即错)按档清零;三处 `copy-closure-audit` 有意墓碑与 `install-smoke.test.js:51`(实为非陈旧)明确排除 | `npm run check:boundary` · `npm run check:test-layout` · import-boundary 段 | 通过 2026-10-12(改 15 留 11:3 墓碑 + 8 活夹具;档四经实测推翻后不改;补第 27 处 `test.common` 无斜杠漏网) |
| P4-L1 | REQ-213 | R7 撤销后 C7 覆盖面实测 | 只读;结论落台账行 | C7 是否需补偿性收窄有明确结论 | 无(实测即结论) | 通过 2026-10-12(结论=**不需收窄**:R7 兜「墓碑⇔划线」属内容侧与表形状正交;行结构/列数/表头三面各有判据,零代码改动) |
| P4-L2 | REQ-211 | 两份号段表解析合并(门禁改调 shared 并自转数字) | `gates/repo/check-pointers.mjs` · `test/gates/check-pointers-ledger.test.js` · `docs/DEV-GUIDE.md` · ADR-054 差异清单(`shared/markdown-table.mjs` 实测零改动) | 判据行为等价,负向夹具不红不绿漂移 | ledger + e2e 两段 · `check:import-boundary` | 通过 2026-10-12(21→15 行;71680 组差分对拍 diff=0;补 8 档,合并前四形态全裸奔;顺带删死分支「两格」) |
| P4-L3 | REQ-210 | 台账脚本进模板库(段二):**按闭包逐条登记 5 个**(非整树纳入) | 全局配置目录 `templates/code-init/` 新建 · 全局配置目录 `templates/README.md` 拷贝清单 +5 行 · 版本 v2.8→v2.9 · 全局配置目录 `README.md:20` 连带改 | 模板含代码树且拷贝清单可执行 | 配置仓 `check-pointers` + `ledger.test` · 临时目录落位实测六命令 | 通过 2026-10-12(闭包 5 文件实测;落位后 next/add/show/set/move/pool 全通,列上限两侧实测生效;版本去重仅 v2.9) |
| P4-L4 | REQ-212 | 下游列上限对读缺口处置 | 本仓 `AGENTS.md` 一句(零代码) | 裁决结论落台账行 | 无 | 通过 2026-10-12(维持人守:AGENTS.md「改四处」改为「改五处」并点名 210 新增的模板副本;机器对读缺口位置已记台账) |
| P4-L5 | REQ-193 | — | 不动(已作废 2026-10-12) | 墓碑在 `docs/REQ.md` 已作废节 | 无 | 作废 2026-10-12(用户裁决:`PLAN.md` 是临时工作载体,不为将删的文件加常驻门禁 —— 判据会先于载体失效) |
| P5-L1 | REQ-225 | 落盘失败码登记完整性判据 | `gates/repo/` 新增 + selftest | 新增未登记失败点的负例判红 | 新门禁 selftest | 未做 |
| P5-L2 | REQ-231 | 覆盖率 `--include` / `--exclude` 取值对读 | `gates/probe/check-coverage-zero.mjs` · selftest 夹具 | 取值改宽的负例判红 | check-coverage-zero selftest | 未做 |
| P5-L3 | REQ-224 | MCP 是否暴露 pdf:布尔决策后实施 | `src/` mcp 侧 · `docs/adr/ADR-066` · `docs/CHANGELOG.md` | 决策落 ADR-066;真实客户端两帧握手实测 | `test/mcp/` 段 | 未做 |
| P6-L1 | REQ-235 · REQ-237 | data-i18n HTML 校验门禁;lint 目标补 shared 并修因此暴露的真错 | `gates/repo/` 新增 + selftest · `eslint.config.js` · `package.json` · `docs/DEV-GUIDE.md` | 字典外 key 判红;shared 脱扫清零 | 新门禁 selftest · `npm run lint` | 未做 |
| P6-L2 | REQ-234 | dual-matrix 86 条锚点改抗漂移形态 | `test/core/dual-pipeline-matrix.test.js` · `gates/dual-matrix.mjs` | 行号漂移不假红;指到错行可判红 | `test/core/dual-pipeline-matrix.test.js` | 未做 |
| P6-L3 | REQ-239 · REQ-241 | 先补浮层收起断言,再按 ADR-065 ③ 三档收敛模块级可变状态 | `test/renderer/` · `src/renderer/` · `docs/adr/ADR-065` | 变异实测断言有牙;三档分类落定且判据转 fail-closed | `test/renderer/` 段 | 未做 |
| P7 | REQ-196 | L1 段↔主体一对一无看守(口径:豁免登记) | `gates/repo/check-test-layout.mjs` · 豁免表 json · selftest | 每个镜像源模块有段或有登记豁免 | 新判据 selftest · `test/gates/` 相关段 | 未做 |

## 整体完成标准

- [ ] 29 条全部到达终态(已完成或已作废),台账无一条停在在办
- [ ] 每条开工前的重验结论有记录(该行或 evidence),作废条有墓碑
- [ ] 每批收尾全量门禁链通过;最终一轮全绿后本文件才可删

## 怎么回滚

按批回滚:每批是一个独立提交单元,`git revert` 该批提交即回到批前状态,台账状态用 `tools/req-edit.mjs` 随代码一并回改。两个不能半途回滚的特例:P2-L3(删生成器与 121 处声明同批改判据,回滚即整批 revert)与 P7(豁免表与判据同批落地)。P6-L3 若 renderer 重构引发回归,先 revert 该批再重裁 REQ-241 口径,不在红树上续改。
