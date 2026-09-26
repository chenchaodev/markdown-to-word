# 架构决策

> 规则见全局配置目录 @WORKFLOW-PLAN.md 阶段 1;规则与数据真源之分 → 全局配置目录 @AGENTS.md 首节
> **写入的命令/事实须实际验证过**。**追加式**:结论未变 → 就地更新并移至顶部;被推翻 → **新增一条**并把旧条标「已被 … 取代」,旧条**保留**。**号永不复用**;规划编号不作决策标识。「涉架构」四判据 → @AGENTS.md「代码结构与质量」。
> **ADR-009~ADR-015 由 campaign REF-001 从已撤除的优化计划裁决表升格**(原文查 git);该 campaign 的文档契约裁决 D-01~D-05 见其 `campaigns/REF-001-全库优化收尾/PLAN.md`。

## 索引

| ADR | 主题 | ADR | 主题 | ADR | 主题 |
|---|---|---|---|---|---|
| ADR-015 | 测试工程化与范围纳入 | ADR-010 | Node 地板/唯一验证入口/依赖钉死 | ADR-005 | 预设模板(默认/学术/商务) |
| ADR-014 | 双管线保持独立 | ADR-009 | 文档与流程契约口径 | ADR-004 | PDF 书签优先 |
| ADR-013 | 发布供应链与「明确不签名」 | ADR-008 | F9 模板导入浅导入 v1 | ADR-003 | 后续批次规划评审 |
| ADR-012 | 图片信任边界与资源上限 | ADR-007 | F7 目录带页码混合路线 | ADR-002 | Electron GUI + printToPDF(取代 ADR-001 的 pdf 路线) |
| ADR-011 | 预设口径:内置携带完整交付链 | ADR-006 | 公式 KaTeX → docx Math(OMML) | ADR-001 | 非对称管线 + 格式注册表(docx 部分仍有效) |

## 格式示例(固定,勿删勿改)

### YYYY-MM-DD HH:mm:ss 主题(ADR-00N)
- 决策:……
- 理由:……
- 备选: <否决方案 + 否决原因>(无则省略)
- 代价: <该决策引入的成本/限制,无则省略>
- 验证: <构建/测试验证方式>
- 来源: <子代理|主会话|campaign 归档升格>
- 关联: 相关文档 / 文件 / 原文存档(docs/archive/,如有原文存档则必填)

## 条目
### 2026-09-26 19:40:00 测试工程化与计划范围纳入(ADR-015)
- 决策:测试全量纳入类型门禁(逐文件 `@ts-check` pragma,`checkJs` 保持 false);测试段逐子进程隔离(独立进程 + 硬超时杀进程树 + 段级 userData 隔离 + case 级报告 + 失败 artifact);fixture 显式注册
- 理由:隐式 any 与同进程段互相污染会让失败定位失效;门禁只统计「选择面」不构成隔离
- 备选:全局开 `checkJs`(把 dist 产物拉进检查范围);同进程 + 看门狗(定位不到 case)
- 代价:段耗时 2.21x;新增测试源文件须显式标注
- 验证:`tscheck-coverage` 段 + `npm run typecheck`
- 来源:campaign 归档升格(REF-001)
- 关联:`test/common/runner.js`

### 2026-09-26 19:40:00 双管线保持独立(ADR-014)
- 决策:不合并 remark(docx)与 markdown-it(pdf);共同语义抽成共享纯函数/契约,以「必须一致 / 允许不同」差异矩阵 + differential fixtures 锁定
- 理由:两条管线的解析器与渲染器本质不同,合并等于重写;差异是设计意图,需要可执行的差异契约
- 备选:合并为单一管线(丢掉 PDF 侧 HTML/`printToPDF` 的差异化能力)
- 代价:共同语义须双侧实现,靠矩阵防漂移;矩阵段行数偏大(已接受例外)
- 验证:`test/segments/dual-pipeline-matrix.test.js`
- 来源:campaign 归档升格(REF-001)
- 关联:`src/core/markdown/`

