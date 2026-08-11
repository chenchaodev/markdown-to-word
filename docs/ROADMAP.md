# 路线图与迭代规划

> 2026-08-02 18:20:36 制定,19:20:18 因需求变更(GUI)修订;21:43:23 二期规划经 @oracle 评审重排。迭代完成记录见 `docs/CHANGELOG.md`;选型结论见 `docs/ADR.md`(ADR-001/002);调研证据见 `docs/RESEARCH.md` 与 `docs/archive/` 存档。

## 需求范围
- Windows 桌面 GUI 应用:选择 markdown 文件 → 转 .docx / .pdf
- GUI 界面中文;中文内容排版可控(硬需求);架构预留其他格式扩展(「等」)

## 功能规划
### MVP(已全部完成)
- 文件选择:对话框 + 拖放
- 格式选择:docx / pdf
- 转换执行 + 进度反馈(解析 → 渲染 → 打印 三段)
- 输出位置:默认同目录同名换扩展名,可选另存

### 一期不做(已决策)
- 预览(HTML 模板已铺路,二期低成本)
- 批量转换、设置面板(字体走 core options 默认)
- 自动更新与签名

## 二期规划(2026-08-02 21:43:23 @oracle 评审后定稿;优先 P1→P0 页面设置、PDF 书签 P1→P2 先 spike)
按批独立交付,每批含验收标准。**已完成批次详情见 CHANGELOG 对应版本**,此处仅保留一行状态;未完成批次保留完整规划。

- 批次 1「排版控制 + 设置底座」✅ 0.6.0(CHANGELOG)
- 批次 2「保真 + 正式文档化」✅ 0.7.0
- 批次 3「批量 + 合并」✅ 0.8.0 + 0.8.1(用户实测反馈修复)
- 批次 4「长文档」✅ 0.9.x~0.10.0(书签/脚注/页眉页脚;书签修复 0.9.1)
- 批次 5「中文排版深化 + 保真补全」✅ 0.11.0~0.14.0(排版参数化/编号/白名单/元数据)
- 批次 6「学术正式化」✅ 0.15.0~0.16.0(模板包/公式双格式)
- 批次 7「体验优化 + 流程简化」✅ 0.17.0 + 0.17.1(3 个实测 bug 修复),用户 GUI 实测通过(0.17.3,记录 docs/ACCEPTANCE.md)

### 批次 8「功能扩展:学术正式化延伸」(2026-08-08 11:50:33 规划,来源:lib-1 竞品调研;勘察 exp-1 + 域 API 调研 lib-1/lib-3 已完成,落盘 docs/RESEARCH.md)✅ 0.18.0~0.18.1
- **已拍板**:D1=**免更新路线**(8a `beginDirty:false`+cachedEntries 纯超链接免页码 + 8b 渲染期静态注入「图 1.1」文本;零提示全端一致,改标题后需重新导出,定稿导出场景);D2=**前缀行识别**(图/表后紧跟「图: 标题」/「表: 标题」行;alt 已被占位文本复用故放弃)
- 实现说明:8b 题注编号最终实现为**全文连续**(图 1/2/3、表 1/2 独立计数),未挂章节号(规划期「图 1.1」简化);8a 目录为静态标题列表(无页码)+ 右键更新域可刷新
- 验收:test/segments/toc-caption.test.js 9 断言全绿;用户实测通过(2026-08-09,记录 docs/ACCEPTANCE.md 批次 8 节)
按价值/成本排序,起手 3-4 项:

**8a Word 原生 TOC 域开关化(低,勘察后范围缩小)**
- 现状:**原生 TOC 域已存在**——render.ts:289-309 用 docx 9.x `TableOfContents` 组件(`\o "1-3" \h \z \u` 配置齐全,占位「右键 → 更新域 生成」),正文含任意标题即**无条件插入**(render.ts:184-187,无开关)
- 增量:① 开关化 `toc?: boolean`(默认开,仿 breakBeforeH1 顶层布尔;PDF 侧 buildTocHtml 同开关,规则对齐);② `features.updateFields` 联动(官方文档明确要求:Word 打开弹提示并全量更新域);③ 题注不污染目录(题注用独立 Caption 段落样式,不挂标题样式即不被 `\o "1-3"` 收集)
- 红线(维持):静态标题列表 + F9 提示兜底
- 验收:test/segments/toc-caption.test.js(document.xml 匹配 `w:instrText` TOC 指令 / w:sdt);Word+WPS 双实测 F9

