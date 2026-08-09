# CHANGELOG

## [0.18.1] - 2026-08-09
- 批次 8 用户实测全部通过(8a 目录打开即见无更新域提示/右键更新域可刷新 + 8b 题注编号与样式正确),验收记录 docs/ACCEPTANCE.md 批次 8 节全部勾选;批次 8 关闭,路线图批次 8 行补实测结论;批次 9(公式编号+交叉引用)开工

## [0.18.0] - 2026-08-09
- 二期批次 8「免更新目录 + 题注自动编号」(typecheck/build/验收脚本 9 段/smoke 全绿,待用户实测)
  - **8a 静态目录(docx)**:`docx` 9.x `TableOfContents` 降级为转换时静态目录 —— `beginDirty:false` + `cachedEntries`(全部本地文本字面量)打开即见、零更新域;`toc` 设置项(默认开)全链路贯穿(settings.ts 兜底 true → convertImpl/renderDocx → UI 设置面板开关);目录页条目「标题 · 页码」,页码为转换时占位计算值(非域)
  - **8b 图/表题注自动编号**:「图: 」/「表: 」前缀行识别为题注(docx:加粗灰色居中段落 + PDF:fig-caption/tab-caption 类,不再落入正文/代码块);docx 侧按文档内出现顺序静态编号(图 1/2/3、表 1/2 独立计数),PDF 侧同序编号;题注与图片同时存在时置于图片之后(按源码顺序,合并渲染保持相对顺序)
  - **验收**:make-batch4-sample.mjs 第 9 段 08-TOC与题注测试(9 断言全绿:docx 目录页「目录」标题 + 条目文字 + 非域静态文本、题注段落样式/编号、PDF 题注 class 与编号);smoke 顺带修复:输出目录可配置后批量产物断言改为用 convertImpl 实际返回路径(不再固定 output/)
  - 待实测:Word/WPS 打开 08-TOC与题注测试.docx 目录是否直接可见、题注样式;修改正文后右键更新域目录是否刷新

## [0.17.3] - 2026-08-09
- 批次 7 GUI 实测全部通过(24 项清单 + 3 个修复复测:合并进度条递进、取消后重试正常、PDF 取消不产出文件),验收记录 docs/ACCEPTANCE.md 全部勾选;批次 7 关闭,路线图批次 7 行补实测结论

## [0.17.2] - 2026-08-08 13:27:24
- docs 文件名统一英文化(archive/ 调研存档除外,历史事实保留原名):状态速查→STATUS、研究结论→RESEARCH、架构决策→ADR、路线图与迭代规划→ROADMAP、开发者手册→DEV-GUIDE、用户手册→USER-GUIDE、体验优化验收记录→ACCEPTANCE;全文交叉引用与全局 AGENTS.md、docs-init 模板同步,候选文档名(REQUIREMENTS/TEST-MANUAL)一并规范

## [0.17.1] - 2026-08-08 12:16:09
- 批次 7 用户实测期 bug 修复(3 个,typecheck/build/smoke 全绿,待用户复测):
  - **合并转换进度条不动**(524cdf2):mergeConvertImpl 缺 onProgress 上报 → 增可选参数按单文件同构发 read/render/done;convert:merge handler 经 convert:progress 通道转发(renderer 的 runMerge 已订阅该事件,此前事件永远不来 → 进度条停在 0%);顺带 smoke 自清理 output 产物(批次 7 重名保护后旧产物不再被覆盖,断言 endsWith("-合并.docx") 因 (N) 序号变体失败;Windows 占用文件 EBUSY 容错跳过)
  - **合并取消后二次转换秒失败**(fd40480):mergeConvertImpl 开头缺 `cancelRequested = false` 复位(单文件 handler / batchConvertImpl 都有)→ 上次取消残留 true,二次合并立即被 throwIfCanceled 误判取消报「转换失败:已取消」;convert:merge handler 补识别 ConvertCanceledError 返回 { ok:false, canceled:true }(与单文件一致),renderer 走「已取消」分支而非失败弹窗
  - **PDF 转换取消不生效**(f809c57):renderPdf 内 printToPDF 为 Electron 原子调用不可中断,期间无取消检查 → renderPdf 补三处 throwIfCanceled(loadFile 前 / 字体等待后 / 打印完成落盘前),取消则中止落盘、不注入书签元数据、不报成功;单文件/合并 PDF 共用 renderPdf 均受益
- 实测说明:PDF 取消需等当前轮 printToPDF 结束才真正中止(原子调用,大文档数秒延迟),但最终不产出文件、状态显示「已取消」

