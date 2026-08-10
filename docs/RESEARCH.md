# 研究结论

> 只记录「换会话仍会用上、且别处查不到」的坑/勿回退事实/库事实。已实施且细节见 CHANGELOG 的条目不再重复;选型见ADR.md。原文存档:docs/archive/。

### 2026-08-10 21:12:58 测试覆盖盘点结论(@explorer,测试缺口清单依据)
- **方法**:能力面(src/core 全部 + src/main + src/renderer)逐一 grep 对照 test/segments 11 段 + smoke 断言,产出「能力点 × 覆盖」全量表(详见存档);缺口清单见 docs/ROADMAP.md「测试缺口」节(24 项,高/中/低三档)
- **高优先级缺口**:封面页双格式(docx cover / pdf .cover 均无断言)、breakBeforeH1 产物分页(smoke 只测设置持久化)、取消链路回归(fd40480/f809c57 两次取消 bug 无回归测试)、重名保护主动断言、缺失图片警告文案(collectMissingImageWarnings)、公式降级分支(katex-error 灰字+警告)、外链图片下载(image-downloader 超时/去重/失败兜底全无)、任务列表(docx 普通列表 / pdf ☐☑ 替换)、h4-h6 标题、分页符产物
- **中优先级**:settings sanitize 边界(字号 8-24/行距 1.0-2.5/边距 0-1000 钳制、损坏回退、旧文件兼容、patch 白名单)、slug 三函数单测(uniqueSlug 去重/docxBookmarkId 兜底)、frontmatter 边界、非 A4 纸张/边距值、docx 行距缩进值、代码块/引用块/列表 w:numPr 序列化、外链 rels、页脚页码文案
- **低优先级(维持 smoke diag + GUI 实测)**:renderer 全部交互、runAfterConvert、collectMarkdownPaths、超长路径回落、IPC dialog/预览
- 来源: @explorer exp-1(两轮);关联: 原文存档 docs/archive/20260810-211258-测试覆盖盘点.md;缺口清单 docs/ROADMAP.md「测试缺口」节

