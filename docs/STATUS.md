- 2026-08-16:**i18n 界面多语言实测通过**(用户确认「界面验证无问题」;ACCEPTANCE 5 项已勾选,排期功能 2/3 关闭)
- 2026-08-16:**文档加密决策不做**(用户确认):docx 库不支持加密(非 OOXML 标准),替代需引入 officecrypto-tool 新依赖;pdf 侧需 qpdf 原生二进制分发;调研依据 archive/20260816-114520,ROADMAP 转「砍」;排期功能 3/3 关闭
- 2026-08-16:**发版 1.0.0 准备中**(用户指令):README/USER-GUIDE 按实际功能更新、软件界面加版本信息;待用户确认后发版(打 tag v1.0.0 + CHANGELOG 汇总 + push)
- 2026-08-16:**文档加密调研完成**(adad6b8,纯文档):docx 库 9.7.1 不支持加密(maintainer 确认,非 OOXML 标准);pdf-lib 不支持写入加密;替代方案 officecrypto-tool(docx,Agile AES-256)/qpdf(pdf,最后一步后处理);实现待用户决策(需引入新依赖 + qpdf 原生二进制分发),依据见 RESEARCH.md + archive/20260816-114520
- 2026-08-16:**i18n 界面多语言完成**(218b183,17 文件 1078+/248-):新增 core/i18n.ts 纯模块(zh/en 字典 + t() 插值 + applyStaticTexts);AppSettings 加 language(默认 zh,全链路透传 + 旧文件兼容);renderer 设置面板「界面语言」radio 即时切换;main 菜单/对话框/预览错误页按语言输出;新增 i18n 测试段 + settings 段更新;40 段 + typecheck/lint/build/smoke 全绿;待实测见 ACCEPTANCE.md
- 2026-08-16:**发版 v0.32.0 完成**(6653713 登记;Release run success;tag v0.32.0 指向 6653713;本地打包验证通过——release\MarkdownToWord-Setup-0.5.1.exe,asar 关键文件确认(code-highlight/render/main/comment/pdf-render/renderer html+css),win-unpacked 启动存活 4 进程)
- 2026-08-16:**代码块语法高亮写 docx 实测通过**(用户确认;ACCEPTANCE 5 项已勾选,排期功能 1/3 关闭)
- 2026-08-16:**代码块语法高亮写 docx 完成**(3eb22c7,7 文件 316+/21-):新模块 core/docx/code-highlight.ts(hljs token → TextRun 序列,GitHub Light 色板与 pdf 侧一致,comment 斜体/strong 加粗);renderCode 接入——已知语言走高亮,无语言/未知语言/解析失败(含文本完整性校验)降级等宽文本;嵌套 span 类栈处理 + 实体单遍解码;测试新增 code-highlight 段 5 组断言,basic-render/mermaid 断言更新为高亮拆分形态;39 段 + typecheck/build/smoke 全绿;待实测见 ACCEPTANCE.md
- 2026-08-16:**待办排期决策**(用户确认):排期 3 项——代码块语法高亮写 docx / i18n / 文档加密;其余候选转「砍」(CSL 参考文献/AI 改写/表格合并单元格/代码高亮主题切换);最近文件延后项作废(批次 11 I1 已实现);ROADMAP「当前待办」同步
- 2026-08-16:**发版 v0.31.0 完成**(63c550b 登记 + 2478744 workflow 修复;Release run success,release notes 从 CHANGELOG 提取验证通过——c346c88 修复生效;tag v0.31.0 指向 2478744)
- 2026-08-16:**WPS 兼容矩阵实测通过**(用户确认 Word/WPS 双实测全部通过;ACCEPTANCE 4 项已勾选;矩阵状态列待用户回填或按通过处理)
- 2026-08-16:**WPS 兼容矩阵进行中**(Word/WPS 双实测清单化,守护既有功能;产出 docs/WPS-COMPAT.md 矩阵 + 实测指引)
- 2026-08-16:**批注迭代实测通过**(用户确认;ACCEPTANCE 4 项已勾选)
- 2026-08-16:**批注迭代完成**(308769e,7 文件 363+/5-):语法 [锚定文本]{批注=内容}(行内,单段落锚定 + 内容行内 rich);remark 插件(comment.ts:micromark text 扩展 + from-markdown 扩展,anchor/content 重新解析支持 rich);docx 渲染(CommentRangeStart/End/Reference + comments 容器,id 渲染期计数器唯一,author 固定 markdown-to-word);mdast-utils 仅锚定文本入纯文本(不进标题 slug/目录/题注);pdf 路线原样输出;38 段(新增 comments.test.js)+ smoke 全绿;待实测见 ACCEPTANCE.md
- 2026-08-16:**批注迭代进行中**(docx 批注支持;语法 [锚定文本]{批注=内容} 已确认;docx 库 API 调研完成(archive 落盘);v1 范围:单段落锚定 + 内容行内 rich,不做回复线程/跨段落;pdf 路线原样显示)
- 2026-08-16:**界面配置区重构实测通过**(用户确认;ACCEPTANCE 5 项已勾选)
- 2026-08-16:**界面配置区重构完成**(d225a76,6 文件 287+/273-):1 个折叠面板「设置」+ 内部 4 子组(模板/页面/排版/导出);模板预设从常显卡片收进设置面板;最近转换限高 240px 滚动;标题区去副标题;公式编号归排版;导出行为独立成组;panelOpen 默认折叠(已记忆展开态优先恢复);37 段 + smoke 全绿;待实测见 ACCEPTANCE.md
- 2026-08-16:**界面配置区重构进行中**(方案已确认:1 个折叠面板「设置」+ 内部 4 子组(模板/页面/排版/导出);模板预设从常显卡片收进设置面板;最近转换限高滚动;标题区去副标题;公式编号归排版;导出行为独立成组)
- 2026-08-16:**模板行布局重构实测通过**(d2147be;窄窗口辅助行换行/主行宽松/ghost 弱化/hint 悬浮均正常)
- 2026-08-16:**模板行 hint 修复实测通过**(5466f83;单行省略 + 悬浮全文正常)
- 2026-08-16:**模板行 hint 排版修复完成**(5466f83,3 文件 8 行):hint 单行省略 + title 悬浮全文(信息保留 + 行高固定);待实测
- 2026-08-16:**模板导入·CSS 覆盖 pdf 路线实测通过**(用户确认功能全部正常;ACCEPTANCE 4 项已勾选)
- 2026-08-16:**模板导入·CSS 覆盖 pdf 路线完成**(32235a7,15 文件 223+/7-):AppSettings 加 pdfCss(默认空);pdf 渲染追加到默认 CSS 之后(同一 style 内后声明覆盖);main 侧 import:pdf-css IPC(dialog + fs + 100KB 上限 + 取消 canceled);renderer 模板预设行加「导入 CSS…/清除」+ 状态显示;docx 路线不消费 CSS;37 段(新增 pdf-css.test.js)+ smoke 全绿;待实测见 ACCEPTANCE.md
- 2026-08-16:**模板导入·CSS 覆盖 pdf 路线进行中**(方案见 archive/20260814-201622:buildTemplate 的 style 后追加用户 CSS 后加载覆盖;防破坏:用户样式限定配色/字体类,分页规则风险文档说明)
- 2026-08-16:**弹窗提示修复复测通过**(308ebc4):勾选=提示/不勾选=不提示/弹窗内「不再提示」联动一致,验收关闭
- 2026-08-16:**弹窗提示 bug 修复**(308ebc4,1 文件 4+/2-):根因——设置面板「转换完成弹窗提示」checkbox 语义为「勾选=提示=suppress=false」,但代码直接传 checked 值(勾选→suppress=true→不提示,行为反);修复 syncSuppressCompleteDialog 回显取反 + change 事件取反;弹窗内「不再提示」checkbox 语义一致无需改;36 段 + smoke 全绿;待复测
- 2026-08-16:**实测修复 2 项**(f9b7d09,6 文件 75+/40-):①关公式编号时 {#eq:label} 段仍隐藏(语法标记不显示,docx skipSet/pdf hidden,不编号不登记不警告);②「清空最近」不生效——根因 saveUiState recentFiles 追加合并语义吞掉空数组,改空数组=清空(替换)、非空=追加合并;新增 test/main/ui-state.test.js 清空断言;36 段 + smoke 全绿;待复测
- 2026-08-16:**公式编号开关完成**(66681a9,13 文件 140+/12-):AppSettings 加 equationNumbering(默认 true);关时 docx/pdf 双格式一致——公式不编号、{#eq:label} 段原样渲染、引用保持原文本(不降级不警告);全链路透传(settings 白名单/校验/兜底/sanitize → buildConvertContext → renderDocx/renderPdfHtml)+ 设置面板 checkbox;36 段 + smoke 全绿;待实测见 ACCEPTANCE.md
- 2026-08-16:**GitHub 发布完成**:建仓 chenchaodev/markdown-to-word(Public)+ push master + 8 tags(v0.21.0~v0.28.0);Release v0.28.0 由 Actions 自动生成(安装包 119.5MB + latest.yml,workflow 见 .github/workflows/release.yml,打 tag 即触发);v0.28.0 tag 曾指向不含 workflow 的 commit 重打一次(教训:tag 必须指向最新 commit);remote 切 SSH(ssh.github.com:443,ed25519 key);全局 AGENTS.md v3.45 补「推送时」规则 + NETWORK-GUIDE v1.4 网络经验
- 2026-08-15:**发版 0.28.0**(78098cf + tag v0.28.0):CHANGELOG 汇总批次 14/15 + 顺手项 + 审计剩余项(豁免迭代并入);项目根 README.md 新建(GitHub 门面,17 项功能特性,内容与 USER-GUIDE/CHANGELOG 核对一致);GitHub 发布已完成(2026-08-16,见顶部新行)
- 2026-08-15:**审计剩余项全部完成**(193feb4 + 89b5860 + 24650c2):第 8 项 settings/ui-state 原子写+写队列抽共享工具 atomic-json.ts(createJsonWriter 工厂,行为零变化)/第 5 项 lint 范围扩 eslint src/ test/ scripts/(allowDefaultProject,首跑修 2 处真实错误)/第 11 项 build.files 排除 highlight.js/styles 确认安全(主题 CSS 手写内联)/第 12 项 archive 清理(删 3 条结论固化存档,24→21 条)/第 6 项备选 DEV-GUIDE 注明 gen-fixtures;第 7/9/10 项实证保留或确认合理;36 段 + smoke 全绿;豁免不 tag
# 状态速查

- 2026-08-15:**批次 15「重构」完成**(1d91d9e + 29c078c):R1 删 theme.ts 死代码/R3 导出 isValidSettings 直测/R4 回退策略注释/R6 IPC 纯逻辑抽 ipc-logic.ts(5 纯函数)/R2 settings-panel 抽 8 纯函数/R5 recent-files↔convert-flow ESM 环经 state 回调打破/R7 双管线差异注释;36 段 + smoke 全绿;重构豁免不 tag
- 2026-08-15:**顺手项完成**(025f651):README mermaid 条目 7 次重复删至 1 行/.gitignore 加 coverage//artifacts.js 注释修正/STATUS 悬挂行移入;评估保留:lint 范围扩 test/scripts(tsconfig 无 allowJs 需改结构)、gen-fixtures 位置(移动劈开测试工具链)、manual/(merge.test.js 活跃消费者,审计「陈旧」判定实证推翻)
- 2026-08-15:**批次 14「测试补齐」完成**(43452ca + 9dd272e):G1-G8 缺口全补(33→35 段,新增 utils/pdf-postprocess),typecheck/lint/build/smoke 全绿;小型豁免不 tag;批次 15「重构」待排期
- 2026-08-15:**批次 14「测试补齐」进行中**(审计依据 archive/20260815-144057):G5/G8/G4 立即批 + G1/G2/G3 近期批 + G6/G7 main 错误路径;待实测见 ACCEPTANCE.md 批次 14
- 2026-08-14:**批次 13「模板导入(预设 JSON 导入/导出)」完成并发版 0.27.0**(cf2f630 + f6e3304):用户实测通过(T1-T3 全勾 + 修复复测);CHANGELOG [0.27.0] + tag v0.27.0
- 2026-08-14:**批次 12「界面体验优化」完成 + 用户实测通过,发版 0.26.0**(验收见 ACCEPTANCE.md 批次 12 节 U1-U7 全勾;含方向 B「代码质量与测试」迭代 1-3,CHANGELOG 0.26.0 条目汇总)

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
- [x] 功能候选(批次 10 全部完成:8c Mermaid 0.23.0 / 交叉引用 0.24.0 / 模板导入 0.27.0+0.29.0 / 公式编号开关 0.29.0 / 批注 0.31.0 / WPS 兼容矩阵 0.31.0);排期 3 项(代码块高亮写 docx / i18n / 文档加密)见 ROADMAP「当前待办」;其余候选已决策不做(砍)
- [x] 测试缺口(24 项)已全部补齐(2026-08-13);新增缺口按需入 ROADMAP「当前待办·测试遗留」
