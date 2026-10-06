# 最优架构整改

> 开工只需读三处：相关 ADR 给约束（结论抄进下方，ADR 原文不动），验证基线给命令（命令本体在 `docs/DEV-GUIDE.md`，本文件只留指针），下一步是要动的那个动作。

## 相关 ADR

- `docs/adr/ADR-014`：docx（remark）与 pdf（markdown-it）双管线**保持独立**，共同语义抽共享纯函数，差异用差异矩阵与差分固件锁定。**本计划不动它** —— 「双管线各自补阶段」正是靠它才成立。
- `docs/adr/ADR-018`：core 的 pdf 渲染路径不做文件 IO（IO 经 options 注入），`node:path`/`node:url` 刻意留在白名单。
- `docs/adr/ADR-019`：preload 暴露面类型单源归 core，`REVERSE_TYPE_ALLOWLIST` 已整体删除。
- `docs/adr/ADR-060`：headless 装配层为四交付面共用，宿主注入点恰好四个；cli 与 mcp 同层零依赖。
- `docs/adr/ADR-062`：测试树位置即身份；门禁元框架瘦身。「段 ↔ 主体一对一目前无机器看守」是本计划要收窄的已知缺口。
- `docs/adr/ADR-064`：文件名 = 唯一职责；含 19 条处置表与 12 条目录准入判据。**其第 2 条已裁决 `ConvertContext` 改名，本计划是执行它而非重议它**；其第 15 条的数字已过期（见下方「下一步」）。
- `docs/adr/ADR-065`：renderer 四个功能目录之间零 import，跨功能协作经组合根注入。
- `docs/adr/ADR-066`：转换进度、降级清单与交付面能力一并类型化。
- `docs/adr/ADR-067`：验收段契约不变，宿主拆成 node 与 electron 两档。
- `docs/adr/ADR-068`：门禁自测走合成根表格化，不合并段。
- `docs/adr/ADR-069`：构建产物带 `.d.ts`，与「是否对外发包」解耦。

**验证基线**：见 [DEV-GUIDE.md](DEV-GUIDE.md)「验证基线」与「门禁接入点」—— 命令只存那一处，本文件不复制。

## 目标

用户在设置面板改动页边距、触发一次转换、看到进度条推进的这条路径上，**进度阶段与降级提示由同一份类型化契约驱动而非各处硬编码**；而支撑这条路径的 renderer 层，其内部依赖方向、外部可见度与测试宿主三者都不再是「碰巧如此」，每一条都有机器看守。

## 下一步

#05 与 #05b 已落地:测试树 271 条类型错误清零(src 与 test 双向 `error TS` 均为 0),随 REQ-222 与 REQ-226/227 作为一个原子提交合入 —— 两者不能拆:REQ-222 单独落地必红(`declaration: true` 让 159 个 `.d.ts` 落进 c8 分母,动态面 159 项判红),REQ-226/227 单独落地则绿。

**下一步按步序表开 #06**（进度·降级·能力三者一并类型化,REQ-217)。它排在最前是因为 #10 的注入式重构要靠类型面兜住「漏改一个交付面」,而那道护栏正是 #06 建出来的;`docs/evidence/20261006-141113-三份只读测绘事实地图与接手须知.md` §四 是 #06 的实测底账(其中 `STAGE_PERCENT: Record<string, number>` 若不同步收紧,`convert-actions.ts` 的查表会**静默**走 `?? 0`,编译面无事而批量进度条不动 —— 那是最可能出岔子的一处)。#08 与 #10 开工前分别先看该文件 §三 与 §五。

三条测绘的结论底账同上，含该文件 §二「接手须知」三条踩空点（新增 evidence 后必须跑 `gen:archive-index` · 段数只写指针不写数字 · 三类测量口径错误）。

## 完成标准

