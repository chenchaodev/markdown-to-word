# CHANGELOG

## [0.10.0] - 2026-08-05
- 二期批次 4「长文档」第二/三项:**脚注 + 页眉页脚页码**
  - docx 页眉页脚:`src/core/docx/render.ts` 新增 `renderHeader`(文档标题居中灰色 7pt,仅 metadata.title/title 存在时生成)与 `renderFooter`(第 X 页 / 共 X 页,PageNumber.CURRENT/TOTAL_PAGES 域,与 PDF footerTemplate 文案一致);挂载于 sections[].headers/footers(9.x 仅支持 section 级);`RenderOptions` 增 `title`(convert.ts docx 分支透传 context.title)
  - docx 脚注:Document 级 `footnotes` 配置 + `FootnoteReferenceRun(id)`(零新依赖,docx@9.7.1 内置);footnoteDefinition 预扫建索引,Ctx 带全局递增计数器(合并场景编号天然连续);重复引用各占新 id(与 markdown-it 编号语义对齐);定义内容复用现有块渲染(paragraph/list/code/blockquote/thematicBreak,table 跳过);标题等同步场景引用降级为字面 `[^label]`
  - PDF 脚注:依赖 `@mdit/plugin-footnote@1.0.2`(peer 显式 markdown-it ^14.2.0,与 tasklist 同源);`buildMarkdownIt` 注册插件 + `buildTemplateCss` 追加 6 条脚注区样式(9pt/分隔线/防跨页);锚点为文档内链接,printToPDF 保留可点击
  - 注意(HTML→PDF 固有行为):Chromium 不支持 `float: footnote`,PDF 脚注按文档流集中在内容末尾渲染,非页脚
- 验收脚本:`scripts/make-batch4-sample.mjs` 重构(htmlToPdf 抽取 + 明文 zip 部件断言),新增 02-脚注测试.{docx,pdf}(docx 断言 footnotes.xml/footer1.xml/header1.xml 存在;pdf 断言 footnotes 区 + footnote-ref 结构)
- 验证:typecheck/build 通过;验收脚本三项断言全通过(合并 PDF 18 条书签 + docx 部件 + pdf 脚注结构);待用户 Word/WPS + GUI 实测

## [0.9.1] - 2026-08-05
- 修复书签点击不跳转(用户实测):destKeyText 对 PDFName key 直接 `decodeURIComponent(asString())` 永远匹配不上(内部编码 `%`→`#25`)→ 全部书签回退首页;改为 `decodeText()` 还原百分号形式再解码
- smoke 补断言:`Dest[0] instanceof PDFRef`(单文件 + 合并两处),防「全部回退首页」类回归

## [0.9.0] - 2026-08-05
- 二期批次 4「长文档」第一项:**PDF 书签大纲注入**(修复用户实测「PDF 侧边栏书签为空」)
  - `src/core/pdf/bookmarks.ts`(纯逻辑,可单测):`lookupNamedDest`(名称树 + 旧式直接 /Dests 字典双兼容,PDFName key 百分号编码解码,PDFDict 间接目标取 /D)+ `setOutline`(marp setOutline 样板:嵌套 First/Last/Count、F 标志、页面 PDFRef 收集)+ `buildBookmarkTree`(扁平标题 → 按 level 嵌套)+ `injectBookmarks`(主入口,解析失败回退首页不抛错)
  - `src/core/pdf/render.ts`:`extractHeadings` 抽出为公共导出(目录 HTML 与书签同源,从渲染后 HTML 提取 h1-h3 id+文本)
  - `src/main/index.ts` renderPdf:printToPDF 后读 /Dests 命名目标 → 注入 Outlines(标题 id 即命名目标名,免文本定位);单文件 + 合并共用,无标题时原样落盘
  - 中文标题 UTF-16BE hex(PDFHexString.fromText);依赖 pdf-lib(package.json 原已依赖 ^1.17.1)
  - smoke 扩展:单文件 pdf + 合并 pdf 读回 Outlines,断言中文标题解码正确(覆盖用户实测场景回归)
  - 验收样例:scripts/make-batch4-sample.mjs → output/批次4验收/01-简介-合并.pdf(18 条书签,嵌套层级正确)