### 2026-09-26 19:40:00 发布供应链与「现阶段明确不签名」(ADR-013)
- 决策:现阶段不采购/不接入代码证书,不因缺签名让 Release fail closed,未签名作为**明确风险**对外说明;发布链补 SHA-256 报告、离线 SBOM、许可证/NOTICE、action 固定到 40 位 SHA、环境指纹;自动更新继续排除,只保留手动检查/下载
- 理由:证书采购与 fail closed 会把发布卡在流程之外;供应链风险可用「可追溯 + 明确告知」缓解
- 备选:接入证书并 fail closed(否决:采购与吊销是发布外的长期负担)
- 代价:Dependabot 对 SHA 固定 action 的漏洞告警失效;用户须自行判断未签名产物
- 验证:`npm run check:supply` + `check:signature`
- 来源:campaign 归档升格(REF-001)
- 关联:`docs/SIGNATURE-STATUS.md`

### 2026-09-26 19:40:00 本地与外链图片的信任边界与资源上限(ADR-012)
- 决策:本地图片仅允许源文档目录或明确可信根目录内,校验顺序 = 原始 src → 词法根边界 → realpath → 规范根边界;拒绝绝对路径、UNC、`file://` 及其它协议 URL、越界 `..`;校验扩展名 + 魔数白名单 + 单文件大小上限。外链图片保留但严格限额(超时/单图与文档总量/并发预算/DNS 校验);缓存加 LRU + 条目数 + 字节数上限,失败不缓存
- 理由:本地图片可读绝对路径/UNC 会把本机文件嵌入产物;无上限的外链与缓存会被单个文档拖垮
- 备选:默认禁用外链图片(牺牲既有能力);信任用户 markdown 不设边界(已实证为风险)
- 代价:引用源目录外图片的文档会被拒,需调整目录或改用外链
- 验证:`test/segments/image-type.test.js`
- 来源:campaign 归档升格(REF-001)
- 关联:`src/core/markdown/precheck.ts`(策略单源)

### 2026-09-26 19:40:00 预设口径:内置携带完整交付链(ADR-011)
- 决策:内置预设携带完整交付链(排版、编号与目录、页眉页脚、水印、公式编号、H1 分页),套用时逐组写入并在 toast 列出被覆盖分组;自定义预设只存排版 + 页面设置,故「不入预设」徽标**仅对自定义预设**成立
- 理由:产品口径已按最新行为演进而文档与 UI 文案落后;两类预设语义必须显式区分,否则「恢复默认 / 另存为」会污染外壳设置
- 备选:自定义预设也携带完整链(否决:其用途就是只固化排版与页面)
- 代价:删除自定义预设的回退只还原排版 + 页面,与「套用内置预设」不同链
- 验证:`test/segments/presets.test.js`
- 来源:campaign 归档升格(REF-001)
- 关联:`src/core/settings/settings-defaults.ts`

### 2026-09-26 19:40:00 工程口径:Node 地板、唯一验证入口、依赖钉死(ADR-010)
- 决策:宿主 Node 统一 22.13+(CI 主 job 固定 22.13.0,保留 Node 22 稳定 lane);发布不可绕过门禁 —— `verify:ci` 为唯一基础链(build → typecheck → lint → acceptance → coverage → fixture drift → smoke → geometry),`verify:release` 复用它并追加 dist 清理与产物核对;几何门禁强制进入 CI/Release,跨 DPI 像素基线**默认单档**,多档须先经一次 lane 实跑;依赖按批准范围钉死,范围内 patch/minor 由人工裁决
- 理由:连续四次「本机绿、远端红」的根因都是绕过或缩水的门禁清单;单源入口让 Release 不再维护第二份命令表
- 备选:Release 维护独立缩水清单(两处漂移);默认多档像素基线(runner 行为无法本地验证,「未测量」退出会把 `verify:ci` 打红)
- 代价:门禁链较长;跨 DPI 多档能力默认关闭
- 验证:`npm run check:contract`(+ selftest)
- 来源:campaign 归档升格(REF-001)
- 关联:`package.json` 脚本