- [ ] 两处仓库文本与实测冲突的数字已订正，且各有机器可复算的出处：`check-import-boundary.mjs` 那条普查命令按 feature 根目录折叠后与注释所写一致（连带订正同文件里 rule `reason` 串中的同一处错误说法 —— 它会被门禁输出直接印出来）；ADR-064 第 15 条的文件头缺失数 = 实测 6 且扫描面写对。
- [ ] 第三处**不动仓库**且已书面记明理由：当前 `pending: true` 实测 5 条，而门禁文件头写的是 T0 当时的 6 条并已附「条数是派生的，别手数」的警告 —— 那是**评审自己转述错了**，不是仓库说错。已落 `docs/evidence/20261006-104227-最优架构评审事实地图与三处订正.md` §一.2。
- [ ] renderer feature 目录间零 import，且该不变量由一条已转正（`--enforce`）的门禁守住；**跨 feature 的反向注册槽清零**（计数口径与 `recentRefreshHandler` 的保留见 `docs/adr/ADR-071-两处判据的形态裁决.md`，判据原文是「四处」已不适用），`state.ts` 的「模块级可变状态全部收敛于此」这句自述重新成立。
- [ ] 转换阶段与降级是穷尽类型化契约：新增一个阶段或降级形态时，漏改任一交付面**编译红**；mcp 侧为预测降级而做的第二次 markdown 解析已消失。
- [ ] 产物覆盖率高可见：renderer 不再是排除项，且任何 `--exclude` 条目若不在台账豁免清单内则门禁判红（反向对读生效）；`check:src-layout` 在 `verify:ci` 链上以 fail-closed 运行。
- [ ] 测试体系形态达标：段契约未变而宿主分两档；**全部**段接入具名 case（段数是派生值，取 `find test -name '*.test.js' | wc -l`，本文件不复制数字）；段内零本地顶层断言**实现**（要禁的是自带 `throw` 的第二份实现，不是叫 `assert` 的名字；`@returns {asserts cond}` 的委派型窄化壳合规 —— 措辞与裁决见 `docs/adr/ADR-071-两处判据的形态裁决.md`）；门禁自测走合成根表格且**断言一条未删**。

## 修复项复测

- [ ] 本计划全程无回归：每相的定向段 + 提交前全量 `npm run test` 均通过，且覆盖率四项阈值不低于开工前实测值（防「结构调整顺带把某块测没了」）。

---

## 步序与泳道

**排序依据不是难度，是依赖**：结构最弱、风险最大的那一步（#10 renderer 重构，44 个文件）落在**最后**，因为在它之前必须先把两样东西建好 —— 覆盖率对它可见（#04）、类型面对它存在（#05）。先拆网后建网会把最大的风险放进盲区。

**三条贯穿全程的纪律**（都是本轮踩出来的，不是套话）：

1. **门禁执行必须串行**，`可写文件不重叠 ≠ 可并行`：任何泳道跑 `npm run build` 都写 `dist/`，而 `dist/` 是所有其他泳道测试的输入；`output/` 同样是共享可变状态。**同相内可以并行编辑，门禁只在相末跑一次。** 判据：两条泳道都不改进入构建产物的源 · 无共享可变状态。
2. **每个测量脚本必须带已知答案自检**。本轮裁决用的 SCC 脚本前两版都「自信地」输出错误结论（第二版因图是空的而报「零个环」）。任何普查/统计脚本在输出结论前，先断言若干条**已知必然存在**的边；类型边与值边必须分开，否则擦除掉的 `import type` 会被算成结构性环。
3. **新门禁一律走 `T0 报告 → T2 fail-closed`**：先让它只报告，把存量违规清零，再删标记转正。转正动作本身就是进度记录，可 grep、可 review。