- 验证:typecheck/build/smoke 全通过;真实产物注入读回验证(Type/Count/中文标题/兄弟链/嵌套)

## [0.8.1] - 2026-08-04
- 批次 3 用户实测反馈与修复:
  - 修复拖放取路径:File.path 已被 Electron 32+ 移除 → preload 暴露 `webUtils.getPathForFile`(文件/文件夹拖入均报「无法获取文件路径」)
  - 文件列表排序:拖拽 + 上移/下移按钮,序号实时刷新,重排 selectedFiles 影响批量/合并顺序
- 实测反馈:PDF 侧边栏书签为空(页面内目录正常)→ 批次 4 开工,书签优先

## [0.8.0] - 2026-08-04
- 二期批次 3「批量 + 合并」完成
  - 批量转换:对话框多选 + 拖放多文件/文件夹(`paths:collectMarkdown` 递归收集,跳过点开头目录,字典序);队列并发 2(评审定稿,docx/pdf 统一);失败不中断,逐条汇总 `{ file, ok, outputPath?, error?, warnings? }`;批量模式跳过 runAfterConvert(防批量后自动打开 N 个文件);进度 `batch:progress`(第 i/N 个 + 阶段)
  - 多文件合并:`src/core/merge.ts` mergeMarkdowns(首文件 frontmatter 保留、后续剥离;图片相对路径 → 绝对,保留 title;`<!-- page-break -->` 拼接;空文件跳过);输出与首文件同目录 `{首文件名}-合并.{ext}`;封面/全局 TOC 自动成立(单文档渲染)
  - imageResolver 跨文件共享:按 baseDir 缓存 createImageResolver(HTTP 去重缓存跨文件生效,规划风险项闭环)
  - renderer:多文件列表态(数量 + 可滚动列表)、批量/合并双按钮(按选择数量切换)、批量进度状态区、批量结果汇总弹窗(逐条 ✓/✗ + 警告/错误,打开所在文件夹定位首个成功项)
  - preload 新增 5 API:openMarkdowns / collectMarkdowns / convertBatch / convertMerge / onBatchProgress
  - smoke 扩展:批量 3 成功 1 缺失(汇总逐条正确)+ 合并 docx(frontmatter 仅首个/图片嵌入/两文件标题齐全)
- 验证:typecheck/build/smoke 全通过;验收样例 output/批次3验收 待用户 GUI 实测

## [0.7.0] - 2026-08-03
- 二期批次 2「保真 + 正式文档化」完成
  - 外链图片下载嵌入:`src/main/image-downloader.ts` createImageResolver(本地读文件 + http(s) 下载 10s 超时/仅 2xx/同 URL 去重);docx 嵌入 + pdf 渲染后并发 3 下载转 data URL;失败保留原 URL + 警告(与缺失图片警告同构)
  - 目录 TOC:docx 内置 `TableOfContents` 类生成 Word 域(目录页 + 静态占位,Word/WPS 右键更新域 F9 生成;仅含标题时生成,封面后/文档最前);pdf 渲染后提取 h1-h3 生成无页码锚点链接目录(printToPDF 实测保留页内锚点为可点击 PDF 链接,含跨页)
  - 封面页 + YAML:`src/core/frontmatter.ts` 手写零依赖解析(title/author/date);有 title 时自动生成封面页(docx 居中排版 + pdf 居中版式);title 优先级 metadata.title > 文件名
  - PDF 预览:完成弹窗新增「预览」按钮(preview:open IPC → convert pdf → 临时 HTML → 独立预览窗口 900×1100,关闭清理)
  - 修复:分页符 div 后紧跟 h1 叠加 break-before 产生空白页(Chromium 相邻 break 不合并)→ 例外规则 `.page-break + h1 { break-before: auto }`
- 验证:typecheck/build/smoke 全通过;core 断言 21 项(frontmatter/封面/外链图/回归)+ docx TOC 12 项 + pdf TOC 18 项 + 分页空白页修复 6 项 + PDF e2e 6 项(5 页无空白页/锚点可点击);验收样例 output/批次2验收.{md,docx,pdf} 待 Word/WPS 实测