**8b 图/表题注自动编号(中,中文「图1.1」差异化最强单点,Typora 生态做不了)**
- 现状:mdast **无 caption 节点**(grep caption/figcaption 零命中),需自定义识别语法;标题编号已是 **w:numPr numbering 静态渲染**(render.ts:425-428,免 F9)→ STYLEREF 域可直接取章节号(**styleId 写 Heading1**,非 Word 内置 `1`)
- **决策点 D1(先定,8a/8b 必须同路线,严禁混用)**:
  - **更新域路线**(推荐,Word 继续编辑场景):8a `updateFields:true` + 8b `SimpleField(" STYLEREF Heading1 \\s ")` + `SequentialIdentifier("图")`(=SEQ 域);Word 打开弹一次提示全量更新,改标题/增删图后 F9 同步,与 Word 原生题注同构;WPS 兼容未官方背书需实测(12.8 起 TOC 引号 bug 已修;F9 弹安全声明)
  - **免更新路线**(一次性定稿导出场景):8a `beginDirty:false` + cachedEntries 纯超链接(免页码)+ 8b 渲染期静态注入「图 1.1」文本;零提示全端一致,改标题后需重新导出
- **决策点 D2**:题注语法(候选:图/表段落后紧跟「图: 标题」前缀行识别;或 Typora 式 alt 提取——alt 已被占位文本复用,倾向前缀行识别)
- docx 实现:渲染期预扫(仿脚注预扫 render.ts:174-178)建文档级题注上下文{类型,序号,章节号};插入点 renderBlock "paragraph"/"table" case(render.ts:352-360)产出后追加题注段落
- PDF 实现:标题编号已 CSS counter 伪元素(pdf/render.ts:369-377),题注 `.fig-caption::before { content: counter(h1c) "." counter(figc) }` 同机制对齐
- 验收:docx document.xml 匹配 SEQ/STYLEREF 指令(或静态题注文本);PDF html 匹配 fig-caption;Word+WPS 双实测 F9

**8c Mermaid 渲染导出(中,排 8a/8b 后)**:PDF 路线近白送(Chromium 有 DOM,可隐藏窗口渲染),docx 嵌入 SVG/PNG——原「砍」列表理由「无 DOM 环境」在 Electron 内不成立,重新评估升回

**8d 公式编号与交叉引用域(中,排 8a/8b 后)**:已有 KaTeX→OMML;对齐 tex2word 卖点;REF 域用库内置 `NumberedItemReference`(书签+`\h \w`)或 `PageReference`,Bookmark 类确认可用(docx 9.x 对象字面量构造)