### 2026-09-26 19:40:00 文档与流程契约口径(ADR-009)
- 决策:① 豁免「archive 只增不改 / 原文留痕」与「CHANGELOG 容量上限」;② 需求入口单源为 `ROADMAP.md`「候选区」,废除 `BACKLOG.md`;③ 旧的两份全局指南(Windows 平台坑、CHANGELOG 写法)已分别并入 `ENV-GUIDE.md` / `PUBLISH-GUIDE.md`,项目侧**改指**而非补建;④ 旧小节名以现行全局节名为准;⑤ `ACCEPTANCE.md` 的「不删行」判读为「不删功能点行」
- 理由:① 统一 archive 命名与按发布口径重写 CHANGELOG 会被这两条约束挡路;② 双源与全局模板的「单一入口」冲突;③④ 旧名在全局已不存在,补建造成第二份真源、沿用旧名即死指针;⑤ 要保住的是跨迭代验收资产,行下散文块不在其列
- 代价:archive 原文不再逐份留痕(决策与事实已分别升格到本文件与 `RESEARCH.md`)
- 验证:`grep` 核对零悬空指针;三处编号台账人工对表
- 来源:campaign 裁决 D-01~D-05 升格(REF-001)
- 关联:`docs/ROADMAP.md`、`AGENTS.md`

### 2026-08-25 功能开发技术路线拍板:F7 目录带页码混合路线(ADR-007,推翻 D1)/F9 模板导入浅导入 v1(ADR-008)
- **F7 决策**:PDF 用两遍法静态页码(第一遍标题锚点+占位等高目录保证布局一致→PDF.js 文本匹配定位页码→第二遍注入);docx 默认维持 D1 免更新静态目录不变,新增 opt-in「Word 域目录」开关(TOC 域+updateFields+cachedEntries 预填条目;Word 打开弹一次更新提示不可关闭,WPS 可能需手动刷新——纳入 WPS-COMPAT 双实测)。**部分推翻批次 8 的 D1 免更新路线**:域目录作为用户自选 opt-in 而非默认
- 理由:docx 静态页码不可行(OOXML 无 page 实体,分页由渲染引擎决定);pdf 两遍法是 Typora 因单遍打印流做不到的独占差异化;弹窗权衡交用户自选而非强加
- **F9 决策**:模板导入做浅导入 v1——jszip 解包用户 .docx 模板,提取 Heading 1-6/Normal 样式 rPr(字体 ascii/eastAsia/字号/颜色/basedOn 一层继承)映射到现有 settings/theme 字段(含 sectPr 页面尺寸边距);不做部件级深导入(Pandoc 式 styles 替换+numbering 合并+settings 白名单,2-4 周+长期维护负担),列后续独立候选
- 理由:npm 无现成库;浅导入覆盖约 80% 诉求且契合 theme.ts 集中字体配置硬约束;解析层是深导入真子集可演进不锁死
- 来源: @librarian 技术路线调研 + 用户拍板(2026-08-25)
- 关联: docs/archive/2026-08-25-182036-功能候选调研与迭代排期.md 第六节、docs/RESEARCH.md 同日条目、ROADMAP F7/F9

### 2026-08-08 10:20:16 批次 6 公式路线:KaTeX → docx Math(OMML),PDF 复用 KaTeX 渲染(ADR-006)
- 决策:docx 公式走 KaTeX MathML 输出 → 转 docx Math(OMML,超出调研范围超额交付);PDF 公式直接 KaTeX HTML+字体渲染(与已有 printToPDF 管线一致);MathML 转换失败时降级为 TeX 源码纯文本兜底
- 理由:单一公式源(KaTeX)双格式复用;OMML 为 Word 原生公式格式,可编辑;PDF 侧无需第二套公式引擎
- 来源: @librarian(lib 调研)+ 自查(落地验证)
- 关联: docs/RESEARCH.md 2026-08-08 10:20:16 批次6公式链路条目、docs/archive/2026-08-06-2229-批次6公式链路调研.md、CHANGELOG 0.16.0

### 2026-08-06 22:28:50 批次 6 模板包:预设模板(默认/学术论文/商务简报)(ADR-005)
- 决策:新增预设模板下拉,一键套用「排版设置 + 页面设置快照」;模板微调后下拉回退「默认」并提示不一致
- 理由:学术正式化目标下,排版参数化(批次 5)升级为可复用模板;避免用户每次手动配齐参数
- 来源: 自查(用户需求)
- 关联: CHANGELOG 0.15.0、src/main/settings.ts 模板预设