## [0.17.0] - 2026-08-08 11:19:01
- 二期批次 7「体验优化 + 流程简化」(用户选定「先体验优化后功能扩展」;调研三路落盘,规划见路线图)
  - **列表增删**(exp-1 勘察 S1):单文件态「移除」按钮、多文件态「追加文件 / 清空列表」+ 每项「移除」按钮(✕ 图标);追加经对话框合并去重(appendSelection),拖入文件始终追加不替换
  - **输出目录可配置**(S2):设置面板新增「输出目录」行(显示当前值 / 选择… / 恢复默认);`settings.ts` 增 `outputDir` 字段(空串=源目录,绝对路径校验,旧设置文件兜底 `""`);`dialog:selectDir` IPC
  - **重名自动加序号**(S2,绝不覆盖):`resolveOutputPath` —— outputDir 空串→源目录;非空→创建(失败回落源目录+警告);候选路径 >250 字符回落源目录+警告(Windows MAX_PATH);已存在则 `名 (2).ext` 递增
  - **编码预检**(中文特有坑):`src/core/encoding.ts`(新,纯函数)decodeMarkdown —— UTF-8/UTF-16LE BOM 嗅探剥离;无 BOM 严格 UTF-8(TextDecoder fatal)失败按 GBK/GB18030 解码(iconv-lite gb18030 为 GBK 超集无损);主进程 convertImpl 接入并追加「已按 GBK 编码读取」警告;依赖 `iconv-lite@^0.7.3`
  - **进度条 + 取消**(S3):转换中显示进度区(进度条 + 百分比 + 取消按钮);单文件/合并按阶段映射百分比(read 15%/render 70%/done 95%),批量按 index/total + 阶段权重;`convert:cancel` IPC + 主进程 cancelRequested 标志 + ConvertCanceledError,批量在文件间检查
  - **完成汇总条常驻**(S1/S3):状态区下方新增汇总条(成功/失败/取消三态 + 图标 + 完成路径 + 「打开所在文件夹 / 打开文件 / 失败详情」+ 可折叠警告 `警告(N)`);批量失败时「失败详情」重开批量弹窗
  - **错误三要素 + 失败弹窗**(lib-2 Top4):单文件/合并失败弹窗进入失败态(标题「转换失败」+ 文件名 + 红色原因 + 隐藏无意义的复制/预览/打开按钮),错误不丢不掩盖
  - **模板回退/非法输入提示**(exp-1 勘察):微调后模板下拉回退「默认」并提示「已微调,与模板预设不一致」(warning 色);边距/字号/行距/字体输入非法字段内提示并恢复原值
  - **批量导出后一致**(exp-1 勘察):batchConvertImpl 取消后按 afterConvert 仅对首个成功项执行(与单文件一致)
  - **快捷键 + 复制路径 + 文案统一**:Ctrl+Enter 主转换、Ctrl+O 添加文件;完成弹窗「复制路径」按钮(navigator.clipboard,失败弹窗内提示);输出格式文案统一「Word / PDF」
  - UI 层(des-2 骨架 + 编排器对接):index.html/style.css 新增 ~145/289 行(列表工具/进度区/汇总条/错误提示/输出目录/复制按钮/文案),renderer.ts 全量接线(~513 行),typecheck/build 通过
  - 验收:make-batch4-sample.mjs 第 8 段编码预检断言(UTF-8 无 BOM/带 BOM/UTF-16LE/GBK 解码标记全绿);其余 main 侧行为走 smoke + GUI 实测清单
  - 待实测:docs/ACCEPTANCE.md 清单(列表增删/输出目录/进度取消/重名序号/GBK 转码/快捷键/复制路径/失败弹窗)