### 批次 9「学术正式化:公式编号 + 交叉引用」(2026-08-09 规划,承接批次 8;范围=原 8d)✅ 0.19.0~0.19.1
- **D3=免更新路线延续**(唯一自洽解,沿用 D1):8b 题注编号已是静态文本(无书签/SEQ 域),REF 域无从引用且重新引入「打开更新域」提示 → 公式编号 = 渲染期静态注入「(N)」,交叉引用 = 静态文本「式 (N)」+ 超链接跳转;改号后重新导出(与 8a/8b 一致)
- **D4 语法拍板**:编号对象 = display 公式($$ 块/`\[..\]`/```math 围栏)自动编号,**全文连续 (1)(2)(3)…**(与 8b 图/表全文连续对齐,不挂章节号);引用锚点 `$$...$$` 后独立行 `{#eq:label}`(标记行不渲染,登记为书签/锚点);引用语法 = markdown 链接 `[式](#eq:label)`(文本为「式」/「公式」→ 渲染为「式 (N)」可点击跳转,其他文本原样保留超链接)
- 实现:docx 公式段落「公式居中 + 编号右对齐」(tab 制表位 CENTER+RIGHT,参照学术排版);label → Bookmark;PDF KaTeX display 后追加编号 + label 锚点 span,链接规则替换文本
- 验证点:remark-math mathFlow 后独立行文本解析行为(实证:独立 paragraph 可识别)、markdown-it katex 插件 token 结构(实证:math_block)、docx tab 制表位与 Math 同段排版(实证:Tab 可序列化,ParagraphChild 类型需断言)
- 不做(记后续):题注/章节交叉引用(需 8b 加 label 机制)、公式编号开关(默认开)
- 验收:test/segments/eq-numbering.test.js 9 断言全绿(typecheck/build/smoke 同步全绿);待 GUI 实测(见 docs/ACCEPTANCE.md 批次 9 节)

- 备选:代码块语法高亮写 docx(低中)、模板导入 MVP(中高,先导出侧)、批注(低)、WPS 兼容矩阵(低,守护既有功能)
- 暂缓:完整 CSL 参考文献、AI 改写、表格合并单元格、文档加密
- 调研证据:TableOfContents/SimpleField/SequentialIdentifier/NumberedItemReference API、STYLEREF 章节号、updateFields 行为、WPS 兼容坑,详见 docs/archive/2026-08-08-1142-docx域API调研.md

### 延后(不排批)
- 代码高亮主题切换:PDF 模板硬编码 GitHub Light,打印场景需求趋零;docx 代码高亮(逐 token 着色,中高成本)延后
- 最近文件:低价值低成本,尾部便利
- 模板导入系统(用户上传 docx/CSS):中成本,排在样式模板后
- 砍:Mermaid(原因无 DOM,批次 8 已重新评估升回)、CLI 转正(无用户需求,调试可走脚本/直接调 core)、自动更新/签名(本地离线隐私卖点,更新反噬)、i18n、目录监视/同步、PDF 多栏、批量重命名

### 差异化定位
中文排版可控(护城河)+ 真 docx(非 HTML 改名)+ 本地离线隐私

## 语法覆盖范围(转换矩阵)
| 语法 | 支持 | 阶段 |
| ---- | ---- | ---- |
| 标题/段落/粗斜体/行内代码/链接/引用 | ✅ | G1 |
| 无序/有序/嵌套列表 | ✅ | G1 |
| 表格/代码块(等宽字体)/图片(本地路径) | ✅ | G1 |
| GFM 删除线/任务列表 | ✅ | G3 联调期顺手 |
| 脚注/公式/docx 代码高亮/目录 TOC | ✅ | 二期 |
| raw HTML 白名单(14 个无属性内联标签) | ✅ | 批次 5 |

## 里程碑(全部完成)
| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| G1 core 打底 | remark 管线 + docx 完整渲染 + eastAsia 字体 | ✅ |
| G2 Electron 骨架 | 窗口 + preload + IPC + 文件选择/拖放 | ✅ |
| G3 转换联调 | convert IPC + 进度事件 + 输出落盘 | ✅ |
| G4 PDF 自研 | markdown-it + HTML 模板 + printToPDF + 高亮 | ✅ |
| G5 收尾 | 错误处理 + electron-builder(NSIS)打包实测 | ✅ |

## 待修复(测试补充迭代发现)
- [x] PDF 任务列表 checkbox 替换失效:pdf/render.ts replaceTaskCheckboxes 正则与 @mdit/plugin-tasklist 实际输出不匹配(属性顺序 type 在前/含 id 属性/布尔属性序列化为 checked="checked"),☐/☑ 替换从未生效,PDF 中 checkbox 以原始 input 形态保留,与「打印稳定」设计意图不符。**2026-08-10 已修复(289b837)**:正则改为 class 定位 input + \schecked 判选中 + label 解包,task-list.test.js 同步为 ☑/☐ 断言。docx 侧任务列表无 checkbox 视觉呈现为设计如此,非 bug。

## 重构规划(2026-08-10 定稿,用户确认排期:测试迭代全部完成后启动)
> 背景:src/main/index.ts 918 行混合五层职责(生命周期/IPC/转换编排/设置/smoke 测试),smoke 复杂化的根因是取消状态为模块级私有全局变量、转换函数未导出,外部测试无法访问。分层方向(core/main/renderer)本身正确,不推倒重来。
> 时机:迭代 3(低优先级测试)完成后启动;行为等价重构,当前 14+ 段 + smoke 全绿为安全网,每步独立提交可回退;第一步单独成迭代(牵动 IPC 层,敏感),二、三步合并。

- [ ] **步骤一(独立迭代):取消状态参数化** —— 模块级 `cancelRequested` 改为转换调用携带的 context 参数(`{ cancelRequested, cancel() }`),IPC 层持有当前调用 context 引用。转换函数自包含编排 → 可直接导出测试,取消回归不再需要「改全局再调用」串行技巧,根治全局可变状态。风险点:IPC 持有方式(context 注册/释放)需小心设计,「取消后复位」语义必须保持(迭代 1 新增的取消回归断言守护)。
- [ ] **步骤二:抽 src/main/converter.ts** —— convertImpl/batchConvertImpl/mergeConvertImpl/resolveOutputPath + 类型 + 取消 context 移入独立模块并导出;index.ts 只留窗口生命周期 + IPC 薄层。
- [ ] **步骤三:smoke 瘦身 + 移出 index.ts** —— SMOKE 块抽到独立文件(src/main/smoke.ts),index.ts 一行调用;重名保护/取消/分页符/breakBeforeH1 纯逻辑断言迁至 acceptance 段体系(Node 可跑);smoke 只留必须 Electron 的断言(printToPDF 产物、书签、renderer diag、设置持久化往返),预计 210 行 → ~80 行。
- [x] **步骤四(可选):测试目录分层** —— test/segments/(core 渲染)+ 新增 test/main/(converter 层),runner 扩展多目录零注册。

## 迭代 4 规划(2026-08-11,预览入口迁移)
> 背景:预览(openPreviewWindow,与 PDF 同排版)当前入口在转换完成弹窗(completeDialogPreview),用户实测后提出:预览应在转换前(先看排版再决定转换),入口需迁移。
> 入口形式(用户确认):选中文件后工具栏/列表项操作区加「预览」按钮;完成弹窗「预览」按钮移除(打开文件夹/打开文件保留)。
> 规模控制:单主题(预览入口迁移),验收清单 ≤5 项;改动面 = src/renderer/(index.html + renderer.ts + style.css 如需);main 层 openPreview IPC 已存在零改动;测试走 smoke renderer diag + GUI 实测。
- [x] 单文件态:文件区/操作栏新增「预览」按钮,点击打开预览窗口(转换前,不产生产物)
- [x] 多文件态:列表项操作区每行新增「预览」按钮,点击预览该文件
- [x] 完成弹窗:移除「预览」按钮(入口统一迁移到转换前)
- [x] 预览失败(文件缺失/渲染错误)提示不崩溃,与现有错误展示一致
- [x] 验收:smoke renderer diag 断言(previewBtn 存在/初始禁用/dialogPreviewRemoved)+ GUI 实测(2026-08-11 用户 6 项清单全通过)

## 待办(排期)
> 2026-08-11 建:bug/需求按优先级排序,完成即勾选。

- [ ] **P0 bug(第一位):smoke-merge-1-合并.pdf 图片未显示**——2026-08-11 用户发现。已知线索:产物 39KB 明显小于含图单文件 smoke-pdf.pdf(71KB),md 用相对路径 `![图](smoke-pdf.png)`;怀疑 merge 链路(baseDir/图片解析)或图片显示功能本身有问题,待专项分析:先复现(单文件 pdf 图片正常?merge docx?merge pdf?)、定位 merge 后 baseDir 与 imageResolver 接线、补测试段断言
- [ ] 批次 10 候选(功能):8c Mermaid、题注/章节交叉引用(8b 补 label 机制)、公式编号开关、代码块语法高亮写 docx、模板导入(先导出侧)、批注、WPS 兼容矩阵

## 测试缺口(待逐步补充)
> 2026-08-10 能力面×覆盖盘点(test/segments 11 段 + smoke 对照 src/core、src/main、src/renderer 全部能力点)。按优先级逐批补齐,每批独立小迭代;补完即勾选。
> 批次规划(2026-08-10):迭代 1 = 高优先级 10 项;迭代 2 = 中优先级 9 项;迭代 3 = 低优先级可自动化项 + IPC dialog/预览 维持 GUI 实测(勾选即完成)。测试补充迭代走豁免:不 tag、不写 CHANGELOG,每迭代收尾全量跑 `npm run test` + `npm run test:smoke` 并提交。
> 迭代 3 规划(2026-08-11,重构完成后):低优先级 5 项。重构红利:converter.ts 已导出 collectMarkdownPaths/resolveOutputPath,原计划「smoke 扩展」升级为 test/main/ 新段 paths.test.js 直测(Node 可跑、断言精确);runAfterConvert none 分支已被 converter.test.js 隐式覆盖(afterConvert 恒置 none,全部转换场景);show-in-folder/open 分支自动化会触发真实 GUI 动作,转 GUI 实测;renderer 交互/IPC dialog/预览维持 GUI 实测。自动化 2 项本次执行,GUI 实测 3 项交用户后勾选。

### 高优先级(用户可见行为/修过 bug 的路径/核心渲染语义)
- [x] 封面页双格式:docx cover(22pt 居中)+ pdf .cover(28pt)结构均无断言 → 新段 cover.test.js
- [x] breakBeforeH1 产物效果:smoke 只测设置持久化,产物分页(docx 分页段落 / pdf break-before CSS)未断言 → smoke 扩展 + core 段
- [x] 取消链路:convert:cancel、batch 取消(canceledCount/未开始项)、merge 取消复位(fd40480/f809c57 两次取消 bug 无回归测试)→ smoke 扩展
- [x] 重名保护:resolveOutputPath 二次转换生成 (2).ext 不覆盖(smoke 仅兼容剥离 (N),未主动断言)→ smoke 扩展
- [x] 缺失图片警告:collectMissingImageWarnings「缺少图片文件:」文案(toc-caption/merge 均用了缺失图但未断言 warnings)→ 现有段补断言
- [x] 公式降级分支:katex-error → 等宽灰字 + 警告(docx render 降级路径未测)→ formula.test.js 补
- [x] 外链图片下载 image-downloader:超时/仅 2xx/失败 null/同 URL 去重缓存 → 新段(纯逻辑)
- [x] 任务列表:docx 侧按普通列表、pdf 侧 ☐/☑ 替换 → 新段 task-list.test.js
- [x] h4-h6 标题(现只断言到 h3)→ heading-links.test.js 补
- [x] 分页符产物:docx PageBreak 段落、pdf .page-break div(smoke g3 有输入无断言)→ smoke 补

### 中优先级(设置边界/渲染细节)
- [x] settings sanitize 边界:字号 8-24/行距 1.0-2.5/边距 0-1000 钳制、非法枚举回退、损坏文件回退默认、旧 settings.json 兼容、patch 白名单 → 新段 settings.test.js(纯函数易测)
- [x] slug.ts 三函数单测:slugify 中文保留 / uniqueSlug 去重 -2/-3 / docxBookmarkId 兜底(数字前缀、40 字符截断)→ 新段 slug.test.js
- [x] frontmatter 边界:引号剥离/注释/异常格式 → 新段 frontmatter.test.js
- [x] 页面设置非 A4 纸张(A3/A5/Letter/Legal)+ 边距值(docx pgMar / pdf @page)→ 新段 page-setup.test.js
- [x] 行距/首行缩进 docx 侧值:w:spacing、w:ind firstLineChars 未断言 → typography.test.js 补
- [x] 代码块序列化:docx Consolas 10pt 逐行、pdf 代码高亮类 → basic-render.test.js 补
- [x] 引用块 docx(缩进+灰底 F2F2F2)/列表 w:numPr 序列化/表格表头 bold → basic-render.test.js 补
- [x] 外链链接 docx rels(ExternalHyperlink)→ heading-links.test.js 补
- [x] PDF 页脚页码文案/页眉内容(部件存在已断言,文案未断言)→ footnotes.test.js 补

### 低优先级(自动化成本高,维持 smoke diag + GUI 实测清单)
- [x] renderer 全部交互(拖放/列表排序/设置面板/进度/取消/快捷键/完成弹窗动作):维持 smoke renderer diag + ACCEPTANCE GUI 实测(2026-08-11 用户实测通过)
- [x] runAfterConvert(show-in-folder/open)行为 → none 分支由 converter.test.js 隐式覆盖;show-in-folder/open 转 GUI 实测(2026-08-11 用户实测通过)
- [x] collectMarkdownPaths 文件夹递归/点目录跳过/skipped → 已迁 test/main/paths.test.js 直测(重构后导出)
- [x] resolveOutputPath 超长路径(>250)回落 + 输出目录 mkdir 失败回落 → 已迁 test/main/paths.test.js 直测(重构后导出)
- [x] IPC dialog / openPreviewWindow → GUI 实测,不自动化(2026-08-11 用户实测通过)

### R8 收尾评审提出(2026-08-11,待执行;来源:拆分后测试面盘点,优先级 A>B)
> 背景:R7/R8 renderer 拆分后评审。书签注入在 core(bookmarks.ts setOutline,纯 pdf-lib),pdf-meta 段已有 htmlToPdf + core 函数复刻 converter 链路的先例;renderer 纯函数(isMarkdown/baseName/truncateMiddle/stageText/STAGE_PERCENT)被 dom.ts 顶层 document 访问挡住无法 Node 直测;smoke diag 的 statusAfterClick 恒空(convertBtn 初始 disabled,.click() 不触发),「请先选择 Markdown 文件」守卫路径零自动化覆盖。全部行为等价,收尾跑 `npm run test`(23 段)+ `npm run test:smoke`。
- [x] A1 分页符断言下沉:pdf 中间 html 的 page-break div 断言从 smoke 并入 page-setup.test.js(只用 core convert,零 app 依赖),smoke 删该块(批 2 完成)
- [x] A2 书签断言下沉:新建 segments/pdf-bookmarks.test.js(htmlToPdf + core setOutline 复刻 smoke 断言:中文标题 + Dest[0] 页面引用,单文件+合并),smoke 保留 pdf 魔数端到端一条;执行时先核实 extractHeadings 签名与 converter 接线点(批 4 完成)
- [x] A3 smoke diag 修盲区:diag 记录初始禁用后 `btn.disabled = false` 再 click,断言「请先选择 Markdown 文件」+ status--error(批 1 完成)
- [ ] B1 renderer 纯函数段:抽 src/renderer/pure.ts(isMarkdown/baseName/truncateMiddle/stageText/STAGE_PERCENT 等零 DOM 函数),utils.ts 改 re-export(renderer 内部 import 路径不变),新建 segments/renderer-pure.test.js
- [ ] C1 image-type.test.js(R2 抽取 / R4 修复核心,高):sniffImageType 类型嗅探 + imageSizeFromBuffer 的 PNG(IHDR)/JPEG(SOF) 原始尺寸解析、webp/gif 降级、最大宽 400 等比缩放;fixtures 用最小 PNG/JPEG bytes
- [ ] C2 presets.test.js(R1 下沉,高):matchesPreset 自匹配/微调任一字段不匹配 + TEMPLATE_PRESETS 全部值落在范围常量(MARGIN/BODY_SIZE/LINE_SPACING)内(「预设已定稿勿改」契约锚);或并入 settings 段
- [ ] C3 extractHeadings 直测(R3 拆出,中):多级/中文/编号标题 → PdfHeading 结构,与 A2 书签段互补(彼测注入端到端,此测提取逻辑)
- [ ] C4(可选,R2):isCaptionTarget/buildEquationContext/collectPlainText 直测——产物断言(toc-caption/formula/eq-numbering)已间接覆盖,边际收益低,不排期

## 重构迭代规划(2026-08-11,审计驱动;来源:docs/archive/20260811-201145-src架构审查.md,两次 @oracle 评估)
> 背景:src 全量架构审查 + 四大文件拆分评估完成。总体:分层正确,问题集中在「契约重复」与「单体文件」两类。所有重构行为等价(除注明修复项),20 段 + smoke 全绿为安全网,每迭代独立提交可回退,收尾走豁免(不 tag 不写 CHANGELOG,并入下次发版)。
> 执行顺序原则:契约抽取(收益/风险比最高)→ 大文件拆分(机械移动)→ 行为修复(补测试)→ renderer 拆分(风险最高放中后段)→ 低优先级清扫。

- [x] **R1 契约共享(H1+H2)**:新建 `src/core/html-whitelist.ts`(白名单标签集+校验核心,docx/pdf 同步切换引用,消除双格式漂移);renderer 类型改 `import type` 自 core(编译期擦除,不违反 contextIsolation);`DEFAULT_SETTINGS`/`TEMPLATE_PRESETS`/`matchesPreset`/范围常量下沉 `src/core/settings-defaults.ts`,main/renderer 共用。新增 test/segments/html-whitelist.test.js(白名单行为+双格式一致性)。**完成**:typecheck/build/21 段/smoke 全绿(commit 394950f)
- [x] **R2 docx/render.ts 拆分(1295→~850)**:`src/core/docx/captions.ts`(CaptionInfo/containsImage/isCaptionTarget/buildCaptionContext/renderCaptionParagraph)、`src/core/docx/equations.ts`(MdMath/EquationInfo/EquationContext/buildEquationContext)、`src/core/mdast-utils.ts`(collectPlainText 与 parse.ts collectText 合并)、`src/core/image-type.ts`(sniffImageType);主循环保持单体;import type 防环;公开面不变
- [x] **R3 pdf/render.ts 拆分(802→~250)**:`src/core/pdf/template.ts`(buildTemplateCss/buildTemplate/buildCoverHtml/loadKatexCss/escapeHtml/decodeEntities/PDF_FOOTER_TEMPLATE)、`src/core/pdf/postprocess.ts`(extractHeadings/buildTocHtml/embedExternalImages/mimeFromBuffer/escapeRegExp);**converter.ts 的 extractHeadings/PDF_FOOTER_TEMPLATE import 同批更新**(tsc 兜底);M7 正则只搬迁不改
- [x] **R4 H3 docx 图片变形修复 + L1 类型统一**:imageToDocx 从 Buffer 解析 PNG(IHDR)/JPEG(SOF)尺寸,按原始宽高比缩放(最大宽 400,高度按比例);webp/未知类型降级占位+警告(与 pdf mimeFromBuffer 一致化)。同步更新 basic-render/merge 段图片断言
- [x] **R5 中优先级快修(M1/M2/M5)**:merge.ts 图片正则支持括号配对 URL(引用式图片记已知限制);renderPdf 临时 HTML 加随机后缀(与 preview 一致);pushRuns/pushRunsSync 统一单一 async 版。merge 段补括号 URL 断言
- [x] **R6 中优先级快修(M4/M6)**:settings saveSettings 写队列串行化(promise 链,防并发丢更新);图片缺失检查并入 imageResolver 失败路径(单次 IO),警告文案三处统一。settings/段补并发断言,image-downloader/basic-render 段更新文案断言
- [x] **R7 renderer 阶段一(零风险)**:DOM 引用块抽 `src/renderer/dom.ts`(纯 getElementById 映射);删 L4 死代码(dialog:openMarkdown main/preload/renderer 三处);L5 lastBatchItems/lastBatchResult 状态合并。验证 smoke diag
- [x] **R8 renderer 阶段二(行为等价)**:renderer.ts 拆分五模块——`state.ts`(selectedFiles/format/converting/mode/settings/hydratingSettings/路径缓存/拖拽态 + IPC 契约类型)、`utils.ts`(setStatus/setError/baseName/truncateMiddle/进度/字段错误/焦点)、`convert-flow.ts`(runConvert/runBatch/runMerge)、`file-list.ts`(列表渲染/拖拽/按钮工厂)、`dialogs.ts`(完成/批量弹窗/汇总条);状态读写一律经 `state.X`(唯一来源),依赖单向(各模块→state/utils/dom;convert-flow→dialogs/file-list,无环);renderer.ts 留组合根(~950,API 契约/模板预设/设置面板/事件接线/init)。逐字段核对 mode/hydratingSettings 语义;验证 typecheck/build/21 段/smoke(renderer diag)
- [ ] **R9 低优先级清扫 + 已知限制**:L3 escape 工具集中(core/utils.ts)、L6 openPreviewWindow/renderPdf 公共 helper、L7 test/common/settings.js save/restore helper(smoke/converter.test.js 共用)、L9 renderPdfHtml 去 async;M3 currentCtx 按 webContents id 建 Map;M7/M8 记录已知限制不动
- [ ] **收尾**:全量 `npm run test:all` + 手动冒烟,STATUS 收尾,豁免不 tag

## R8 收尾测试 × R9 综合排期(2026-08-11;测试 A/B/C 组与 R9 合并分 5 批,每批独立迭代、豁免收尾、全量验证)
> 原则:先建安全网(纯函数断言零风险)→ 机械清扫(行为等价)→ 中风险(安全网最厚时);M7/M8 不动;A2 依赖 C3 认知与批 3 的 renderPdf helper;每批 typecheck/build/全量段/smoke 全绿门槛。

- [x] **批 1「测试锚点」(零风险)**:C1 image-type.test.js(R4 修复核心:PNG IHDR/JPEG SOF 尺寸、webp/gif 降级、最大宽 400 等比缩放)+ C2 presets 契约段(matchesPreset 自匹配/微调不匹配、预设值在范围常量内)+ A3 smoke diag 修盲区(enable 后 click 断言守卫文案)。验证 21→23 段 + smoke
- [x] **批 2「smoke 下沉 + 提取逻辑」(零行为改动)**:A1 分页符断言并入 page-setup 段(smoke 删块)+ C3 extractHeadings 直测(多级/中文/编号 → PdfHeading)。验证 23 段 + smoke 瘦身(commit 3219a29)
- [x] **批 3「R9 低风险清扫」(机械/基建)**:L9 取消——checkLocalImages/embedExternalImages 经 imageResolver 真异步(外链下载),renderPdfHtml 保留 async,不值得重构;L7 test/common/settings.js save/restore helper(converter.test.js 换用,smoke.ts 属应用代码不 import test/,保持自身);L6 新建 src/main/temp-html.ts(writeTempHtml),renderPdf/openPreviewWindow 换用。验证 23 段 + smoke
- [x] **批 4「中风险」(安全网最厚时)**:A2 pdf-bookmarks.test.js 书签端到端段(htmlToPdf + injectBookmarks + assertOutline,复用批 3 helper,补 buildBookmarkTree 层级/跨级回挂直测)+ L3 escape 工具集中 core/utils.ts(escapeHtml/decodeEntities/escapeRegExp;template.ts re-export 兼容,math.ts/postprocess.ts 换用)+ M3 currentCtx 按 webContents id 建 Map(三 handler set/delete,cancel 按窗口取)。验证 24→25 段 + smoke
- [x] **批 5「收尾」**:全量 `npm run test:all` 通过;STATUS 当前状态/验证基线更新;手动 GUI 冒烟由用户现场确认,豁免不 tag