## [0.6.0] - 2026-08-03
- 二期批次 1「排版控制 + 设置底座」完成
  - 设置持久化:`src/main/settings.ts` 手写 userData/settings.json(原子写/整文件形状校验/patch 白名单 sanitize);记忆输出格式/页面设置/H1 分页开关/导出后行为;IPC settings:get/set + preload 4 新 API
  - 导出后行为:完成弹窗新增「打开所在文件夹/打开文件」按钮(shell:reveal/shell:open IPC);设置项控制转换后自动执行(默认不自动,防打断)
  - 分页控制:显式分页符 `<!-- page-break -->`(docx PageBreak / pdf 白名单 page-break div,裸 HTML 其余转义)+ H1 前分页开关(docx pageBreakBefore / pdf break-before CSS,默认关)
  - 页面设置面板(完整版):纸张 A4/A3/A5/Letter/Legal、纵向/横向、四边距 mm(docx section pgSz/pgMar 参数化、pdf @page size/margin 参数化);UI 即时生效自动保存
  - 标题 slug/id 底座:`src/core/slug.ts` + mdast 标题 data.id 声明合并;docx 标题书签 / pdf 标题 id(批次 2 TOC 铺路)
  - 修复:docx landscape 宽高双重交换 bug(库自动交换,勿手动)
- 验证:typecheck/build/smoke 全通过;双格式渲染断言 17 项(分页符/书签/pgSz/边距/转义/去重);分页符 PDF 页数确定性验证(/Count=2);验收样例 output/批次1验收-*.docx 待 Word/WPS 实测

## [0.5.4] - 2026-08-02
- 应用图标:build/icon.svg(「源文档 → 转换 → 输出文档」蓝渐变 Win11 风格,纯几何无字体依赖)+ scripts/svg-to-ico.mjs(SVG → 6 尺寸 ICO)
- 打包验证:exe 图标生效(无 default icon 警告,32x32 提取成功),安装包 89.5MB

## [0.5.3] - 2026-08-02
- 修复打包版启动崩溃:files 排除 highlight.js es/ 导致 exports import 条件目标缺失(ERR_MODULE_NOT_FOUND)
- 移除 es/ 排除(体积 +0.3MB),styles/ 排除保留;教训落盘研究结论.md
- 验证:asar 校验(es/common.js 在、styles 0 条)、win-unpacked 启动、静默安装/启动/卸载全通过

## [0.5.2] - 2026-08-02
- G5 完成:electron-builder(26.15.3)NSIS 打包
  - build 配置:output release/、files 白名单 + highlight.js es/styles 排除、electronLanguages 裁剪(zh-CN/en-US)、NSIS 向导式安装(oneClick:false + 可改目录)
  - 实测:安装包 88.9MB;静默安装/卸载退出码 0;安装版启动 OK;asar 内容校验(dist 完整/高亮裁剪生效)
  - 已知:打包版 --smoke 不可用(asar 只读,output/ 写不进),验证走启动存活 + asar list + 静默装/卸

## [0.5.1] - 2026-08-02
- 缺失图片警告:转换前统一检查 mdast 图片节点,本地路径不存在时收集 warnings 经 IPC 返回
- renderer 以黄色 `.status--warning` 展示(「⚠ 警告:缺少图片文件: xxx」),不打断弹窗路径展示
- 验证:typecheck/build/smoke 全通过;core 直测(相对/绝对坏路径均警告,存在图片不误报)

## [0.5.0] - 2026-08-02
- G4 完成:PDF 自研管线(markdown-it + HTML 模板 + printToPDF)
  - `src/core/pdf/render.ts`:markdown-it 14.3 + @mdit/plugin-tasklist + highlight.js(lib/common)
  - `src/core/convert.ts`:格式注册表(docx → Buffer / pdf → HTML + footerTemplate)
  - 任务列表 checkbox 打印 bug 规避:☐/☑ 字符替换;图片统一转 file:// URL
  - printToPDF:A4 + @page 边距 + 页码页脚,模板样式经 designer 润色(标题节奏/表格/代码高亮补齐)
  - renderer 解锁 pdf 格式选择;smoke 扩展 pdf 链路(魔数校验)