## [0.16.0] - 2026-08-08 10:20:16
- 二期批次 6「学术正式化」第二项:**公式双格式支持**(PDF:KaTeX;docx:KaTeX MathML → docx Math 组件 + 降级)
  - 依赖:`@mdit/plugin-katex@1.0.2`(peer markdown-it ^14.2.0,与 footnote/tasklist 同族;依赖 katex 0.18.1)+ `remark-math@6.0.0`(remark@15 兼容)
  - PDF 侧(`src/core/pdf/render.ts`):`md.use(katex)`(支持 $..$/$$..$$、\(..\)/\[..\]、```math 围栏);`loadKatexCss` 读 katex.min.css 内联进模板并把 `url(fonts/` 改写为 `file://` 绝对路径(fonts 与 css 必须同级,file:// 相对路径按 html 位置解析会失败);`body { print-color-adjust: exact }` + `.katex-display` 超宽保护;读取失败返回空串(公式仍渲染仅缺字体样式,不抛错)
  - printToPDF 时序(`src/main/index.ts`):loadFile 后 `await executeJavaScript("document.fonts.ready")` 再打印(否则公式缺字形);3 个 convert 调用点传 `katexDir: app.getAppPath()/node_modules/katex/dist`
  - docx 侧(`src/core/docx/math.ts` 新 + `render.ts`):KaTeX `output:"mathml"` 产出 MathML → 零依赖最小标签扫描器解析 → walker 映射 docx Math 组件(mfrac→MathFraction、msqrt/mroot→MathRadical、msub/msup/msubsup→MathSub(Sup)Script、munderover(∑)→MathSum、mover/munder→MathLimitUpper/Lower、mrow/mo/mi/mn/mtext→MathRun);inlineMath → Math 组件入段与 TextRun 混排(9.7.1 实证 Math 属 ParagraphChild);math(display)→ 独立居中段落
  - 降级红线:KaTeX 报错(katex-error)/未覆盖节点(mtable/mglyph/mstyle 等)/解析失败/空公式 → 整式降级为 TeX 源码等宽灰字(Consolas 888888)+ warnings 提示,内容不丢不崩
  - 实证:Math 序列化 `<m:oMath>`/`<m:f>`/`<m:rad>`/`<m:sSubSup>`/`<m:nary>`(MathSum)/`<m:limUpp>`;MathIntegral accent 空串不产出 m:chr 已弃用
  - **语法不对称**:```math 围栏仅 PDF 侧(@mdit/plugin-katex),remark-math 的 mathFlow 只认 $$..$$ / $..$(docx 侧围栏落为代码块)——验收样例用 $$ 块
  - 验收:make-batch4-sample.mjs 第 7 段 07-公式测试(行内 x²/分式/上下标 + 独立 ∑ + 开方,docx 断言 m:oMath/m:t x/m:f/m:sSubSup/m:rad,pdf 断言 class="katex" + @font-face);typecheck/build + 验收十三断言全通过
  - 待实测:Word/WPS 打开 07-公式测试.docx(公式可编辑性、缩放渲染)与 07-公式测试.pdf(字体/缩放目测)

## [0.15.0] - 2026-08-06 22:28:50
- 二期批次 6「学术正式化」第一项:**预设模板包**(设置面板「模板预设」下拉,一键套用排版 + 页面设置快照)
  - 3 个预设(renderer 侧定义,核心无新逻辑——渲染只认具体 typography/pageSetup 值):`default` 默认(引用 DEFAULT_SETTINGS,无第二份定义)、`paper` 学术论文(Times New Roman/宋体/12pt/1.5/缩进/两端对齐/编号;A4 上下 25.4 左右 31.7)、`business` 商务简报(Calibri/微软雅黑/11pt/1.15/无缩进/左对齐/无编号;A4 上下 19.1 左右 25.4)
  - 交互:「排版」面板顶部新增模板下拉 + hint;change → 整体替换 settings.typography/pageSetup → hydration 保护下统一回填全部控件 → 整体持久化;`matchesPreset` 逐字段精确比较,持久化值与预设一致时启动回选该模板,微调后回退「默认」;模板 id 不写入设置(套用后即具体值,可继续微调)
  - 验证:typecheck/build 通过;套用效果待用户 GUI 实测(选「学术论文」→ 转换 → docx/pdf 对照字体字号边距)

## [0.14.0] - 2026-08-06 22:17:06
- 二期批次 5「中文排版深化 + 保真补全」最后一项:**raw HTML 白名单**(双格式一致,安全最小集)
  - 白名单(14 个无属性内联标签):`strong/b`(粗)、`em/i`(斜)、`u`、`s/del`(删除线)、`code/kbd`(等宽 Consolas)、`sub`、`sup`、`mark`(高亮 yellow)、`br`(换行)、`span`(透传);可嵌套(栈式解析);**带属性或非白名单标签 → 整串回退安全行为**(pdf 转义 / docx 跳过,危险段含内容整体丢弃)
  - pdf 侧(`src/core/pdf/render.ts`):实证 markdown-it 14.3 `html_inline` 仅匹配单标签 → 新增解析层规则 `html_whitelist` 组合整串 token;渲染三分支:page-break → 分页 div、白名单整串 → 原样输出(Chromium 渲染)、其余 → escapeHtml;html_block 与 html_inline 同规则(行首白名单串归 html_block,须同判定保证双格式一致)
  - docx 侧(`src/core/docx/render.ts`):`normalizeInlineHtml` 段落内 html/text 归一化(白名单合并、危险段丢弃、孤立闭标签丢弃,接入 paragraph/list/blockquote/表格单元格/脚注段落);`parseInlineHtml` 栈式样式解析(纯字符串→结构,零依赖);`renderInlineHtmlParagraph` 复用正文段落渲染(5a 排版设置生效)
  - 实证(docx 9.7.1):TextRun 选项为 `italics`/`strike`/`subScript`/`superScript`/`highlight`/`underline: {}`;`<br>` 用 `break: 1`;OOXML 序列化 `w:b/`/`w:i/`/`w:strike/`/`w:vertAlign`(subscript/superscript)/`w:highlight`/`w:u w:val="single"`/`w:br`
  - 验收:make-batch4-sample.mjs 第 6 段(白名单全部标签 + 嵌套 + script/div/带属性三类危险样例,docx 断言样式运行齐全且危险内容零残留、pdf 断言原样输出 + 转义形式);typecheck/build + 验收十一断言全通过
  - 待实测:06-raw-html-白名单测试.{docx,pdf} 目测双格式渲染效果

## [0.13.0] - 2026-08-06 21:48:32
- 二期批次 5「中文排版深化 + 保真补全」第三项:**排版参数化 + 设置面板**(5a)
  - 设置模型:`src/core/typography.ts`(新)`TypographySettings` + `DEFAULT_TYPOGRAPHY`(fontAscii Calibri / fontEastAsia 微软雅黑 / bodySizePt 12 / lineSpacing 1.5 / firstLineIndent true / align justify / headingNumbering true);renderer 侧有平行定义(进程隔离),契约字段保持一致
  - 持久化:`src/main/settings.ts` `SETTING_KEYS` 增 `typography`(此前 UI 写入会被静默忽略);`sanitizeTypography` 逐字段校验(字体非空、bodySizePt 8-24、lineSpacing 1.0-2.5、align 枚举),非法/缺失回退默认;旧 settings.json 缺字段时其余设置保留、仅 typography 落默认,不报错
  - docx 应用(`src/core/docx/render.ts`):styles.default 字体(ascii/eastAsia/hAnsi 三槽)+ 字号 `bodySizePt×2` half-points(替换硬编码 24);正文段落两端对齐 JUSTIFIED、行距 `spacing.line = round(lineSpacing×240)` + LineRuleType.AUTO、首行缩进 `indent.firstLineChars: 200`(2 字符,9.7.1 实证支持;仅普通正文段落,heading/列表/代码/表格不受影响);headingNumbering 显式选项优先、默认取设置
  - PDF 应用(`src/core/pdf/render.ts`):模板 body `font-family: "<eastAsia>", "<ascii>"`、`font-size: ${bodySizePt}pt`、`line-height: ${lineSpacing}`(替换硬编码 11pt/1.65);firstLineIndent → `p { text-indent: 2em }`;align justify → `p { text-align: justify }`;headingNumbering 与 docx 侧联动(默认 true)
  - 主进程:`src/main/index.ts` 3 个 convert() 调用点(单文件/合并/预览)context 均透传 `settings.typography`
  - UI(des-1):设置面板新增「排版」区块(西文/中文字体文本输入 + datalist 建议、正文字号 8-24、行距 1.0-2.5、首行缩进/两端对齐/章节编号开关),与「页面设置」面板同构,控件变更乐观更新 + 整体写回
  - 验收:make-batch4-sample.mjs 新增 05-排版设置测试(自定义 typography:字号 28 half-points、宋体、两端对齐、编号关闭 → 断言 styles.xml `w:sz w:val="28"`/宋体、document.xml `w:jc both`/无 w:numPr、PDF 模板 14pt/2em/justify/宋体/无 counter);typecheck/build + 验收九断言全通过
  - 实证(OOXML 序列化细节):字号元素为 `w:sz`(非 `w:size`);docx 库 JUSTIFIED 序列化为 `w:jc w:val="both"`;`IIndentAttributesProperties.firstLineChars` 存在(字符单位,中文排版 2 字符=200)
  - 待实测:设置面板排版设置持久化 + docx/PDF 产物对照目测(重点:首行缩进、两端对齐、字号行距双格式一致)

## [0.12.0] - 2026-08-06 21:38:17
- 二期批次 5「中文排版深化 + 保真补全」第二项:**PDF 章节编号 + 元数据注入**
  - PDF 章节编号:`src/core/pdf/render.ts` `RenderPdfHtmlOptions` 增 `headingNumbering`(默认开);`buildTemplateCss` 追加 CSS counter 规则(h1/h2/h3 counter-increment/reset + `::before` 渲染 1 / 1.1 / 1.1.1,与 docx 侧 decimal 编号语义一致);编号经伪元素渲染**不进入 HTML 文本节点**,extractHeadings/书签/目录文本不受影响(与 docx 侧书签不含编号一致)
  - PDF 元数据:`src/core/pdf/metadata.ts`(新,纯逻辑可测)`setPdfMetadata` —— frontmatter title/author/date → PDF Info(title/author 仅注入非空,date 解析失败用当前时间兜底 + 设 modificationDate);`PdfArtifact` 增 `metadata?: DocMetadata`;`src/main/index.ts` renderPdf 在书签注入后追加(顺序固定:书签 → 元数据,pdf-lib 整体重存必须最后执行,否则丢书签)
  - 验收:make-batch4-sample.mjs 链路对齐主进程(补 setPdfMetadata 调用)+ 新增断言(counter CSS 存在、PDF 读回 title/author 与 frontmatter 一致);typecheck/build + 验收六断言全通过
  - 待实测:PDF 文档属性(title/author/date)与章节编号目测(对照 docx 03 样例编号层级)

## [0.11.0] - 2026-08-06 21:27:25
- 二期批次 5「中文排版深化 + 保真补全」第一项:**docx 标题章节自动编号 + 内部/外部链接跳转**
  - 标题编号:`src/core/docx/render.ts` 新增 `headingNumberingOptions()`(reference "md-heading",levels 0-2,text `%1`/`%1.%2`/`%1.%2.%3`,decimal,indent 360/360);`renderHeading` 对 h1-h3 挂段落级 `numbering: { reference, level: depth-1 }`(**静态渲染,打开 Word/WPS 无需 F9 即显示**;heading + numbering + Bookmark 三层不冲突,9.7.1 实证);`RenderOptions` 增 `headingNumbering`(默认开)
  - 内部链接:`[text](#slug)` → `InternalHyperlink({ anchor: docxBookmarkId(slug) })` 跳转同名标题书签(9.7.1 无 Hyperlink 类,9.x 拆分;anchor 与书签 id 字符串精确匹配);外链 http(s) → `ExternalHyperlink({ link })` 真超链接(替代假链接);相对路径保持假链接样式;pushRuns/pushRunsSync 双侧同步;`InlineChild` 类型加宽接纳超链接
  - 验收:make-batch4-sample.mjs 新增 03-标题编号链接测试.docx(解包断言 numbering 多级 text 模板 + hyperlink anchor + 书签保留);typecheck/build + 验收四项断言全通过
  - 待实测:Word/WPS 打开 03-标题编号链接测试.docx 目测编号层级/点击跳转;PDF 侧章节编号在批次 5 后续(5a)跟进
- 注:PDF 侧章节编号未在本提交实现(规划批次 5 剩余项,与排版参数化同批)

## [0.10.0] - 2026-08-05 22:22:19
- 二期批次 4「长文档」第二/三项:**脚注 + 页眉页脚页码**
  - docx 页眉页脚:`src/core/docx/render.ts` 新增 `renderHeader`(文档标题居中灰色 7pt,仅 metadata.title/title 存在时生成)与 `renderFooter`(第 X 页 / 共 X 页,PageNumber.CURRENT/TOTAL_PAGES 域,与 PDF footerTemplate 文案一致);挂载于 sections[].headers/footers(9.x 仅支持 section 级);`RenderOptions` 增 `title`(convert.ts docx 分支透传 context.title)
  - docx 脚注:Document 级 `footnotes` 配置 + `FootnoteReferenceRun(id)`(零新依赖,docx@9.7.1 内置);footnoteDefinition 预扫建索引,Ctx 带全局递增计数器(合并场景编号天然连续);重复引用各占新 id(与 markdown-it 编号语义对齐);定义内容复用现有块渲染(paragraph/list/code/blockquote/thematicBreak,table 跳过);标题等同步场景引用降级为字面 `[^label]`
  - PDF 脚注:依赖 `@mdit/plugin-footnote@1.0.2`(peer 显式 markdown-it ^14.2.0,与 tasklist 同源);`buildMarkdownIt` 注册插件 + `buildTemplateCss` 追加 6 条脚注区样式(9pt/分隔线/防跨页);锚点为文档内链接,printToPDF 保留可点击
  - 注意(HTML→PDF 固有行为):Chromium 不支持 `float: footnote`,PDF 脚注按文档流集中在内容末尾渲染,非页脚
- 验收脚本:`scripts/make-batch4-sample.mjs` 重构(htmlToPdf 抽取 + 明文 zip 部件断言),新增 02-脚注测试.{docx,pdf}(docx 断言 footnotes.xml/footer1.xml/header1.xml 存在;pdf 断言 footnotes 区 + footnote-ref 结构)
- 验证:typecheck/build 通过;验收脚本三项断言全通过(合并 PDF 18 条书签 + docx 部件 + pdf 脚注结构);待用户 Word/WPS + GUI 实测

## [0.9.1] - 2026-08-05 22:03:15
- 修复书签点击不跳转(用户实测):destKeyText 对 PDFName key 直接 `decodeURIComponent(asString())` 永远匹配不上(内部编码 `%`→`#25`)→ 全部书签回退首页;改为 `decodeText()` 还原百分号形式再解码
- smoke 补断言:`Dest[0] instanceof PDFRef`(单文件 + 合并两处),防「全部回退首页」类回归

## [0.9.0] - 2026-08-05 21:52:33
- 二期批次 4「长文档」第一项:**PDF 书签大纲注入**(修复用户实测「PDF 侧边栏书签为空」)
  - `src/core/pdf/bookmarks.ts`(纯逻辑,可单测):`lookupNamedDest`(名称树 + 旧式直接 /Dests 字典双兼容,PDFName key 百分号编码解码,PDFDict 间接目标取 /D)+ `setOutline`(marp setOutline 样板:嵌套 First/Last/Count、F 标志、页面 PDFRef 收集)+ `buildBookmarkTree`(扁平标题 → 按 level 嵌套)+ `injectBookmarks`(主入口,解析失败回退首页不抛错)
  - `src/core/pdf/render.ts`:`extractHeadings` 抽出为公共导出(目录 HTML 与书签同源,从渲染后 HTML 提取 h1-h3 id+文本)
  - `src/main/index.ts` renderPdf:printToPDF 后读 /Dests 命名目标 → 注入 Outlines(标题 id 即命名目标名,免文本定位);单文件 + 合并共用,无标题时原样落盘
  - 中文标题 UTF-16BE hex(PDFHexString.fromText);依赖 pdf-lib(package.json 原已依赖 ^1.17.1)
  - smoke 扩展:单文件 pdf + 合并 pdf 读回 Outlines,断言中文标题解码正确(覆盖用户实测场景回归)
  - 验收样例:scripts/make-batch4-sample.mjs → output/批次4验收/01-简介-合并.pdf(18 条书签,嵌套层级正确)
- 验证:typecheck/build/smoke 全通过;真实产物注入读回验证(Type/Count/中文标题/兄弟链/嵌套)

## [0.8.1] - 2026-08-04 21:13:03
- 批次 3 用户实测反馈与修复:
  - 修复拖放取路径:File.path 已被 Electron 32+ 移除 → preload 暴露 `webUtils.getPathForFile`(文件/文件夹拖入均报「无法获取文件路径」)
  - 文件列表排序:拖拽 + 上移/下移按钮,序号实时刷新,重排 selectedFiles 影响批量/合并顺序
- 实测反馈:PDF 侧边栏书签为空(页面内目录正常)→ 批次 4 开工,书签优先

## [0.8.0] - 2026-08-04 20:57:34
- 二期批次 3「批量 + 合并」完成
  - 批量转换:对话框多选 + 拖放多文件/文件夹(`paths:collectMarkdown` 递归收集,跳过点开头目录,字典序);队列并发 2(评审定稿,docx/pdf 统一);失败不中断,逐条汇总 `{ file, ok, outputPath?, error?, warnings? }`;批量模式跳过 runAfterConvert(防批量后自动打开 N 个文件);进度 `batch:progress`(第 i/N 个 + 阶段)
  - 多文件合并:`src/core/merge.ts` mergeMarkdowns(首文件 frontmatter 保留、后续剥离;图片相对路径 → 绝对,保留 title;`<!-- page-break -->` 拼接;空文件跳过);输出与首文件同目录 `{首文件名}-合并.{ext}`;封面/全局 TOC 自动成立(单文档渲染)
  - imageResolver 跨文件共享:按 baseDir 缓存 createImageResolver(HTTP 去重缓存跨文件生效,规划风险项闭环)
  - renderer:多文件列表态(数量 + 可滚动列表)、批量/合并双按钮(按选择数量切换)、批量进度状态区、批量结果汇总弹窗(逐条 ✓/✗ + 警告/错误,打开所在文件夹定位首个成功项)
  - preload 新增 5 API:openMarkdowns / collectMarkdowns / convertBatch / convertMerge / onBatchProgress
  - smoke 扩展:批量 3 成功 1 缺失(汇总逐条正确)+ 合并 docx(frontmatter 仅首个/图片嵌入/两文件标题齐全)
- 验证:typecheck/build/smoke 全通过;验收样例 output/批次3验收 待用户 GUI 实测

## [0.7.0] - 2026-08-03 23:14:13
- 二期批次 2「保真 + 正式文档化」完成
  - 外链图片下载嵌入:`src/main/image-downloader.ts` createImageResolver(本地读文件 + http(s) 下载 10s 超时/仅 2xx/同 URL 去重);docx 嵌入 + pdf 渲染后并发 3 下载转 data URL;失败保留原 URL + 警告(与缺失图片警告同构)
  - 目录 TOC:docx 内置 `TableOfContents` 类生成 Word 域(目录页 + 静态占位,Word/WPS 右键更新域 F9 生成;仅含标题时生成,封面后/文档最前);pdf 渲染后提取 h1-h3 生成无页码锚点链接目录(printToPDF 实测保留页内锚点为可点击 PDF 链接,含跨页)
  - 封面页 + YAML:`src/core/frontmatter.ts` 手写零依赖解析(title/author/date);有 title 时自动生成封面页(docx 居中排版 + pdf 居中版式);title 优先级 metadata.title > 文件名
  - PDF 预览:完成弹窗新增「预览」按钮(preview:open IPC → convert pdf → 临时 HTML → 独立预览窗口 900×1100,关闭清理)
  - 修复:分页符 div 后紧跟 h1 叠加 break-before 产生空白页(Chromium 相邻 break 不合并)→ 例外规则 `.page-break + h1 { break-before: auto }`
- 验证:typecheck/build/smoke 全通过;core 断言 21 项(frontmatter/封面/外链图/回归)+ docx TOC 12 项 + pdf TOC 18 项 + 分页空白页修复 6 项 + PDF e2e 6 项(5 页无空白页/锚点可点击);验收样例 output/批次2验收.{md,docx,pdf} 待 Word/WPS 实测

## [0.6.0] - 2026-08-03 21:46:27
- 二期批次 1「排版控制 + 设置底座」完成
  - 设置持久化:`src/main/settings.ts` 手写 userData/settings.json(原子写/整文件形状校验/patch 白名单 sanitize);记忆输出格式/页面设置/H1 分页开关/导出后行为;IPC settings:get/set + preload 4 新 API
  - 导出后行为:完成弹窗新增「打开所在文件夹/打开文件」按钮(shell:reveal/shell:open IPC);设置项控制转换后自动执行(默认不自动,防打断)
  - 分页控制:显式分页符 `<!-- page-break -->`(docx PageBreak / pdf 白名单 page-break div,裸 HTML 其余转义)+ H1 前分页开关(docx pageBreakBefore / pdf break-before CSS,默认关)
  - 页面设置面板(完整版):纸张 A4/A3/A5/Letter/Legal、纵向/横向、四边距 mm(docx section pgSz/pgMar 参数化、pdf @page size/margin 参数化);UI 即时生效自动保存
  - 标题 slug/id 底座:`src/core/slug.ts` + mdast 标题 data.id 声明合并;docx 标题书签 / pdf 标题 id(批次 2 TOC 铺路)
  - 修复:docx landscape 宽高双重交换 bug(库自动交换,勿手动)
- 验证:typecheck/build/smoke 全通过;双格式渲染断言 17 项(分页符/书签/pgSz/边距/转义/去重);分页符 PDF 页数确定性验证(/Count=2);验收样例 output/批次1验收-*.docx 待 Word/WPS 实测

## [0.5.4] - 2026-08-02 21:20:47
- 应用图标:build/icon.svg(「源文档 → 转换 → 输出文档」蓝渐变 Win11 风格,纯几何无字体依赖)+ scripts/svg-to-ico.mjs(SVG → 6 尺寸 ICO)
- 打包验证:exe 图标生效(无 default icon 警告,32x32 提取成功),安装包 89.5MB

## [0.5.3] - 2026-08-02 21:08:53
- 修复打包版启动崩溃:files 排除 highlight.js es/ 导致 exports import 条件目标缺失(ERR_MODULE_NOT_FOUND)
- 移除 es/ 排除(体积 +0.3MB),styles/ 排除保留;教训落盘RESEARCH.md
- 验证:asar 校验(es/common.js 在、styles 0 条)、win-unpacked 启动、静默安装/启动/卸载全通过

## [0.5.2] - 2026-08-02 21:03:06
- G5 完成:electron-builder(26.15.3)NSIS 打包
  - build 配置:output release/、files 白名单 + highlight.js es/styles 排除、electronLanguages 裁剪(zh-CN/en-US)、NSIS 向导式安装(oneClick:false + 可改目录)
  - 实测:安装包 88.9MB;静默安装/卸载退出码 0;安装版启动 OK;asar 内容校验(dist 完整/高亮裁剪生效)
  - 已知:打包版 --smoke 不可用(asar 只读,output/ 写不进),验证走启动存活 + asar list + 静默装/卸

## [0.5.1] - 2026-08-02 20:51:28
- 缺失图片警告:转换前统一检查 mdast 图片节点,本地路径不存在时收集 warnings 经 IPC 返回
- renderer 以黄色 `.status--warning` 展示(「⚠ 警告:缺少图片文件: xxx」),不打断弹窗路径展示
- 验证:typecheck/build/smoke 全通过;core 直测(相对/绝对坏路径均警告,存在图片不误报)

## [0.5.0] - 2026-08-02 20:46:39
- G4 完成:PDF 自研管线(markdown-it + HTML 模板 + printToPDF)
  - `src/core/pdf/render.ts`:markdown-it 14.3 + @mdit/plugin-tasklist + highlight.js(lib/common)
  - `src/core/convert.ts`:格式注册表(docx → Buffer / pdf → HTML + footerTemplate)
  - 任务列表 checkbox 打印 bug 规避:☐/☑ 字符替换;图片统一转 file:// URL
  - printToPDF:A4 + @page 边距 + 页码页脚,模板样式经 designer 润色(标题节奏/表格/代码高亮补齐)
  - renderer 解锁 pdf 格式选择;smoke 扩展 pdf 链路(魔数校验)
- 验证:typecheck/build/smoke 全通过;PDF 产物经 observer 视觉验收(中文/表格/高亮/任务列表/图片/页码 7/8 正常,1 项为源 md 间距问题)

## [0.4.4] - 2026-08-02 20:32:46
- 修复弹窗 hidden 失效:.hidden 加 !important,避免被后定义的 .dialog-overlay{display:flex} 覆盖(启动即显示、确定关不掉)
- smoke renderer 诊断增加弹窗启动隐藏检查(防回归)

## [0.4.3] - 2026-08-02 20:29:51
- 转换完成弹窗:模态提示(遮罩 + 卡片),显示结果文件完整路径(可选中复制),确定/遮罩/Esc 关闭
- 失败路径不变(状态区红字);smoke 诊断保留(api/按钮/点击反馈)

## [0.4.2] - 2026-08-02 20:20:58
- G3 完成:convert IPC 端到端(读→解析→渲染→落盘,同目录换 .docx 扩展名)
- 进度事件 read/render/done 推送 + renderer 进度文案;转换按钮启用(pdf 待 G4)
- convertImpl 抽为纯函数(main 内),smoke 自测覆盖 convert 链路
- 验证:typecheck/build/smoke(docx 8978 bytes)全通过

## [0.4.1] - 2026-08-02 20:07:41
- G2 完成:Electron 43 骨架(主进程窗口/dialog/IPC + preload contextBridge + renderer UI)
- renderer:Win11 浅色风格,文件选择/拖放(md 扩展名校验)/格式单选/状态反馈,CSP 已配置
- 验证:`typecheck`/`build`/`electron . --smoke` 全通过
- .npmrc 固化 electron 双镜像(勿回退)

## [0.4.0] - 2026-08-02 19:57:10
- G1 完成:实现 `src/core` 转换管线(remark + remark-gfm 解析,docx 9.x 渲染)
- 支持:标题1-6/段落/粗斜体/删除线/行内代码/链接/有序无序嵌套列表/表格(表头加粗)/代码块/引用/图片(魔数识别+resolver 注入)/分割线
- 中文:theme.ts 集中配置 eastAsia 微软雅黑,已实测写入 XML
- 验证基线建立:typecheck/build/g1-verify.mjs 全通过,样例含中英混排全要素
- 实测结论落盘 docs/RESEARCH.md(docx 9.x Numbering/TextRun/ImageRun 用法)

## [0.3.1] - 2026-08-02 19:22:14
- 规划补充:语法覆盖矩阵、renderer 技术选择(vanilla TS)、G1/G4 依赖清单
- 修复里程碑缺口:表格/代码块/引用/图片 渲染并入 G1

## [0.3.0] - 2026-08-02 19:20:18
- 需求变更为 Windows GUI 应用,重新规划:Eelectron 43 + docx 自研渲染 + 自研 printToPDF 管线(弃 md-to-pdf)
- 重写路线图(功能规划 MVP、里程碑 G1-G5);新增 ADR-002,修订 ADR-001 pdf 路线
- 研究结论新增 GUI 调研与 pdf 路线修订;AGENTS.md/状态速查/开发者手册同步

## [0.2.1] - 2026-08-02 19:15:14
- docs/README.md 按全局模板重构(阅读路径/文档登记/维护约定三节,登记全部文档)
- 路线图补充进展状态与里程碑状态列;状态速查同步

## [0.2.0] - 2026-08-02 18:20:36
- 完成选型调研与架构评审:docx 自研渲染管线(remark + docx 9.x)+ md-to-pdf 5.x
- 新增规划文档:`docs/ROADMAP.md`、`docs/RESEARCH.md`、`docs/ADR.md`
- AGENTS.md 固化选型硬约束

## [0.1.0] - 2026-08-02 17:46:35
- 初始化项目脚手架:git 仓库、package.json、tsconfig、.npmrc(npmmirror)、docs 骨架
- 技术栈确定为 Node.js/TypeScript(ESM)
