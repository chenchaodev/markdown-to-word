# 研究结论

> 只记录「换会话仍会用上、且别处查不到」的坑/勿回退事实/库事实。已实施且细节见 CHANGELOG 的条目不再重复;选型见ADR.md。原文存档:docs/archive/。
> **路径迁移注记(2026-08-24)**:目录结构重组(2026-08-23,提交 6f3d72a~9909d74)前历史条目「关联」字段中的扁平路径已失效——对照关系:`src/settings.ts`→`src/main/persist/settings.ts`、`src/index.ts`→`src/main/`(拆 windows/ipc/menu/converter/persist/services)、`src/renderer.ts`→`src/renderer/renderer.ts`+六功能域、`src/core/{i18n-dict}.ts`→`src/core/i18n/`、core 根级散文件→`pipeline/markdown/image/settings/util/` 子域。时间戳记录按规约不改写原文。
> **分节注记(2026-09-26,REF-001 #14)**:条目按技术主题分组、组内时间倒序;一条未删未合并,只做分组与压缩,压缩处保留结论/关键数值/验证方式 + `docs/archive/` 原文链接。

## docx 生成与域

### 2026-09-26 22:10:00 docx MathSum 的 m:e 必须装被加数,否则 WPS 显示方框(勿回退)
- **结论**:① `MathSum({ children })` 的 `children` **是被加数**(`∑…x` 的 `x`),传 `[]` 产出空 `<m:e/>`,WPS/Word 在该位置画**方框「□」**;`naryPr` 已内置 `∑`,children 绝不能再塞运算符。② KaTeX 的 `<munderover>` **只含运算符与上下限**,被加数在**下一个兄弟节点**,须由 `walkChildren` 取 `children[i+1]` 且**只消费这一个**。③ 该段此前是**死代码**(旧测试注明 `munderover`/`MathSum` 不可达),display 公式改按 display 模式渲染后才第一次走到 → **「某能力不可达」≠「该路径已验证」**。④ 列表项/引用块内公式 value 被 remark-math 解析成带尾随 `$$` 的脏值(如 `"\frac{1}{2}\n$$"`)送 KaTeX 必失败,与「渲染层是否递归进 math」是两个独立缺陷。
- **来源/验证**:2026-09-26 用户在 WPS 目视发现方框后定位,与 docx 9.7.1 源码双向核对;失败形态「结构合法、字符无缺失、观感坏」只有直接看 XML 才暴露;**关联**:`src/core/docx/handlers/{math,equations,content}.ts`、`test/segments/math-structures.test.js`(断言查 `<m:e>` 内有被加数)。**遗留**:行内 `∑` 仍是 `m:sSubSup` + 被加数作兄弟。

### 2026-08-08 11:50:33 docx 域 API 调研结论(@librarian,8a TOC/8b 题注实施依据)
- **结论**:① `TableOfContents("目录", { hyperlink, headingStyleRange: "1-3" })` 是 docx 9.x 官方路径,须配 `features: { updateFields: true }` → 8a = 开关化 + updateFields 联动。② **无 `ComplexField` 类**;行内域只能 `SimpleField(instruction, cachedValue?)`,**域指令空格是关键**(首尾各留一个)。③ 「图 1.1」章节号 = `图 { STYLEREF 1 \s }-{ SEQ 图 \* ARABIC \s 1 }`,须手插,styleId 写 `Heading1`(非 Word 内置 `1`);前提是标题编号为 `w:numPr` 自动编号(现有 5b 已满足)。④ **两路线必须二选一、8a/8b 同路线严禁混用**:更新路线(打开弹一次提示、改标题后 F9 同步;WPS 支持未背书需实测,Google Docs/LibreOffice 忽略 updateFields 显示空白)vs 免更新路线(`beginDirty:false` + cachedEntries,零提示但改标题后陈旧;页码无法精确,docx 无排版引擎 #885)。
- **来源/验证**:@librarian lib-1 + lib-3,对照 docx 9.7.1 源码逐行实证;**关联**:`docs/archive/20260808-1142-docx域API调研.md`、docx issue #1212/#2673/#885。

### 2026-08-06 21:27:25 docx 标题编号 + 内部链接(已验证,勿回退)
- **结论**:① 标题编号用**段落级 numbering**:Paragraph 挂 `numbering: { reference: "md-heading", level: depth-1 }`,1 个 reference + 3-6 级 levels(text `%1`/`%1.%2`/`%1.%2.%3`,format `decimal`,indent `{ left: 360, hanging: 360 }`),**静态渲染、无需 F9**;heading + numbering + Bookmark 三层不冲突,不注入 ListParagraph 样式(9.7.1 实证)。② 「第一章 + 1.1」需 level 1/2 加 `isLegalNumberingStyle: true`(w:isLgl)。③ **9.7.1 无 `Hyperlink` 类**:内部链接 `InternalHyperlink({ anchor: docxBookmarkId(slug), children })`(参数名是 `anchor`),外链 `ExternalHyperlink({ link })`;链接样式需 `TextRun` 手动 color/underline。
- **来源/验证**:@librarian(lib-1,本地 d.ts/cjs 逐行实证),产物解包核对 `w:numPr` / `w:bookmarkStart`;**关联**:`src/core/docx/{render,theme}.ts`、`docs/archive/20260806-2116-docx标题编号与内部链接调研.md`。

### 2026-08-05 22:22:19 docx 页眉页脚 + 页码(已验证,勿回退)
- **结论**:① `new Header({ children: (Paragraph|Table)[] })`,children 只收段落/表格、**不能放裸 TextRun**。② **挂载点只有 `sections[].headers/footers`**;首页不同用 `properties.titlePage: true` + `headers.first`。③ **9.x 无 `PageNumberFormat`(改名 `NumberFormat`)**;格式写 section `properties.page.pageNumbers.formatType`;「第 X 页 / 共 X 页」用 `PageNumber.CURRENT`/`TOTAL_PAGES` 放 `TextRun({ children })`。④ 合并场景单 section 渲染 → 页码连续;`TOTAL_PAGES` 含封面/目录,与 PDF `footerTemplate` 语义一致;页眉标题优先级 `metadata.title ?? options.title`。
- **来源/验证**:@librarian(lib-3,对照 docx 9.7.1 源码验证);**关联**:`src/core/docx/render.ts`、`docs/archive/20260805-2210-页眉页脚页码调研.md`。

### 2026-08-02 19:57:10 G1 实测事实(docx 9.x + remark 管线,已验证)
- **结论**:① `Document` 直接收 `numbering: INumberingOptions` **对象**,不需要 `new Numbering()`;`TextRun` 无公开可变 `options`,行内样式靠构造参数累积。② mdast 的 `image` 是 **PhrasingContent 行内节点**,行内渲染需支持 `ImageRun`;type 枚举是 `png/jpg/gif`,魔数要返回 `"jpg"` 而非 `"jpeg"`。③ 设 `font: { ascii, eastAsia, hAnsi }` 后 document.xml 正确写入 eastAsia。
- **来源/验证**:自查(typecheck + 生成 docx + 解包检查 XML);**关联**:`src/core/docx/render.ts`。

## PDF 管线

### 2026-08-05 22:03:15 书签实现 + 「点击不跳转」修复(已验证,勿回退)
- **结论**:① **pdf-lib `PDFName.asString()` 返回内部编码**(`%`→`#25`),须先 `key.decodeText()` 再 `decodeURIComponent` 才得中文。② printToPDF 产物**无 /Names 名称树而是旧式直接 `/Dests` 字典**,须兼容两种。③ **`dict.lookup(key,type)` 在 key 缺失时抛 `UnexpectedObjectTypeError` 而非返回 undefined**(实测崩溃根因),须 `dict.get(key)` + 手动 `context.lookup(ref)`;`decodeText` 走 PDFDocEncoding 会把 UTF-8 中文解成乱码。④ 自研 `src/core/pdf/bookmarks.ts`:`lookupNamedDest` + `setOutline`(pageRefs 经 `catalog.Pages().traverse` 收集)+ `injectBookmarks`;标题 id 即命名目标名。⑤ pdf-lib 1.17.1,ESM 用包名导入勿碰 `pdf-lib/es/index.js`;中文标题必须 `PDFHexString.fromText`(UTF-16BE),issue #516。**教训**:断言须查 `Dest[0] instanceof PDFRef`,只查标题文本会漏过「全部回退首页」。
- **来源/验证**:@librarian lib-1 marp-cli 样板 + 自查实测;**关联**:`src/core/pdf/{bookmarks,render}.ts`、`docs/archive/20260805-2151-pdf书签注入调研.md`。

### 2026-08-02 20:46:39 G4 实测事实(printToPDF 管线,已验证,勿回退)
- **结论**:① `printToPDF({ pageSize:'A4', margins:0, printBackground:true, preferCSSPageSize:true, displayHeaderFooter:true, footerTemplate })` 实测成功;边距交给 `@page { size:A4; margin:18mm 16mm 22mm }`;**默认 pageSize 是 Letter 必须显式 A4;@page 存在时 `landscape` 失效,方向写 CSS**。② 任务列表 checkbox bug 规避:渲染后把 `<input class="task-list-item-checkbox">` 替换为 ☐/☑ + `li.task-list-item { list-style:none }`。③ 图片统一转 `pathToFileURL` 绝对路径;`footerTemplate` 必须内联样式(9px 灰字)。④ `hljs/lib/common` + `ignoreIllegals:true` 可用,需 printBackground 才有底色。**依赖**:markdown-it **14.3.0**(15.0.0 与 tasklist@1.0.2 peer 冲突)。
- **来源/验证**:自查 + @librarian + @observer(截图确认);**关联**:`src/core/pdf/render.ts`、`src/core/convert.ts`。

## 双管线能力与契约口径

### 2026-09-25 决策口径统一(supersede 台账,零行为变更)
- **结论**:裁决此前只落在优化计划里,本轮把 **D-02/D-03/D-08** 写进对应文档并登记取代关系(不改写历史 CHANGELOG/ADR)。①**D-02**:内置 `TEMPLATE_PRESETS` 携带完整交付链(typography+pageSetup+headerFooter+watermark+equationNumbering+breakBeforeH1);`CustomPreset` **只含 typography + pageSetup** → 「不入预设」徽标 = 仅指自定义预设;删除自定义预设后的回退路径也只还原这两组,与套用内置不同链。②**D-03**:图片校验顺序固定 原始 src → 词法根边界 → realpath → 规范根边界,单一来源 `core/markdown/precheck.ts`,main 侧复用;拒绝绝对路径/UNC/带协议 URL/越界 `..`/realpath 越界;**媒体类型与大小上限尚未实施**。③**D-08**:测试段逐子进程隔离(硬超时、资源回收、case 级报告、失败 artifact)。④**代码签名状态是独立单源事实**,见 `docs/SIGNATURE-STATUS.md`。
- **来源/验证**:裁决原文已随 #07 撤除,快照 `docs/archive/20260926-211455-全库优化计划与执行台账.md`;回归断言 `test/main/{image-downloader,converter}.test.js`;口径落点 USER-GUIDE / WPS-COMPAT / ACCEPTANCE / ROADMAP / design。

### 2026-08-13 19:35:32 mermaid 集成方案调研结论(@librarian + @explorer,8c 实施依据)
- **结论**:① **11.16.1 钉死**;ESM-only + dist 内 IIFE `mermaid.min.js`(3.5MB,file:// 直用规避模块 CORS),零 CDN;node_modules 约 120-130MB(asar 压缩 60-70%);Node 无 DOM 不能渲染。② 链路:单例隐藏 BrowserWindow(sandbox+contextIsolation、`backgroundThrottling:false`)→ `initialize({ securityLevel:'strict', fontFamily:'"Microsoft YaHei",sans-serif' })` → `mermaid.render`(内部串行队列)→ `document.fonts.ready` → **canvas 2x 光栅化** → `{ pngBuffer, widthPx, heightPx }`。③ docx 嵌 PNG 逻辑 1x 像素 2x(`transformation` 两值必须同时给),**不用 SVG 嵌入**(Word 2019+/M365 才渲染 + docx #3227);pdf 端 SVG 直接内联。④ 降级:`parse(suppressErrors)` 失败或超时/崩溃 → 输出等宽代码块原文 + warning(不中断)。⑤ `securityLevel:'strict'`(loose 有 CVSS 7.6 存储型 XSS 先例)+ CSP `default-src 'none'; img-src data:` 断网。⑥ 坑:maxTextSize 默认 50000;ELK 已拆包。⑦ 不做:mermaid-cli、Kroki(违反离线卖点)、resvg-js、jsdom。
- **来源/验证**:@librarian lib-1 + @explorer exp-1;**关联**:`docs/archive/20260813-193532-mermaid集成方案.md`。

### 2026-08-08 11:50:33 管线勘察(TOC/题注编号现状事实)
- **结论**:① docx 原生 TOC 域已存在(`\o "1-3" \h \z \u`,占位「右键 → 更新域 生成」),**无条件插入、无开关** → 8a = 开关化(`toc?: boolean`)+ 题注不得被 TOC 收集(需 `\b`)。② 章节编号是 **numbering 静态渲染非域**,打开 Word/WPS **无需 F9**;OOXML 引擎管理多级计数、**代码无计数器变量** → 题注拿不到当前章节号。③ 题注两路线:(a) STYLEREF+SEQ(需更新域);(b) 静态注入章节号 + SEQ 仅担图序号(免 F9,重排不自动更新)。④ **无 caption 语法**(mdast 无 figure/figcaption),题注需自定义识别 + 文档级计数 ctx;PDF 侧用 CSS counter 伪元素,目录 `buildTocHtml()` 从渲染后正文正则提取 h1-h3。⑤ 新增设置字段仿 `breakBeforeH1` 放 AppSettings 顶层,同步 SETTING_KEYS + sanitize + renderer 平行类型。
- **来源/验证**:@explorer exp-1(验收 = 段文件零注册自动发现,docx 断言 zipContains + OOXML 片段匹配,PDF 断言 .html 字符串匹配);**关联**:`docs/archive/20260808-1123-批次8管线勘察.md`。

### 2026-08-08 10:20:16 公式链路(@librarian + 实测,勿回退)
- **结论**:① docx@9.x 原生 OMML:Math/MathRun/MathFraction/MathRadical/MathSuperScript/MathSubScript/MathSubSuperScript/MathFunction/MathSum/MathIntegral/MathLimit/MathRoundBrackets,**无需注入原始 XML**。② KaTeX 字体:`katex.min.css` **必须与 fonts/ 同级**;`file://` 下 @font-face 相对路径可用,**data: URL 全失效** → 构建期复制 css + 21 个 woff2(~400KB,删 ttf/woff)。③ printToPDF 头号坑 = 字体时序,须 `executeJavaScript('document.fonts.ready')` 再打印;必须 `printBackground:true` + `print-color-adjust: exact`;display 公式超宽不换行。④ KaTeX `output:'mathml'` → 自研 walker → docx Math 树,覆盖 ~10 种节点,**无需自研 TeX 解析器**;未覆盖/报错 → TeX 源码等宽输出 + warning(红线兜底)。
- **来源/验证**:@librarian lib-2;**关联**:`docs/archive/20260806-2229-批次6公式链路调研.md`。

### 2026-08-05 22:22:19 脚注(已验证)
- **结论**:① PDF 侧 `@mdit/plugin-footnote@^1.0.2`(peer ^14.2.0),锚点 footnote-N,重复引用编号 [2]/[2:1];**Chromium 不支持 `float: footnote`,脚注集中在内容末尾(非页脚)—— 通用行为差异,验收预期**。② docx 侧零新依赖:Document 级 `footnotes: Record<id, { children: Paragraph[] }>` + `FootnoteReferenceRun(id)`,**只挂 Document 级、不在 section 级**。③ 全局递增计数器统一编号(勿按文件重置),嵌套引用递归且共用计数器,重复引用按次数编号(与 markdown-it 对齐)。④ **语法不对称**:内联 `^[...]` 只有 PDF 支持,remark 侧无对应节点。
- **来源/验证**:@librarian lib-2;**关联**:`src/core/{pdf,docx}/render.ts`、`docs/archive/20260805-2212-脚注实现调研.md`。

### 2026-08-04 20:57:34 批量/合并(已验证)
- **结论**:① 批量队列并发 2,失败不中断逐条汇总,跳过 runAfterConvert(防打开 N 个文件),进度 `batch:progress` { index, total, file, stage }。② `mergeMarkdowns(files:{content,baseDir}[])` 纯逻辑:首文件保留 frontmatter、后续剥离;图片相对路径 → 绝对(保留 title);`<!-- page-break -->` 拼接;空文件跳过;合并后走单文档渲染 → 封面/全局 TOC 自动成立。③ 输出 `{首文件名}-合并.{ext}`;imageResolver 跨文件共享(模块级 Map);`collectMarkdown` 递归收集(跳过点开头目录,seen 防符号链接循环)。**坑**:JSDoc 内 `**/*.md` 含 `*/` 提前终止注释 → 后续当代码解析(TS1109)。
- **来源/验证**:自查 + fixer/designer 实现;**关联**:`src/core/pipeline/merge.ts`、`src/main/{index,preload.cts}`。

### 2026-08-03 23:14:13 spike 与实测(已验证,勿回退)
- **结论**:① **SimpleField 不行**(fldSimple 仅行内;ComplexField 已移除),用内置 `TableOfContents`;降级 `cachedEntries` 须自行注册 TOC1-9 样式,`length<=1` 会补空段落。② printToPDF **保留页内锚点为可点击链接(含跨页)**(Link 注释 + `/Dests`,非 /GoTo)→「无页码+锚点」目录成立。③ **分页空白页**:`break-before: page` 相邻不合并,分页符后紧跟 h1 产生空白页 → 无条件 `.page-break + h1 { break-before: auto; }`。④ **Electron 43 ESM 主入口**:顶层 `await app.whenReady()` 挂起不退出,必须 `.then()` 链;直调 `node_modules/.bin/electron.cmd`(npx 触发网络检查)。⑤ pdf 外链图:并发 3 下载 → data URL 内嵌,失败留原 URL + 警告;`createImageResolver` 带 10s AbortSignal + 同 URL 去重。
- **来源/验证**:fix-5/7/8/9/10 终态结论 + 自查实测;**关联**:`src/core/{frontmatter,convert}.ts`。原文存档 `20260803-2311-批次2-spike与实现结论.md` 已于 2026-08-15 删除,结论以本条为准。

### 2026-08-03 21:46:27 docx/pdf 排版控制(已验证,勿回退)
- **结论**:① landscape 时**库自动交换 width/height 写入 pgSz**,应传原始(纵向)值,手动交换会双重交换致宽高反。② 无 `IParagraphOptions.bookmarks`,标题书签用 `Bookmark` 组件包裹 runs。③ mdast `Data` 空接口,标题 id 需 `declare module "mdast"` 合并,消费端读 `node.data?.id`。④ markdown-it heading_open 的 `content` **恒为空**,纯文本在 `tokens[idx+1].content`。⑤ 原子写 = 临时文件 + rename(Windows 可覆盖),整文件形状校验失败整体回退默认。
- **来源/验证**:自查 + fixer/designer 实现;**关联**:`src/core/{slug,parse,convert}.ts`、`src/main/persist/settings.ts`(旧路径见头部注记)。

## 依赖与工具链

### 2026-09-26 21:14:55 TS7 native 有语法错误时跳过全程序语义诊断(勿回退)
- **结论**:程序内存在**任一语法错误**时 `tsc` **跳过语义诊断** → 「输出为空」可能是假绿,验收须**双编译器交叉**(TS7 CLI + TS6 API 探针)。`.js` 中 `!` 触发 TS8013,测试树禁用 `!`,改 `@returns {asserts cond}`。
- **理由**:单编译器单次输出的「空」不足以判绿,与「第一轮过、第二轮挂」的假绿同族。
- **来源/验证**:REF-001 实测(本文件全部 `2026-09-26 21:14:55` 条目同此出处,#14 承接自 campaign「待升 RESEARCH」段,台账快照 `docs/archive/20260926-211455-全库优化计划与执行台账.md`):注入语法错误后该轮只报语法错误,换 TS6 探针语义诊断复现;**关联**:`tsconfig.test.json`、`npm run typecheck`。

### 2026-09-26 21:14:55 eslint `maximumDefaultProjectFileMatchCount` 是性能护栏
- **结论**:达上限整体报 `Too many files`,**再加任一 `.js/.mjs` 就把 lint 打成一片红**;本仓已由 200 提到 300。该上限只管解析成本、不表达类型正确性。
- **理由**:撞上限时的红是噪声,会被误读为新增代码有类型问题。
- **来源/验证**:REF-001 实测:新增 `.mjs` 前后各跑一次 `npm run lint` 对比;**关联**:`eslint.config.mjs`。

### 2026-09-26 21:14:55 裸跑 build 不回收已删源输出,`clean:dist` 须删 `*.tsbuildinfo`
- **结论**:tsc 增量**不回收已删/重命名源的输出**,而 `gen:dist-manifest` 只是快照、发现不了陈旧 → 判新鲜度须走 dist 链或先 `clean:dist`;`clean:dist` **必须连带删根目录 `*.tsbuildinfo`**,否则 clean 后 build 几乎不产出文件。
- **理由**:「clean 了但 build 没产物」与「build 通过但含陈旧文件」两种假象都会让门禁失去判据。
- **来源/验证**:REF-001 实测:删源文件后裸跑 build 仍留旧产物,`clean:dist` + build 后消失;**关联**:`package.json` 的 `clean:dist`/`build`/`gen:dist-manifest`。

### 2026-09-25 E5 双配置 typecheck 的 CI 顺序依赖(3.11.8 发版踩坑)
- **结论**:test 树 typecheck 编译期 import `dist/**` → 全新工作区必须先 `npm run build` 再 typecheck,否则批量 TS2307 且未标注文件连带 TS7006;本地因常驻 dist 不复现。E5 按 `// @ts-check` 渐进启用(checkJs:false),相对路径 import `../../dist/...` 无法经 tsconfig paths 重映射 → 正解是**顺序修复**,不做路径改造。
- **来源/验证**:3.11.8 首次发版 Release 与 CI 双失败(TS2307);E5 当时仅本地验证未跑远端 CI 即随批推送;修复 = 三条 workflow build 先行(`d75fe3f`)。

### 2026-08-24 审计整改记录(依赖钉死策略清单 / highlight.js styles 潜伏副作用)
- **钉死清单**:`markdown-it 14.3`(15.0 与 tasklist@1.0.2 peer ^14.2.0 冲突)、`@mdit/plugin-footnote 1.0.2`(peer ^14.2.0)、`mermaid 11.16.1`(依赖 dist IIFE 规避 CORS)、`electron-builder 26.15.3`(27 alpha 不用)、`docx 9.x`(major 升级须全量回归);「勿回退」标注以 `AGENTS.md` 为准。**highlight.js 两条同族事实**:① `lib/common` 经 exports map import 条件解析到 `es/`,**`es/` 不可排除**(否则 ERR_MODULE_NOT_FOUND),`styles/` 可排除;② 排除 `styles/` 后若代码 import 主题 CSS,dev/smoke 正常但**打包后静默 404**。
- **来源/验证**:全库审计整改批(2026-08-24);**关联**:`docs/archive/20260824-134811-审计待办清单.md`(ENG-8/ENG-9)、本文件 G5 条目。

### 2026-08-16 11:45:20 文档加密调研(已明确不做)
- **结论**:① **docx 9.7.1 不支持加密**(密码保护非 OOXML 标准,是 MS 专有 Agile/Standard Encryption;dist 搜 encrypt/password 零匹配)。② 替代 `officecrypto-tool 0.0.19`(ECMA-376 Agile AES-256/SHA-512,`officeCrypto.encrypt(buffer,{password})`,CJS 老库需验 ESM 默认导入);`office-crypto 0.1.0` 未完成;`ooxml-encryption` 仅 xlsx。③ **pdf-lib 1.17.1 不支持写加密**(仅 isEncrypted 检测 + ignoreEncryption),printToPDF 无加密选项 → 须 `qpdf`,顺序固定 printToPDF → 书签 → 元数据 → **加密最后一步**。**处置**:确认**不做**,留档备查。
- **来源/验证**:@librarian lib-1;**关联**:`docs/archive/20260816-114520-文档加密调研.md`。

### 2026-08-14 20:16:22 模板导入方案选型
- **决策**:**预设 JSON 导入/导出**(复用 `sanitizeCustomPresets`,零新依赖);CSS 模板覆盖次选。**关键事实**:预设 = 纯数值快照(typography+pageSetup),渲染只认最终字段;pdf CSS 全在 `template.ts` 字符串(需防用户 CSS 破坏 `.page-break`/`breakBeforeH1`);docx 不消费 CSS。**docx 深导入不做**:9.x 仅 `patchDocument`;docx4js 3.3.0 停更 + OOXML 逆映射工程量大。**格式** `{schemaVersion:1, presets:[{name,typography,pageSetup}]}`,同名覆盖、上限 10 截断。
- **来源/验证**:@librarian lib-1 + @explorer exp-1;**关联**:`docs/archive/20260814-201622-模板导入方案.md`。

### 2026-08-14 18:51:13 双方向探索方案
- **结论**:方向 A 界面体验(用户已选)20 问题 + 12 候选,关键缺陷 = **拖放区点击=替换整表但文案声称追加**、**设置面板展开后转换按钮/进度被推出 640px 视口**、**模板预设埋在第二折叠面板**;本批做 Phase 0 速赢,C1 = 多文件态追加、单文件态更换。方向 B(存档):tsconfig 4 开关 + mermaid-service 降级测试(199 行 vs 34 行,最高回归风险)+ settings-panel 纯逻辑抽取。**工具链**:c8 12.x/nyc 18/eslint 10/knip 6 全要求 Node 20.19+(Node 18 已 2025-04 EOL,需锁 c8 10.1.3/eslint 9.39.x);eslint 10 起 flat config 唯一;depcheck 停维护(推荐 knip)。
- **来源/验证**:@designer + @oracle + @librarian + @explorer;**关联**:`docs/archive/20260814-185113-双方向探索方案.md`。

### 2026-08-23 B10a 工程基建两坑
- **结论**:① **`dist/renderer` 是混合目录**(tsc 产物 + 拷贝的 html/css 同居),加 clean 时**不可整目录 rmSync**(会致 acceptance 2 段 ERR_MODULE_NOT_FOUND),只能按扩展名清 `.html/.css`。② **tsc incremental 不检查产物存在性**,输出被外部删除仍跳过重编译(幽灵缺模块),恢复须 `npx tsc --build --force`(单用 `--force` 报 TS5093)。
- **来源/验证**:acceptance 2/40 失败 → build 复现 → force 恢复;**关联**:原 ROADMAP B10。

## Electron 主进程与安全

### 2026-09-26 23:20:00 「等固定时长」不是同步:fire-and-forget 写必须用 drain(勿回退)
- **结论**:① 迁移写是 **`void` fire-and-forget**(`void writeSettingsJson.enqueue(...)`),**外部无法通过「等够久」确认落盘** —— 放弃等待后写仍可能**迟到落盘并覆盖等待期的新写入**;真实故障:等 100ms 到点放弃 → 下一小节覆写 → 上一小节结果迟到落盘盖掉它 → 读到陈旧内容判红。② **正解是 drain**:写入器暴露 `drain()`(队尾空事务),resolve 即代表此前所有写(含重试)已结算;单次写失败不截断队列,故有失败写时同样 resolve;测试 `await` 它取代固定预算轮询,**退出路径也必须 drain**(否则未落盘的写随进程丢掉 = 真实产品缺口)。③ **rename 重试是放大效应非成因**:重试把「快速失败」变成「可能百毫秒后成功落盘」,**扩大**迟到覆盖窗口;根因仍是同步方式本身不成立。
- **来源/验证**:2026-09-26 CI 连续两次同段失败、两种错误;逐段核对 `[ok]` 进度定位「第一轮过、第二轮(覆盖率那轮)挂」;修复 `48594f0`;**关联**:`src/main/persist/atomic-json.ts`(`JsonWriter.drain`)、`settings.ts`(`whenSettingsIdle`)、`src/main/index.ts`(`window-all-closed` 前 drain)、`test/main/{atomic-json,settings}.test.js`。**加 drain 时须核查其他使用方**(`ui-state` 共用)。

### 2026-09-26 21:14:55 Windows `rename` 覆盖被读句柄占用的目标必 EPERM,须有界退避
- **结论**:**必然 EPERM**(杀软/索引器/云同步随手一握即触发,实测确定性),一次瞬时占用即丢整次写 → 须补**有界退避重试**(仅 EPERM/EBUSY/EACCES 族)。**代价**:重试**扩大** fire-and-forget 写的迟到覆盖窗口(根因仍是同步方式,见上条 drain)。
- **理由**:不重试则丢整次写,重试则放大另一类窗口,两者须靠 drain 收敛,不能只做其一的补偿。
- **来源/验证**:REF-001 实测,修复 `504870a`;测试以「cwd 切进目标子目录」造稳定占用(见下条);**关联**:`src/main/persist/atomic-json.ts`、`test/common/temp-resource.js`。

### 2026-09-26 21:14:55 显式落盘顺序:内容 → 文件 fsync → rename → 父目录 fsync
- **结论**:顺序固定;**缺文件 fsync 时断电可得 0 字节配置**,读回整文件回退默认 = 用户全部偏好**静默**归零(无提示无备份)。
- **理由**:回退默认是静默的,原子写链上任何一环缺失都直接表现为用户偏好归零而非报错。
- **来源/验证**:REF-001 实测:逐环去掉 fsync 模拟中断,读回得 0 字节/旧内容/新内容三态;**关联**:`src/main/persist/atomic-json.ts`。

### 2026-09-26 21:30:00 Electron 门禁入口的三条失败路径(与直觉相反,勿回退)
- **结论**:① **`app.quit()` 不吃 `process.exitCode`** —— 实测设 1 后调 `app.quit()` 真实退出码 **0**,抛错后同样 0 → **失败被判绿**;要显式码必须 `app.exit(code)`。纯 Node 脚本里 `process.exitCode` 正常,这条只针对 Electron 主进程。② **加载期抛错进程内无解**:ESM 主模块 loader 只打 `App threw an error during load`、**不退出**;且 ESM 在**任何求值之前**先完成模块图 linking,「静态 import 解析不到/缺导出」发生在守卫自己被加载之前 → 只能把入口静态导入面压到最小(node 内建 + electron + 守卫),业务依赖全动态 import;`M2W_ENTRY_LOAD_TIMEOUT_MS` 看门狗兜「载荷既不完成也不报错」。③ **`.then()` 回调内抛错只降级为 `UnhandledPromiseRejectionWarning`、进程照活**(Electron 不采用 Node 默认 `unhandled-rejections=throw`);`await app.whenReady()` 在 async 函数体内亦然,与「顶层 await 挂起」是两个坑。
- **来源/验证**:2026-09-26 实测(每条真起 Electron 子进程验退出码);修复 `test/common/entry-guard.mjs`(`decideEntryExit` + `runEntry`,五入口共用,失败一律非零);**已知残余**:`session-persist-feedback` 段会 `removeAllListeners("unhandledRejection")` 摘掉兜底。

### 2026-09-26 20:10:00 Windows/Electron 三条易踩实测事实
- **结论**:① **打开的文件句柄不阻止删除**(libuv 用 `FILE_SHARE_DELETE`,`rmSync` 照样成功)→「开句柄造 EBUSY」在 Windows 上是**假的**,能稳定造「删不掉」的是**把 cwd 切进该子目录**(`process.chdir()` 必 EPERM,node 与 Electron 均实测)。② `Buffer.compare` 返回 -1/0/1 的 **memcmp 大小关系,不是首个差异下标**。③ **Electron asar 虚拟 fs 接管任何含 `.asar` 的路径**:`writeFileSync`/`openSync+writeSync`/`rename`/`copyFile` 一律抛 `Invalid package`,连读也走归档解析;测试须临时 `process.noAsar = true` 或交给纯 node 子进程。
- **来源/验证**:2026-09-26 实测(node 与 Electron 双侧);**关联**:`test/common/temp-resource.js`(占用锚点改为切 cwd)、`test/common/assert.js`(`firstByteDiff` 不得复用 `Buffer.compare`)。**符合晋升全局 `ENV-GUIDE.md`「一、Windows 平台坑」条件,是否晋升由用户定。**

### 2026-08-08 12:16:09 修复期踩坑(已验证,勿回退)
- **结论**:① **每个转换入口必须独立复位 `cancelRequested`**(单文件 / 批量 `batchConvertImpl` 开头 / **合并自己函数开头**),缺失则二次转换被 `throwIfCanceled` 误判「已取消」。② **进度上报逐入口接线**,合并最初缺失 → 进度条停在 0%。③ **printToPDF 是原子调用不可中断**,取消检查点须放在**打印完成后落盘前**(取消则不产文件、不注书签、不报成功)。④ 取消分支依赖 handler 返回 `{ ok:false, canceled:true }`,否则弹「转换失败」。⑤ **smoke 自清理产物**(重名保护后残留旧产物不再被覆盖 → 断言因 (N) 序号变体失败),Windows EBUSY 容错跳过。
- **来源/验证**:自查(用户实测反馈驱动),修复 `524cdf2`/`fd40480`/`f809c57`。

### 2026-08-08 11:19:01 体验优化(已验证,勿回退)
- **结论**:① **编码预检**:`TextDecoder("utf-8",{fatal:true})` 判定合法性,失败按 iconv-lite **gb18030** 解码(**gb18030 是 GBK 超集,GBK 无损**);UTF-8 BOM(EF BB BF)与 UTF-16LE BOM(FF FE)嗅探剥离;Node 原生不支持 GBK。② **重名加序号** `名 (2).ext` 绝不覆盖;Windows 路径 **>250 字符回落源目录并警告**(MAX_PATH)。③ `outputDir` 空串 = 源文件同目录,非空须绝对路径(相对视为非法),创建失败回落并警告。④ 取消链路:`convert:cancel` → 置标志 → 检查点抛 `ConvertCanceledError` → `{ ok:false, canceled:true }`;批量未开始项记 canceledCount。⑤ 批量后按 `afterConvert` **仅对首个成功项执行**。
- **来源/验证**:自查(typecheck/build/验收全绿);**关联**:`src/core/encoding.ts`;原文存档 `20260808-1029`/`-1030`/`-1031` 三份调研。

## 渲染层与 UI

### 2026-08-25 功能开发技术路线调研(目录带页码 / 模板导入)
- **F9**:npm 无现成库读任意 .docx 套样式;Pandoc `reference-doc` 是部件级搬运,坑多(#1305 numId 断链 / #9522 settings 整搬损坏)→ **浅导入 v1**(jszip 读 styles.xml 关键 rPr → 映射 theme.ts/settings,3-5 天)。**F7**:Word TOC 域 + updateFields 打开必弹提示(不可关闭,docx #1212),WPS 可能不响应;docx 静态页码不可行(OOXML 无 page 实体)→ **混合路线**:pdf 两遍法静态页码(占位等高 + PDF.js 文本定位;Typora 单遍流做不到 = 独占差异化)+ docx 默认静态目录、opt-in 域目录(cachedEntries 预填防空白)。**已拍板**(2026-08-25):F7 混合、F9 浅导入 v1,决策记录见 `docs/adr/ADR-007-目录带页码混合路线.md` 与 `docs/adr/ADR-008-模板导入浅导入.md`(索引在 `docs/ADR.md`)。
- **来源/验证**:@librarian + 用户拍板;**关联**:`docs/archive/20260825-182036-功能候选调研与迭代排期.md` 第六节。

### 2026-08-25 18:20:36 功能候选调研与迭代排期(2.0.0 后新阶段)
- **结论**:五大高频痛点(格式/公式/Mermaid/高亮/批量)已解决;剩余缺口 = 页眉页脚自定义(V2EX #1098305「交付全家桶」最后缺口)、水印(GUI 竞品空白)、转换预检报告(零竞品)、合并+总目录(手册场景真空)。**架构扩展点**:docx handlers switch、pdf rules 数组、CROSS_REF_KINDS 表驱动、ConvertContext 只增不改;但**双管线有意不合并**(remark/mdast vs markdown-it),新语法双侧各实现一次。**拍板 9 项**(含**推翻 D1 免更新路线**);两项待调研项结论见上一条。
- **来源/验证**:@explorer + @librarian + 用户选型;**关联**:`docs/archive/20260825-182036-功能候选调研与迭代排期.md`、`docs/archive/20260814-201622-模板导入方案.md`。

### 2026-09-25 17:43:34 竞品功能矩阵二轮调研
- **结论**:三个活跃开发候选(登记见 `docs/ROADMAP.md`「候选区」)—— ① **模板深导入**(reference.docx/.dotx 样式全量映射,竞品验证付费点,价值升「高」)② **docx 导入回 Markdown 含修订读回**(Pandoc `--track-changes` 等价,少有成熟实现)③ **中文排版包深化**(字号制/中英混排/智能首行缩进,竞品均为半成品);另:原生公式 + Mermaid 降级、剪贴板热键插入光标处(PasteMD)为高价值可选项。竞品高价值集中在保真度/模板化/剪贴板工作流/中文排版四带。
- **来源/验证**:@librarian + @explorer 并行;**关联**:`docs/archive/20260925-174334-竞品功能矩阵调研.md`。

### 2026-08-08 11:19:01 功能扩展调研要点
- **结论**:**Mermaid 从加分项变标配**;WPS 用户群被单独服务,docx 输出必须过 WPS 兼容关(见 `docs/WPS-COMPAT.md`);中文排版(eastAsia)是全赛道短板(Pandoc 3.2.1 才加 `w:hint="eastAsia"` 且中英引号仍有 bug)→ 护城河成立。
- **来源/验证**:@librarian lib-1;**关联**:`docs/archive/20260808-1030-功能扩展调研.md`。

### 2026-08-08 11:19:01 易用性调研要点
- **结论**:中文特有坑 = GBK/GB18030 转码(Node 原生不支持,需 iconv-lite)、MAX_PATH 260 预检(>250 回落)、UTF-16/ANSI 乱码文件名。**基准**:SUS 68 分 = 50 分位;任务完成率行业均值 78%、目标 ≥90%;点击数 ≤3;启发式走查 3-5 人可发现约 75% 问题。
- **来源/验证**:@librarian lib-2;**关联**:`docs/archive/20260808-1031-易用性调研.md`。

## 代码结构与架构

### 2026-08-24 02:26:55 目录结构评审(P1/P2 已落地)
- **结论**:三层分离与 core 分域执行一致,handlers↔rules 粒度对称;问题仅两类。**P1 契约归位(已完成)**:`ConvertProgressPayload`/`ConvertMode` 与 `UiState`/`RecentFile` 曾被 renderer type-only import(1+3 处)构成反向依赖 → 新建 `core/ipc-contract.ts`(含 Batch 三类型),仅 PreloadApi 维持实现推导。**P2 test 归位(已完成)**:4 段直测 dist/main → `test/main/`,2 段 → `test/renderer/`(acceptance.mjs 扩第三发现根);**口径冲突已由用户裁定关闭**(技术债 D4/D5):采「全量镜像三层」。**确认不动**:pipeline/merge(纯函数)vs converter/merge(IO)同名分层正确;i18n/settings 三处;image-downloader 属 main。
- **来源/验证**:@oracle ora-1(全量结构 + 约 20 文件头部核实);**关联**:`docs/archive/20260824-022655-目录结构评审.md`、`docs/archive/20260823-230554-目录结构优化方案.md`。

### 2026-08-23 23:05:54 目录结构优化方案(已实施)
- **结论**:重组前约 70% 接近理想,欠账 6 项:core 根级 20 文件平铺、`core/i18n.ts` 702 行(字典 ~585 行混逻辑,引用 ~20 src + 测试 31 处)、`renderer/events.ts` 607 行单闭包混 6 事件域、`main/index.ts` 695 行、`main/converter.ts` 524 行、core/docx 缺 handlers 层。**关键事实**:i18n EN 字典 `Record<keyof typeof ZH,...>` 编译期锁键集 → ZH/EN 必须同文件;`pdf/rules/` 存在因 markdown-it 可覆盖规则,docx 走 mdast 无规则层、对应物是 handlers/(不对称有技术原因);core 根级均为纯 ESM,移动 = 只改相对 import;唯一测试联动 contract-single-source.test.js。**批次**(全绿后逐批提交,已全部完成):①i18n+core 归组(~90 处 import)②docx handlers ③renderer 功能域+events/style ④main/index 抽取(先收敛 ctxByWebContents)⑤converter 拆分+smoke 迁移。
- **来源/验证**:@explorer exp-1 四轮探查 + 用户裁定;**关联**:`docs/archive/20260823-230554-目录结构优化方案.md`。

### 2026-08-11 20:11:45 src 架构审查(H1-H3 已落地)
- **结论**:分层正确,问题集中在「契约重复」与「单体文件」;双管线平行实现是选型代价,**维持「契约常量共享 + 测试锁定」,不合并**。**H1** 内联 HTML 白名单 docx/pdf 逐字复制两份 → 抽 `core/markdown/html-whitelist.ts`;**H2** 契约类型/默认值三处重复 → 改 `import type`(编译期擦除,不违反 contextIsolation)+ DEFAULT_SETTINGS 下沉 core;**H3** docx 图片固定 400×300 拉伸 → Buffer 解析尺寸按比例缩放,webp 降级占位。**中优先级**:merge 图片正则截断含括号 URL、renderPdf 临时 HTML 无随机后缀(并发同毫秒竞争)、currentCtx 全局变量多窗口串台、`settings:set` 并发写丢更新。**拆分**:`style.css` 不值得拆(级联风险 > 收益)。
- **来源/验证**:@oracle ora-2;**关联**:`docs/archive/20260811-201145-src架构审查.md`。

### 2026-08-23 13:30:05 全库质量审计(已全量闭环)
- **结论**:core(28 文件 ~4440 行)top:convert⇄render 循环依赖、`headingNumbering=false` 题注编号双格式分歧、frontmatter 误吞 `---` 开头正文(无已知 key 守卫)、图片 resolver 无 memo、四组人肉同步契约(CROSS_REF_KINDS / sec-label 正则 ×4 / ImageResolver ×3 / 白名单双扫描器)、悬空引用警告不去重、slug 40 字符截断致书签碰撞、pdfCss/KaTeX CSS 未净化 `</style>`(配合无 CSP 预览窗成真实注入面)。main/renderer:无单实例锁、关窗时转换无拦截、无 unhandledRejection 兜底、预览/打印模板无 CSP。**正面确认(不动)**:安全基线、原子写+写队列、per-call 取消、aria/焦点、fixtures 单源。
- **来源/验证**:@explorer×3 深审 + 抽查;五批 24 项已于 2026-09-25 全部完成;**关联**:`docs/archive/20260823-133005-全库质量审计.md`、`docs/archive/20260925-130122-技术债处置计划.md`。

### 2026-09-25 00:47:12 四路代码分析盘点(已闭环)
- **结论**:无阻塞缺陷(契约单源/安全基线/恒等守护突出);①双管线平行 + 警告去重/hljs 配色多处双源(**仅测试护栏,标「勿动」不合并**)②GUI 超 500 行三文件(book-wizard 967 / settings-bindings 710 / settings-panel 560)、`about:open-external` 游离 IPC、关于窗 sandbox:false 全仓唯一 ③覆盖率无门槛不进 CI + G1-G9 缺口、smoke 硬编码断言有 flaky 风险 ④lockfile 版本漂移(当场修复 + release.yml 三方校验门禁)与文档状态矛盾。**处置**:分 A~E 五阶段,**五批 24 项全部完成(2026-09-25)**;C4 拍板「1a 最小注入」、E2「仅动等待,计数全保留」。
- **来源/验证**:4 个 explorer 子代理并行;**关联**:`docs/archive/20260925-004712-代码分析四路盘点.md`、`docs/ROADMAP.md`(处置记录现落「候选区」)。

## 测试与门禁

### 2026-09-26 22:48:00 覆盖率四指标有 ±0.01pp 的环境间抖动,「逐位不变」不是可达判据
- **结论**:同一份代码、同一份 `dist`,四项覆盖率在 **CI 与本机之间有 ±0.01pp 的差异**:2026-09-26 三次实测里 CI 两轮都是 `93.06 / 89.08 / 93.59 / 93.06`,本机两轮都是 `93.06 / 89.07 / 93.59 / 93.06`(差在 branch,2725/3059 分支)。**同一环境内多次跑是稳定的**,跨环境才抖。所以拿覆盖率当回归判据时,判据必须写成「无方向性下降 + 差异落在运行间抖动内」,**不能写「逐位相同」** —— 后者在实践中不可达,会逼着人把真实回归当成噪声放过。
- **来源/验证**:REF-018(删掉门禁链内对覆盖率零贡献的裸跑遍)落地后的前后对照;前一条已记录「覆盖率会静默少算」是**另一个**触发器(段集合/段顺序变了 → c8 临时目录被内层 c8 清空),两者别混:那一条会让某文件**掉到 0**,本条只在末位小数上动。**关联**:`docs/ADR.md` ADR-016、`package.json` 的 `test:coverage` 阈值、`scripts/gate-probes/gates/coverage.mjs`。

### 2026-09-26 21:46:00 c8 + Electron:二层探针进程在退出路径回写覆盖,退出码被 0xC0000005 顶掉
- **结论**:① c8 12 **只注入 `NODE_V8_COVERAGE` 一个变量**(无 spawn-wrap、无 `NODE_OPTIONS`);Electron 43 主进程认它,且在 `app.exit` 与 `process.exit` **两条**退出路径都回写覆盖 JSON —— 「立即退出」不等于「跳过回写」。② 触发形态:一个**活着的 Electron 主进程**(Chromium 主循环/GPU/utility 线程仍在)在退出期回写覆盖时撞上 Electron 拆卸,Windows runner 上以 `3221225477`(`0xC0000005` 访问冲突)终止,**诊断文本已完整落盘、只有退出码被顶掉**,于是「入口失败应退 4」「崩溃段应上报 7」这类**以退出码为唯一证据**的断言以与被测行为无关的方式判红。③ 只有**二层**子进程会中(段内嵌套编排派生的夹具进程、入口探针进程):顶层段的 `app.exit` 发生在 app 稳态之后,同轮 116/118 全绿;全仓唯一的 Electron 内无条件 `process.exit()` 在 `runner-report` 的崩溃夹具 → 它 2/2 中,`app.exit(4)` 变体 1/2 中(两个不同概率,不是同一处随机)。④ **轮次差是唯一分辨维度**:同一 commit 同一台 runner,`npm run test` 轮全绿、只在其后的 `test:coverage` 轮炸(覆盖写手只在该轮存在);与压力/资源无关(两轮段耗时同量级),本机全量复现不了。⑤ 修法:覆盖采集环境**不下传给二层子进程**,判据取「父进程自身是段宿主」(`M2W_SEGMENT_FILE` 存在);顶层段的采集不受影响,二层夹具不执行 `dist/**`、对覆盖汇总零贡献,四项覆盖率无方向性下降(数值以 `npm run test:coverage` 输出为准)。
- **勿回退**:「顶层 harness 专属 env 不下传」现有成员为 2 个 —— `M2W_ONLY`(无条件剥)与 `NODE_V8_COVERAGE`(**仅嵌套编排剥**)。若将来新增的嵌套编排**会执行 `dist/**`**,必须在 `runSegmentIsolated` 该分支显式保留采集,否则是**静默少算覆盖率**(与本仓已记的「覆盖率会静默少算」同族,比崩溃更难发现)。退出码断言不得为绕开本条而放宽:`runner-report` 的「父进程原样上报子进程退出码」是该契约唯一的端到端验证。
- **来源/验证**:2026-09-26 GitHub Actions 两轮(commit 48594f0 与 2f074ee,连续两轮 `verify:ci` 判红、每轮换一个段)。**判据是「触发条件消失」而非「症状不复现」**:本地对照跑证明二层 spawn 增加 11+ 个时 `coverage/tmp` 份数只随段数增长(不随二层进程增长)→ 二层子进程已不注册覆盖写手;本机全量 `test:coverage` 修复前后均 118/118 通过。crashpad/WER 未取到,崩点具体位置属推测。**关联**:`test/common/runner.js`(`runSegmentIsolated` 的 env 下传边界)、`test/common/entry-guard.mjs`(默认退出实现)、`test/segments/runner-report.test.js`(崩溃夹具)、`test/segments/entry-exit-guard.test.js`(入口探针 spawn);`scripts/gate-probes/gates/coverage.mjs`(子 c8 **显式指定自己的** `NODE_V8_COVERAGE` 目录,不依赖外层环境,故不受本条影响)。原文:`docs/archive/20260926-214428-二层Electron探针崩溃归因.md`。

### 2026-09-26 21:30:00 测试框架的「选择面」与「发现面」是两个语义
- **结论**:`M2W_ONLY` 同时被两件事消费 —— 「本轮跑哪些**顶层**段」与「段内 `discoverSegments` 能发现哪些段」。旧实现里 `discoverSegments(dirs)` 无条件读 `process.env.M2W_ONLY`,而段宿主把 `...process.env` 整包传给子进程 → **顶层筛选词跨进程渗进段内**:段自测的沙盒前缀 `segments/xxx-selftest/` 被外层 `M2W_ONLY=segments` 命中零个 → 发现面被滤空。**滤空发生在发现层,不是执行层**。**长期没暴露**:按段名前缀筛(如 `M2W_ONLY=runner-report`)恰好不触发(它是沙盒名前缀的子串),且 CI 全量跑不设该变量。
- **来源/验证**:2026-09-26 实测(按目录筛时某段报「应执行 N 个沙盒段,实际 0」);**关联**:`test/common/runner.js`(`resolveOnlySelection` 三态契约:未声明 = 读 `M2W_ONLY`、显式 `null` = 不筛选、字符串 = 按词筛;`runSegmentIsolated` 从子进程 env 删除该变量)、`test/segments/runner-report.test.js`。**遗留**:`fixture-contract.test.js` 手工 `delete` 再复原,属打补丁。

### 2026-09-26 20:10:00 renderer 测试段的元素 stub 契约(易致假红)
- **结论**:`test/renderer/**` 各段自带**极简元素 stub**,非统一实现。例:`wizard-command-guard.test.js` 的 stub 有 `setAttribute` 但**没有** `removeAttribute`/`getAttribute`/`offsetWidth`,`querySelector` **恒返回 null**;被测代码新增此类调用即在段内抛错,表现为**与真实缺陷无关的断言失败**(一次 `removeAttribute('aria-busy')` 让「两格式应依次执行两次合并」报成 `mergeCount === 1`)。Node 侧**全局 `HTMLElement` 不存在**,**不得用 `instanceof`** 判类型,须鸭子类型。
- **来源/验证**:2026-09-26 本轮 renderer 段实测(一次 `removeAttribute('aria-busy')` 触发与业务无关的假红)。
- **关联**:`src/renderer/ui/dialogs.ts`(aria-busy 显式写回 `"false"` 而非摘除属性,正为规避此坑)、`src/renderer/state/utils.ts`。**新增 DOM 接口调用前须确认所在段 stub 提供了该成员。**

### 2026-08-15 14:40:57 代码/测试/文档组织形式审计(缺口已全闭)
- **结论**:12 项可调点(高收益低成本 4 项:README mermaid 条目重复 7 次 / .gitignore 缺 coverage/ / artifacts.js 注释漂移 / STATUS 标题外悬挂 3 行);**已确认合理**:docx/render.ts 单体、style.css 大文件、33 段零注册体系。重构候选 R1-R8 随批处置。**G1-G9 全闭**:G1 math.ts 60.65% branch → `formula.test.js`;G2 pdf postprocess 75% → `pdf-postprocess.test.js`;G3 bookmarks 旧式 Dests/catch/间接目标 → `pdf-bookmarks.test.js`;G4 metadata 25% → `pdf-meta.test.js`;G5 utils → `utils.test.js`;G6 converter/paths → `converter.test.js`+`paths.test.js`;G7 mermaid-service → `mermaid-service.test.js`;G8 十处散点;G9 不补。**覆盖率门槛**:c8+Electron 采集实测可用(sourcemap 映射回 .ts),基线 stmts 93.92 / branch 88.84 / funcs 93.15 / lines 93.92,门槛 90/85/90/90 写在 `test:coverage` 内单源,c8 每次自清 tmp。
- **来源/验证**:@explorer + @oracle;**关联**:`docs/archive/20260815-144057-代码测试文档审计.md`。

### 2026-08-10 21:12:58 测试覆盖盘点结论
- **方法**:能力面(src/core + main + renderer)逐一 grep 对照测试段 + smoke,产出「能力点 × 覆盖」全量表;24 项缺口分高/中/低,逐批关闭。**高**(当时):封面双格式断言、breakBeforeH1 产物分页、取消链路回归(两次取消 bug 无测试)、重名保护、缺失图片警告、公式降级、外链图片下载(超时/去重/兜底全无)、任务列表、h4-h6、分页符产物。**中**:settings sanitize 边界(字号 8-24 / 行距 1.0-2.5 / 边距 0-1000 钳制、损坏回退、patch 白名单)、slug 三函数、frontmatter 边界、非 A4 纸张。**低**(smoke diag + GUI 实测):renderer 交互、runAfterConvert、超长路径回落、IPC dialog/预览。
- **来源/验证**:@explorer exp-1(两轮);**关联**:`docs/archive/20260810-211258-测试覆盖盘点.md`;现行登记见 `docs/DEV-GUIDE.md`「测试体系」节与 `docs/ROADMAP.md`「候选区」。

### 2026-08-13 21:18:12 验收样例生成方案(拍板)
- **选型**:测试段导出 `export const fixtures = { main: ... }` → 生成器落盘 `test/fixtures/acceptance/<段名>[-key].md`,**md 唯一事实来源 = 测试段**(零重复/永不漂移);不选独立手写样例集(必与断言漂移);试点 4 段。**机制**:`gen-fixtures.mjs` 扫描段动态 import → 落盘 + 复制图片(缺失跳过)+ README 索引;`--check` 逐字节比对(差异 exit 1);需先 build。**坑**:`test/common/pdf-utils.js` 顶层 `import { BrowserWindow } from "electron"` 纯 Node 必 SyntaxError → 需 `node:module.register` 最小 mock;含 fixtures 的段 import 失败一律 exit 1。
- **来源/验证**:用户决策(2026-08-13);**关联**:`docs/archive/20260813-211812-验收样例生成方案.md`。

### 2026-09-26 21:14:55 `pathToFileURL` 把 8.3 短路径的 `~` 编码成 `%7E`
- **结论**:8.3 短路径里的 `~` 产出 `%7E`,Chromium 原样保留;配 `realpath` 展开短名后,期望值若用词法根比对**必然不等**。断言须按码族/两侧归一化后比较。
- **理由**:只在 8.3 短名开启的机器上出现,断言却指向「路径策略不对」,排查方向会一路错到实现。
- **来源/验证**:REF-001 Windows runner 实测:同文件短路径与 realpath 展开路径比较 `pathToFileURL(...).href` 与浏览器侧 URL;**关联**:`test/tools/geometry/*`。

### 2026-09-26 21:14:55 测试段同进程连跑两遍的迟到覆盖(本批主因)
- **结论**:同段一轮跑两遍(`npm test` 与 `test:coverage`)**第一遍过、第二遍挂** —— 根因是上一遍遗留异步写在本遍落盘,非本遍回归。已由 drain 修掉(见 Electron 一节);「同段一轮跑多遍」这一形态本身值得留档。
- **理由**:症状(第二遍挂)与原因(第一遍的写)分处两遍,逐遍读断言只会得出「第二遍代码有问题」的错误结论。
- **来源/验证**:REF-001 实测,修复 `48594f0`;修前双跑第二遍稳定失败、修后全绿;**关联**:`test/common/segment-host.mjs`、`npm run test:coverage`。

### 2026-09-26 21:14:55 门禁探针里再跑一次真 c8 会静默少算覆盖率
- **结论**:探针在沙盒里再跑真 c8 而**未覆盖 `NODE_V8_COVERAGE`**,子进程继承外层同一临时目录并在其 report 阶段清空 → **排在探针段之前的段的覆盖数据整段丢失**,探针自身全绿。修法:给子 c8 指定沙盒内 `NODE_V8_COVERAGE`;**不能用「改名去排序」绕过**(会让门禁依赖字母序)。
- **理由**:少算发生在 report 阶段而非执行阶段,门禁输出看不出异常,只会让阈值判断失真。
- **来源/验证**:REF-001 实测:探针段排最后时前若干段覆盖整段消失,覆盖该变量后复测;**关联**:`test/tools/` 覆盖率探针、`npm run test:coverage`(阈值单源在脚本内)。

### 2026-09-26 21:14:55 覆盖率阈值棘轮:降阈值/谎报 measured/只改基线都判红
- **结论**:`floor`(85/80/85/85)+ `headroomPp`(5) 有牙:三种绕过手法都判红;低于门槛的正确动作是**补测试而非降阈值** —— 只有「阈值 + 实测 + 余量」互相约束才不可编。
- **理由**:覆盖率数字本身可编,不加余量约束则降阈值与谎报都能过。
- **来源/验证**:REF-001 实测:三种手法各跑一次门禁均 exit 非 0,补测试后转绿;**关联**:`test/tools/` 覆盖率门禁。

### 2026-09-26 21:14:55 跨 DPI 几何采样用 `--force-device-scale-factor` 模拟
- **结论**:不改系统 DPI(需管理员且污染开发机),用 Electron 进程内 `--force-device-scale-factor`;页面实读 `devicePixelRatio` 与期望不符即判「未测量」并以**退出码 2** 结束;worker 报绿但退出码非 0 时**以退出码为准**(该规则在一次真实故障下拦下过假绿)。
- **理由**:改系统 DPI 需管理员且污染开发机;「报告文本」与「退出码」双通道时只信报告会漏掉「没测到却报绿」。
- **来源/验证**:REF-001 实测:期望 DPI 与页面实读不符时以退出码 2 结束而非报绿;**关联**:`test/tools/geometry/*`、`scripts/check-geometry.mjs`。

## 供应链与发布

### 2026-09-26 20:10:00 asar 归档格式两个反直觉事实(勿回退)
- **结论**:① 头部文件树**按目录分层嵌套**(`{"files":{"dist":{"files":{…}}}}`),**拼接路径字面量在头部文本中根本不会出现** → 「读头若干 MB 再子串搜索」判定条目**必然假阴性**;实测 10643 个文件的头部 JSON 约 2.6MB(**在 4MB 内**)仍报「未找到冒烟入口」,与同轮 exit 0 **直接矛盾**;正确做法是**按路径分段逐层下探**。② 定长布局 `[u32 payload_size=4][u32 头长][u32 头长-4][u32 JSON 长][JSON…]`,**JSON 起点 = 绝对偏移 16**;pickle 迭代器跳过 payload_size,故长度字段在**偏移 4**,按 0 读会差 4 字节解出垃圾前缀。
- **来源/验证**:2026-09-26 `npm run dist` 全链通过同轮里预检报「--smoke 必以 1 结束」而实际 exit 0;dump 真实 asar 前 32 字节得定长布局;**关联**:`scripts/smoke-proc.mjs`(`asarContainsEntry` 按树下探,`parsed` 字段区分「未收录」与「头解不开」)、`scripts/pack-size.mjs`(`readAsarTree` 展平求和,两者**刻意不合并**)、`scripts/check-asar-manifest.mjs`、`test/segments/install-smoke.test.js`(夹具改为构造真实二进制头)。

### 2026-08-02 21:08:53 G5 打包坑(electron-builder,已验证,勿回退)
- **结论**:① **highlight.js es/ 不可排除**(import 条件解析到 `./es/common.js`,排除即启动即 `ERR_MODULE_NOT_FOUND`);排除 node_modules 子目录前必须核 exports map 条件目标,**dev/smoke 全绿 ≠ 打包可用**。② electron-builder 26.15.3 + `"type":"module"` 打包成功;**`directories.output` 必须设 `release/`**;纯 JS 依赖不需 asarUnpack。③ 镜像 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`(**带 /mirrors/**,`registry.npmmirror.com/...` 404);nsis-3.0.4.1 写死,同步延迟会 404。④ 产物目录被系统进程锁(EBUSY unlink app.asar)致重建失败;`-c.directories.output=x` 会被当配置文件路径报 ENOENT。⑤ **打包版 `--smoke` 不可用**(output 在 asar 内只读),改用「启动存活 + asar list + 静默装卸」;`win.electronLanguages: ["zh-CN","en-US"]` 收益最大。
- **来源/验证**:自查 + @librarian lib-2;**关联**:`package.json` build 配置。

### 2026-08-28 Windows 本地打包踩坑(长路径 + Defender EPERM + 镜像 env 未转发)
- **结论**:① **Defender 实时扫描在解压到 `.tmp` 后立即锁定 electron.exe 句柄**,父目录 rename 报 `EPERM`(与 G5 的 EBUSY unlink 同源但触发点是 extractArchive 之后的 rename)。② 项目在 OneDrive 目录,junction 短路径无效(仍写真实路径 + 同步锁),且真实路径过长无法中转。③ **可行解法(两步)**:输出重定向到非 OneDrive 短路径 + `--config.electronDist=<短路径>\node_modules\electron\dist` 直接喂已解压发行目录(改 copy 而非解压后 rename)。④ **镜像 env 未转发**:`.npmrc` 的键不会变成环境变量,electron-builder 读不到 → 回退 GitHub 报 `ETIMEDOUT 20.205.243.166:443`;须显式设 `ELECTRON_BUILDER_BINARIES_MIRROR` 与 `ELECTRON_MIRROR`。⑤ Defender 排除需管理员,本机无权限。
- **来源/验证**:2026-08-28 本地打包实测(项目位于 OneDrive 同步目录,产物 `C:\m2w-out\MarkdownToWord-Setup-3.5.0.exe`)。
- **关联**:`npm run dist`;镜像变量经 `scripts/setup-env.ps1` 设(写死勿回退,见 `AGENTS.md`)。

### 2026-09-26 21:14:55 `npm audit --omit=dev` 在刻意不装依赖的 job 里 dev 剪枝失效
- **结论**:不装依赖的 job 里 dev 剪枝失效 → 纯构建期工具(xmldom/fast-uri/js-yaml/sharp)泄漏进生产树被判发布风险。判定层须以 **lockfile 的 dev 标记**为权威,job 补 `npm ci --ignore-scripts`。
- **理由**:判据若取「装出来的树」而非 lockfile 声明的树,门禁结论依赖 job 的安装方式而非项目真实依赖面。
- **来源/验证**:REF-001 实测:同 lockfile 装/不装 dev 两种 job 下 `npm audit --omit=dev` 输出对比,再用 lockfile dev 标记复判;**关联**:`.github/workflows/` 审计 job。

### 2026-09-26 21:14:55 CI 注入的 `PSModulePath` 污染使签名核对探测不可用
- **结论**:污染使 PowerShell 5.1 加载不到 `Microsoft.PowerShell.Security` → 探测命令在 runner 不可用;失败须走 **`probe-unavailable` 三态**而非崩堆栈(混成二态会把「探测不了」误报成「探测为否」)。
- **理由**:能力缺失与探测为否混成二态,会让 CI 误报签名缺失,或直接崩掉掩盖真实结论。
- **来源/验证**:REF-001 实测,修复 `f89dbc5`;注入污染值的 shell 里确认落到 `probe-unavailable` 且门禁继续;**关联**:`scripts/check-signature-status.mjs`、`test/segments/signature-status.test.js`、`docs/SIGNATURE-STATUS.md`(状态单源,勿改)。

### 2026-09-26 21:14:55 npmmirror 的 `npm audit` 端点实测 404
- **结论**:须如实记为 `unavailable` 并由 OSV.dev 两阶段兜底,**全部源不可用时判红**,绝不把「扫不到」谎报成「无漏洞」(两者输出长得一样,不留三态等于给供应链结论开后门)。
- **理由**:「不可用」与「无漏洞」在门禁输出里无法区分,不显式留三态就等于放行。
- **来源/验证**:REF-001 实测:直接请求确认 404,全源不可用时确认判红;**关联**:`.github/workflows/` 审计步、OSV.dev 兜底。

### 2026-09-26 21:14:55 包元数据缺 `license` 时的取值纪律
- **结论**:字段优先;缺失时回落随包许可证物证(仓库小写 `license` 文件 / README 声明 / 远端 SPDX)并**记录来源与证据文件名**;仍无法识别才判红(**不猜测**)。SBOM(以 lockfile 为准)与许可证清单(以物证为准)可能对同一包给出不同取值,**这是有意的差异**。
- **理由**:判定要可复核到具体文件,否则清单在审计时不可追溯;两份清单口径不同源于事实来源不同。
- **来源/验证**:REF-001 实测:缺字段包走物证回落并核对记录含证据文件名,无任何可识别信息的包判红;**关联**:发布流水线许可证清单与 SBOM 步骤。

### 2026-09-26 21:14:55 自写 prerelease 版本比较器,刻意不引 semver
- **结论**:该脚本在两条 workflow 的 `npm install` **之前**各跑一次,`import 'semver'` 恰在最需要它时 `ERR_MODULE_NOT_FOUND` = 门禁自我否定 → 自写零依赖比较器(门禁脚本的依赖前提必须早于门禁自身可用时刻)。
- **理由**:门禁脚本的依赖前提必须早于门禁自身可用的时刻,否则最需要它的那次运行必然失败。
- **来源/验证**:REF-001 实测:清空 `node_modules` 后仍可运行;**关联**:两条 workflow 版本一致性校验步、`package.json` version(三统一见 `AGENTS.md`)。

### 2026-09-26 21:14:55 NSIS 按用户模式与非交互安装:失败留下幽灵卸载条目
- **结论**:安装目录不可硬写 `%ProgramFiles%`(实测 `UninstallString` 带 `/currentuser`);失败前若已写入卸载注册表项与开始菜单 `.lnk`,两者都指向不存在的 exe,会在「应用」里留下**无法卸载的幽灵条目** → 清理须按**前后快照差集**只清本次新增并点名具体键/路径(按模式清会误删用户既有残留)。
- **理由**:按模式清会误删用户既有的其他安装残留;不按差集清则幽灵条目永久残留且用户无法自行移除。
- **来源/验证**:REF-001 实测:写完注册表项后注入失败,差集只含本次残留、清理后无孤儿项;**关联**:NSIS 配置、真实装卸验收项见 campaign PLAN「人工验收」节。