- 验证:typecheck/build/smoke 全通过;PDF 产物经 observer 视觉验收(中文/表格/高亮/任务列表/图片/页码 7/8 正常,1 项为源 md 间距问题)

## [0.4.4] - 2026-08-02
- 修复弹窗 hidden 失效:.hidden 加 !important,避免被后定义的 .dialog-overlay{display:flex} 覆盖(启动即显示、确定关不掉)
- smoke renderer 诊断增加弹窗启动隐藏检查(防回归)

## [0.4.3] - 2026-08-02
- 转换完成弹窗:模态提示(遮罩 + 卡片),显示结果文件完整路径(可选中复制),确定/遮罩/Esc 关闭
- 失败路径不变(状态区红字);smoke 诊断保留(api/按钮/点击反馈)

## [0.4.2] - 2026-08-02
- G3 完成:convert IPC 端到端(读→解析→渲染→落盘,同目录换 .docx 扩展名)
- 进度事件 read/render/done 推送 + renderer 进度文案;转换按钮启用(pdf 待 G4)
- convertImpl 抽为纯函数(main 内),smoke 自测覆盖 convert 链路
- 验证:typecheck/build/smoke(docx 8978 bytes)全通过

## [0.4.1] - 2026-08-02
- G2 完成:Electron 43 骨架(主进程窗口/dialog/IPC + preload contextBridge + renderer UI)
- renderer:Win11 浅色风格,文件选择/拖放(md 扩展名校验)/格式单选/状态反馈,CSP 已配置
- 验证:`typecheck`/`build`/`electron . --smoke` 全通过
- .npmrc 固化 electron 双镜像(勿回退)

## [0.4.0] - 2026-08-02
- G1 完成:实现 `src/core` 转换管线(remark + remark-gfm 解析,docx 9.x 渲染)
- 支持:标题1-6/段落/粗斜体/删除线/行内代码/链接/有序无序嵌套列表/表格(表头加粗)/代码块/引用/图片(魔数识别+resolver 注入)/分割线
- 中文:theme.ts 集中配置 eastAsia 微软雅黑,已实测写入 XML
- 验证基线建立:typecheck/build/g1-verify.mjs 全通过,样例含中英混排全要素
- 实测结论落盘 docs/研究结论.md(docx 9.x Numbering/TextRun/ImageRun 用法)

## [0.3.1] - 2026-08-02
- 规划补充:语法覆盖矩阵、renderer 技术选择(vanilla TS)、G1/G4 依赖清单
- 修复里程碑缺口:表格/代码块/引用/图片 渲染并入 G1

## [0.3.0] - 2026-08-02
- 需求变更为 Windows GUI 应用,重新规划:Eelectron 43 + docx 自研渲染 + 自研 printToPDF 管线(弃 md-to-pdf)
- 重写路线图(功能规划 MVP、里程碑 G1-G5);新增 ADR-002,修订 ADR-001 pdf 路线
- 研究结论新增 GUI 调研与 pdf 路线修订;AGENTS.md/状态速查/开发者手册同步

## [0.2.1] - 2026-08-02
- docs/README.md 按全局模板重构(阅读路径/文档登记/维护约定三节,登记全部文档)
- 路线图补充进展状态与里程碑状态列;状态速查同步

## [0.2.0] - 2026-08-02
- 完成选型调研与架构评审:docx 自研渲染管线(remark + docx 9.x)+ md-to-pdf 5.x
- 新增规划文档:`docs/路线图与迭代规划.md`、`docs/研究结论.md`、`docs/架构决策.md`
- AGENTS.md 固化选型硬约束

## [0.1.0] - 2026-08-02
- 初始化项目脚手架:git 仓库、package.json、tsconfig、.npmrc(npmmirror)、docs 骨架
- 技术栈确定为 Node.js/TypeScript(ESM)
