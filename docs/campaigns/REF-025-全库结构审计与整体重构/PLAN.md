# REF-025 全库结构审计与整体重构

> 规则见全局配置目录 @CAMPAIGN-GUIDE.md

> 大型重构专用(判据 → 全局配置目录 @WORKFLOW-PLAN.md 阶段 0);编号规范 → 全局配置目录 @NUMBERING-GUIDE.md。两者均为单一事实源,本文件不复制规则。
> 四条硬约束:① `#NN` **永不改写**(进 commit 不可变历史),新增只追加到末尾;② 每行必须有**客观可判的退出条件 + 门禁命令**;③ 全部阶段关闭后执行归档五步,然后删除本目录;④ 每阶段收尾核对「人工验收」节,验完的项划掉并标日期。状态不在本文件维护 —— 阶段收尾手工更新同目录 `STATE.md` 四行。

## 背景与目标

2026-09-26 一次只读结构评审(两条并行 lane:explorer 事实盘点 + oracle 架构判断)判定全库结构**基本合理但有明确问题**,并发现三项此前未登记的结构问题。既有候选区里另有 8 条已登记但未解决的技术债指向同一片(core 分层、renderer 内部、门禁工程、测试工程)。本 campaign 一次性收敛全部条目,行为等价优先,不合并双管线。

- **工作项**:`REF-025`(与 `../../ROADMAP.md` 候选区一致)
- **登记日期**:2026-09-26
- **规模**:L
- **模式**:2(大型重构 / 技术债)
- **评审原文**:`docs/archive/20260926-232219-REF-025-全库结构审计与整体重构.md`
- **不作为**「不改行为」保证的说明:见「风险与中止条件」节第 1 条

> **登记落盘 provenance 备注(2026-09-26 记,成因是并发写者,非本 campaign 计划内动作)**
>
> 本工作项的**候选区行与编号台账 bump 的实际落盘 commit 是 `8e088c5 perf(测试): 验收段编排并发池 (REF-019)`** —— 那是另一主会话在同一工作树实施 REF-019 时提交的,把本轮并发产生的 `../../ROADMAP.md` 改动一并纳入(commit message 只带 `(REF-019)`)。因此 `git log --grep '(REF-025'` **查不到登记那一笔**,追溯链从**下一次带 `(REF-025)` 的提交起**才连续。
>
> 用户已裁决:**接受现状,不追溯**。改写历史属安全底线禁止,故不改;编号本身无冲突(台账 `已用 REF 001-026` 与候选区 REF-025 / REF-026 一致,未重号)。本条仅为免得后续读者把「查不到登记 commit」误判成登记缺失。

## 裁决

> 只增不改。需长期保留的裁决在归档时**升为 `ADR-00N`**(不是编号继承,是 `D-0N → ADR-00N` 的转换)。本 campaign 期间 `docs/ADR.md` 禁写,裁决只增在本文件。

