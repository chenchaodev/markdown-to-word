# 研究结论

> 只记录「换会话仍会用上、且别处查不到」的坑/勿回退事实/库事实。已实施且细节见 CHANGELOG 的条目不再重复;选型见ADR.md。原文存档:docs/archive/。
> **路径迁移注记(2026-08-24)**:目录结构重组(2026-08-23,提交 6f3d72a~9909d74)前历史条目「关联」字段中的扁平路径已失效——对照关系:`src/settings.ts`→`src/main/persist/settings.ts`、`src/index.ts`→`src/main/`(拆 windows/ipc/menu/converter/persist/services)、`src/renderer.ts`→`src/renderer/renderer.ts`+六功能域、`src/core/{i18n-dict}.ts`→`src/core/i18n/`、core 根级散文件→`pipeline/markdown/image/settings/util/` 子域。时间戳记录按规约不改写原文。
> **分节注记(2026-09-26,REF-001 #14)**:条目按技术主题归入下列二级标题,组内时间倒序;**一条未删、未合并**,只做分组与正文压缩,压缩处保留结论/关键数值/验证方式 + `docs/archive/` 原文链接,过程叙事与已被后续条目覆盖的实测细节被折叠。

## docx 生成与域

### 2026-09-26 22:10:00 docx MathSum 的 m:e 必须装被加数,否则 WPS 显示方框(勿回退)
- **结论**:① docx 9.7.1 `MathSum({ children })` 的 `children` **是被加数**(`∑…x` 的 `x`),传 `[]` 产出空 `<m:e/>`,WPS/Word 在该位置画**方框「□」**;`naryPr` 已内置 `∑`,children 绝不能再塞运算符(会显示两次且被加数丢失)。② KaTeX 的 `<munderover>` **只含运算符与上下限**,被加数在**下一个兄弟节点**,须由 `walkChildren` 取 `children[i+1]` 且**只消费这一个**(`=` 与后续分式必须留在 `m:nary` 外)。③ 该段此前是**死代码**(旧测试注明 `munderover`/`MathSum` 不可达),display 公式改按 display 模式渲染后才第一次走到 → **「某能力不可达」≠「该路径已验证」**。④ 列表项/引用块内公式 value 被 remark-math 解析成带尾随 `$$` 的脏值(如 `"\frac{1}{2}\n$$"`)送 KaTeX 必失败,与「渲染层是否递归进 math」是两个独立缺陷,两者同修后才真正走 Office MathML 管线。
- **来源/验证**:2026-09-26 用户在 WPS 目视发现方框后定位,与 docx 库源码及自带示例双向核对;失败形态是「结构合法、字符无缺失、观感坏」,只有直接看 XML 才暴露;**关联**:`src/core/docx/handlers/{math,equations,content}.ts`、`test/segments/math-structures.test.js`(断言查 `<m:e>` 内有被加数且 `</m:nary><m:r>` 不得出现)。**已知遗留**:行内 `∑` 仍是 `m:sSubSup` + 被加数作兄弟(Word 原生用 `m:nary` + `limLoc subSup`),对齐另立工作项。

### 2026-08-08 11:50:33 docx 域 API 调研结论(@librarian,8a TOC/8b 题注实施依据)
- **结论**:① `TableOfContents("目录", { hyperlink, headingStyleRange: "1-3" })` 是 docx 9.x 官方推荐路径,产出完整 w:sdt 复杂域,须配 `features: { updateFields: true }` → 8a 增量 = 开关化 + updateFields 联动。② **无 `ComplexField` 类**;行内域只能用 `SimpleField(instruction, cachedValue?)`(无 dirty 属性,不传则空白),**域指令空格是关键**(开关前须有空格,首尾各留一个)。③ 「图 1.1」章节号 = STYLEREF 域 `图 { STYLEREF 1 \s }-{ SEQ 图 \* ARABIC \s 1 }`,无包装类须手插,styleId 写 `Heading1`(非 Word 内置 `1`);前提是标题编号为 `w:numPr` 自动编号 —— 现有 5b 已是 numbering 静态渲染,域路线直接兼容。④ **两条路线必须二选一、8a/8b 同路线,严禁混用**:更新路线(`updateFields:true` + STYLEREF+SEQ;打开弹一次提示,改标题后 F9 同步;WPS 支持未官方背书需实测,Google Docs/LibreOffice 忽略 updateFields 显示空白)vs 免更新路线(`beginDirty:false` + cachedEntries,零提示全端一致、导出即准,但改标题后陈旧需重新导出,cachedEntries 页码无法精确 —— docx 无排版引擎,#885)。
- **来源/验证**:@librarian lib-1 + lib-3,对照 docx 9.7.1 类型/源码逐行实证;**关联**:`docs/archive/20260808-1142-docx域API调研.md`、WPS 证据 plus.wps.cn/blog/p114770、p114765,docx issue #1212/#2673/#885。

### 2026-08-06 21:27:25 批次 5 docx 标题编号 + 内部链接实现结论(已验证,勿回退)
- **结论**:① 标题编号首选**段落级 numbering**:标题 Paragraph 挂 `numbering: { reference: "md-heading", level: depth-1 }`,1 个 reference + 3-6 级 levels(text `%1`/`%1.%2`/`%1.%2.%3`,format `decimal`,indent `{ left: 360, hanging: 360 }`),**静态渲染、打开 Word/WPS 无需 F9**;heading + numbering + Bookmark 三层不冲突(pStyle / numPr / 内容),并存不注入 ListParagraph 样式(9.7.1 实证)。② 混合格式「第一章 + 1.1」坑:`%n` 按被引用级别自己的 numFmt 渲染,level 1/2 需 `isLegalNumberingStyle: true`(w:isLgl)才得「1.1」。③ **9.7.1 无 `Hyperlink` 类**(9.x 拆分):内部链接 `InternalHyperlink({ anchor: docxBookmarkId(slug), children })`(参数名是 `anchor` 不是 `internalAnchor`),外链 `ExternalHyperlink({ link })`;链接样式不自动套用,`TextRun` 仍需手动 color/underline;anchor 与书签 id 字符串精确匹配。
- **来源/验证**:@librarian(lib-1,本地 docx@9.7.1 d.ts/cjs 逐行实证),产物解包核对 `w:numPr` / `w:bookmarkStart`;**关联**:`src/core/docx/{render,theme}.ts`、`docs/archive/20260806-2116-docx标题编号与内部链接调研.md`。

### 2026-08-05 22:22:19 批次 4 docx 页眉页脚 + 页码实现结论(已验证,勿回退)
- **结论**:① `new Header({ children: (Paragraph|Table)[] })`,children 只收段落/表格、**不能放裸 TextRun**,页码字段必须包在 Paragraph 里。② **挂载点只有 `sections[].headers/footers`**(Document 级无此选项);首页不同用 `properties.titlePage: true` + `headers.first`/`footers.first`。③ **9.x 无 `PageNumberFormat`(旧 API 已移除,改名 `NumberFormat`)**;页码格式写 section `properties.page.pageNumbers.formatType`;中文「第 X 页 / 共 X 页」用 `PageNumber.CURRENT`/`TOTAL_PAGES` 放 `TextRun({ children })` 混排。④ 合并场景单次渲染单 section → 页眉页脚覆盖全页、页码连续;`TOTAL_PAGES` 统计全文档(含封面/目录),与 PDF `footerTemplate` 的 totalPages 语义一致。
- **来源/验证**:@librarian(lib-3,已对照本地 docx@9.7.1 类型/源码验证);页眉标题优先级 `metadata.title ?? options.title`;**关联**:`src/core/docx/render.ts`、`src/core/convert.ts`、`docs/archive/20260805-2210-页眉页脚页码调研.md`。

### 2026-08-02 19:57:10 G1 实测事实(docx 9.x + remark 管线,已验证)
- **结论**:① `Document` 直接收 `numbering: INumberingOptions` **对象**,不需要 `new Numbering()` 实例;`TextRun` 无公开可变 `options` 字段,行内样式靠构造参数累积传递。② mdast 的 `image` 是 **PhrasingContent 行内节点**(嵌在 paragraph 内)不是块级,行内渲染需支持 `ImageRun`;`ImageRun` 的 type 枚举是 `png/jpg/gif`,魔数判断要返回 `"jpg"` 而非 `"jpeg"`。③ Windows 下设 `font: { ascii, eastAsia, hAnsi }` 后 document.xml 正确写入 eastAsia,中文字体生效。
- **来源/验证**:自查(typecheck + 生成 docx + 解包检查 XML);**关联**:`src/core/docx/render.ts`。

## PDF 管线

### 2026-08-05 22:03:15 批次 4 书签实现结论 + 「点击不跳转」修复(已验证,勿回退)
- **结论**:① **pdf-lib `PDFName.asString()` 返回内部编码**(`%` 被转义为 `#25`),须先 `key.decodeText()` 还原百分号形式再 `decodeURIComponent` 才得到中文(实测,勿回退)。② printToPDF 产物**无 /Names 名称树而是旧式直接 `/Dests` 字典**,须兼容两种结构。③ **`dict.lookup(key, type)` 在 key 缺失时抛 `UnexpectedObjectTypeError` 而非返回 undefined**(实测崩溃根因),须用 `dict.get(key)` + 手动 `context.lookup(ref)`;`PDFName.decodeText` 走 PDFDocEncoding 会把 UTF-8 中文解成乱码(勿用)。④ 注入实现 `src/core/pdf/bookmarks.ts`(自研):`lookupNamedDest`(双兼容 + 间接目标取 /D)+ `setOutline`(pageRefs 经 `catalog.Pages().traverse` 收集、嵌套 First/Last/Count、F 标志 italic|bold)+ `injectBookmarks`;标题 id 即命名目标名(slug 与 /Dests key 一一对应)。⑤ pdf-lib 1.17.1 为最新稳定版,ESM 用包名导入、勿碰 `pdf-lib/es/index.js`;中文标题必须 `PDFHexString.fromText`(UTF-16BE),`PDFString` 乱码(issue #516);子项 Count 负值 = 折叠。
- **教训**:smoke 断言只查标题文本不查 Dest 指向,漏过「全部回退首页」类 bug;已补断言 `Dest[0] instanceof PDFRef`(单文件 + 合并两处)。
- **来源/验证**:@librarian(lib-1)marp-cli 样板 + 自查实测(`save()` 不破坏原 Link 注释/字体/图片);**关联**:`src/core/pdf/{bookmarks,render}.ts`、`docs/archive/20260805-2151-pdf书签注入调研.md`。

### 2026-08-02 20:46:39 G4 实测事实(printToPDF 管线,已验证,勿回退)
- **结论**:① `printToPDF({ pageSize:'A4', margins:0, printBackground:true, preferCSSPageSize:true, displayHeaderFooter:true, footerTemplate })` 在 Electron 43 实测成功;margins 设 0、边距交给 `@page { size:A4; margin:18mm 16mm 22mm }`;**默认 pageSize 是 Letter 必须显式 A4;@page 存在时 `landscape` 选项失效,方向写 CSS**。② 任务列表 checkbox 打印 bug 规避有效:渲染后把 `<input class="task-list-item-checkbox" …>` 替换为 ☐/☑ 字符 + `li.task-list-item { list-style:none }`。③ 图片统一转 `pathToFileURL` 绝对路径(override image rule)可用;`footerTemplate` 必须内联样式(9px 灰字)。④ 代码高亮 `import hljs from 'highlight.js/lib/common'` + `ignoreIllegals:true` 可用;PDF 需 printBackground 才有底色(已开)。
- **依赖版本**:markdown-it **14.3.0**(15.0.0 与 @mdit/plugin-tasklist@1.0.2 peer 冲突),tasklist peer 要求 ^14.2.0。
- **来源/验证**:自查 + @librarian(lib-1) + @observer(obs-1,截图确认 checkbox 替换);**关联**:`src/core/pdf/render.ts`、`src/core/convert.ts`。

## 双管线能力与契约口径

### 2026-09-25 阶段 0 OPT-0.3 决策口径统一(supersede 台账,零行为变更)
- **结论**:D-01~D-12 裁决此前只落在优化计划里,USER-GUIDE/ACCEPTANCE/WPS-COMPAT 与测试注释存在旧口径;本轮把 **D-02/D-03/D-08** 写进对应文档并登记取代关系(不改写历史 CHANGELOG/ADR 原文,`[x]` 实测条目一律保留)。①**D-02**:内置 `TEMPLATE_PRESETS` 携带完整交付链(typography + pageSetup + headerFooter + watermark + equationNumbering + breakBeforeH1),套用时逐组写入并 toast 列出被覆盖分组;`CustomPreset` 契约**只含 typography + pageSetup**,故自定义预设不动页眉页脚/水印 → 界面「不入预设」徽标 = 仅指自定义预设。**实现差异留档**:删除自定义预设后的回退路径也只还原 typography + pageSetup,与「套用内置预设」不同链,勿在文档写成完整链回退。②**D-03**:本地图片校验顺序固定为 原始 src → 词法根边界 → realpath → 规范根边界,策略单一来源 `src/core/markdown/precheck.ts`,main 侧 `image-downloader.ts` 复用;拒绝面 = 绝对路径、UNC、`file://` 及一切带协议 URL、越界 `..`、realpath 越界;**媒体类型(魔数白名单)与单文件大小上限尚未实施**,排阶段 3 资源预算 —— 勿在文档写成已有限制。③**D-08**:测试段逐子进程隔离(硬超时、资源回收、case 级报告、失败 artifact)为正式口径。④**代码签名状态是独立单源事实**,本文件不转述,见 `docs/SIGNATURE-STATUS.md`。
- **理由**:同一事实曾有两种相反表述(内置完整链 vs 不入预设),口径冲突必须由裁决文档单点裁定,其余文档只做指针 + supersede 注记。
- **来源/验证**:裁决文档与执行台账已随 #07 撤除,原文快照 `docs/archive/20260926-211455-全库优化计划与执行台账.md`,评审整合原文 `docs/archive/20260925-201811-全库优化评审整合与迭代计划.md`;回归断言 `test/main/{image-downloader,converter}.test.js`;写入口径落点 = `docs/USER-GUIDE.md`、`docs/WPS-COMPAT.md`、`docs/ACCEPTANCE.md`、`docs/ROADMAP.md`(原候选池已并入「候选区」)、`docs/design/*`。

### 2026-08-13 19:35:32 mermaid 集成方案调研结论(@librarian + @explorer,8c 实施依据)
- **结论**:① **mermaid 11.16.1 钉死**;ESM-only + dist 内 IIFE 产物 `mermaid.min.js`(3.5MB,file:// 直用,规避模块 CORS),零 CDN 自包含;node_modules 约 120-130MB(asar 压缩 60-70%);Node 无 DOM 不能渲染。② 链路:单例隐藏 BrowserWindow(sandbox+contextIsolation、`backgroundThrottling:false`)→ `initialize({ securityLevel:'strict', fontFamily:'"Microsoft YaHei",sans-serif' })` → `mermaid.render`(内部串行队列,无需自建锁)→ `document.fonts.ready` → **canvas 2x 光栅化** → PNG `{ pngBuffer, widthPx, heightPx }`。③ docx 端嵌 PNG、逻辑 1x 像素 2x(`transformation` width/height 必须同时给),**不用 SVG 嵌入**(Word 2019+/M365 才渲染 + docx #3227);pdf 端 SVG 直接内联,highlight 同步限制 → 占位 + 后处理替换,`<!-- page-break -->` 不变。④ 降级:`mermaid.parse(suppressErrors)` 失败或 render 超时/崩溃 → 输出等宽代码块原文 + warning(不中断),窗口一次性预热复用。⑤ 安全:`securityLevel:'strict'`(loose 有存储型 XSS 先例 CVSS 7.6、思源 2026-04 NTLM 窃取通报),隐藏窗口加 CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'` 断网。⑥ 坑:v11 breaking = ESM-only / mermaidAPI 废弃 / ELK 拆包;maxTextSize 默认 50000,超大图拒绝。⑦ 不做:mermaid-cli、Kroki 在线(违反离线卖点)、resvg-js、jsdom 垫片。
- **来源/验证**:@librarian lib-1 + @explorer exp-1,验收见 `docs/ACCEPTANCE.md` 批次 10;**关联**:`docs/archive/20260813-193532-mermaid集成方案.md`。

### 2026-08-08 11:50:33 批次 8 管线勘察结论(@explorer,TOC/题注编号现状事实)
- **结论**:① docx 原生 TOC 域已存在(`renderTocPage()` 用 `TableOfContents`,`\o "1-3" \h \z \u` 齐全,占位「右键 → 更新域 生成」),正文含任意 heading 即**无条件插入、无开关** → 8a 增量 = 开关化(`toc?: boolean`)+ 确认题注不被 TOC 收集(不得用标题样式/需 `\b` 排除)。② docx 章节编号 = **numbering 静态渲染非域**,打开 Word/WPS **无需 F9**;OOXML numbering 引擎管理多级计数、**代码无计数器变量** → 题注段落无法复用标题计数器拿「当前章节号」。③ 题注两条路线(产品决策):(a) STYLEREF 域 + SEQ 域(Word 原生标准,需更新域,与「无需 F9」冲突);(b) 渲染期静态注入章节号 + SEQ 仅承担图序号(免 F9,重排不自动更新)。④ **无 caption 语法**(mdast 无 figure/figcaption,白名单无 `<figure>`),题注需自定义识别 + 块级插入点 + 文档级计数 ctx(仿 footnoteNextId);PDF 侧题注易实现(标题编号是 CSS counter 伪元素,书签不受影响;目录 `buildTocHtml()` 从渲染后正文正则提取 h1-h3,无 [TOC] 语法)。⑤ 新增设置字段落点:仿 `breakBeforeH1` 放 AppSettings 顶层,同步改 SETTING_KEYS + sanitize + renderer 平行类型/默认值 + main 侧 convertImpl 实时 loadSettings()。
- **来源/验证**:@explorer exp-1(验收钩子 = 验收入口自动发现段文件、零注册;docx 断言 zipContains + OOXML 片段匹配,PDF 断言 .html 字符串匹配);**关联**:`docs/archive/20260808-1123-批次8管线勘察.md`。

### 2026-08-08 10:20:16 批次 6 公式链路实现结论(@librarian 调研 + 实测,勿回退)
- **结论**:① docx@9.x 原生支持 OMML 数学:Math(容器)/MathRun/MathFraction/MathRadical/MathSuperScript/MathSubScript/MathSubSuperScript/MathFunction/MathSum/MathIntegral/MathLimit/MathRoundBrackets 等,数学段落走 Math 容器**无需注入原始 XML**。② KaTeX 字体本地嵌入:`katex.min.css` 相对引用 fonts/、**必须 css 与 fonts/ 同级**;`file://`(win.loadFile)下 @font-face 相对路径可用,**data: URL 加载则全失效** → 最佳实践 = 构建期复制 katex.min.css + 21 个 woff2(~400KB,删 ttf/woff)到资源目录。③ printToPDF 公式坑:头号坑 = 字体时序,did-finish-load 后必须 `await win.webContents.executeJavaScript('document.fonts.ready')` 再 printToPDF,否则缺字形;必须 `printBackground:true` + `print-color-adjust: exact`;display 公式不自动换行、超宽溢出(KaTeX 固有)。④ 上游取 MathML:KaTeX `output:'mathml'`(`renderToString` 零成本产出)→ 自研 walker → docx Math 组件树,覆盖 msqrt/mfrac/msub/msup/msubsup/mrow/mo/mi/mn/mtext ~10 种节点,**无需自研 TeX 解析器**;降级线(红线兜底):walker 未覆盖 / KaTeX 报错 → TeX 源码以 MathRun 等宽样式输出 + warning,不丢内容不崩。
- **来源/验证**:@librarian(lib-2);**关联**:`docs/archive/20260806-2229-批次6公式链路调研.md`。

### 2026-08-05 22:22:19 批次 4 脚注实现结论(已验证)
- **结论**:① PDF 侧 `@mdit/plugin-footnote@^1.0.2`(peer 显式 markdown-it ^14.2.0),输出锚点 footnote-N/footnote-ref-N,重复引用编号 [2]/[2:1];**Chromium 不支持 CSS `float: footnote`,PDF 脚注集中在内容末尾渲染(非页脚)—— HTML→PDF 通用行为差异,验收预期**。② docx 侧零新依赖:Document 级 `footnotes: Record<id字符串, { children: Paragraph[] }>` + 正文 `new FootnoteReferenceRun(id)`,id 从 1 起唯一,**footnotes 只挂 Document 级、不在 section 级**。③ 实现要点:全局递增计数器统一编号(md 拼接合并天然连续,勿按文件重置),嵌套引用需递归渲染且共用计数器,重复引用按引用次数逐个编号(与 markdown-it 对齐)而非按定义去重。④ **语法不对称**:内联脚注 `^[...]` 只有 PDF 侧支持,remark 侧 mdast 无对应节点 → docx 侧按字面量/不支持处理。
- **来源/验证**:@librarian(lib-2);**关联**:`src/core/{pdf,docx}/render.ts`、`docs/archive/20260805-2212-脚注实现调研.md`。

### 2026-08-04 20:57:34 批次 3 实现结论(批量/合并,已验证)
- **结论**:① 批量转换队列并发 2,失败不中断逐条汇总,批量模式跳过 runAfterConvert(防批量后自动打开 N 个文件),进度 `batch:progress` { index, total, file, stage }。② 多文件合并 `mergeMarkdowns(files:{content,baseDir}[])` 纯逻辑:首文件 frontmatter 保留、后续剥离;图片相对路径 → 绝对(path.resolve,保留 title 部分);`<!-- page-break -->` 拼接;空文件跳过;合并后走单文档渲染 → 封面/全局 TOC 自动成立。③ 合并输出与首文件同目录 `{首文件名}-合并.{ext}`;imageResolver 跨文件共享(模块级 Map<baseDir, resolver> 缓存);拖放文件夹 `collectMarkdown` 递归收集(跳过点开头目录,seen 防符号链接循环)。
- **坑**:JSDoc 注释内 `**/*.md` 含 `*/` 会提前终止注释块 → 后续内容被当代码解析(TS1109 一串),**注释里写 glob 需避开 `*/` 序列**。
- **来源/验证**:自查(迭代实测)+ fixer/designer 实现;**关联**:`src/core/pipeline/merge.ts`、`src/main/index.ts`、`src/main/preload.cts`。

### 2026-08-03 23:14:13 批次 2 spike 与实测结论(已验证,勿回退)
- **结论**:① docx TOC:9.7.1 **内置 `TableOfContents` 类**可用(**SimpleField 不行** —— fldSimple 仅行内;ComplexField 已移除),产出标准 TOC 复杂域(`TOC \h \o "1-3" \u \z`,begin 带 dirty);降级方案 `cachedEntries` 同 API 但要**自行注册 TOC1-9 样式** + 逐条书签 href,库怪癖 `cachedEntries.length<=1` 会补空段落。② **printToPDF 保留页内锚点为 PDF 可点击链接(含跨页)**:Link 注释 + 命名目标 `/Dests`,非 /GoTo → PDF 目录「无页码+锚点」方案成立,零额外处理。③ **分页空白页坑**:`break-before: page` 相邻**不合并**(Chromium 实测),分页符 div 后紧跟的 h1 叠加 break-before 产生 1 空白页,`body > h1:first-child` 例外在封面/目录场景失效 → 无条件加 `.page-break + h1 { break-before: auto; }`。④ **Electron 43 ESM 主入口坑**:顶层 `await app.whenReady()` 挂起(ready 永不 resolve、进程不退出),必须 `app.whenReady().then(async()=>{})` 链;electron 直调用 `node_modules/.bin/electron.cmd`(npx 会触发网络检查)。⑤ pdf 外链图:渲染后收集 http(s) img src → 并发 3 下载 → data URL 内嵌,失败保留原 URL + 警告;main 侧 `createImageResolver`(fetch + 10s AbortSignal + 同 URL 去重缓存)。
- **来源/验证**:fix-5/fix-9/fix-10/fix-7/fix-8 终态结论 + 自查实测;**关联**:`src/core/{frontmatter,convert}.ts`、`src/core/{docx,pdf}/render.ts`、`src/main/{index,image-downloader}.ts`。原文存档 `20260803-2311-批次2-spike与实现结论.md` 已于 2026-08-15 archive 清理删除,结论以本条为准。

### 2026-08-03 21:46:27 批次 1 实测事实(docx/pdf 排版控制,已验证,勿回退)
- **结论**:① docx 9.x section `page.size`:orientation=landscape 时**库自动交换 width/height 写入 pgSz**,应传原始(纵向)尺寸 + orientation 枚举,手动交换会双重交换导致宽高反(实测 bug 已修复)。② docx 9.x 无 `IParagraphOptions.bookmarks`,标题书签用 `Bookmark` 组件包裹 runs。③ mdast `Data` 为空接口,标题 id 需 `declare module "mdast"` 声明合并(parse.ts),docx 消费端直接读 `node.data?.id`。④ markdown-it 14.3 的 heading_open token 的 `content` **恒为空字符串**,标题纯文本落在下一个 inline token(`tokens[idx+1].content`)。⑤ 设置持久化原子写:临时文件 + rename(Windows 下 rename 可覆盖),整文件形状校验失败整体回退默认。
- **来源/验证**:自查(迭代实测)+ fixer/designer 实现;**关联**:`src/core/{slug,parse,convert}.ts`、`src/core/{docx,pdf}/render.ts`、`src/main/persist/settings.ts`(旧扁平路径见头部迁移注记)。

## 依赖与工具链

### 2026-09-26 21:14:55 TS7 native 在程序内存在语法错误时跳过全程序语义诊断(勿回退)
- **结论**:TS7 native(`tsc`)在程序内存在**任一语法错误**时会**跳过全程序语义诊断** → 「tsc 输出为空」可能是假绿,验收须**双编译器交叉**(TS7 CLI + TS6 API 探针)。配套:`.js` 中非空断言 `!` 触发 TS8013,测试树禁用 `!`,改用 `@returns {asserts cond}` 与显式读取 helper。
- **来源/验证**:REF-001 阶段 0/7 实测(#14 承接自 campaign「待升 RESEARCH」段,台账快照 `docs/archive/20260926-211455-全库优化计划与执行台账.md`;**本文件全部 2026-09-26 21:14:55 条目的来源同此**):注入一处语法错误后该轮只报语法错误、无语义诊断行,换 TS6 API 探针后语义诊断复现;**关联**:`tsconfig.test.json`、`npm run typecheck`(双编译器别名勿回退,见 `AGENTS.md`)。

### 2026-09-26 21:14:55 eslint `maximumDefaultProjectFileMatchCount` 是性能护栏而非类型门禁
- **结论**:达到上限时整体报 `Too many files`,**再加任一 `.js/.mjs` 就把 lint 打成一片红**;本仓已由 200 提到 300。该上限只管解析成本、不表达类型正确性,撞上限时的红是噪声。
- **来源/验证**:REF-001 阶段 0/5 实测:新增一个 `.mjs` 文件,撞上限前后各跑一次 `npm run lint` 对比;**关联**:`eslint.config.mjs`。

### 2026-09-26 21:14:55 裸跑 build 不回收已删源的输出,`clean:dist` 必须连带删 `*.tsbuildinfo`
- **结论**:裸跑 `npm run build` **不回收已删除/重命名源的输出**(tsc 增量),而 `gen:dist-manifest` 只是快照、自身发现不了陈旧 → 判断产物新鲜度必须走 dist 链或先 `clean:dist`;`clean:dist` **必须连带删根目录 `*.tsbuildinfo`**,否则增量缓存会让 clean 后 build 几乎不产出文件。
- **来源/验证**:REF-001 阶段 0 实测:删一个源文件后裸跑 build,`dist/` 仍留旧产物;跑 `clean:dist` + build 后旧产物消失且增量缓存清空;**关联**:`package.json` 的 `clean:dist`/`build`/`gen:dist-manifest` 脚本、同族条目见 B10a 与 G5。

### 2026-09-25 E5 双配置 typecheck 的 CI 顺序依赖(3.11.8 发版踩坑)
- **结论**:test 树 typecheck(`tsconfig.test.json`)编译期 import `dist/**` 编译产物 → 任何全新工作区(CI runner / 清空 dist 的本地)必须先 `npm run build` 再 typecheck,否则批量报 TS2307 Cannot find module,且未标注文件连带 TS7006(类型解析失败致隐式 any);本地因常驻 dist 不复现。E5 按文件头 `// @ts-check` 渐进启用(checkJs:false),类型需 dist 下实际 .js;测试文件相对路径 import(`../../dist/...`)无法经 tsconfig paths 重映射回 src,故正解为**顺序修复(构建先行)**,不做路径改造。
- **来源/验证**:3.11.8 首次发版 Release 与 CI 双失败(2026-09-25,TS2307 批量报错日志);E5 当时仅本地验证未跑远端 CI 即随批推送;本地双配置 typecheck 全绿反证 dist 存在性;修复 = 三条 workflow 步骤 build 先行(提交 `d75fe3f`);**关联**:`docs/CHANGELOG.md`(发版记录)。

### 2026-08-24 审计整改记录(依赖钉死策略清单 / highlight.js styles 潜伏副作用)
- **钉死清单**:`markdown-it 14.3`(15.0 与 @mdit/plugin-tasklist@1.0.2 peer ^14.2.0 冲突,升级须连带评估 tasklist/footnote 两插件)、`@mdit/plugin-footnote 1.0.2`(peer 显式 ^14.2.0,随 markdown-it 联动)、`mermaid 11.16.1`(ESM-only,依赖 dist 内 IIFE 产物 file:// 直用规避模块 CORS)、`electron-builder 26.15.3`(27 alpha 不用,升级须重验 NSIS 链路)、`docx 9.x`(渲染核心,API 面大,major 升级须全量回归)。项目级「勿回退」标注以 `AGENTS.md` 为准。
- **highlight.js 两条同族事实**:① `lib/common` 经 exports map 的 **import 条件解析到 `es/`**,**`es/` 不可从打包排除**(否则 ERR_MODULE_NOT_FOUND),`styles/` 可排除(模板自带 .hljs 颜色)。② 反向副作用:build.files 排除 `styles/` 后,若代码 `import 'highlight.js/styles/xxx.css'`,dev/smoke 正常但打包后**静默 404** → **dev 全绿 ≠ 打包可用** 的又一实例。
- **来源/验证**:全库审计整改批(2026-08-24);**关联**:`docs/archive/20260824-134811-审计待办清单.md`(ENG-8/ENG-9)、本文件 G5 打包坑条目。

### 2026-08-16 11:45:20 文档加密调研(@lib-1,功能排期依据;已明确不做)
- **结论**:① **docx 9.7.1 不支持加密**(maintainer 确认:密码保护 Word 文档非 OOXML 标准、是 Microsoft 专有 Agile/Standard Encryption;dist 全量搜 encrypt/password 零匹配;`isEncrypted` 是 JSZip 解压检查)。② 替代:`officecrypto-tool 0.0.19`(ECMA-376 Agile AES-256/SHA-512,Word 2007+ 兼容,`officeCrypto.encrypt(buffer,{password})`;CJS 老库,ESM 默认导入需验证)、`office-crypto 0.1.0` 加密未完成、`ooxml-encryption` 仅 xlsx。③ **pdf-lib 1.17.1 不支持写入加密**(README 官方声明;仅 isEncrypted 检测 + ignoreEncryption 加载),printToPDF 无加密选项 → 加密须靠 `qpdf`(node-qpdf2 Promise+TS 或命令行 `qpdf --encrypt user owner 256`),顺序固定 printToPDF → 书签 → 元数据 → **加密最后一步**(pdf-lib 无法 load 加密文档)。**处置**:调研后确认**不做**(价值不抵依赖与安全成本),结论留档备查。
- **来源/验证**:@librarian lib-1;**关联**:`docs/archive/20260816-114520-文档加密调研.md`。

### 2026-08-14 20:16:22 模板导入方案选型(@lib-1 + @exp-1,批次 13 规划依据)
- **决策**:「模板导入」= **预设 JSON 导入/导出**(首选;复用 `sanitizeCustomPresets` 校验,零新依赖、低风险高价值);CSS 模板覆盖(pdf 路线追加用户 CSS)次选。
- **关键事实**:预设 = 纯数值快照(typography+pageSetup),渲染管线只认最终字段值、无资源字段承载位;pdf CSS 全在 `template.ts` 模板字符串(无变量机制,追加 `<style>` 后可覆盖,但需防用户 CSS 破坏 `.page-break`/`breakBeforeH1` 分页强制规则);docx 路线不消费 CSS。**docx 深导入不做的理由**:docx 9.x 仅 `patchDocument` 占位符替换;docx4js 3.3.0 单人维护 2024-09 停更 + OOXML 样式逆映射工程量大、与自研管线架构相悖。**JSON 格式** `{schemaVersion:1, presets:[{name,typography,pageSetup}]}`(兼容裸数组);导入 = 读文件 → sanitize → 追加合并(同名覆盖)→ 上限 10 截断。
- **来源/验证**:@librarian lib-1 + @explorer exp-1;**关联**:`docs/archive/20260814-201622-模板导入方案.md`。

### 2026-08-14 18:51:13 双方向探索方案(@des-1/@ora-1/@lib-1/@exp-1/@exp-2,批次 12 规划依据)
- **结论**:方向 A 界面体验优化(用户已选)列 20 项问题 + 12 项候选分三阶段,关键缺陷 = **P9 点击拖放区=替换整表但文案声称追加**(误触丢全部选择、无确认)、**P1 设置面板展开后转换按钮/进度被推出 640px 视口**、**P3 模板预设埋在第二折叠面板**;本批实施 Phase 0 速赢,C1 语义 = 多文件态点击追加、单文件态点击更换。方向 B(未选,存档备查):速赢 = tsconfig 4 开关 + mermaid-service 超时/崩溃降级测试(199 行 vs 34 行,最高回归风险)+ settings-panel 纯逻辑抽取;不做 = vitest 迁移 / 再拆 render.ts 主循环。
- **工具链硬事实**:c8 12.x/nyc 18/eslint 10/knip 6 全要求 Node 20.19+(Node 18 需锁 c8 10.1.3/eslint 9.39.x,Node 18 已 2025-04 EOL);eslint 10 起 flat config 唯一;depcheck 停维护(官方推荐 knip);Electron 快捷键 / 深色模式均为原生能力,UI 侧零新依赖。
- **来源/验证**:@designer des-1 + @oracle ora-1 + @librarian lib-1 + @explorer exp-1/exp-2;**关联**:`docs/archive/20260814-185113-双方向探索方案.md`。

### 2026-08-23 B10a 工程基建两坑(copy-renderer 混合目录 / incremental 不重建被删产物)
- **结论**:① **`dist/renderer` 是混合目录**:tsc 编译产物与 copy-renderer 拷贝的静态资源同居;加 clean 步骤时**不可整目录 rmSync**(会删掉编译产物致 acceptance 2 段 ERR_MODULE_NOT_FOUND),只能按扩展名清理 `.html/.css`。② **tsc incremental 不检查产物存在性**:tsbuildinfo 记录输入版本,输出文件被外部删除后 `tsc` 仍跳过重编译(幽灵缺模块);恢复须 `npx tsc --build --force`(`--force` 单独用报 TS5093,必须配 `--build`)。CI 每次全新检出不受影响。
- **来源/验证**:踩坑现场 acceptance 2/40 失败 → build 后复现 → force 恢复;**关联**:原 ROADMAP B10。

## Electron 主进程与安全

### 2026-09-26 23:20:00 「等固定时长」不是同步:fire-and-forget 写必须用 drain 等结算(勿回退)
- **结论**:① `loadSettings` 的迁移写是 **`void` fire-and-forget**(`void writeSettingsJson.enqueue(...)`,不等它落盘就返回),因此**外部无法通过「等够久」确认写已落盘** —— 轮询到点放弃后,写仍可能**迟到落盘并覆盖调用方在等待期做的新写入**。本仓真实故障:某小节等迁移写落盘最多等 100ms,慢机上到点放弃 → 下一小节覆写 `settings.json` → 上一小节结果迟到落盘盖掉它 → 下一小节读到陈旧内容判红;同段另一处报 `rm` 撞 `EISDIR`。② **正解是 drain**:写入器暴露 `drain()` —— **排在队尾的空事务**即 drain,它 resolve 即代表此前所有写(含重试)已结算;单次写失败不截断队列,故有失败写时 drain 同样 resolve(不会死等)。测试 `await` 它取代固定预算轮询;**退出路径也必须 drain**,否则队列里未落盘的写随进程一起丢掉(真实产品缺口,不只是测试问题)。③ **与 rename 重试的交互是放大效应而非成因**:重试把「快速失败、什么都不落盘」变成「可能百毫秒后成功落盘」,**扩大**迟到覆盖窗口;但根因是同步方式本身不成立 —— 任何超过该预算的写(慢盘、fsync 慢)都会触发同样覆盖。失败极具误导性:断言名字指向「设置读取」,实际是上一个异步写的迟到落盘;且只在慢机/runner 暴露,本机反复跑全绿。
- **来源/验证**:2026-09-26 CI 连续两次在同一段失败、两种不同错误;逐段核对 `[ok]` 进度后定位「第一轮过、第二轮(覆盖率那轮)挂」的覆盖时序;修复 commit `48594f0`;**关联**:`src/main/persist/atomic-json.ts`(`JsonWriter.drain`)、`settings.ts`(`whenSettingsIdle`)、`src/main/index.ts`(`window-all-closed` 退出前 drain,失败不阻止退出)、`test/main/{atomic-json,settings}.test.js`。**给 `JsonWriter` 加 drain 时须一并核查其他使用方**(`ui-state` 共用同一写入器)。

### 2026-09-26 21:14:55 Windows 上 `rename` 覆盖被读句柄占用的目标必然 EPERM,须补有界退避重试
- **结论**:Windows 上 `rename` 覆盖**正被读句柄占用**的目标**必然 EPERM**(杀软/索引器/云同步随手一握即触发,实测确定性),一次瞬时占用即丢整次写 → 须补**有界退避重试**(仅 EPERM/EBUSY/EACCES 族)。**代价**:重试把「快速失败」变成「可能百毫秒后成功落盘」,**扩大**了 fire-and-forget 写的迟到覆盖窗口 —— 根因仍是同步方式本身不成立(见上条 drain)。
- **来源/验证**:REF-001 实测,修复 commit `504870a`;测试以「把进程 cwd 切进目标子目录」造稳定占用(见下条),断言重试后落盘成功且不截断队列;**关联**:`src/main/persist/atomic-json.ts`、`test/common/temp-resource.js`、`test/main/atomic-json.test.js`。

### 2026-09-26 21:14:55 显式落盘顺序:内容 → 文件 fsync → rename → 父目录 fsync
- **结论**:顺序固定为 写内容 → 文件句柄 `fsync` → `rename` → 父目录 `fsync`;**缺文件 fsync 时断电可得 0 字节配置**,而读回整文件回退默认 = 用户全部偏好静默归零(静默,无提示无备份)。
- **来源/验证**:REF-001 阶段 3 资源/生命周期实测:逐环去掉 fsync 后模拟中断,读回分别得到 0 字节/旧内容/新内容三态;**关联**:`src/main/persist/atomic-json.ts`,基线见本文件批次 1 条目的原子写事实。

### 2026-09-26 21:30:00 Electron 门禁入口的三条失败路径事实(与直觉相反,勿回退)
- **结论**:① **`app.quit()` 不吃 `process.exitCode`** —— 实测设 `process.exitCode=1` 后调 `app.quit()`,真实退出码 **0**;抛错后再走 `app.quit()` 同样 0 → **失败被判绿,比挂死更隐蔽**;要显式码必须用 `app.exit(code)`(ready 前/后都吃)。纯 Node 脚本里 `process.exitCode` 正常生效,这条只针对 Electron 主进程。② **加载期抛错进程内无解**:Electron 的 ESM 主模块 loader 捕获求值错误后只打 `App threw an error during load`、**不退出**,此时入口里没有任何代码在跑、没有钩子能接管;更深一层 ESM 在**任何求值之前**先完成整张模块图的 linking,故「静态 import 解析不到/缺导出」发生在守卫自己被加载之前 → 只能靠「入口静态导入面压到最小(node 内建 + electron + 守卫),业务依赖一律动态 import」缩小盲区,`M2W_ENTRY_LOAD_TIMEOUT_MS` 看门狗兜「载荷既不完成也不报错」。③ **`.then()` 回调内抛错只降级为 `UnhandledPromiseRejectionWarning`、进程照活** —— Electron 主进程不采用 Node 默认的 `unhandled-rejections=throw`;`await app.whenReady()` 写在 async 函数体内(不是模块顶层)时同样如此,与「顶层 await 挂起」是**两个不同的坑**。三条都让门禁在失败时给出**错误信号**(挂死让 CI 报「超时」而非「门禁失败」,静默判绿更糟)。
- **来源/验证**:2026-09-26 实测(每条真起 Electron 子进程验退出码,含「抛错 + `app.quit()` 仍为 0」对照),修复见 `test/common/entry-guard.mjs`;**关联**:`entry-guard.mjs`(`decideEntryExit` 纯函数判定层 + `runEntry` 壳层,五个入口共用;失败关闭:阶段非 ok、阶段 ok 却带错误、阶段不在码表一律非零)、`test/segments/entry-exit-guard.test.js`、`scripts/check-geometry.mjs`。**已知残余**:`session-persist-feedback` 段会 `process.removeAllListeners("unhandledRejection")` 摘掉兜底监听,此后回到 warn + 挂住(真实失败仍由壳层 try/catch 覆盖)。

### 2026-09-26 20:10:00 Windows/Electron 三条易踩的实测事实
- **结论**:① **打开的文件句柄不阻止删除** —— libuv 以 `FILE_SHARE_DELETE` 打开文件,`rmSync` 照样成功(实测)→ 「开一个句柄来造 EBUSY」这类夹具在 Windows 上是**假的**,能**稳定**造出「删不掉」的是**把进程 cwd 切进该子目录**(`process.chdir()`,必 EPERM;node 与 Electron 均实测)。② `Buffer.compare` 返回 -1/0/1 的 **memcmp 大小关系,不是首个差异下标**,拿它当差异偏移用会让「差异位置」信息静默消失。③ **Electron 的 asar 虚拟 fs 会接管任何含 `.asar` 的路径**:`writeFileSync`/`openSync+writeSync`/`rename`/`copyFile` 四种写法一律抛 `Invalid package`,连读也走归档解析;测试要造/读 `.asar` 文件须临时置 `process.noAsar = true`(记得还原)或交给纯 node 子进程代做。
- **来源/验证**:2026-09-26 阶段 7 实测(node 与 Electron 双侧);**关联**:`test/common/temp-resource.js`(占用锚点已由「开句柄」改为「切 cwd」)、`test/segments/install-smoke.test.js`、`test/common/assert.js`(`firstByteDiff` 不得复用 `Buffer.compare` 的返回值)。**这些是跨项目通用的 Windows/Node 行为,符合晋升全局配置目录 `ENV-GUIDE.md`「一、Windows 平台坑」的条件,是否晋升由用户定。**

### 2026-08-08 12:16:09 批次 7 修复期踩坑结论(已验证,勿回退)
- **结论**:① **每个转换入口必须独立复位 `cancelRequested`**:单文件在 convert handler、批量在 `batchConvertImpl` 开头、**合并必须在自己函数开头** —— 缺失则上次取消残留 true,二次转换立即被 `throwIfCanceled` 误判「已取消」。② **进度上报必须逐入口接线**:合并最初缺失 → renderer 进度条停在 0%。③ **printToPDF 是 Electron 原子调用、不可中断**:取消检查点应放在 loadFile 前 / fonts.ready 后 / **打印完成后落盘前**(最后一个是关键:取消则不产出文件、不注入书签元数据、不报成功)。④ renderer 取消分支依赖 handler 返回 `{ ok:false, canceled:true }`,否则弹「转换失败」而非「已取消」。⑤ **smoke 自清理产物**:重名保护后 output 残留旧产物不再被覆盖 → 断言会因 (N) 序号变体失败;smoke 开头按前缀清理自身产物,Windows 占用 EBUSY 容错跳过。
- **来源/验证**:自查(用户实测反馈驱动),修复 commit `524cdf2`/`fd40480`/`f809c57`。

### 2026-08-08 11:19:01 批次 7 体验优化实现结论(已验证,勿回退)
- **结论**:① **编码预检**:`TextDecoder("utf-8",{ fatal:true })` 是可靠的 UTF-8 合法性判定,失败按 iconv-lite **gb18030** 解码(**gb18030 是 GBK 超集,GBK 文件无损**);UTF-8 BOM(EF BB BF)与 UTF-16LE BOM(FF FE)嗅探剥离;Node 原生不支持 GBK 解码,必须 iconv-lite。② **重名加序号**:输出已存在 → `名 (2).ext` 递增、绝不覆盖(单文件/批量/合并统一走 `resolveOutputPath`);Windows 路径 **>250 字符回落源目录并警告**(MAX_PATH,Electron 侧无解)。③ **输出目录语义**:`settings.outputDir` 空串 = 源文件同目录;非空 = 绝对路径校验(相对路径视为非法),不存在则创建,创建失败回落源目录并警告。④ **取消机制**:renderer 发 `convert:cancel` → 主进程置 `cancelRequested` → 检查点抛 `ConvertCanceledError` → 返回 `{ ok:false, canceled:true, error:"已取消" }`;批量在文件间检查,未开始项记 `{ canceled:true }` 与 canceledCount。⑤ **批量导出后一致**:按 `afterConvert` **仅对首个成功项执行**。
- **来源/验证**:自查(fix-2 部分落盘 + 编排器直接实现,typecheck/build/验收全绿);**关联**:`src/core/encoding.ts`、`src/main/persist/settings.ts`;原文存档 `docs/archive/20260808-1029-GUI操作流程勘察.md`、`20260808-1030-功能扩展调研.md`、`20260808-1031-易用性调研.md`。

## 渲染层与 UI

### 2026-08-25 功能开发技术路线调研(F7 目录带页码 / F9 docx 模板导入)
- **F9 模板导入**:npm 无现成库做「读任意 .docx 模板套用样式」;Pandoc `reference-doc` 是部件级选择性搬运,坑多(#1305 numId 断链 / #9522 settings 整搬损坏)→ **推荐浅导入 v1**(jszip 读 styles.xml 关键 rPr → 映射 theme.ts/settings 字段,3-5 天,契合集中字体配置硬约束),深导入列后续独立候选。
- **F7 目录带页码**:Word TOC 域 + updateFields 打开必弹更新提示(不可关闭,docx #1212),WPS 可能不响应自动更新;docx 静态页码不可行(OOXML 无 page 实体)→ **推荐混合路线**:pdf 两遍法静态页码(占位等高目录保布局一致 + PDF.js 文本匹配定位;Typora 因单遍打印流做不到 = 独占差异化)+ docx 默认维持静态目录、新增 opt-in 域目录开关(cachedEntries 预填防空白),WPS 行为纳入双实测。**用户已拍板(2026-08-25)**:F7 采混合路线、F9 采浅导入 v1,决策记录见 `docs/ADR.md`(ADR-007/ADR-008)。
- **来源/验证**:@librarian 技术路线调研 + 用户拍板;**关联**:`docs/archive/20260825-182036-功能候选调研与迭代排期.md` 第六节。

### 2026-08-25 18:20:36 功能候选调研与迭代排期(2.0.0 后新阶段)
- **竞品对标核心结论**:格式错乱/公式/Mermaid/代码高亮/批量五大高频痛点本产品均已解决;剩余真实缺口 = 页眉页脚自定义(Logo 页眉,V2EX #1098305「交付全家桶」最后缺口;Typora 页码 issue 118+ 赞多年未解的反面印证)、水印(GUI 竞品空白)、转换预检报告(零竞品,AI 生成不规范 md 是新时代格式错乱最大来源)、合并 + 总目录(手册场景真空);差异化定位「易用性 × 正式交付能力」兼得是竞品格局裂缝。
- **架构扩展点**:docx handlers/ switch 分发、pdf rules/ 数组挂载、CROSS_REF_KINDS 表驱动、ConvertContext 只增不改 → 新语法功能落点现成;但**双管线有意不合并**(docx=remark/mdast,pdf=markdown-it),新语法双侧各实现一次成本双倍。**用户拍板做 9 项**:页眉页脚自定义 / 水印 / 标题排版粒度 / 图片控制增强 / 表格列宽 / 转换预检 / 合并增强 / docx 模板导入(解除暂缓)/ 目录带页码(**推翻 D1 免更新路线**);两项待调研项结论见上一条。
- **来源/验证**:@explorer 能力盘点 + @librarian 竞品对标 + 用户选型;**关联**:`docs/archive/20260825-182036-功能候选调研与迭代排期.md`、前序 `docs/archive/20260814-201622-模板导入方案.md`。

### 2026-09-25 17:43:34 竞品功能矩阵二轮调研(活跃开发三方向输入)
- **结论**:按纯用户价值给出三个活跃开发候选方向(登记去向见 `docs/ROADMAP.md`「候选区」)—— ① **模板深导入**(reference.docx/.dotx 样式全量映射,竞品验证付费点,原暂缓升待拍板 + 价值升「高」)② **docx 导入回 Markdown 含修订读回**(往返闭环断点,Pandoc `--track-changes` 等价,少有成熟实现)③ **中文排版包深化**(字号制/中英混排/智能首行缩进,竞品 md-to-cn-word / MD2Word / md2docx-cn 均为半成品、缺口最大);另验证:原生公式 + Mermaid 降级、剪贴板热键插入光标处(PasteMD)为高价值可选项。竞品高价值集中在保真度/模板化/剪贴板工作流/中文排版四带,三方向均在既有底座上做深。
- **来源/验证**:@librarian 竞品矩阵调研 + @explorer 现状盘点(并行子代理);**关联**:`docs/archive/20260925-174334-竞品功能矩阵调研.md`。

### 2026-08-08 11:19:01 功能扩展调研要点(@librarian,批次 8 规划依据)
- **市场信号**:**Mermaid 从加分项变标配**(2026 新工具几乎全有);WPS 用户群被单独服务,docx 输出必须过 WPS 兼容关(见 `docs/WPS-COMPAT.md`);中文排版(eastAsia)仍是全赛道系统性短板(Pandoc 3.2.1 才加 `w:hint="eastAsia"` 且中英引号还有 bug)→ 护城河成立,也是营销话术点。
- **来源/验证**:@librarian(lib-1);**关联**:`docs/archive/20260808-1030-功能扩展调研.md`。

### 2026-08-08 11:19:01 易用性调研要点(@librarian,批次 7 已实施;未做项见路线图)
- **结论**:中文用户特有坑 = GBK/GB18030 编码检测转码(Node 原生不支持,需 iconv-lite,已实施)、Windows MAX_PATH 260 预检(已实施,>250 字符回落)、UTF-16/ANSI 乱码文件名。**可量化自评基准**:SUS 68 分 = 50 分位;任务完成率行业均值 78%,目标 ≥90%;点击数目标 ≤3;启发式走查 3-5 人可发现约 75% 问题。
- **来源/验证**:@librarian(lib-2);**关联**:`docs/archive/20260808-1031-易用性调研.md`。

## 代码结构与架构

### 2026-08-24 02:26:55 目录结构评审(重组后复核,只读;P1/P2 已落地)
- **总体判断**:三层分离(core 纯逻辑 / main 编排+IO / renderer DOM)与 core 分域(docx/pdf 输出域 + markdown/image/pipeline 共享语法域 + settings/i18n/util 横切契约)执行一致,handlers↔rules 粒度对称;真正问题仅两类 —— 跨进程契约类型寄居 main 层、test/ segments 与 main 边界不符自述口径。
- **P1 契约类型归位(已完成)**:`main/ipc/channels.ts` 的 ConvertProgressPayload/ConvertMode 与 `main/persist/ui-state.ts` 的 UiState/RecentFile 曾被 renderer type-only import(1+3 处),构成 renderer→main 反向依赖 → 新建 `core/ipc-contract.ts` 承载两族类型(含 BatchResult/BatchItem),channel 常量/IO 实现留 main,反向依赖清零(仅 PreloadApi 维持实现推导)。**P2 test 归位(已完成)**:segments/ 里 4 段实为直测 dist/main → 迁 `test/main/`;2 段直测 dist/renderer → 迁 `test/renderer/`(acceptance.mjs 扩第三发现根)。**口径冲突已由用户裁定关闭**(2026-09-25,技术债 D4/D5):采「全量镜像三层」,9 个 main + 4 个 renderer 主题段全迁。**确认合理不动**:mermaid 三同名各归其位;pipeline/merge 与 converter/merge 同名但纯函数 vs IO 分层正确;i18n/settings 三处;image-downloader(IO 属 main)。
- **来源/验证**:@oracle ora-1(全量结构 + 约 20 文件头部核实);**关联**:`docs/archive/20260824-022655-目录结构评审.md`、前序 `docs/archive/20260823-230554-目录结构优化方案.md`。

### 2026-08-23 23:05:54 目录结构优化方案(四轮探查定稿,已实施)
- **结论**:重组前约 70% 接近理想,结构性欠账 6 项 —— core 根级 20 文件平铺、`core/i18n.ts` 702 行(字典 ~585 行与逻辑混放,引用面 ~20 src 文件 + 测试 31 处)、`renderer/events.ts` 607 行单函数闭包混 6 事件域、`main/index.ts` 695 行五块混放、`main/converter.ts` 524 行三实现混放、core/docx 缺 handlers 层。
- **关键事实**:i18n EN 字典 `Record<keyof typeof ZH,...>` 编译期锁定键集 → ZH/EN 必须同文件;`pdf/rules/` 存在因 markdown-it 有规则可覆盖,docx 走 mdast 无规则层、对应物是 handlers/,`theme/ctx/prescan/chrome` 属横切留顶层 —— 不对称有技术原因非遗留错误;core 根级文件均为纯 ESM 模块,移动 = 只改相对 import(无动态路径/`__dirname`);唯一测试联动是 contract-single-source.test.js 路径断言。
- **不拆与批次**:`docx/render.ts` 编排器 / `dom.ts` / `math.ts` / `ui-state.ts`(sanitize 防御性冗余)/ `settings-panel.ts`(零直测系有意分层)明确不拆;`style.css` 随 renderer 重组拆四文件,`smoke.ts` 移出生产路径首选 `test/tools/smoke/`。**实施批次**(每批独立提交 typecheck/build/test 全绿,已全部完成):①i18n+core 归组(~90 处 import)→②docx handlers 归拢→③renderer 功能域重组+events/style 拆分→④main/index.ts 抽取(先收敛 ctxByWebContents 防循环)→⑤converter 拆分+smoke 迁移;路径对照见头部迁移注记。
- **来源/验证**:@explorer exp-1 四轮递进探查 + 用户裁定;**关联**:`docs/archive/20260823-230554-目录结构优化方案.md`。

### 2026-08-11 20:11:45 src 架构审查结论(@oracle,重构规划依据;H1-H3 已落地)
- **总体**:分层正确(core/main/renderer 单向依赖,core 纯净可复用),问题集中在「契约重复」与「单体文件」;docx/pdf 双管线平行实现(题注/公式编号/白名单)是选型代价,**维持「契约常量共享 + 测试锁定」,不建议合并**。
- **高优先级(已落地)**:H1 内联 HTML 白名单 docx/pdf 逐字复制两份(注释自认须同步)→ 抽 `core/markdown/html-whitelist.ts` 单一实现;H2 契约类型/默认值三处重复 → 改 `import type`(编译期擦除,不违反 contextIsolation)+ DEFAULT_SETTINGS 下沉 core;H3 docx 图片固定 400×300 拉伸变形 → Buffer 解析 PNG/JPEG 尺寸按比例缩放,webp 降级占位 + 警告。**中优先级**(部分已收敛):merge 图片正则截断含括号 URL、renderPdf 临时 HTML 无随机后缀(批量并发同毫秒竞争)、currentCtx 全局变量多窗口取消串台、`settings:set` 并发写丢更新、缓存无上限(当前可接受)。**拆分评估**:docx/render.ts 只拆独立岛(白名单/预扫/工具),主循环保持单体;pdf/render.ts 轻量拆 3 组;renderer 两阶段(先下沉 core 类型 + dom.ts,再建 state.ts);`style.css` **不值得拆**(级联顺序风险 > 拆分收益)。
- **来源/验证**:@oracle ora-2;**关联**:`docs/archive/20260811-201145-src架构审查.md`。

### 2026-08-23 13:30:05 全库质量审计(代码/文档/可用性;已全量闭环)
- **core(28 文件 ~4440 行)top 改进**:convert⇄render 运行时循环依赖、`headingNumbering=false` 题注编号双格式分歧、frontmatter 误吞以 `---` 开头文档正文(无已知 key 守卫)、docx 图片 resolver 无 memo、四组人肉同步契约(CROSS_REF_KINDS / sec-label 正则 ×4 / ImageResolver ×3 / 白名单双扫描器)、docx 悬空引用警告不去重、列表/引用块内不支持的块级内容静默丢弃、slug 40 字符截断在去重后致书签碰撞、pdfCss/KaTeX CSS 注入未净化 `</style>`(配合无 CSP 的预览窗口成真实注入面);次要项与逐条明细见存档。
- **main/renderer**:进程健壮性三缺口(无单实例锁、关窗时转换进行中无拦截、无 unhandledRejection 兜底);预览/打印 HTML 模板无 CSP + 外链导航未收口;IPC 参数校验标准不一;无暗色模式。**测试/工程**:当时只有 tag 触发 Release、`test:smoke` 不含 build、三段直写真实 `%APPDATA%`、runner 无逐段超时、copy-renderer 无 clean;盲区 main/index.ts、打包态资源目录定位、theme.ts eastAsia 无断言。**正面确认(保持不动)**:安全基线(isolation/sandbox/preload 白名单/零 XSS 面)、原子写 + 写队列、per-call 取消上下文、aria/焦点管理、fixtures 单一来源、断言消息嵌入实际值。
- **来源/验证**:@explorer×3 并行深审 + 主会话抽查复核;剩余约 20 项分五阶段排期,**五批 24 项已于 2026-09-25 全部完成**;**关联**:`docs/archive/20260823-133005-全库质量审计.md`、处置计划 `docs/archive/20260925-130122-技术债处置计划.md`。

### 2026-09-25 00:47:12 四路代码分析盘点(core / GUI / 测试工程化 / 文档状态;已闭环)
- **结论**:全库健康度良好、无阻塞性缺陷(契约单源/安全基线/测试恒等守护突出);核心发现:①双管线平行实现 + 警告去重/hljs 配色多处双源(**仅测试护栏,候选池标「勿动」不合并**)②GUI 超 500 行 TS 三文件(book-wizard 967 / settings-bindings 710 / settings-panel 560)、`about:open-external` 游离 IPC 单源、关于窗 sandbox:false 全仓唯一 ③覆盖率无门槛不进 CI + G1-G9 分支缺口未关闭、smoke 硬编码断言有 flaky 风险 ④lockfile 版本漂移(当场修复 + release.yml 三方校验门禁)与文档状态矛盾(ROADMAP/ACCEPTANCE 陈旧副本、关于页口径,均已回写关闭)。
- **处置**:剩余约 20 项分 A(封版期维护)/B(安全契约收口)/C(core 双源收敛)/D(结构重构)/E(测试增强)五阶段排期 —— **五批 24 项全部完成(2026-09-25)**;决策点 C4 拍板「1a 最小注入」、E2 拍板「仅动等待,计数全保留」均随批完成;遗留渐进/冻结/限制三类处置随需求管道重组(同日)集中入需求管道。
- **来源/验证**:4 个 explorer 子代理并行只读分析 + 主会话汇总;**关联**:`docs/archive/20260925-004712-代码分析四路盘点.md`、`docs/archive/20260925-130122-技术债处置计划.md`、`docs/ROADMAP.md`(处置记录现落「候选区」)。

## 测试与门禁

### 2026-09-26 21:46:00 c8 + Electron:二层探针进程在退出路径回写覆盖,退出码被 0xC0000005 顶掉
- **结论**:① c8 12 **只注入 `NODE_V8_COVERAGE` 一个变量**(无 spawn-wrap、无 `NODE_OPTIONS`);Electron 43 主进程认它,且在 `app.exit` 与 `process.exit` **两条**退出路径都回写覆盖 JSON —— 「立即退出」不等于「跳过回写」。② 触发形态:一个**活着的 Electron 主进程**(Chromium 主循环/GPU/utility 线程仍在)在退出期回写覆盖时撞上 Electron 拆卸,Windows runner 上以 `3221225477`(`0xC0000005` 访问冲突)终止,**诊断文本已完整落盘、只有退出码被顶掉**,于是「入口失败应退 4」「崩溃段应上报 7」这类**以退出码为唯一证据**的断言以与被测行为无关的方式判红。③ 只有**二层**子进程会中(段内嵌套编排派生的夹具进程、入口探针进程):顶层段的 `app.exit` 发生在 app 稳态之后,同轮 116/118 全绿;全仓唯一的 Electron 内无条件 `process.exit()` 在 `runner-report` 的崩溃夹具 → 它 2/2 中,`app.exit(4)` 变体 1/2 中(两个不同概率,不是同一处随机)。④ **轮次差是唯一分辨维度**:同一 commit 同一台 runner,`npm run test` 轮全绿、只在其后的 `test:coverage` 轮炸(覆盖写手只在该轮存在);与压力/资源无关(两轮段耗时同量级),本机全量复现不了。⑤ 修法:覆盖采集环境**不下传给二层子进程**,判据取「父进程自身是段宿主」(`M2W_SEGMENT_FILE` 存在);顶层段的采集不受影响,二层夹具不执行 `dist/**`、对覆盖汇总零贡献,四项覆盖率无方向性下降(数值以 `npm run test:coverage` 输出为准)。
- **勿回退**:「顶层 harness 专属 env 不下传」现有成员为 2 个 —— `M2W_ONLY`(无条件剥)与 `NODE_V8_COVERAGE`(**仅嵌套编排剥**)。若将来新增的嵌套编排**会执行 `dist/**`**,必须在 `runSegmentIsolated` 该分支显式保留采集,否则是**静默少算覆盖率**(与本仓已记的「覆盖率会静默少算」同族,比崩溃更难发现)。退出码断言不得为绕开本条而放宽:`runner-report` 的「父进程原样上报子进程退出码」是该契约唯一的端到端验证。
- **来源/验证**:2026-09-26 GitHub Actions 两轮(commit 48594f0 与 2f074ee,连续两轮 `verify:ci` 判红、每轮换一个段)。**判据是「触发条件消失」而非「症状不复现」**:本地对照跑证明二层 spawn 增加 11+ 个时 `coverage/tmp` 份数只随段数增长(不随二层进程增长)→ 二层子进程已不注册覆盖写手;本机全量 `test:coverage` 修复前后均 118/118 通过。crashpad/WER 未取到,崩点具体位置属推测。**关联**:`test/common/runner.js`(`runSegmentIsolated` 的 env 下传边界)、`test/common/entry-guard.mjs`(默认退出实现)、`test/segments/runner-report.test.js`(崩溃夹具)、`test/segments/entry-exit-guard.test.js`(入口探针 spawn);`scripts/gate-probes/gates/coverage.mjs`(子 c8 **显式指定自己的** `NODE_V8_COVERAGE` 目录,不依赖外层环境,故不受本条影响)。原文:`docs/archive/20260926-214428-二层Electron探针崩溃归因.md`。

### 2026-09-26 21:30:00 测试框架的「选择面」与「发现面」是两个语义
- **结论**:`M2W_ONLY` 同时被两件事消费 —— 「harness 这一轮跑哪些**顶层**段」与「某段内部 `runAll`/`discoverSegments` 能发现哪些段」。旧实现里 `discoverSegments(dirs)` 无条件读 `process.env.M2W_ONLY`,而段宿主把 `...process.env` 整包传给子进程,于是**顶层筛选词跨进程渗进段内**:段自测要跑的沙盒段前缀是 `segments/xxx-selftest/`,被外层 `M2W_ONLY=segments` 命中零个 → 发现面被滤空 → 拿到空清单。**滤空发生在发现层,不是执行层** —— 执行层只是忠实执行了被滤空的清单,查错方向会一路错到执行层。
- **为什么长期没暴露**:触发条件是「筛选词命中零个目标段」,而按段名前缀筛(如 `M2W_ONLY=runner-report`)恰好**不**触发(它是沙盒名前缀的子串);且 CI 全量跑不设 `M2W_ONLY` → 只在本地按目录筛的隔离调试姿势下暴露。实证信号是同一段内两种用法并存:一处要「不筛选」、两处要「按词筛」,而旧 API 只能靠改环境变量表达后者。
- **来源/验证**:2026-09-26 实测(按目录筛时某段报「应执行 N 个沙盒段,实际 0」);**关联**:`test/common/runner.js`(`resolveOnlySelection` 承载三态契约:未声明 = 读 `M2W_ONLY`、显式 `null` = 不筛选、字符串 = 按词筛;`runSegmentIsolated` 边界把该变量从子进程 env 删除,段清单由 `M2W_SEGMENT_FILE` 单独决定)、`test/segments/runner-report.test.js`。**已知遗留**:`test/segments/fixture-contract.test.js` 是第二处段内自用该变量 —— 手工 `delete` 再 `finally` 复原,属调用点打补丁,新契约下行为不变。

### 2026-09-26 20:10:00 renderer 测试段的元素 stub 契约(易致假红)
- **结论**:`test/renderer/**` 的段各自带一套**极简元素 stub**,并非统一实现。例如 `wizard-command-guard.test.js` 的 stub 有 `setAttribute`,但**没有** `removeAttribute`/`getAttribute`/`offsetWidth`,且 `querySelector` **恒返回 null**。被测代码一旦新增对这类成员的调用就会在段内抛错,表现为**与真实缺陷毫无关系的断言失败**(本轮一次 `removeAttribute('aria-busy')` 让「付印两格式应依次执行两次合并」报成 `mergeCount === 1`)。另一面:Node 侧段以最小 stub 驱动,**全局 `HTMLElement` 不存在**,故**不得用 `instanceof HTMLElement`** 判类型,须用鸭子类型。
- **关联**:被测代码 `src/renderer/ui/dialogs.ts`(aria-busy 显式写回 `"false"` 而非摘除属性,正为规避此坑)、`src/renderer/state/utils.ts`(焦点来源栈用鸭子类型)。**新增 DOM 接口调用前须确认所在段的 stub 提供了该成员。**

### 2026-08-15 14:40:57 代码/测试/文档组织形式审计(@exp-1 + @ora-1,批次 14 规划依据;缺口已全闭)
- **结论**:12 项组织形式可调点(高收益低成本 4 项:README mermaid 条目重复 7 次 / .gitignore 缺 coverage/ / artifacts.js 注释漂移 / STATUS 标题外悬挂 3 行;中收益:lint 只跑 src/、gen-fixtures.mjs 位置、manual/ 夹具陈旧;低收益:preload.cts 混用合理、build.files 排除 hljs styles、archive 条数)。**已确认合理**:docx/render.ts 单体、style.css 大文件、33 段零注册体系。重构候选 R1-R8(死代码、renderer DOM 层零覆盖、sanitize 未导出、宽松回退策略并存、循环依赖、IPC 面 0% 覆盖、双管线差异注释、硬约束提醒)均已随批处置。
- **测试缺口 G1-G9(已全部关闭)**:G1 math.ts 60.65% branch(munderoverToNary 非 ∑ 回落 / moText)→ `formula.test.js`;G2 pdf postprocess 75% stmts → `pdf-postprocess.test.js`;G3 bookmarks 旧式 Dests / decodeURIComponent catch / 间接目标 → `pdf-bookmarks.test.js`;G4 metadata 25% branch → `pdf-meta.test.js`;G5 utils decodeNumeric / escapeRegExp → `utils.test.js`;G6 converter open 失败 / pdf 分支 / stat 失败 → `converter.test.js`+`paths.test.js`;G7 mermaid-service 兜底 → `mermaid-service.test.js`;G8 十处散点逐条命中;G9 维持不补(encoding/html-whitelist/slug)。**覆盖率门槛**:c8 + Electron 覆盖采集实测可用(报告经 sourcemap 映射回 .ts);基线 stmts 93.92 / branch 88.84 / funcs 93.15 / lines 93.92,门槛 90/85/90/90 写在 `test:coverage` 脚本内单源,ci.yml 验收步改跑该脚本。
- **来源/验证**:@explorer exp-1 + @oracle ora-1;**关联**:`docs/archive/20260815-144057-代码测试文档审计.md`。

### 2026-08-10 21:12:58 测试覆盖盘点结论(@explorer,覆盖基线依据)
- **方法**:能力面(src/core 全部 + src/main + src/renderer)逐一 grep 对照测试段 + smoke 断言,产出「能力点 × 覆盖」全量表(详见存档);24 项缺口按高/中/低三档,后续逐批关闭。
- **高优先级缺口(当时)**:封面页双格式断言、breakBeforeH1 产物分页、取消链路回归(两次取消 bug 无回归测试)、重名保护主动断言、缺失图片警告文案、公式降级分支、外链图片下载(超时/去重/失败兜底全无)、任务列表、h4-h6 标题、分页符产物。**中优先级**:settings sanitize 边界(字号 8-24 / 行距 1.0-2.5 / 边距 0-1000 钳制、损坏回退、旧文件兼容、patch 白名单)、slug 三函数单测、frontmatter 边界、非 A4 纸张/边距、`w:numPr` 序列化、外链 rels、页脚页码文案。**低优先级(维持 smoke diag + GUI 实测)**:renderer 全部交互、runAfterConvert、collectMarkdownPaths、超长路径回落、IPC dialog/预览。
- **来源/验证**:@explorer exp-1(两轮);**关联**:`docs/archive/20260810-211258-测试覆盖盘点.md`;缺口的现行登记与守护方式见 `docs/DEV-GUIDE.md`「测试体系」节与 `docs/ROADMAP.md`「候选区」。

### 2026-08-13 21:18:12 验收样例生成方案选型(@用户拍板,测试基建)
- **选型(拍板)**:测试段导出 `export const fixtures = { main: ... }` → 生成器落盘 `test/fixtures/acceptance/<段名>[-key].md` —— **md 唯一事实来源 = 测试段**,零重复/永不漂移/自动跟功能走;不选「独立手写验收样例集」(手工维护 + 与断言漂移);试点 4 段先行、触发 = 手动 npm script + 提交前 `--check`。
- **机制与坑**:`gen-fixtures.mjs`(纯 Node)扫描段动态 import → 落盘 md + 复制图片(缺失静默跳过)+ 生成 README 索引;`--check` 内存重生成逐字节比对(差异 exit 1);幂等;命令 `npm run gen:fixtures`(需先 build)/`npm run check:fixtures`。`test/common/pdf-utils.js` 顶层 `import { BrowserWindow } from "electron"` 在纯 Node 下必 SyntaxError → 需 electron mock 桥接(`node:module.register` 最小 mock);含 fixtures 的段 import 失败一律 exit 1(防不完整索引覆盖旧产物)。
- **来源/验证**:用户决策(2026-08-13,方案对比见存档);**关联**:`docs/archive/20260813-211812-验收样例生成方案.md`。

### 2026-09-26 21:14:55 `pathToFileURL` 把 8.3 短路径的 `~` 编码成 `%7E`
- **结论**:`pathToFileURL` 对 8.3 短路径里的 `~` 产出 `%7E`,而 Chromium 原样保留;配 `realpath` 展开 8.3 短名后,期望值若用词法根比对**必然不等**。断言须按码族/两侧归一化后比较 —— 这类失败只在 8.3 短名开启的机器上出现,断言却指向「路径策略不对」。
- **来源/验证**:REF-001 阶段 7 Windows runner 实测:对同一文件分别取短路径与 realpath 展开路径,比较 `pathToFileURL(...).href` 与浏览器侧读到的 URL;**关联**:`test/tools/geometry/*`。

### 2026-09-26 21:14:55 测试段同进程连跑两遍时的迟到覆盖(本批主因)
- **结论**:同一测试段在一轮里跑多遍(`npm test` 与 `test:coverage` 各一遍)时,**第一遍过、第二遍挂** —— 根因是上一遍遗留的异步写在本遍落盘,不是本遍代码回归。已由 drain 修掉(见 Electron 一节的 drain 条目);「同一段在一轮里跑多遍」这一形态本身值得留档:段内任何未结算的异步写都会变成跨遍数据竞争,症状与原因分处两遍。
- **来源/验证**:REF-001 阶段 5/7 实测,修复 commit `48594f0`;修前该段在双跑下第二遍稳定失败,修后两遍全绿;**关联**:`test/common/segment-host.mjs`、`test/common/runner.js`、`npm run test:coverage`。

### 2026-09-26 21:14:55 门禁探针里再跑一次真 c8 会静默少算覆盖率
- **结论**:门禁探针在沙盒里再跑一次真 c8 而**未覆盖 `NODE_V8_COVERAGE`**,子进程继承外层同一临时目录并在其 report 阶段清空 → **所有文件名排在探针段之前的段的覆盖数据整段丢失**,而探针自身全绿。修法是给子 c8 指定沙盒内的 `NODE_V8_COVERAGE`;**不能用「给测试段改名去排序」绕过**(会让门禁依赖字母序而非真实覆盖)。少算发生在 report 阶段,门禁输出看不出异常。
- **来源/验证**:REF-001 阶段 5 实测:故意把探针段排在最后,观察前若干段的覆盖数据整段消失,覆盖 `NODE_V8_COVERAGE` 后复测;**关联**:`test/tools/` 下覆盖率门禁探针、`npm run test:coverage`(阈值单源在脚本内)。

### 2026-09-26 21:14:55 覆盖率阈值棘轮:降阈值、谎报 measured、只改基线都判红
- **结论**:`floor`(85/80/85/85)+ `headroomPp`(5) 的棘轮判据在真实仓库上**有牙**:降阈值、谎报 `measured`、只改基线不改命令,三种手法都判红;实测低于门槛时的正确动作是**补测试而非降阈值** —— 覆盖率数字本身可编,只有「阈值 + 实测 + 余量」三者互相约束才不可编。
- **来源/验证**:REF-001 阶段 5 实测:对三种绕过手法各跑一次门禁,均 exit 非 0,补测试后转绿;**关联**:`test/tools/` 覆盖率门禁。

### 2026-09-26 21:14:55 跨 DPI 几何采样用 Electron 进程内 `--force-device-scale-factor` 模拟
- **结论**:不改系统 DPI,改用 Electron 进程内 `--force-device-scale-factor` 模拟;页面实读 `devicePixelRatio` 与期望不符即判「未测量」并以**退出码 2** 结束;worker 报告判绿但退出码非 0 时**以退出码为准**(该规则在一次真实故障下拦下过假绿)。改系统 DPI 需管理员且会污染开发机;只信报告会漏掉「没测到却报绿」。
- **来源/验证**:REF-001 阶段 7 跨 DPI 基线实测:把期望 DPI 改成与页面实读不符,确认以退出码 2 结束而非报绿;**关联**:`test/tools/geometry/*`、`scripts/check-geometry.mjs`。

## 供应链与发布

### 2026-09-26 20:10:00 asar 归档格式两个反直觉事实(勿回退)
- **结论**:① asar 头部的文件树是**按目录分层嵌套**的(`{"files":{"dist":{"files":{"main":{"files":{"smoke.js":{…}}}}}}}`),**拼接路径字面量(如 `dist/main/smoke.js`)在头部文本中根本不会出现** —— 用「读文件头若干 MB 再对拼接路径做子串搜索」判定条目是否存在**必然假阴性**。本项目实测:10643 个文件的包内头部 JSON 约 2.6MB(**在 4MB 之内**),但因上述嵌套结构仍报「未找到冒烟入口」,与同一轮实际退出码 0 通过的结论**直接矛盾**。正确做法是**按路径分段在目录树里逐层下探**。② 头部定长布局为 `[u32 payload_size=4][u32 头长度][u32 头长度-4][u32 JSON 长度][JSON…]`,**JSON 起点是绝对偏移 16**;Chromium pickle 迭代器会**跳过 payload_size**,故长度字段在**偏移 4** 而非 0 —— 按偏移 0 读会差 4 字节并解出垃圾前缀。
- **来源/验证**:实测 2026-09-26 —— `npm run dist` 全链通过的同一轮里,预检输出「打包产物收到 --smoke 必然以退出码 1 结束」而同一步骤实际 exit 0;直接 dump 真实 asar 前 32 字节得到定长布局;**关联**:`scripts/smoke-proc.mjs`(`asarContainsEntry` 按树下探,返回 `parsed` 字段区分「未收录」与「头解不开」)、`scripts/pack-size.mjs`(`readAsarTree` 展平整树求和,两者**刻意不合并**:一个只答单条目在不在,一个要全树求和)、`scripts/check-asar-manifest.mjs`(冒烟入口已升级为必备条目硬门禁)、`test/segments/install-smoke.test.js`(夹具改为构造真实 asar 二进制头)。

### 2026-08-02 21:08:53 G5 打包坑 + 实测事实(electron-builder,已验证,勿回退)
- **结论**:① **highlight.js es/ 不可排除**:`import hljs from 'highlight.js/lib/common'` 在 ESM 下经 exports map 的 import 条件解析到 `./es/common.js`,打包时排除该目录 → asar 内模块解析失败 → 主进程启动即 `ERR_MODULE_NOT_FOUND`;`styles/` 可继续排除。教训:排除 node_modules 子目录前必须核对该包 exports map 的 import/require 条件目标,**dev/smoke 全绿 ≠ 打包可用**。② electron-builder 26.15.3 + `"type":"module"` 实测打包成功,ESM 入口无需特殊配置;**`directories.output` 必须设 `release/`**(默认 dist/ 与 tsc 产物混目录);纯 JS 依赖无原生模块 → 不需要 asarUnpack。③ 镜像正确地址 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`(**带 /mirrors/**,`registry.npmmirror.com/...` 404,已 HEAD 实测);工具链版本写死(nsis-3.0.4.1),镜像同步延迟会 404,首次成功缓存于 `%LOCALAPPDATA%\electron-builder\Cache`。④ **产物目录被系统进程锁**(EBUSY unlink app.asar)致重建 win-unpacked 失败,锁来自 Defender/索引类系统服务;CLI 覆盖参数 `-c.directories.output=x` 会被解析为配置文件路径报 ENOENT,改输出目录应直接改 package.json。⑤ **打包版 `--smoke` 不可用**:smoke 写 output/ 位于 asar 内(只读);打包版验证用「启动存活 + asar list + 静默安装/卸载(退出码 0)」;`win.electronLanguages: ["zh-CN","en-US"]` 裁 locales 收益最大。
- **来源/验证**:自查 + @librarian(lib-2);**关联**:`package.json` build 配置、同族条目见依赖钉死清单。

### 2026-08-28 Windows 本地打包踩坑(长路径 + Defender 重命名 EPERM + 镜像 env 未转发)
- **结论**:① **Windows Defender 实时扫描在 electron 解压到 `.tmp` 后立即锁定其中 electron.exe 等句柄**,父目录重命名失败报 `EPERM … rename '…\win-unpacked.tmp' -> '…\win-unpacked'`(经典 electron-builder/杀软冲突;与 G5 的 EBUSY unlink 同源但触发点不同,此处是 extractArchive 之后的 rename)。② **长路径叠加**:项目位于 OneDrive 同步目录,即便建 junction 指向短路径,electron-builder 仍解析真实路径写入,OneDrive 同步锁同样触发失败,且真实路径过长无法重命名中转。③ **可行解法(两步叠加本地打包成功)**:输出目录重定向到非 OneDrive 短路径(`--config.directories.output=C:\m2w-out`)+ `--config.electronDist=<短路径>\node_modules\electron\dist` 直接喂已解压的 electron 发行目录,electron-builder 改为 copy 而非解压后 rename,彻底规避 Defender 重命名锁。④ **镜像 env 未转发坑**:`.npmrc` 的 `electron_builder_binaries_mirror` 仅是 npm 配置键,npm 不会转成 `ELECTRON_BUILDER_BINARIES_MIRROR` 环境变量,electron-builder 读不到 → 回退 GitHub 下载报 `connect ETIMEDOUT 20.205.243.166:443`(nsis 等工具链);须显式设该变量(及 `ELECTRON_MIRROR`)再构建。⑤ Defender 排除需管理员,本机无权限失败,故未走排除路线。
- **关联**:`package.json` `build` 配置、`npm run dist`;本地环境经 `scripts/setup-env.ps1` 设镜像变量(写死勿回退,见 `AGENTS.md`「硬约束」行);前序 G5 打包坑(EBUSY unlink 同类)。

### 2026-09-26 21:14:55 `npm audit --omit=dev` 在刻意不装依赖的 job 里 dev 剪枝失效
- **结论**:在**刻意不装依赖**的 job 里跑 `npm audit --omit=dev`,dev 剪枝失效 → 纯构建期工具(xmldom/fast-uri/js-yaml/sharp)泄漏进生产树并被判为发布风险。判定层须以 **lockfile 的 dev 标记**为权威判据,job 补 `npm ci --ignore-scripts`。
- **来源/验证**:REF-001 阶段 0 门禁实测:同一 lockfile 在装/不装 dev 两种 job 下跑 `npm audit --omit=dev` 对比输出,再用 lockfile dev 标记复判;**关联**:`.github/workflows/` 审计 job。

### 2026-09-26 21:14:55 CI 注入的 `PSModulePath` 污染使签名核对探测命令在 runner 上不可用
- **结论**:CI 注入的 `PSModulePath` 污染使 Windows PowerShell 5.1 加载不到 `Microsoft.PowerShell.Security` → 签名核对探测命令在 runner 上不可用;探测失败须走 **`probe-unavailable` 三态**而非崩原始堆栈。把「探测不了」与「探测为否」混成二态,会让 CI 在能力缺失时误报为签名缺失。
- **来源/验证**:REF-001 实测,修复 commit `f89dbc5`;在注入污染值的 shell 里跑探测命令,确认落到 `probe-unavailable` 分支且门禁继续;**关联**:`scripts/check-signature-status.mjs`、`test/segments/signature-status.test.js`(三方锁定该状态文件)、`docs/SIGNATURE-STATUS.md`(状态单源,勿改)。

### 2026-09-26 21:14:55 npmmirror 的 `npm audit` 端点实测 404 不可用
- **结论**:npmmirror 的 `npm audit` 端点实测 **404**,须如实记为 `unavailable` 并由 OSV.dev 两阶段兜底,**全部源不可用时判红**,绝不把「扫不到」谎报成「无漏洞」。「不可用」与「无漏洞」在输出里长得一样,不留三态等于给供应链结论开了后门。
- **来源/验证**:REF-001 阶段 0 实测:直接请求该端点确认 404,并在全部源不可用时确认门禁判红;**关联**:`.github/workflows/` 审计步、OSV.dev 兜底实现。

### 2026-09-26 21:14:55 包元数据缺 `license` 字段时的取值纪律
- **结论**:字段优先;缺失时回落随包许可证物证(仓库小写 `license` 文件 / README 声明 / 远端 SPDX)并**记录来源与证据文件名**;内容仍无法识别才判红(**不猜测**)。故 SBOM(以 lockfile 为准)与许可证清单(以物证为准)可能对同一包给出不同取值,**这是有意的差异**。
- **来源/验证**:REF-001 阶段 6 发布/供应链实测:对缺 license 字段的包走物证回落并核对记录含证据文件名,对无任何可识别信息的包确认判红;**关联**:发布流水线许可证清单与 SBOM 产出步骤。

### 2026-09-26 21:14:55 自写 prerelease 版本比较器,刻意不引 semver
- **结论**:该脚本在两条 workflow 的 `npm install` **之前**各跑一次,若 `import 'semver'` 恰好在最需要它时 `ERR_MODULE_NOT_FOUND`,等于门禁自我否定 → 自写比较器,零依赖。门禁脚本的依赖前提必须早于门禁自身可用的时刻。
- **来源/验证**:REF-001 阶段 6 实测:清空 `node_modules` 后跑该脚本,确认仍可运行;**关联**:两条 workflow 的版本一致性校验步、`package.json` version 字段(版本号三统一见 `AGENTS.md`「规则」行)。

### 2026-09-26 21:14:55 NSIS 按用户模式与非交互安装:失败会留下无法卸载的幽灵条目
- **结论**:安装目录不可硬写 `%ProgramFiles%`(本仓实测 `UninstallString` 带 `/currentuser`);安装器在失败前已写入卸载注册表项与开始菜单 `.lnk` 时,两者都指向不存在的 exe,会在 Windows「应用」里留下**无法卸载的幽灵条目** → 失败清理须按**前后快照差集**只清本次新增残留,并点名具体键/路径。按模式清会误删用户既有的其他安装残留。
- **来源/验证**:REF-001 阶段 6 发布/安装实测:在写完注册表项后注入失败,确认前后快照差集只含本次残留、清理后「应用」里无孤儿项;**关联**:NSIS 配置、真实安装/卸载的人工验收项见 campaign PLAN「人工验收」节。