| 步 | 工作项 | 目标 | 可写文件（不重叠） | 退出条件 | 门禁 | 并行 | 结果 |
|---|---|---|---|---|---|---|---|
| #01 | REQ-214 | 订正仓库文本与实测冲突的数字（2 处），并把第三处记为「评审自己错了、仓库对」 | `gates/repo/check-import-boundary.mjs`（仅注释、那条普查命令、rule `reason` 串）· `docs/adr/ADR-064-*.md`（第 15 条数字与扫描面） | 普查命令按根目录折叠后与注释一致；`reason` 串里同一处错误说法一并订正（它会被门禁输出直接印出）；ADR-064 第 15 条 = 6 且扫描面写对；`pending:true` 处**不动仓库**且理由已落 evidence | `npm run check:boundary` · `npm run check:docs` | 串行（后续步都引用这些数字） | 通过 2026-10-06 |
| #02 | REQ-223 | 就地整改：改名与注释订正，不动结构 | `src/core/settings/settings-schema.ts` → `schema.ts` 及其引用方 · `test/renderer/dom-stub.js` · **`gates/repo/` 3 处路径字面量（见下注）** | 改名后「文件名 = 唯一职责」重新成立且**不新增同名组**；DOM stub 注释与隔离模型一致 | `npm run typecheck` · `npm run check:src-layout` · `npm run check:boundary` | 可与 #03 并行编辑（写域不重叠） | **通过 2026-10-06** |
| #03 | REQ-216 | 三处「单源存在但未生效」收口 | `src/core/i18n/warning.ts` · `src/core/pdf/{render,postprocess}.ts` · `src/core/pipeline/precheck.ts` · `src/convert/{artifact-writer,paths,cli-pdf-job}.ts` · `src/cli/{index,options}.ts` · `src/main/cli-pdf-host.ts` | 同一输入下 docx 与 pdf 的警告条数口径一致（需断言）· CLI 判输出失败不再依赖文案 · `max` 有机器看守 | `npm run typecheck` · `npm run test` | 可与 #02 并行编辑，门禁在相末跑 | **通过 2026-10-06**（144 段 / 242 case 全绿） |
| #04 | REQ-215 | 补网：把最弱的一层纳入可见范围 | `package.json`（覆盖率口径 + 链组成）· `gates/repo/check-coverage-zero.mjs` · `gates/repo/coverage-baseline.json` · `gates/repo/check-html-const-mirror.mjs` · 6 个缺文件头的 `src` 文件 | 豁免对读双向生效（任一方向缺登记即红）· renderer 进统计且**阈值未下调** · `check:src-layout` 与 `check:html-const-mirror` 上链并 fail-closed | `npm run test:coverage` · `npm run check:coverage-zero` · `npm run verify:ci` | 串行（改链组成，按全局配置目录 `tools/AGENTS.md` 走门禁改动的连带项） | **通过 2026-10-06**（`verify:ci` 44 步全绿） |
| #05 | REQ-222 | 让产物带 `.d.ts`，测试的类型面对齐被测物 | `tsconfig.json` · `package.json`（打包清单）· `gates/artifacts/check-*.mjs` · `test/**` 的 `@typedef`（约 40 文件） | 声明文件产出且不进安装包；产物清单门禁绿；测试 `@typedef` 指向产物 | `npm run typecheck` · `npm run build` · `npm run check:dist-manifest` | 串行 | **通过 2026-10-06**（类型面见 #05b；打包侧连带项：`.d.ts` 与 `.d.cts` 均已排除出包，见 ADR-073） |
| #05b | REQ-222 | **修测试树的 271 条新暴露类型错误** | `test/main/**`(100) · `test/core/**`(94) · `test/renderer/**`(41) · `test/behavior/**`(18) · `test/convert/**`(12) · `test/harness/**`(6) —— 四个泳道按目录切，写域互不重叠 | 六个目录各自的 `error TS` 行数为 0；**零 `any`／`@ts-ignore`／`@ts-nocheck`／摘 `// @ts-check`**；断言强度未被削弱 | `npx tsc -p tsconfig.test.json`（**看全量，不看尾部**）· 受影响段 | 四泳道并行编辑，**门禁由主会话相末跑一次** | **通过 2026-10-06**（src 与 test 双向 `error TS` 均为 0；随 REQ-222 与 REQ-226/227 原子提交落地） |

**#05 的范围在执行期变了一次，记在此处**：原以为「开 `declaration` + 把 `@typedef` 从 `src/` 改指 `dist/`」是个小改动，实测**打开了整个测试树的类型面**—— 产物此前不带 `.d.ts`，故测试里每一处 `import … from "../../dist/…"` 的类型都等同于 `any`，**对产物的引用从来没被类型检查过**。真实类型一到位，积压的「夹具类型没写准」一次性判红 **271 条**（`TS2345` 109 / `TS2322` 35 / `TS2740` 24 / `TS2339` 20 / `TS2739` 15 / `TS2532` 15），分布如上表。运行期行为一直是对的；新可见的只是「夹具从未对照它真正跑的东西验过」—— 那正是 ADR-069 要拆的那个错配。