### 2026-08-08 11:50:33 docx 域 API 调研结论(@librarian,8a TOC/8b 题注实施依据)
- **TableOfContents 组件存在且为官方推荐路径**(docx 9.x):`new TableOfContents("目录", { hyperlink, headingStyleRange: "1-3", ... })`,生成完整 w:sdt 复杂域;官方文档要求配合 `features: { updateFields: true }`(产出 w:updateFields,Word 打开弹提示并全量更新所有域——TOC/SEQ/STYLEREF/REF 均在内);现有 render.ts:289-309 已用该组件,**8a 增量 = 开关化 + updateFields 联动**
- **无 ComplexField 类**;行内域用 `SimpleField(instruction, cachedValue?)`(无 dirty 属性,未更新时显示 cachedValue,不传则空白);库内置 SequentialIdentifier = 裸 SEQ 域(无开关无缓存值),带 `\* ARABIC \s 1` 的题注需 SimpleField 手插;域指令空格是关键(开关前必须有空格,首尾各留一个)
- **「图 1.1」章节号 = STYLEREF 域**(Word 原生题注机制,`图 { STYLEREF 1 \s }-{ SEQ 图 \* ARABIC \s 1 }`);docx 无 STYLEREF 包装类,SimpleField 手插,styleId 必须写 `Heading1`(非 Word 内置 `1`);前提:标题编号必须 w:numPr 自动编号——**现有 5b 已是 numbering 静态渲染(render.ts:425-428 w:numPr),域路线直接兼容,无需改造**
- **两条路线必须二选一、8a/8b 同路线,严禁混用**(目录是域+题注静态 → 编号体系割裂):
  - **更新路线**: 8a `updateFields:true`(可关 beginDirty)+ 8b STYLEREF+SEQ;打开弹一次域更新提示(Word 确认后全量精确),改标题/增删图后 F9 同步;WPS 支持未官方背书需实测(12.8 前 TOC 引号 bug 已修;F9 弹安全声明);Google Docs/LibreOffice 忽略 updateFields 显示空白
  - **免更新路线**: 8a `beginDirty:false` + cachedEntries(不带 page 的纯超链接目录完全免页码)+ 8b 渲染期静态注入章节号文本;零提示全端一致,导出即准,改标题后陈旧需重新导出;cachedEntries 页码无法精确(docx 无排版引擎,#885)
- **推荐**: 用户会用 Word 继续编辑长文档 → 更新路线(与 Word 原生一致);一次性定稿导出 → 免更新路线。**待用户决策**
- 来源: @librarian lib-1 + lib-3;关联: 原文存档 docs/archive/2026-08-08-1142-docx域API调研.md;WPS 证据 plus.wps.cn/blog/p114770、p114765、gi-wps.com/blogs/640620432、docx issue #1212/#2673/#885

### 2026-08-08 11:50:33 批次 8 管线勘察结论(@explorer,实现 TOC/题注编号的现状事实)
- **docx 原生 TOC 域已存在**:render.ts:289-309 `renderTocPage()` 用 docx 9.x `TableOfContents` 组件(`\o "1-3" \h \z \u` 配置齐全,占位「右键 → 更新域 生成」),正文含任意 heading 即**无条件插入**(render.ts:184-187,无开关);批次 8a 增量 = 开关化(`toc?: boolean`)+ 确认题注不被 TOC 收集(题注不得用标题样式/需 `\b` 排除)
- **docx 章节编号 = numbering 静态渲染,非域**:h1-h3 挂 `numbering: { reference: "md-heading" }`(render.ts:425-428),打开 Word/WPS **无需 F9**;OOXML numbering 引擎管理多级计数,**代码无计数器变量** → 题注段落无法复用标题计数器拿「当前章节号」
- **题注编号两条路线(产品决策待定)**: (a) STYLEREF 域取最近 Heading 1 编号 + SEQ 域计数(Word 原生标准,但需更新域才显示,与「无需 F9」现状冲突);(b) 渲染期静态注入章节号文本 + SEQ 域仅承担图序号(免 F9,重排不自动更新)。建议先问用户是否接受「需更新域」
- **无 caption 语法**:mdast 无 figure/figcaption 节点,raw HTML 白名单无 `<figure>`;题注需自定义识别(如图片段落后/表格后的特殊标记)+ 块级插入点(renderBlock "paragraph"/"table" case,render.ts:352-360),需文档级计数 ctx(仿 footnoteNextId 模式 render.ts:87、169)
- **PDF 侧题注易实现**:标题编号是 CSS counter 伪元素(不进文本,书签不受影响,pdf/render.ts:369-377);题注可 `.fig-caption::before { content: counter(h1c) "." counter(figc) }` 实现;PDF 目录 buildTocHtml()(483-495)从渲染后正文正则提取 h1-h3,无 [TOC] 语法
- **新增设置字段落点**:开关仿 `breakBeforeH1` 放 AppSettings 顶层(顶层布尔先例,settings.ts:16-26),或仿 `headingNumbering` 挂 TypographySettings;新增字段需同步改 SETTING_KEYS(settings.ts:45)+ sanitize(119-152)+ renderer 平行类型/默认值(renderer.ts:98-105、131-153);主进程 convertImpl 实时 loadSettings()(main/index.ts:97)
- **验收脚本钩子**:`test/acceptance.mjs` 自动发现并顺序执行 `segments/*.test.js`(段文件导出 `async function run()`,零注册;新增测试=新建段文件);docx 断言 = zipContains(部件存在)/unzipPart + 字符串匹配 OOXML 片段(如 `w:lvlText w:val="%1.%2"`);PDF 断言 = 产物 .html 字符串匹配(CSS counter、class);公共工具(htmlToPdf/saveArtifact/路径常量)见 `test/common/`
- 来源: @explorer exp-1;关联: 原文存档 docs/archive/2026-08-08-1123-批次8管线勘察.md

### 2026-08-08 12:16:09 批次 7 修复期踩坑结论(已验证,勿回退)
- **每个转换入口必须独立复位 cancelRequested**:单文件在 convert handler 复位、批量在 batchConvertImpl 开头复位、**合并必须在自己函数开头复位**——缺失则上次取消残留 true,二次转换立即被 throwIfCanceled 误判「已取消」(fd40480 修复)。新增转换入口时对照三个入口检查
- **进度上报必须逐入口接线**:单文件/批量有 onProgress,合并最初缺失 → renderer 进度条停在 0%(524cdf2 修复)。新增转换入口时确认 main→preload→renderer 三层通道全通(事件名 convert:progress/batch:progress)
- **printToPDF 是 Electron 原子调用,不可中断**:取消需等当前轮打印结束;取消检查点应放在 loadFile 前 / fonts.ready 后 / **打印完成后落盘前**(最后一个是关键,取消则不产出文件、不注入书签元数据、不报成功)(f809c57 修复)。renderPdf 为单文件/合并共用
- **renderer 取消分支依赖 handler 返回 { ok:false, canceled:true }**:ConvertCanceledError 必须被每个 handler 识别并转成 canceled 字段,否则 renderer 走失败分支弹「转换失败」而非「已取消」
- **smoke 自清理产物**:批次 7 重名保护后,output 残留旧产物不再被覆盖 → smoke 断言(如 endsWith("-合并.docx"))会因 (N) 序号变体失败;smoke 开头按前缀清理自身产物,Windows 占用文件 EBUSY 容错跳过
- 来源: 自查(用户实测反馈驱动);关联: 524cdf2 / fd40480 / f809c57

### 2026-08-08 11:19:01 批次 7 体验优化实现结论(已验证,勿回退)
- **编码预检**:`TextDecoder("utf-8", { fatal: true })` 是可靠的 UTF-8 合法性判定;失败按 iconv-lite gb18030 解码(**gb18030 是 GBK 超集,GBK 文件无损**);UTF-8 BOM(EF BB BF)与 UTF-16LE BOM(FF FE)嗅探剥离;Node 原生不支持 GBK 解码,必须 iconv-lite
- **重名加序号**:输出路径已存在 → `名 (2).ext` 递增,绝不覆盖(与单文件/批量/合并统一走 resolveOutputPath);Windows 路径 **>250 字符回落源目录并警告**(MAX_PATH 限制,Electron 侧无解)
- **输出目录语义**:`settings.outputDir` 空串 = 源文件同目录;非空 = 绝对路径校验(相对路径视为非法),输出目录不存在则创建、创建失败回落源目录并警告
- **取消机制**:renderer 发 `convert:cancel` IPC → 主进程置 cancelRequested 标志 → 检查点抛 ConvertCanceledError → 返回 `{ ok:false, canceled:true, error:"已取消" }`;批量在文件间检查,未开始项记 `{ canceled: true }` 与 canceledCount
- **批量导出后一致**:批量完成后按 afterConvert **仅对首个成功项执行**(防 N 个文件自动打开),与单文件语义对齐
- 来源: 自查(fix-2 部分落盘 + 编排器直接实现,typecheck/build/验收全绿)
- 关联: src/core/encoding.ts、src/main/index.ts、src/main/settings.ts、src/renderer/renderer.ts、docs/archive/2026-08-08-1029/1030/1031 三份调研存档

### 2026-08-08 11:19:01 功能扩展调研要点(@librarian,批次 8 规划依据,详见路线图)
- 市场信号:**Mermaid 从加分项变标配**(2026 新工具几乎全有);WPS 用户群被单独服务,docx 输出必须过 WPS 兼容关;中文排版(eastAsia)仍是全赛道系统性短板(Pandoc 3.2.1 才加 w:hint="eastAsia" 且中英引号还有 bug)——护城河成立,也是营销话术点
- 来源: @librarian(lib-1);关联: docs/ROADMAP.md、原文存档 docs/archive/2026-08-08-1030-功能扩展调研.md

### 2026-08-08 11:19:01 易用性调研要点(@librarian,批次 7 已实施;未做项见路线图)
- 中文用户特有坑:GBK/GB18030 编码检测转码(Node 原生不支持,需 iconv-lite,已实施)、Windows MAX_PATH 260 预检(已实施,>250 字符回落)、UTF-16/ANSI 乱码文件名
- 可量化自评:SUS 基准 68 分=50 分位;任务完成率行业均值 78%,目标 ≥90%;点击数目标 ≤3;启发式走查 3-5 人可发现约 75% 问题
- 来源: @librarian(lib-2);关联: 原文存档 docs/archive/2026-08-08-1031-易用性调研.md

### 2026-08-08 10:20:16 批次 6 公式链路实现结论(@librarian 调研 + 实测,勿回退)
- **docx@9.x 原生支持 OMML 数学**:组件 Math(容器)/MathRun/MathFraction/MathRadical/MathSuperScript/MathSubScript/MathSubSuperScript/MathFunction/MathSum/MathIntegral/MathLimit/MathRoundBrackets 等;数学段落走 Math 容器,**无需注入原始 XML**
- **KaTeX 字体本地嵌入**:katex.min.css 相对路径引用 fonts/,必须 css 与 fonts/ 同级;file://(win.loadFile)下 @font-face 相对路径可用,**data: URL 加载则全失效**;最佳实践 = 构建期复制 katex.min.css + 21 个 woff2(~400KB,删 ttf/woff)到资源目录,不 data URI 内嵌
- **printToPDF 公式坑**:① 头号坑 = 字体时序,did-finish-load 后必须 `await win.webContents.executeJavaScript('document.fonts.ready')` 再 printToPDF,否则缺字形;② 必须 printBackground: true + CSS print-color-adjust: exact;③ display 公式不自动换行,超宽溢出(KaTeX 固有)
- **docx 公式上游:KaTeX `output: 'mathml'`**(renderToString 零成本产出 MathML)→ 自研 MathML walker → docx Math 组件树;覆盖 msqrt/mfrac/msub/msup/msubsup/mrow/mo/mi/mn/mtext ~10 种节点;**走 MathML 路线无需自研 TeX 解析器**
- 降级线(红线兜底):walker 未覆盖 / KaTeX 报错 → TeX 源码以 MathRun 等宽样式输出 + warning,不丢内容不崩
- 来源: @librarian(lib-2);关联: 原文存档 docs/archive/2026-08-06-2229-批次6公式链路调研.md

### 2026-08-06 21:27:25 批次 5 docx 标题编号 + 内部链接实现结论(已验证,勿回退)
- 标题编号**首选段落级 numbering**:标题 Paragraph 直接挂 `numbering: { reference: "md-heading", level: depth-1 }`(与现有 md-list 同构);1 个 reference + 3-6 级 levels(text `%1`/`%1.%2`/`%1.%2.%3`,format "decimal",indent `{ left: 360, hanging: 360 }`);编号静态渲染,**打开 Word/WPS 无需 F9 即显示**
- **heading + numbering + Bookmark 三者不冲突**(pStyle / numPr / 段落内容三层);`numbering` 与 `heading` 并存不会注入 ListParagraph 样式(9.7.1 实证)
- 混合格式「第一章 + 1.1」坑:`%n` 按被引用级别自己的 numFmt 渲染,level 1/2 需 `isLegalNumberingStyle: true`(w:isLgl)才得「1.1」;需 Word/WPS 实测
- **9.7.1 无 Hyperlink 类**(9.x 拆分):内部链接用 `InternalHyperlink({ anchor: docxBookmarkId(slug), children })`(anchor 指向 Bookmark 的字符串 id/w:name,参数名是 anchor 不是 internalAnchor);外链用 `ExternalHyperlink({ link })`;相对路径保持假链接样式
- 链接样式不自动套用,TextRun 仍需手动 color/underline;anchor 与书签 id 字符串精确匹配(两侧都走 docxBookmarkId);与脚注/Bookmark 可同段混排
- 来源: @librarian(lib-1,本地 docx@9.7.1 d.ts/cjs 逐行实证)
- 关联: src/core/docx/render.ts、src/core/docx/theme.ts、原文存档 docs/archive/2026-08-06-2116-docx标题编号与内部链接调研.md

### 2026-08-05 22:22:19 批次 4 脚注实现结论(已验证)
- PDF 侧:@mdit/plugin-footnote@^1.0.2(peer 显式 markdown-it ^14.2.0);输出锚点 footnote-N/footnote-ref-N;重复引用编号 [2]/[2:1];**Chromium 不支持 CSS float: footnote,PDF 脚注集中在内容末尾渲染(非页脚)——HTML→PDF 通用行为差异,验收预期**
- docx 侧零新依赖:9.7.1 Document 级 `footnotes: Record<id字符串, { children: Paragraph[] }>` + 正文 `new FootnoteReferenceRun(id)`;id 从 1 起唯一,分隔线/编号自动;**footnotes 只挂 Document 级,不在 section 级**
- **docx 侧实现要点:全局递增计数器统一编号(md 拼接合并天然连续,勿按文件重置);footnoteDefinition 内容嵌套引用需递归渲染且共用计数器;重复引用按引用次数逐个编号(与 markdown-it 对齐),而非按定义去重**
- **语法不对称:内联脚注 ^[...] 只有 PDF 侧支持(markdown-it),remark 侧 mdast 无对应节点 → docx 侧按字面量/不支持处理,需在需求层面确认**
- 来源: @librarian(lib-2);关联: src/core/pdf/render.ts、src/core/docx/render.ts、原文存档 docs/archive/2026-08-05-2212-脚注实现调研.md

### 2026-08-05 22:22:19 批次 4 docx 页眉页脚 + 页码实现结论(已验证,勿回退)
- Header/Footer 构造:`new Header({ children: (Paragraph|Table)[] })`,children 只收段落/表格,不能放裸 TextRun;页码字段必须包在 Paragraph 里
- **挂载点只有 `sections[].headers/footers`**(Document 级无此选项);首页不同用 `properties.titlePage: true` + headers.first/footers.first
- **坑:9.x 无 `PageNumberFormat`(旧版 API 已移除,改名 `NumberFormat`);页码格式写 section `properties.page.pageNumbers.formatType`;中文模板「第 X 页 / 共 X 页」用 `PageNumber.CURRENT`/`TOTAL_PAGES` 放 `TextRun({ children })` 混排**
- 合并场景:文本拼接后单次渲染单 section → 页眉页脚自动覆盖全页、页码连续;TOTAL_PAGES 统计全文档(含封面/目录),与 PDF footerTemplate 的 totalPages 语义一致
- 页眉标题优先级:`metadata.title ?? options.title`(与 pdf 相同);docx 侧 renderDocx 新增 title 选项,convert.ts docx 分支补传
- 来源: @librarian(lib-3,已对照本地 docx@9.7.1 类型/源码验证)
- 关联: src/core/docx/render.ts、src/core/convert.ts、原文存档 docs/archive/2026-08-05-2210-页眉页脚页码调研.md

### 2026-08-05 22:03:15 批次 4 书签实现结论 + 「点击不跳转」修复(已验证,勿回退)
- **坑:pdf-lib PDFName 的 `asString()` 返回内部编码(`%` 已被转义为 `#25`);必须先 `key.decodeText()` 还原为百分号形式,再 `decodeURIComponent` 才得到中文**(实测,勿回退)
- printToPDF 产物 **无 /Names 名称树,而是旧式直接 `/Dests` 字典**(catalog /Dests → {key: dest});需兼容两种结构(名称树 + 直接字典),勿只按名称树实现
- **坑:pdf-lib 的 `dict.lookup(key, type)` 在 key 缺失时抛 `UnexpectedObjectTypeError` 而非返回 undefined**(实测崩溃根因);必须用 `dict.get(key)` + 手动 `context.lookup(ref)` 解引用;旧式直接字典的 key 是 PDFName 百分号编码 UTF-8;PDFName 的 decodeText 走 PDFDocEncoding 会把 UTF-8 中文解成乱码(勿用)
- 注入实现(src/core/pdf/bookmarks.ts,自研):`lookupNamedDest`(双兼容 + PDFDict 间接目标取 /D)+ `setOutline`(marp-cli 样板:pageRefs 经 `catalog.Pages().traverse` 收集、嵌套 First/Last/Count、F 标志 italic|bold)+ `buildBookmarkTree` + `injectBookmarks`;标题 id 即命名目标名(slug 与 /Dests key 一一对应)
- pdf-lib 1.17.1 为最新稳定版;ESM 用包名导入,勿碰 `pdf-lib/es/index.js`(无扩展名相对导入,Node ESM 抛 ERR_MODULE_NOT_FOUND);中文标题必须 PDFHexString.fromText(UTF-16BE),PDFString 乱码(issue #516);子项 Count 负值=折叠;save() 不破坏原 Link 注释/字体/图片(实测)
- 教训:smoke 断言只查标题文本不查 Dest 指向,漏过「全部回退首页」类 bug;已补断言 `Dest[0] instanceof PDFRef`(单文件+合并两处)
- 来源: @librarian(lib-1)样板 + 自查实测;关联: src/core/pdf/bookmarks.ts、src/core/pdf/render.ts(extractHeadings)、src/main/index.ts(renderPdf 注入)、原文存档 docs/archive/2026-08-05-2151-pdf书签注入调研.md

### 2026-08-04 20:57:34 批次 3 实现结论(批量/合并,已验证)
- 批量转换:队列并发 2;失败不中断逐条汇总;批量模式跳过 runAfterConvert(防批量后自动打开 N 个文件);进度 `batch:progress` { index, total, file, stage }
- 多文件合并:`mergeMarkdowns(files: {content, baseDir}[])` 纯逻辑——首文件 frontmatter 保留、后续剥离;图片相对路径 → 绝对(path.resolve,保留 title 部分);`<!-- page-break -->` 拼接;空文件跳过;合并后走单文档渲染 → 封面/全局 TOC 自动成立
- 合并输出:与首文件同目录 `{首文件名}-合并.{ext}`;imageResolver 跨文件共享(模块级 Map<baseDir, resolver> 缓存);拖放文件夹 `collectMarkdown` 递归收集(跳过点开头目录,seen 防符号链接循环)
- **坑:JSDoc 注释内 `**/*.md` 含 `*/` 会提前终止注释块 → 后续内容被当代码解析(TS1109 一串);注释里写 glob 需避开 `*/` 序列**
- 来源: 自查(迭代实测)+ fixer/designer 实现;关联: src/core/merge.ts、src/main/index.ts、src/main/preload.cts、src/renderer/*

### 2026-08-03 23:14:13 批次 2 spike 与实测结论(已验证,勿回退)
- docx TOC:docx 9.7.1 **内置 `TableOfContents` 类**可用(SimpleField 不行——fldSimple 仅行内;ComplexField 已移除),产出标准 TOC 复杂域(begin/separate/end + `w:instrText` TOC \h \o "1-3" \u \z,begin 带 dirty);主方案 `contentChildren` 静态占位(F9 更新替换);降级方案 `cachedEntries` 同 API 但要**自行注册 TOC1-9 样式** + 逐条书签 href;库怪癖 `cachedEntries.length<=1` 补空段落
- **printToPDF 保留页内锚点为 PDF 可点击链接(含跨页)**:`/Type /Annot /Subtype /Link` + 命名目标 `/Dests`(/sec1 [2 0 R /XYZ ...]),非 /GoTo;PDF 目录「无页码+锚点」方案成立,零额外处理
- **分页空白页坑**:`break-before: page` 相邻**不合并**(Chromium printToPDF 实测):分页符 div 后紧跟的 h1 叠加 break-before 产生 1 空白页;`body > h1:first-child` 例外在封面/目录场景失效;修复=无条件加 `.page-break + h1 { break-before: auto; }`
- **Electron 43 ESM 主入口坑**:顶层 `await app.whenReady()` 挂起(ready 永不 resolve,进程不退出);必须 `app.whenReady().then(async()=>{})` 链;electron 直调用 `node_modules/.bin/electron.cmd`(npx 会触发网络检查)
- pdf 外链图:渲染后收集 http(s) img src → 并发 3 下载 → data URL 内嵌(mimeFromBuffer 魔数 png/jpeg/gif/webp);失败保留原 URL + 警告;main 侧 `createImageResolver`(fetch + 10s AbortSignal + 同 URL 去重缓存)
- 来源: fix-5/fix-9/fix-10/fix-7/fix-8(终态结论)+ 自查实测
- 关联: src/core/{frontmatter,convert}.ts、src/core/docx/render.ts、src/core/pdf/render.ts、src/main/{index,image-downloader}.ts、原文存档 docs/archive/2026-08-03-2311-批次2-spike与实现结论.md

### 2026-08-03 21:46:27 批次 1 实测事实(docx/pdf 排版控制,已验证,勿回退)
- docx 9.x section `page.size`:orientation=landscape 时**库自动交换 width/height 写入 pgSz**,应传原始(纵向)尺寸 + orientation 枚举;手动交换会双重交换导致宽高反(实测 bug 已修复)
- docx 9.x 无 `IParagraphOptions.bookmarks`:标题书签用 `Bookmark` 组件包裹 runs(BookmarkStart/children/BookmarkEnd,产出标准 Word 书签)
- mdast `Data` 为空接口:标题 id 需 `declare module "mdast"` 声明合并(parse.ts),docx 消费端直接读 `node.data?.id`
- markdown-it 14.3 的 heading_open token 的 `content` 恒为空字符串,标题纯文本落在下一个 inline token(`tokens[idx+1].content`),标题 id 生成需该兜底
- 设置持久化原子写:临时文件 + rename(Windows 下 rename 可覆盖);整文件形状校验失败整体回退默认
- 来源: 自查(迭代实测)+ fixer/designer 实现;关联: src/core/{slug,parse,convert}.ts、src/core/docx/render.ts、src/core/pdf/render.ts、src/main/settings.ts

### 2026-08-02 21:08:53 G5 打包坑 + 实测事实(electron-builder,已验证,勿回退)
- **坑:highlight.js es/ 不可排除**:`import hljs from 'highlight.js/lib/common'` 在 ESM 下经 exports map 的 **import 条件解析到 `./es/common.js`**,打包时排除该目录 → asar 内模块解析失败 → 主进程启动即 `ERR_MODULE_NOT_FOUND`;styles/ 可继续排除(模板自带 .hljs 颜色)。教训:排除 node_modules 子目录前必须核对该包 exports map 的 import/require 条件目标;**dev/smoke 全绿 ≠ 打包可用**
- electron-builder 26.15.3 + `"type":"module"` 实测打包成功,ESM 入口无需特殊配置;**`directories.output` 必须设 `release/`**(默认 dist/ 与 tsc 产物混目录);纯 JS 依赖无原生模块 → 不需要 asarUnpack
- 镜像正确地址:`ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`(**带 /mirrors/**,registry.npmmirror.com/... 404,已 HEAD 实测);工具链版本写死(nsis-3.0.4.1),镜像同步延迟会 404,首次成功缓存于 %LOCALAPPDATA%\electron-builder\Cache
- **产物目录被系统进程锁(EBUSY unlink app.asar)**:electron-builder 重建 win-unpacked 失败;绕道改 `directories.output`;锁来自 Defender/索引类系统服务;CLI 覆盖参数 `-c.directories.output=x` 会被解析为配置文件路径报 ENOENT,改输出目录应直接改 package.json
- **打包版 `--smoke` 不可用**:smoke 写 output/ 位于 asar 内(只读);打包版验证用「启动存活 + asar list + 静默安装/卸载(退出码 0)」;NSIS 捆绑 29 语言含 zh_CN;`win.electronLanguages: ["zh-CN","en-US"]` 裁 locales 收益最大
- 来源: 自查 + @librarian(lib-2);关联: package.json build 配置,里程碑 G5

### 2026-08-02 20:46:39 G4 实测事实(printToPDF 管线,已验证,勿回退)
- 依赖版本事实:markdown-it **14.3.0**(15.0.0 与 @mdit/plugin-tasklist@1.0.2 peer 冲突);@mdit/plugin-tasklist peer 要求 ^14.2.0
- `printToPDF({ pageSize:'A4', margins:0, printBackground:true, preferCSSPageSize:true, displayHeaderFooter:true, footerTemplate })` 在 Electron 43 实测成功;margins 设 0、边距交给 `@page { size:A4; margin:18mm 16mm 22mm }`(preferCSSPageSize 生效);**printToPDF 默认 pageSize 是 Letter 必须显式 A4;@page 存在时 `landscape` 选项失效,方向写 CSS**
- 任务列表 checkbox 打印 bug 规避方案实测有效:渲染后把 `<input class="task-list-item-checkbox" ...>` 替换为 ☐/☑ 字符 + `li.task-list-item { list-style:none }`,PDF 输出为 Unicode 符号(observer 实测截图确认)
- 图片统一转 `pathToFileURL` 绝对路径(override image rule)实测可用;footerTemplate 必须内联样式(9px 灰字),页码「第 X 页 / 共 X 页」正常
- 代码高亮:`import hljs from 'highlight.js/lib/common'` + `ignoreIllegals:true` 实测可用;PDF 需 printBackground 才有底色(已开)
- 来源: 自查 + @librarian(lib-1)+ @observer(obs-1);关联: src/core/pdf/render.ts、src/core/convert.ts

### 2026-08-02 19:57:10 G1 实测事实(docx 9.x + remark 管线,已验证)
- `docx` 9.x 的 `Document` 直接收 `numbering: INumberingOptions` 对象,不需要 `new Numbering()` 实例;`TextRun` 无公开可变 `options` 字段,行内样式用构造参数累积传递
- mdast 中 `image` 是 **PhrasingContent 行内节点**(嵌在 paragraph 内),不是块级节点;行内渲染需支持 `ImageRun`;`ImageRun` 的 type 枚举是 `png/jpg/gif`,魔数判断要返回 `"jpg"` 而非 `"jpeg"`
- Windows 下生成 docx:设置 `font: { ascii, eastAsia, hAnsi }` 后 document.xml 正确写入 eastAsia,中文字体生效
- 来源: 自查(typecheck + 生成 docx + 解包检查 XML);关联: src/core/docx/render.ts
