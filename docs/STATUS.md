- 2026-08-14:**批次 13「模板导入(预设 JSON 导入/导出)」完成并发版 0.27.0**(cf2f630 + f6e3304):用户实测通过(T1-T3 全勾 + 修复复测);CHANGELOG [0.27.0] + tag v0.27.0
- 2026-08-14:**批次 12「界面体验优化」完成 + 用户实测通过,发版 0.26.0**(验收见 ACCEPTANCE.md 批次 12 节 U1-U7 全勾;含方向 B「代码质量与测试」迭代 1-3,CHANGELOG 0.26.0 条目汇总)
# 状态速查

## 当前状态
- 2026-08-14:**方向 B「代码质量与测试」全项完成(迭代 1-3)**:迭代 1 维护顺手项(7eb82af smoke 隔离 ui-state 会话残留 + USER-GUIDE/ROADMAP 核对去重);迭代 2 速赢批(abed9b7/1ebd756 settings-logic 抽取 + 22 断言直测,e526060 tsconfig 4 严格开关 + 依赖声明补齐 jszip/@types/mdast/katex(depcheck 修复),e6e48a9 mermaid-service 超时/崩溃/加载失败降级路径测试);迭代 3 工具链(eslint 10 flat + typescript-eslint 8.67 side-by-side TS6 API——TS 7 无 JS API,官方推荐方案,首跑修 5 处真实 floating/misused promise;c8 12 覆盖率:main 97% / core-docx 93% / core-pdf 95% / renderer 100%,sourceMap 映射,NODE_V8_COVERAGE 实测可行;engines 升 >=20.19);typecheck/lint/32 段/smoke 全绿;批次 12 已实测通过,0.26.0 已发版
- 2026-08-14:**方向 B 首项完成(settings-logic 抽取,abed9b7)**:自 settings-panel.ts 抽零 DOM 纯函数层 `src/renderer/settings-logic.ts`(validatePresetName/customPresetToTemplate/allPresets/customPresetNameFromId/clampMargin,allPresets 参数化),新建 segments/settings-logic.test.js 直测(22 断言),31→32 段全绿;typecheck/build/smoke 全绿;豁免不 tag
- 2026-08-13:**批次 11「体验打磨」完成 + 用户实测通过,发版 0.25.0**:11 项候选全选拆 4 迭代单元独立提交——I1 状态记忆(e0262e1:ui-state.ts 原子写+宽松校验,最近文件一键重转/会话恢复/对话框目录记忆/窗口面板记忆)、I2 结果增强(dd16075:批量失败重试/复制全部路径/完成弹窗不再提示)、I3 预览与模板(7d87bed:预览设置变更即时刷新+focus mtime 刷新/customPresets 另存为预设)、I4 顺手项(ebc5d88:列表行双击预览/应用菜单+关于);31 段 + smoke 全绿;用户 GUI 实测通过(ACCEPTANCE.md 批次 11 节全勾),验收关闭
- 2026-08-14:**批次 12「界面体验优化」Phase 0+1+2 实现完成 + 用户实测通过,发版 0.26.0**(方案存档 archive/20260814-185113):Phase 0 速赢 7 项拆 4 提交(af572e4 U1 点击行为对齐/740dd5d U2 窗口最小尺寸+密度上限/22cd5ab U3 快捷键提示+文案统一/dfd9a40 U4 预设上限提示);Phase 1 一次提交(a6d16ea C2 底部操作区 sticky 常驻/C10 双击预览可见提示+删 selected 死代码/C9 弹窗焦点陷阱);Phase 2+追加按钮一次提交(C8 模板预设上移全局常显/C12 最近条目仅加载/单文件态追加文件按钮,用户反馈);typecheck/build/31 段/smoke 全绿;待实测见 ACCEPTANCE.md 批次 12 U1-U7;方向 B(质量与测试)方案存档备查
- 2026-08-13:**批次 10 功能 2「题注/章节交叉引用」完成 + 用户实测通过,发版 0.24.0**:docx+pdf 双格式——题注(图/表)与章节 label 锚点(`{#fig:}`/`{#tab:}`/`{#sec:}`)、静态编号引用(`[图](#fig:a)` → 「图 1.1」+ 跳转)、悬空降级「(?)」+ 警告;renderDocx 预扫登记修复「引用先于目标出现」;pdf 侧顺带修复 8b 遗留(template.ts 补 counter-increment,此前 PDF 题注序号恒 0);自动化断言 test/segments/cross-ref.test.js(12 条验收点,30 段全绿);用户 GUI 实测通过(样例 test/fixtures/acceptance/cross-ref.md),ACCEPTANCE.md 批次 10 功能 2 节全勾,验收关闭
- 2026-08-13:**验收样例生成器完成(试点 + 全量)**:测试段导出 fixtures → test/tools/gen-fixtures.mjs 按功能自动生成 test/fixtures/acceptance/*.md(16 段 21 样例 + README 索引 + 图片复制),GUI 人工实测直接拖入;`npm run gen:fixtures`(需先 build)/`npm run check:fixtures` 漂移校验(幂等,exit 0/1);30 段全绿;选型见 RESEARCH.md + archive/20260813-211812
- 2026-08-13:**批次 10 功能 1「Mermaid 渲染导出」完成发版(0.23.0)**:```mermaid 围栏 → docx 嵌入 PNG(2x 高清,≤400 等比缩)+ pdf 内联 SVG(矢量);main 层单例隐藏窗口渲染服务(mermaid.min.js IIFE 本地加载 + CSP 断网 + parse 预检 + 15s 超时降级);语法错误/超时 → 等宽代码块原文 + 警告;用户 GUI 实测通过(ACCEPTANCE.md 批次 10 节全勾);测试 29 段 + smoke 全绿;提交 a89507a,豁免并入 0.23.0 发版(R 系列重构/T 组测试/B1/P0 修复)
- 2026-08-13:**B1 renderer 纯函数段完成**(482160e):抽 src/renderer/pure.ts(零 import 纯函数层),utils.ts re-export 保持 import 路径不变,新建 segments/renderer-pure.test.js(26→27 段);typecheck/build/27 段/smoke 全绿;豁免不 tag;测试缺口 25 项全部清零
- 2026-08-13:**R10 重构 × T 组测试全部完成**(6 个独立迭代,每迭代独立提交可回退):迭代 1 T 组测试安全网(8fa48db)——T2 merge→pdf 中间 HTML file:// 断言(392fca1 反斜杠修复守卫)、T3 docx bookmark w:id 唯一性(标题+公式书签,R4 回归)、T4 renderPdf 失败路径(patch printToPDF 抛错 → 窗口销毁+tmp 清理)、T5 行内 HTML 交叉边界(行首 html_block 放行/危险交错丢弃)、T7 image-downloader timeoutMs 注入(默认 10s 不变)、T8 getImageResolver 同一性,T6 核实现有覆盖免补;迭代 2 R10-2(ec26a4b) renderPhrasingSync/renderPhrasing 合并(删「类型谎言」InlineSyncChild);迭代 3 R10-3(16c3d3f) 三 handler 收敛 runWithCtx(取消语义集中);迭代 4 R10-4(5abe4fe) HTTP 失败不缓存(网络抖动不永久失败,断言 7 反转);迭代 5 R10-6(ffa5e7c) 行内 HTML 抽 core/docx/inline-html.ts(render.ts 1010→840);迭代 6 R10-5(5454426) renderer 设置面板抽 settings-panel.ts(renderer.ts 889→576,init 时序保持);R10-7 决定不做(收益 ~20 行, token 流敏感);typecheck/build/26 段/smoke(含 renderer diag)全绿;豁免不 tag
- 2026-08-12:**评审候选 R10-1 + T1 完成**(来源 20260812-000224 重构评审,用户确认执行此两条,其余候选待排期):R10-1 convert context 构造收敛——`buildConvertContext` 统一 convertImpl/mergeConvertImpl/openPreviewWindow 三处 settings→context 映射(消除字段逐字重复漂移),`app.getAppPath()` 依赖收敛至新模块 src/main/katex-dir.ts `getKatexDir()`(全仓库唯一 electron 依赖点,入口层传入),convertImpl/batchConvertImpl/mergeConvertImpl 尾部新增可选 `katexDir?` 参数(既有调用行为不变);T1 GBK 端到端——新段 test/main/gbk-encoding.test.js(iconv-lite 写 GBK 中文 → convertImpl("docx") → 断言「已按 GBK 编码读取」警告 + document.xml 中文正确);typecheck/build/26 段/smoke 全绿;提交 e015fae(refactor)+ 002a313(test);豁免不 tag
- 2026-08-11:**R8 收尾测试 × R9 综合排期完成(5 批全绿)**:批1 测试锚点(C1 image-type 直测 + C2 presets 契约段 + A3 smoke diag 修盲区,21→23 段);批2 smoke 下沉(A1 分页符并入 page-setup 段,C3 extractHeadings 直测,23 段);批3 R9 低风险清扫(L9 取消——imageResolver 真异步保留 async;L7 test/common/settings.js backupSettings;L6 src/main/temp-html.ts writeTempHtml 两处换用);批4 中风险(A2 pdf-bookmarks 书签端到端段 24→25 段;L3 escape 集中 core/utils.ts 三处换用;M3 currentCtx 按 webContents id 建 Map 多窗口取消隔离);每批独立提交可回退;typecheck/build/25 段/smoke(test:all)全绿;豁免不 tag
- 2026-08-11:**R8 renderer 阶段二完成(行为等价)**:renderer.ts 1596→~950 行拆分五模块——`state.ts`(共享可变状态单一来源 + IPC 契约类型 BatchProgressInfo/BatchItem/BatchResult)、`utils.ts`(setStatus/setError/进度/字段错误/焦点)、`file-list.ts`(选择渲染/列表/按钮工厂/拖拽清理)、`dialogs.ts`(汇总条 + 完成/批量弹窗)、`convert-flow.ts`(runConvert/runBatch/runMerge);renderer.ts 留组合根(API 契约/模板预设/设置面板/事件接线/init),状态读写全部经 `state.X`,依赖方向单向(各模块→state/utils/dom,convert-flow→dialogs/file-list);逐字段核对 mode/hydratingSettings 语义;typecheck/build/21 段/smoke(renderer diag)全绿;豁免不 tag
- 2026-08-11:**R7 renderer 阶段一完成(零风险)**:DOM 引用块抽 `src/renderer/dom.ts`(73 处元素映射纯 getElementById/querySelector,renderer.ts 命名导入,~175 行瘦身);删 L4 死代码 dialog:openMarkdown/openMarkdownDialog(main index.ts / preload.cts / renderer 类型三处);L5 lastBatchItems 并入 lastBatchResult(单状态,items 取自 lastBatchResult?.items);typecheck/build/21 段/smoke(renderer diag)全绿;豁免不 tag
- 2026-08-11:**R6 中优先级快修完成(M4/M6)**:settings saveSettings 写队列串行化(promise 链,调用序 = 写盘序,防并发交错写同一 tmp 丢更新;settings 段补并发断言:并发调用全部成功、最终落盘 = 最后一次调用完整状态、无 .tmp 残留);图片缺失检查并入 imageResolver 失败路径(移除 convert 层 stat 预扫,单次 IO;docx imageToDocx 失败统一告警,pdf 新增 checkLocalImages;三处文案统一为「图片加载失败: <src>」,常量收敛 src/core/image-warning.ts;image-downloader/basic-render 段更新文案断言);R2-R5 重构迭代此前已提交(R2 f7063c9 / R3 da3d4d0 / R4 82b26d0 / R5 863adb3,ROADMAP 勾选同步);typecheck/build/21 段/smoke 全绿;豁免不 tag
- 2026-08-11:**审计驱动重构进行中(R8/R9)**:R1 契约共享完成(白名单/设置契约收敛 core 单一来源,21 段 + smoke 全绿,394950f);src 全量架构审查 + 四大文件拆分评估完成(存档 20260811-201145),9 个迭代重构方案落盘 ROADMAP;每迭代独立提交可回退,行为等价(除注明修复项),收尾豁免不 tag
- 2026-08-11:**smoke 遗留修复完成**(输出隔离:outputDir 强制 "" + afterConvert "none" 结束恢复,产物落 output/smoke 不再污染 Downloads/自动弹窗;命名描述化:g3/g4/merge-a/b → smoke-basic/smoke-pdf/smoke-merge-1/2,清理前缀收敛 smoke-;typecheck/build/smoke 全绿,设置文件恢复验证通过;小型豁免不 tag)
- 2026-08-11:**迭代 4「预览入口迁移」用户实测通过**(预览迁移到转换前:单文件态操作行 + 多文件态每行「预览」按钮,完成弹窗移除预览按钮;build/验收 20 段/smoke 全绿,0.22.0)
- 2026-08-11:**重构四步完成 + 测试缺口高/中补齐**(取消状态参数化、converter 抽取、smoke 独立瘦身、测试目录分层;验收 19 段 + smoke 全绿,0.21.0)
- 2026-08-10:**测试体系重组完成**(验收脚本按内容主题拆分 segments/*.test.js 去批次化、样例静态入仓 fixtures/、产物目录 output/{artifacts,smoke}、旧产物清理;typecheck/build/验收 11 段/smoke 全绿,0.20.0)
- 2026-08-09:**批次 9 用户实测通过**(公式编号 + 交叉引用,0.19.1 含 2 个实测修复),批次 9 关闭
- 2026-08-09:批次 8 用户实测通过(8a 静态目录 + 8b 题注编号,0.18.1),批次 8 关闭
- 2026-08-08 13:27:24:docs 文件名统一英文化(0.17.2,纯文档;archive/ 存档保留原名)
- 2026-08-08:批次 7「体验优化 + 流程简化」完成 + 3 个 bug 修复已提交(0.17.1,typecheck/build/smoke 全绿)
- 2026-08-02~08-06:批次 1-6 与 G1-G5 均已完成(用户实测通过:批次 1/2/3 与 G5),详见 CHANGELOG;验收产物见 `output/artifacts/`(按内容主题命名,无批次概念)

## 验证基线
- 已跑通:
pm run typecheck、
pm run lint、
pm run build、
px electron . --smoke(启动 + docx/pdf 双链路 + 设置持久化/landscape 端到端 + 批量/合并端到端 + renderer 诊断)、
pm run test:coverage(c8,2026-08-14 实测 main 97% / core-docx 93% / core-pdf 95% / renderer 100%)
- 验收脚本:`npm run test`(test/acceptance.mjs 自动发现 `segments/`(core 渲染)与 `main/`(主进程层)下 `*.test.js`,32 段:基础渲染/封面/合并/脚注/公式/公式编号/PDF 元数据/PDF 书签端到端/标题编号链接/标题提取/排版/白名单/编码/TOC 与题注/任务列表/设置/页面设置(含分页符)/frontmatter/slug/外链图片下载/图片类型/预设契约/转换编排/路径解析/GBK 端到端/renderer 纯函数/Mermaid(core 契约 + main 真实渲染)/题注章节交叉引用/settings-logic 直测;新增测试=新建段文件零注册);main 侧行为(重名序号/输出目录/取消/批量导出)已有 `main/converter.test.js` 断言,smoke 保留必须 Electron 的断言(printToPDF 产物/书签/renderer diag/设置持久化往返)
- 验收样例:`npm run gen:fixtures`(需先 build)按功能自动生成 `test/fixtures/acceptance/*.md`(GUI 人工实测直接拖入);`npm run check:fixtures` 漂移校验(幂等,exit 0/1);新增功能=测试段顶层加 `export const fixtures = { main: ... }`,生成器零改动自动纳入
- smoke 自清理 output/smoke 临时产物(批次 7 重名保护后旧产物不再被覆盖,断言会遇 (N) 序号变体;Windows 占用文件 EBUSY 容错跳过)
- 历史批次断言明细见 `docs/CHANGELOG.md` 对应版本条目(0.4.x~0.17.x)
- 打包:`npm run dist`(electron-builder NSIS);验证链:--dir → asar list → win-unpacked 启动存活 → 静默安装/卸载(退出码 0);打包版 `--smoke` 不可用(asar 内只读,output/smoke 写不进);镜像环境变量见开发者手册

## 铁律(勿回退)
> 项目级硬约束(技术栈/镜像/字体/分页符/依赖钉死)已全部迁至项目 `AGENTS.md`「硬约束」节,以彼处为准。

## 打开事项
- [ ] 功能候选(批次 10 两项 8c Mermaid + 交叉引用均已完成发版 0.24.0;下一项待用户确认,见 ROADMAP「当前待办」)+ 暂缓/延后项见 `docs/ROADMAP.md`「当前待办」节
- [ ] 测试缺口(24 项)已全部补齐(2026-08-13);新增缺口按需入 ROADMAP「当前待办·测试遗留」