### 2026-08-04 22:44:37 批次 4 开工:PDF 书签优先(ADR-004)
- 决策:批次 4「长文档」开工,PDF 书签优先(用户实测反馈侧边栏书签为空);脚注/页眉页脚+页码随后
- 方案确认:读 printToPDF 产出的 /Dests 命名目标 → pdf-lib 注入大纲(免 pdfjs 文本定位);已实测合并 PDF 含 18 个 Link 注释 + /Dests 命名目标,锚点链接存在但无大纲树
- 红线:书签 H1/H2 最小版或砍;注意 /Dests key 编码(中文 slug 为 UTF-16BE hex)
- 理由:用户实测反馈 + 前置产物结构解析(研究结论 2026-08-04 20:57:34 条目)
- 来源: 自查(用户反馈 + 产物解析)
- 关联: docs/ROADMAP.md 批次 4、docs/RESEARCH.md 2026-08-04 20:57:34 条目

### 2026-08-03 23:28:16 后续批次规划评审(批次 3 拆批 + 批次 5/6 方向,ADR-003)
- 决策:批次 3 拆两批——3「批量+合并」(多选/拖放文件夹+队列+失败汇总;合并=渲染前 md 拼接,frontmatter 仅取首个,封面/全局 TOC 自动成立)与 4「长文档」(PDF 书签 + 脚注);批次 5「中文排版深化+保真补全」(字体/字号/行距/首行缩进/两端对齐/章节编号/docx 内部链接/raw HTML 白名单);批次 6「学术正式化」(脚注/公式 KaTeX+OMML spike/模板包)
- **PDF 书签改方向**:弃 pdfjs 文本定位(拆 span/中文匹配脆),改「读 printToPDF 产出的 /Dests 命名目标 → pdf-lib 注入大纲」——slug/标题文本自产一一对应,免文本提取,风险高→中低;注意 /Dests key 编码(中文 slug 为 UTF-16BE hex)
- 砍:自动更新/签名、i18n、目录监视/同步、Mermaid/CLI;延后:最近文件、代码高亮主题切换、分节页面设置、图片尺寸/表格列宽
- 理由:@oracle 评审(ora-1);护城河重心从「格式正确」转向「排版可定制」
- 来源: @oracle
- 关联: docs/ROADMAP.md、原文存档 docs/archive/2026-08-03-2325-后续批次规划评审.md(2026-08-15 archive 清理已删,决策见本条)

### 2026-08-02 19:20:18 Electron GUI + 自研 printToPDF 管线(ADR-002)
- 决策:产品形态改为 Windows GUI(Electron 43);pdf 路线弃 md-to-pdf,改「markdown-it → HTML 模板 → `webContents.printToPDF()`」;转换在主进程执行;IPC 用 `contextIsolation` + preload 白名单(`invoke`/`send`);新增 `src/main/` 与 `src/renderer/`,core 与注册表设计不变
- 理由:主进程即 Node,转换核心零改造复用;Electron 自带 Chromium 一份两用(GUI + PDF 打印),避免双份 ~300MB 体积;HTML 模板为二期预览铺路
- 修订:ADR-001 中 pdf 路线(md-to-pdf)被本条目取代;docx 自研管线与格式注册表不变
- 来源: @oracle
- 关联: docs/ROADMAP.md

### 2026-08-02 18:20:36 非对称转换管线 + 格式注册表(ADR-001)
- 决策:docx 走 remark AST 自研渲染,PDF 走 md-to-pdf 现成管线;`src/core/convert.ts` 以格式注册表分发
- 理由:中文 eastAsia 可控是硬需求,值得自研 docx 渲染;注册表预留格式扩展
- 已被 2026-08-02 19:20:18 ADR-002 部分取代(pdf 路线);docx 部分与注册表设计仍然有效
- 回退:若自研 docx 渲染工作量失控,回退到 `@mohtasham/md-to-docx`
- 来源: @oracle
- 关联: docs/ROADMAP.md

## 编号台账

> **ADR 号唯一真值。** 与 `ROADMAP.md`「编号台账」同一纪律:连号、永不复用、「已用」记**已分配过的最大值**。核对:人工读本行与「条目」节已用最大号对表;发版前确认 → 全局配置目录 @PUBLISH-GUIDE.md。

已用 ADR 001-015  ｜ 下一个 ADR-016