**#05b 的最大杠杆不是「逐条改夹具」，是「删掉陈旧的手写类型注解」**（2026-10-06 实测）：271 条里相当大一块不是夹具写错，而是 **`declaration` 打开之前为了让测试能过、手写进测试文件里的替代性 JSDoc 注解** —— 典型是 `/** @returns {{ typography: object, … }} */`,注释里常写着「dist 编译产物无 `.d.ts`,字面量会被推成 never[]」这类理由。产物现在带声明了，**那些注解的前提已失效，而且 `@returns` 会覆盖推断** ⇒ 函数体改对了也不生效。实测：**删掉 `settings-logic.test.js` 里 `preset()` 上方一条 `@returns`，单文件当场少 10 条错误**；同一个文件另两处同类（`wizard-state.test.js` 手抄了一份 `WizardDraft`、`convert-helpers.js` 的 5 条 typedef 指 `src/`）也是同一病因。**故处理顺序必须是：① 查报错处附近有无手写 `@returns`/`@type`/`@param` → 有先删，让类型从产物声明推断 ② 删完还红才是夹具真写错 ③ 此时才按 `dist/*.d.ts` 的真实契约补注解。禁止与产物声明并存第二份手写类型 —— 那正是 ADR-069 要拆的错配。：#10 是 44 文件的 renderer 重构，而「renderer 层的类型面从不存在」正是它最缺的那道护栏；回退等于把计划里最大的风险留在一个没有类型看守的层上改。**代价是多出一整相的机械工作量**，这一条已计入，不藏。**唯一红线：不得用 `any`／`@ts-ignore`／摘 `// @ts-check` 把数字刷绿** —— 那会让这一步从「装上安全网」变成「装上一个恒绿的面具」，比不做更坏。
| #06 | REQ-217 | 进度、降级、能力三者一并类型化 | `src/core/convert.ts` · `src/core/pipeline/*` · `src/core/{pdf,docx}/render.ts` · `src/convert/{run,context}.ts` · `src/mcp/tools.ts` · `src/renderer/state/pure.ts` | 阶段为穷尽判别联合，漏一个 kind 编译红；降级由 core 登记、交付面透传；两处 `ConvertContext` 改名完成 | `npm run typecheck` · 受影响段 | 必须在 #05 之后（要有类型面才谈得上「漏改编译红」） | 未开始 |
| #07 | REQ-219 | 验收宿主分两档，段契约一字不改 | `test/harness/{runner,segment-host}.js` · `shared/test-common-surface.js` | 纯 node 档段不需要 userData 重定向；新增门禁判「node 档闭包内不得出现 electron」 | `npm run test` | 串行 | 未开始 |
| #08 | REQ-220 | 断言与具名 case 收敛成一套，并机器强制 | `test/harness/{assert,case}.js` · 各段 `*.test.js` · `gates/repo/check-test-layout.mjs`（新判据） | **全部**段接入具名 case（段数取 `find test -name '*.test.js' | wc -l`，不复制数字）；段内零本地顶层断言**实现**（自带 `throw` 的重写体要清零，`@returns {asserts cond}` 的委派型窄化壳合规，裁决见 `docs/adr/ADR-071-两处判据的形态裁决.md`）；新判据先报告后转正 | `npm run test` · `npm run check:test-layout` | 必须在 #07 之后（共用 harness） | 未开始 |
| #09 | REQ-221 | 门禁自测走合成根表格化 | 新增合成根 harness · `test/gates/**` | 每道门禁的「合成树 + 期望问题清单」退化为一张表；**断言一条未删** | `npm run test` | 必须在 #08 之后（表格化要用统一断言库） | 未开始 |
| #10 | REQ-218 | renderer 注入式重构 | `src/renderer/**` | feature 间零 import 且该判据已转正；**跨 feature 的反向注册槽清零**（按机制数不按点位；`recentRefreshHandler` 由组合根注册、已是目标形态须保留；判据原文「四处」已由 `docs/adr/ADR-071-两处判据的形态裁决.md` 取代）；模块级可变状态收敛进 store | `npm run typecheck` · `npm run test` · 覆盖率四项不低于开工前 | 串行，且**按 feature 目录分四个可独立回滚的提交** | 未开始 |