| ID | 决策 | 理由 | 升 ADR |
|---|---|---|---|
| D-01 | 本次整体重构判为模式 2:判据①(跨 ≥2 个发布批次、无法一次会话完成)+ 判据③(候选区 ≥2 条未解决项指向测试/门禁同一片)成立;判据②(能指出覆盖该区域行为的测试文件路径且改动后无需改任何断言)**不完全成立**,已写入「风险与中止条件」节 | 规模不是独立充分条件,此处两条硬判据成立;判据②的缺口须显式记录而非忽略 | 否(流程裁决,不需长期化) |
| D-02 | 格式注册表:承认未实现并改文档措辞,**不做查表重构** | 真做要动 6 处 format 分支跨 core/main 两层 + `paths.ts` 扩展名映射 + renderer 格式按钮,属改行为,超出本 campaign「行为等价优先」的承诺 | 是 |
| D-03 | 双管线保持独立不变(复核 ADR-014),只补「扩展点落点列」与「override 注册顺序不变量」 | REF-008 已判「勿动」;本 campaign 只把隐式耦合显式化,不合并 | 是 |
| D-04 | `precheck.ts` / `ai-cleanup.ts` 整体移入 `pipeline/`,而非拆成 policy + 阶段两层 | 二者本质是转换阶段(各被 main 调一次、无第二管线消费),移动即可解目录级双向,改动面最小;拆两层会多造一个只含一个函数的目录 | 是 |
| D-05 | `PreloadApi` 抽到 core 侧共享契约模块,而非在 renderer 侧做本地副本 | 复制契约会破坏 `ipc-contract.ts` 的单源范式(ADR-009 口径:两侧一律从 core 取契约) | 是 |
| D-06 | REQ-002 的 core 纯度决策**下放到 REQ-002 开工前单独拍板**,本 campaign 只登记压力不预判 | 预判会在缺少实现上下文时锁死方案空间;门禁在实现中途变红本身就是正确的逼选点 | 否 |
| D-07 | 提速与测试工程收尾项纳入本 campaign 但隔离在阶段 5。**原口径已随 REF-019 落地修正**:REF-019 已由 `8e088c5` 完成并判「已完成」,本阶段不重复实施,只做其落地后的复核(#23);阶段 5 现含 REF-020(未拍板)、REF-023(进行中)、REF-026 / REF-027(并发写者新登记) | 用户要求纳入全部未解决项;隔离使前四阶段不因其失败而受影响。REF-019 完成后阶段 5 的性质从「提速实施」转为「提速收尾 + 测试工程债收口」,故阶段名同步改为「测试工程收口与提速」。若阶段 5 成本超出预期,按「范围显著扩大」拆为两个工作项、原目录按归档五步收尾 | 否 |

## 计划与阶段

> 阶段是计划项的**属性列**,不是独立层级;阶段边界 = 该阶段最后一个计划项完成时;计划项计入其**起始**阶段。「关联」可空:多数技术债项不来自用户需求。
> 门禁取值:`npm run check:contract`(文档/指针类)· `npm run check:boundary`(层向门禁类)· `npm run typecheck && npm run lint`(纯移动类)· `npm run test:coverage`(改行为面,须全绿 + 四指标不低于现值 93.06/89.08/93.59/93.06)· `npm run verify:ci`(门禁契约变更类)· `npm run test:all`。

**阶段 0 · 声称与文档一致性裁决**(先改对地基,再动代码)

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #01 | 0 | 格式注册表声称裁决:`../../ROADMAP.md:121` 与 `../../docs/adr/ADR-001-非对称转换管线与格式注册表.md:6-7` 与 `src/core/convert.ts:1-2` 均声称「格式注册表」,实现是 `src/core/convert.ts:183` 的 `if (format === "pdf")`,全库 format 分支 6 处跨 3 层(`convert.ts:183`、`main/converter/single.ts:95,116`、`main/converter/merge.ts:157,174`、`main/converter/paths.ts:53`)。裁决:承认未实现并改文档措辞,**不做查表重构**(那属改行为) | REF-025 | 新增 ADR 条目并把 ADR-001 标「部分被取代」;`ROADMAP.md:121` 的「预留」已降级表述;6 处分支的处置方案已写进本文件裁决表 | `npm run check:contract` |
| #02 | 0 | 文档与代码不符修正:`src/renderer/state/state.ts:18` 声称「renderer→main 反向依赖清零」,实际剩 1 条已登记项(`src/renderer/renderer.ts:30`) | REF-025 | 该行表述改为「剩 1 条已登记项」并指向 `scripts/check-import-boundary.mjs:86-94` | `npm run check:contract` |
| #03 | 0 | 跨层方向收口:`src/renderer/renderer.ts:30` 的 `import type { PreloadApi }` 反向依赖(挂 `REVERSE_TYPE_ALLOWLIST` 近一年未收口)。把 `PreloadApi` 抽到 core 侧共享契约模块,删除放行条目 | REF-025 | `check-import-boundary.mjs` 的 `REVERSE_TYPE_ALLOWLIST` 为空或整条规则移除;`npm run check:boundary` 通过;`import-boundary` 段全绿 | `npm run check:boundary && npm run test:coverage` |
| #04 | 0 | 边界门禁补 main 层 scope:`LAYER_RULES` 增 main→renderer 禁止条目(现靠约定) | REF-025 | 新增规则 + 至少 1 条负向夹具;`check-import-boundary.mjs` 行为等价未变 | `npm run check:boundary && npm run test:coverage` |
| #05 | 0 | REQ-002 前置裁决登记:模板深导入要读 OOXML 非 styles 部件需 `node:fs`,届时 `CORE_NODE_BUILTIN_FILES` 会正确变红。二选一(加白名单=承认 core 碰宿主 / 下沉 main=承认模板导入不是 core 职责)**本项只登记压力与裁决时点,不预判方案** | REF-025 | 裁决表有该条且写明「REQ-002 开工前单独拍板」;风险节已点名 | `npm run check:contract` |

**阶段 1 · core 分层收口**

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #06 | 1 | `core/markdown` ↔ `core/pipeline` 目录级双向依赖收口:`precheckMarkdown`(`core/markdown/precheck.ts:194-246`)与 `cleanupMarkdown`(`core/markdown/ai-cleanup.ts`)是**阶段**不是共享语义(只被 `main/converter/preprocess.ts:13-14` 与 `main/ipc/register.ts:11` 各调一次),移入 `pipeline/` | REF-025 | 目录级双向边归零(正向 `pipeline/parse.ts:4,6,9,11`、反向 `precheck.ts:15` / `ai-cleanup.ts:12-13` 全部单向化);受影响测试文件清单已列出且**断言内容零变化** | `npm run typecheck && npm run lint && npm run test:coverage` |
| #07 | 1 | core 内建白名单粒度:`precheck.ts` 拆出 `markdown/image-path-policy.ts`(承载零 IO 的 `createLocalImagePathPolicy`,`:165-179`),`pdf/rules/image.ts` 移出 `CORE_NODE_BUILTIN_FILES` | REF-025 | `CORE_NODE_BUILTIN_FILES` 由 4 文件减为 3;`src/core` 不再传递依赖 `node:fs` 于纯渲染路径;`image-type` 段全绿 | `npm run check:boundary && npm run test:coverage` |
| #08 | 1 | `src/core/docx/render.ts`(410 行 / 3 导出)按自然切点拆分:ctx 构造(`:150-200`)、块级分发(`:222-232`)、Document 装配(`:235-300`)、section 页眉分流(`:290+`) | REF-025 | 每个导出符号的职责归属单一;渲染产物断言全部未变 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #09 | 1 | 双管线扩展点可机械定位:`src/core/pdf/render.ts:187-295` 的 11 次 `override*Rule` 注册顺序加不变量声明;`test/segments/dual-pipeline-matrix.test.js` 行结构加 `docxLandmark` / `pdfLandmark` 列指向**扩展点**而非产物 | REF-025 | 顺序约束在源码有声明;矩阵每行有两侧落点列;21 行实跑与 158 条 `must()` 零削弱 | `npm run test:coverage` |

**阶段 2 · renderer 内部收口**

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #10 | 2 | `src/renderer/settings/settings-panel.ts`(560 行 / 22 导出 / 5 职责)抽出无 DOM 依赖的 `persistSettings` 写路径原语(迁出 `:358-441` 的 5 个 `persist*`),解掉向导对设置面板的写路径依赖(`wizard/wizard-steps.ts:22`、`wizard-steps-delivery.ts:16`、`wizard-fields.ts:24`) | REF-025 | 向导三处 import 指向新模块且**不再 import `settings-panel.js`**;`settings-panel` 的导出数按职责分组 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #11 | 2 | `src/renderer/state/utils.ts`(实为 DOM 工具箱,18 导出,被 `convert/` 4 处、`settings/` 5 处、`ui/` 3 处、`wizard/` 2 处全量导入)移至 `ui/dom-ops.ts`;`state/` 只留 `state.ts` + `pure.ts` | REF-025 | `state/` 只剩 store 与纯函数核;`state/utils.ts` 已不存在;全部调用点断言未变 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #12 | 2 | `src/renderer/settings/` 命名统一:`-panel` / `-logic` / `-bindings` / `-drawer` 四种后缀描述同一子系统四个切面(参照同仓 `convert/` 的 `-flow` / `-events`) | REF-025 | 同目录文件名后缀收敛为一套;全部 import 路径同步且断言未变 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #13 | 2 | renderer 内部依赖方向门禁:复用 `check-import-boundary.mjs` 的规则表机制加 renderer 内部 scope,防止 `wizard ↔ settings-panel` 对向依赖(该方向约束目前为空白) | REF-025 | 新增规则生效 + 至少 1 条负向夹具;`check-import-boundary.mjs` 覆盖 src 与 dist 双形态 | `npm run check:boundary && npm run test:coverage` |

**阶段 3 · 剩余大文件与泛化桶**

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #14 | 3 | `src/main/ipc/register.ts`(727 行 / 6 导出 / 2 section,全部 IPC 通道单点注册)按主题域拆分 | REF-025 | 单文件不再承载全部通道注册;`ipc-channels` / `ipc-register` / `ipc-logic` 三段归属划分复核后断言未变 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #15 | 3 | `src/core/settings/settings-defaults.ts`(677 行 / 35 导出,默认值 + 归一化 + 预设三合一)按域拆分 | REF-025 | 每个导出归属单一域;`presets` / `settings` 段断言未变 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #16 | 3 | `src/core/util/utils.ts` 泛化桶更名(`escapeHtml:8` / `decodeEntities:18` / `escapeRegExp:34` 三个不同关注点 → `text-escape.ts`),并核实全库无第二处自建同类转义 helper | REF-025 | 文件更名完成且调用点同步;「是否存在重复单源」有书面结论(若有则一并收敛) | `npm run typecheck && npm run lint && npm run test:coverage` |
| #17 | 3 | `src/main/ipc/logic.ts` 被 `src/main/windows/preview.ts:20` 当工具库用(反向依赖,未登记)—— 抽出工具函数或改指向 | REF-025 | `windows/` 不再 import `ipc/logic.js`;`preview` 段断言未变 | `npm run typecheck && npm run lint && npm run test:coverage` |
| #18 | 3 | 等宽字体机制对齐:`src/core/pdf/template-css.ts:108` 是字面量 `Consolas`,docx 侧走 `src/core/docx/theme.ts:9` 的 `CODE_FONT`(正文侧两侧都已走 typography,仅等宽这一项机制不同) | REF-025 | 两侧等宽字体取同一单源;`pdf-css` 段断言未变 | `npm run typecheck && npm run test:coverage` |

**阶段 4 · 门禁与覆盖面**

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #19 | 4 | REF-024:段筛选命中 0 个即判红(`M2W_ONLY` 拼错时 `discoverSegments` 返回空清单、入口打印「全部 0 段通过」并 `return 0`,一个 typo 就能静默关掉整轮门禁) | REF-024 | 段发现结果为 0 且未显式声明「允许空」时抛错;正/负夹具各 1 | `npm run test:coverage` |
| #20 | 4 | `src/main/smoke.ts:29-33` 的三条「打包面纪律」(禁引用仓库相对路径 / 禁 `test/` / 资源走 `resource-dirs`)从注释约定变 `check-import-boundary.mjs` 的机械规则 | REF-025 | 新增规则 + 至少 1 条负向夹具;`check:asar` 仍通过 | `npm run check:boundary && npm run check:asar && npm run test:smoke` |
| #21 | 4 | REF-006 新事实:`dist/renderer/**`(30 个文件)整层被排除在覆盖率分母外,而它恰是层向越界风险最高的一层。改为参与平均或给 renderer 单列明显低于主线的独立阈值。**阈值本身不动** | REF-006 | renderer 层在覆盖率报告中可见;主阈值仍为 90/85/90/90 | `npm run test:coverage` |
| #22 | 4 | REF-002:`test/common/dual-extract.js` 下沉后,`cross-ref` 段与差异矩阵 `xref-label-namespace` 行仍各自实现「命中哪一条」;`toc-caption` / `eq-numbering` / `heading-links` 亦用裸字符串重复同一批产物事实 | REF-002 | 「命中哪一条」收敛为单源;矩阵 21 行实跑与 158 条 `must()` 零削弱 | `npm run test:coverage` |

**阶段 5 · 测试工程收口与提速**

| ID | 阶段 | 目标 | 关联 | 退出条件(可判定) | 门禁命令 |
|---|---|---|---|---|---|
| #23 | 5 | REF-019 落地后的复核与收口(**原实施已由 `8e088c5` 完成,处置改「已完成」,本项不重复实施**):① `test/common/runner.js` 在并发池落地后是否已成多职责堆积(段发现 / 编排 / 报告 / 并发 / 沙盒 / 进程管理);② `scripts/check-ci-contract.mjs` 对链内顺序与并发档位的断言是否仍成立;③ 独占槽机制与新登记的 REF-026(编排器自测段沙盒固定路径,并发下无隔离)是否需在本 campaign 内一并处置 | REF-019 | 上述三点各有书面结论;若判定 runner.js 需拆则拆法落进本项,否则明确记为「已接受例外」;契约断言与 `M2W_TEST_CONCURRENCY` 默认 1 口径一致 | `npm run verify:ci` |
| #24 | 5 | REF-020:lint 结果缓存(`lint` 是 `verify:ci` 里仅次于两遍测试的开销) | REF-020 | 本地重复运行省时生效;CI 侧已恢复缓存否则无收益(须在流水线配置里体现) | `npm run verify:ci` |
| #25 | 5 | REF-023 代码部分:win32 上把子进程 `code > 0x7fffffff` 标注成「子进程被 Windows 异常码 0xC0000005 终止」(背景:2026-09-26 那次 0xC0000005 两轮复发只拿到一个数字,根因无法证实或证伪)。**原「待 REF-019 同批落地」的依赖已解除** —— REF-019 已由 `8e088c5` 完成,本项可独立推进 | REF-023 | 失败日志自带该线索;契约脚本断言同步 | `npm run test:all` |
| #26 | 5 | **REF-026**:编排器自测段沙盒改唯一目录 —— `test/segments/runner-report.test.js` 的自测沙盒是固定路径 `output/tmp/runner-report-selftest/`,两套验收同时跑时一方 `cleanupSandbox()` 删掉沙盒、另一方嵌套 `runAll` 去 import 夹具即 `ERR_MODULE_NOT_FOUND`(2026-09-26 REF-019 验收时实测撞到,同一根因下连废 5 轮)。修法:沙盒目录名带每次运行的唯一后缀,参照段级 userData 的 `createTempUserData` 口径 | REF-026 | 两套验收并发跑不再互删沙盒;自测段连续 3 遍全绿;固定路径字面量已不存在 | `npm run test:all` |
| #27 | 5 | **REF-027**:测试树残留批次编号与门禁字母表缺口 —— `test/segments/eq-numbering.test.js` 6 处 throw 消息与 `b9*` 变量名带批次编号(REF-017 同类遗留,非其引入);REF-017 新加的门禁 `scripts/check-test-numbering.mjs` 的 `PLANNING_TOKEN_RE` 不含批次形态,故抓不到。**两者须同批做且有顺序**:先清 6 处残留,再把批次形态加进字母表,否则门禁立刻变红 | REF-027 | 6 处残留已清;`PLANNING_TOKEN_RE` 已含批次形态;`npm run check:contract` 与新增门禁均通过 | `npm run check:contract && npm run test:all` |

## 人工验收（≤5 条；campaign 期间只写在本节，不写 `../../ACCEPTANCE.md`）

> **本节是归档五步第 4 步的唯一输入源**(回填 `../../ACCEPTANCE.md` 覆盖矩阵,`工作项` 列 = 本工作项 ID)。行为等价重构通常**没有**人工验收项;本工作项有,故逐条列出。通过后划掉并标 `· <YYYY-MM-DD>`。

- [ ] 阶段 0 后:ROADMAP / ADR / 代码注释三处关于「格式注册表」的表述互相一致,且无任何文档仍声称已有注册表
- [ ] 阶段 2 后:打开设置抽屉,切换主题 / 语言 / 预设 / 导入模板并确认持久化生效(覆盖 `settings-panel` 拆分与 `persistSettings` 迁移)
- [ ] 阶段 2 后:走一遍成书向导全流程(打开、填字段、选模板、选输出目录、提交),确认写路径不再经设置面板
- [ ] 阶段 3 后:转换含代码块的样例,比对 docx 与 PDF 两侧等宽字体外观一致(覆盖 #18)
- [ ] 阶段 4 后:`M2W_ONLY=<拼错的词> npm test` 必须判红并给出明确错误(覆盖 #19)

## 范围外

- **双管线合并**(REF-008 已判「架构定论勿动」,ADR-014 保持独立)—— 本 campaign 只补约束不合并。
- **全部「已明确不做」条目**(REQ-010~016、REQ-020~022、REF-009~REF-013、REF-016)—— 重新晋升需用户单独拍板。
- **REF-015 代码签名** —— 需外部采购证书,超出「重构」语义;纳入会让 campaign 因外部依赖长期挂起。维持「暂缓 + 明确风险」。
- **REF-017 `test/**` 规划编号清理** —— **已由并发写者完成**并判「已完成」:实测 105 处已清零,并新增门禁 `scripts/check-test-numbering.mjs` 挂 `verify:ci`。本 campaign 不重复实施,只承接它的门禁缺口 —— 即 REF-027(已由 #27 认领)。
- **REF-006 的「阈值是否升到某 minor」** —— 人工裁决项,本 campaign 只处理「`dist/renderer/**` 整层排除」这一新事实,**不动 90/85/90/90 阈值**。
- **测试深导入 `dist/**` 内部产物(40+ 处)的全面去化** —— 属改架构且收益不确定;只落「新增特性时断言优先落在 `core/markdown/*` 单源模块」的规范。
- **删除 `test/pending/` 目录** —— 删文件属安全底线,需用户单独确认;本 campaign 只在「范围外」登记待裁决。
- **REQ-002 模板深导入的实现** —— 本 campaign 只在阶段 0 登记其对 core 纯度的压力并裁决,不做实现。

## 风险与中止条件

1. ⚠️ **判据②不成立的后果(最重要)**:本 campaign 大量计划项是文件移动(#06 / #07 / #11 / #14 / #15 / #16),而测试侧有 40+ 处深导入 `dist/**` 内部产物(如 `test/segments/basic-render.test.js:15-18` 直导 `dist/core/pipeline/parse.js` / `dist/core/docx/render.js` / `dist/core/convert.js`;`test/main/artifact-commit.test.js:26` 直导 `dist/main/converter/artifact-writer.js`;`test/renderer/renderer-pure.test.js:23` 直导 `dist/renderer/state/pure.js`;`test/renderer/convert-command-lock.test.js:227-259` 直取 4 个 renderer 产物绝对路径)。文件移动会改测试的 import 路径(不改断言内容,但测试文件要动),因此**不能声称「测试路径无需改动」**。缓解:① 行为等价性由 `npm run test:coverage` 全绿 + 四指标不低于现值证明;② 每个移动类计划项的退出条件必须列出受影响测试文件清单并声明「断言内容零变化」;③ 新增特性时断言优先落在 `core/markdown/*` 单源模块上(那层改名成本低),不落在 handler 产物形状上。
2. 阶段 5 动的是门禁契约与 CI 耗时,可能与阶段 0/4 的门禁改动叠加冲突。**已部分实现**:REF-019 的并发档位由 ADR-017 裁决为「默认 1、CI 显式开 4、独占槽不进池」,`scripts/check-ci-contract.mjs` 的相关断言已随 `8e088c5` 同步;残余风险是本 campaign 阶段 0(#04 main 层 scope)与阶段 4(#20 smoke 纪律门禁化)若也改同一张规则表,须与并发档位断言共存而不互相覆盖。
3. ~~REF-019 与 `gate-probes` 工作树指纹冲突~~ **已消解**:ADR-017 用「独占槽」解决 —— `gate-probes` 整轮先以并发 1 跑完、不进池,绕开「指纹覆盖 `output/`、并发下必然变动而确定性自判红」。**残余**:`test/segments/runner-report.test.js` 的自测沙盒仍是固定路径 `output/tmp/runner-report-selftest/`,两套验收同时跑会互删,已由并发写者登记为 **REF-026**(待拍板);#23 负责判定它是否需在本 campaign 内一并处置。
4. #03(`PreloadApi` 抽 core)会动 `ipc-contract.ts` 的导出面,属改对外接口;#18(等宽字体取单源)会改用户可见的 PDF 等宽字体取值来源。两者都需在所属阶段门禁外另跑一次 `npm run test:smoke` 与人工目视。

> 默认中止条件:连续 2 个阶段门禁未通过 → 暂停并重新裁决范围;范围显著扩大 → 拆为两个工作项,原目录按归档五步收尾。

## 待升 RESEARCH 的技术事实

> 本节是归档五步第 3 步(事实升格)的输入源,留待 campaign 关闭时升为 `../../RESEARCH.md` 条目;campaign 期间 `docs/RESEARCH.md` 禁写。

1. **层向门禁的覆盖与漏项** —— `scripts/check-import-boundary.mjs` 已覆盖 renderer→main(剩 1 条类型放行)与 core 内建白名单 4 文件,但 main→renderer 方向无规则、renderer 内部无 scope。
2. **双管线状态传播模型相反** —— docx 侧 ctx 逐块下传,PDF 侧走 `override*Rule` 顺序注册;「同一语义两端行为一致」无机制保证,只靠差异矩阵锁定。
3. **PDF 侧 11 次 `override*Rule` 注册顺序是隐式耦合** —— `src/core/pdf/render.ts:187-295` 靠后注册覆盖先注册,顺序即优先级,源码无任何声明。
4. **renderer 实际中心 hub 是 `state/utils.ts`** —— 名为 `state/` 的实为 DOM 工具箱(18 导出),被 `convert/` `settings/` `ui/` `wizard/` 共 14 处全量导入;真正的 store 与纯函数只占同目录另两文件。
5. **renderer→main 唯一残余跨层边与其放行机制** —— `src/renderer/renderer.ts:30` 的 `import type { PreloadApi }`,靠 `REVERSE_TYPE_ALLOWLIST` 放行,挂了近一年。
6. **覆盖率分母排除 `dist/renderer/**` 整层** —— 94 个被测文件中 33 个低于单项阈值,恰是层向越界风险最高的 renderer 层被整层排除在分母外。
7. **测试深导入 `dist/**` 内部产物的耦合面** —— 40+ 处直导内部模块路径,任何文件移动都要改测试 import(断言内容可零变化)。
8. **`scripts/` 对 `dist/` 只引产物面、不引内部实现** —— 正面约束:`check-import-boundary.mjs` / `check-ci-contract.mjs` / `check-smoke-contract.mjs` 均按产物路径断言,这是 REF-019 提速可安全并行的前提。
