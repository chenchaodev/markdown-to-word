- 2026-08-23:**审计改进 B10b docx 解包统一 jszip 完成**(docx-utils.js 删系统 tar 路径改 jszip 内存解析,unzipPart 转 async,71 处调用点/16 测试文件适配;验收总耗时 23.5s→19.1s);40 段全绿;B10 仅余 B10c noUncheckedIndexedAccess 存量适配(约 200 错误)
- 2026-08-23:**审计改进 B10a 工程门禁基建完成**(3 子代理并行:ci.yml 新建(push master/PR,windows-latest node22,concurrency+timeout30)/release.yml 加固(concurrency 不可取消+timeout40+失败 artifact 兜底)/acceptance userData 临时目录隔离/runner 逐段看门狗(M2W_SEGMENT_TIMEOUT_MS,默认 180s)+总耗时与最慢 5 段排行/tsconfig incremental/删死配置 tsconfig.eslint.json/test:smoke 前置构建新鲜度守卫/copy-renderer 按扩展名清陈旧静态资源/icons npm script);踩坑两枚已记 RESEARCH(dist/renderer 混合目录不可整删、incremental 不重建被删产物须 tsc --build --force);40 段 + smoke 全绿;B10 余 jszip 统一(B10b)与 noUncheckedIndexedAccess 存量适配(B10c,约 200 错误)
- 2026-08-23:**审计改进 B1-B3 完成**(cb40e04 安全加固 / ac1b357 主进程健壮性 / 7d85fad 编码与元数据 / c9e16b6 docx 渲染 / 本批 B3c 渲染保真:表格列对齐、eq label 口径 pdf 放宽、自闭合 `<br/>` 白名单三扫描器放行、merge 代码块感知+分页符防叠加、未知魔数图片跳过嵌入;复核修正两处审计误报:闭标签大小写本无缺陷、merge 首文件 frontmatter 保留为设计决策);40 段 + smoke 全绿;B3 仅余「列表/引用块降级见 B4」关联项,下一步 B10
- 2026-08-23:**全库质量审计 + 改进排期落盘**(3 子代理并行深审 core / main+renderer / 测试工程配置,主会话抽查复核;结论存 archive/2026-08-23-133005-全库质量审计 + RESEARCH 同日条目);全部待办 B1-B14(约 90 项)入 ROADMAP「当前待办·审计改进排期」,排期顺序与依赖已定;6 个决策点用户已全部拍板(题注编号=全文档连续 / eq label 口径=pdf 放宽对齐 docx / 未知图片类型=跳过+警告 / 最近条目=单击加载双击重转 / 暗色模式=做 / IPC 命名整理=做),规划即契约,按 B14→B1→B2 起步
- 2026-08-16:**发版 1.0.0 完成**(30661fe 登记;版本号三统一——package.json 1.0.0 / tag v1.0.0 / CHANGELOG [1.0.0],AGENTS.md 规则同步「1.0.0 起三统一」;Release run success,安装包 MarkdownToWord-Setup-1.0.0.exe 119.6MB + latest.yml;远端 tag 指向 30661fe 验证通过)
- 2026-08-16:**i18n 界面多语言实测通过**(用户确认「界面验证无问题」;ACCEPTANCE 5 项已勾选,排期功能 2/3 关闭)
- 2026-08-16:**文档加密决策不做**(用户确认):docx 库不支持加密(非 OOXML 标准),替代需引入 officecrypto-tool 新依赖;pdf 侧需 qpdf 原生二进制分发;调研依据 archive/20260816-114520,ROADMAP 转「砍」;排期功能 3/3 关闭
- 2026-08-16:**界面版本信息完成**(71eda87):标题区显示版本号(main IPC app:version + preload getVersion + renderer 显示,与「关于」对话框同源,失败静默);发布文档同步更新(15ee2d2:README/USER-GUIDE/docs-README)
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
- [x] 功能候选全部收口(批次 10:8c Mermaid / 交叉引用 / 模板导入 / 公式编号开关 / 批注 / WPS 兼容矩阵;排期 3 项:代码块高亮写 docx 0.32.0 实测通过 / i18n 1.0.0 实测通过 / 文档加密决策不做(砍));ROADMAP「当前待办」仅剩已完成/砍标记,无排期功能
- [x] 测试缺口(24 项)已全部补齐(2026-08-13);新增缺口按需入 ROADMAP「当前待办·测试遗留」