**相的划分**：#01 单独成相（其余各步都引用它的数字）· #02+#03 一相（写域不重叠）· #04 · #05 · #06 · #07+#08+#09 一相（测试体系形态，三步有内部依赖）· #10 单独成相（最大最险，独立回滚）。

**一处执行期扩域（2026-10-06）**：#02 的写域最初漏了 `gates/repo/`。改名一个文件会打断**任何持有该路径字面量的门禁** —— 实测命中 3 处（`check-transform-dispatch.mjs` 的枚举排除项、其 selftest 的负向夹具、`test-layout.cross-import-exemptions.json` 的 specifier），不改则这三道门禁必红。执行泳道按「不改则必红」自行补了那 3 行并主动上报越界，属正确处置；**漏列 `gates/` 是派发时的规划错误，不是它的**。教训：**改名的写域必须包含「按路径字面量引用该文件的全部门禁与夹具」** —— 这类引用不落在 import 图里，只能靠 grep 路径字符串找出来。

**一处执行期撤步（2026-10-06，原 #02b「console 前缀统一」）**：评审裁决「**不建日志框架**」——本仓没有日志文件、没有遥测，且冒烟输出的 marker 是被 `smoke-report.mjs` 解析的**协议**，加一层抽象只有成本没有收益。那条裁决已落 evidence §二，是本项真正的产出。剩下的机械部分（36 处调用的前缀措辞统一）经复评**撤除，不做**：架构收益为零，而它要动的 `src/**` 覆盖面与后续 #06、#10 两步的写域高度重叠 —— 为纯样式 churn 制造三次写冲突与三次回归风险不划算。**撤除而不是搁置**：它不是「等有空再做」，是「评估后判定不值得做」。若日后有人认为统一前缀有诊断价值，重新评估即可，不必视为欠账。

## 整体完成标准

- [ ] 上表 #01~#10 的「退出条件」逐条成立，且十个「结果」列全部为「通过 + 日期」。
- [ ] 五条新 ADR 状态均为「现行」，且其「后果」节承诺的护栏（feature 间零 import、降级透传、node 档闭包无 electron、`--exclude` 反向对读、`--enforce` 上链）**全部已转正为 fail-closed**，没有停在「只报告」。
- [ ] `docs/REQ.md` 十条在办行全部转终态（`REQ-214`~`REQ-223` 已完成 / 已作废），`REQ-224`（MCP 是否支持 pdf）按裁决落终态或保留待拍板并写明原因。
- [ ] 本轮沉淀可被下一个会话独立使用：`docs/evidence/20261006-104227-*.md` 的三处订正与「测量脚本必须带自检」那条教训无需重读本对话即可复用。
- [ ] 一次 `npm run verify:ci` 全绿，且覆盖率四项阈值不低于开工前实测值。

## 怎么回滚

**每一相是一个独立提交单元，`git revert` 即可**，无数据迁移、无格式迁移、无对外动作 —— 本计划全部是源码、门禁与文档改动。

分相回滚要点：

- **#04（补网）是唯一会「改门禁链组成」的一步**：回滚时覆盖率基线必须**连同**一起 revert，否则留下孤儿豁免条目 —— 那种状态下门禁恒绿而问题仍在，是比没做更坏的状态。`--enforce` 的转正标记同理，回滚即回到只报告模式，不影响运行时。
- **#05（`.d.ts`）**：回滚要连同 `build.files` 的排除项与产物清单门禁的期望清单一起 revert，三者任一单独回滚都会让打包清单门禁判红。
- **#06（契约类型化）**：改的是跨层签名，回滚后 `src/renderer` 与 `src/convert` 必须同一提交内一起回，否则编译面不闭合。
- **#10（renderer 重构）是唯一有行为风险的一步**：按 convert / settings / ui / wizard 四个 feature 目录拆成四个提交，组合根接线单独一个提交。任一 feature 目录可独立 revert 而其余三个仍然自洽。**它是行为等价重构，revert 不留数据迁移、不留持久化结构变化。**
- **回滚顺序**：若要整体回退，从后往前（#10 先于 #06 先于 #04）—— 每一步的前置条件都是后一步建立的，先撤后置会让中间态编译不过。

**不可回滚的点**：无。唯一对外可见的行为变化是 docx 进度阶段变细（#06），它不改变任何持久化结构；`USER-GUIDE.md` 若需同步，同批回滚即可。
