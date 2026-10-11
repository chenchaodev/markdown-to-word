# 183 及之后待办全量执行计划

> 相关 ADR 给约束,验证基线给命令,下一步是要动的那个动作。工作项号与状态在 [REQ.md](REQ.md) 台账 —— 本文件不写编号纪律。

## 相关 ADR

- `docs/adr/ADR-062-测试树位置即身份与门禁元框架瘦身.md`:L1(段↔主体一对一)与 P3(删 fixtures 生成器)未落地;对账第二道证据待补(:197 已订正过一次,缺的是白名单补充)。REQ-183 / 196 / 209 的依据。
- `docs/adr/ADR-064-源码树一职责一文件与内部边界判据.md`:gates 树 no-undef 兜底的覆盖面表述与实测不符(shared/ 今日脱扫)。REQ-237 的依据。
- `docs/adr/ADR-065-renderer功能层注入式重构.md`:③ 模块级可变状态收敛进 state/ 未做。REQ-241 的依据;ADR-076 把 dom-ops 搬进基础层后,trapStack / focusOriginStack 归属需在该步重裁。
- `docs/adr/ADR-066-转换契约类型化.md`:能力声明按 YAGNI 撤步、清单留在 convert.ts 头注 ⇒ REQ-224 已是一个布尔常量而非结构性缺失。
- `docs/adr/ADR-073-c8扫描面收窄到只收js产物.md`:`--include` 取值无对读。REQ-231 的依据。
- `docs/adr/ADR-074-自测用例契约搬shared与表格化护栏边界.md`:门禁树侧 named-case 族仍 pending(REQ-240);迁移后 case 内判定失败被自身 catch 错标(REQ-238)。

**验证基线**:见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」—— 命令只存那一处,本文件不复制;那里也只写命令、不写结果。

## 目标

183 及之后登记的 29 条工作项,逐条经过「开工前重验 → 执行或裁决作废 → 终态」闭环后全部关闭;期间每一批收尾全量门禁链绿,台账无长期滞留行。

## 开工前重验(每条 REQ 的硬门)

台账记录与当前代码已有较大变动:**每条 REQ 开工前必须重新确认**,两点都过才翻「在办」并动第一个文件;任一点不过 → 提请用户裁决后走「已作废」留墓碑,不硬做:

1. **必要性**:对照该行「为什么停在这 / 什么条件下重看」与当前代码实测,确认任务仍存在、仍值得做;
2. **改动合理性**:确认本计划中该步的改动范围、判据、口径与当前代码未漂移(文件、行号、门禁现状以实测为准)。

## 下一步

等用户裁决。P1 首步(REQ-183 + REQ-240)开工前先按上面硬门重验:核对 check-test-layout.mjs 现状与 ADR-062:197 已订正内容,通过后翻「在办」。

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
| P1-L1 | REQ-183 · REQ-240 | 补对账第二道证据(断言器白名单)并订正 ADR-062:197;门禁树侧 named-case 族转 fail-closed | `gates/repo/check-test-layout.mjs` 与其 `.selftest.mjs` · `docs/adr/ADR-062-*.md` | 白名单补充后同法比对零丢失;删掉某份自测的 .case( 调用即判红 | check-test-layout selftest · `npm run check:docs` | 未做 |
| P1-L2 | REQ-236 | `assertHostRequirementsAlive` 接线进 runner 发现路径 | `test/harness/runner.js` · 段宿主 selftest | 段改名或该登记未登记均判红并点名 | `test/harness/` 相关段 | 未做 |
| P1-L3 | REQ-197 | 退出钩子前缀改为可分辨形态;16 个 EPERM 归因 | `test/harness/temp-resource.js` · `docs/evidence/`(归因) | report-only 与真红视觉可分辨;归因落档 | `test/harness/` 相关段 | 未做 |
| P1-L4 | REQ-199 | 超时敏感段固定 setTimeout 改确定性等待 | `test/convert/image-request-budget.test.js` | 隔离连跑 4 次与全链内均绿 | `test/convert/image-request-budget.test.js` | 未做 |
| P1-L5 | REQ-238 | case 内判定失败不再被自身 catch 错标为夹具异常 | 受影响的各 `gates/**/*.selftest.mjs`(逐份) | 消息标签正确且断言零丢失 | 受改 selftest 原段 | 未做 |
| P2-L1 | REQ-205 · REQ-206 | supply 5 份助手副本与 withCapturedOutput 族收口进 `test/harness/` | `test/harness/` 新增 · `test/gates/supply/supply/` · `test/gates/install-smoke.test.js` | 行内复制清零;新助手有 1:1 selftest 段(段数 140→141 显式接受) | `test/gates/supply` 与 `test/gates/install-smoke.test.js` 段 | 未做 |
| P2-L2 | REQ-207 · REQ-208 | 新建段名反查 `npm run where`;DEV-GUIDE 测试体系节压到 ≤5 行 | `tools/` 新增 · `package.json` · `docs/DEV-GUIDE.md` | 段名反查唯一命中且有负向用例;压缩后指针不丢 | 反查脚本用例 · `npm run check:docs` | 未做 |
| P2-L3 | REQ-209 | 删 fixtures 生成器与 121 处空声明,同批改判据 | `gates/fixtures/` · `test/behavior/*.test.js` · `gen-fixtures.mjs:281` 判据 · samples 手工维护面确认 | `= null` 判据切换后全链绿 | `npm run verify:ci` | 未做 |
| P3-L1 | REQ-201 · REQ-203 | .gitattributes 注释与首部裁决冲突按裁决落地;3 条空转 eol=lf 处置 | `.gitattributes` · 必要时 `docs/adr/` | 同一文件内两种 EOL 口径不再并存 | `npm run check:docs` · CI EOL 相关步 | 未做 |
| P3-L2 | REQ-202 | 字面量 LF 锚点防复发门禁,以已知点自证 | `gates/repo/` 新增 + selftest · 归一原语收口点 | 已知点作正例判红且误伤为零 | 新门禁 selftest | 未做 |
| P3-L3 | REQ-204 | 清理 test 与 gates 下陈旧路径登记 | `test/**` · `gates/**`(注释与夹具字符串) | 21+3 处清零且零真 import 不变 | `npm run check:docs` | 未做 |
| P4-L1 | REQ-213 | R7 撤销后 C7 覆盖面实测 | 只读;结论落 `docs/evidence/` 与台账行 | C7 是否需补偿性收窄有明确结论 | 无(实测即结论) | 未做 |
| P4-L2 | REQ-211 | 两份号段表解析合并(门禁改调 shared 并自转数字) | `gates/repo/check-pointers.mjs` · `shared/markdown-table.mjs` · selftest | 判据行为等价,负向夹具不红不绿漂移 | `test/gates/check-pointers-ledger.test.js` | 未做 |
| P4-L3 | REQ-210 | 台账脚本进模板库(段二):拷贝清单扩到 shared 与 tools | 全局配置仓的 `templates/README.md` 与模板目录 · 下游指针 | 模板含代码树且拷贝清单可执行 | 配置仓 `npm run check:docs` | 未做 |
| P4-L4 | REQ-212 | 下游列上限对读缺口处置(默认维持人守) | 视裁决;默认仅补表述 | 裁决结论落台账行 | 无 | 未做 |
| P4-L5 | REQ-193 | PLAN 表格形态 4 处残留处置;判据是否扩到 PLAN 的裁决 | 视裁决;`gates/repo/check-pointers.mjs` 或新门禁 | 残留有处置且 127 行语义已裁 | 判据段 | 未做 |
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
