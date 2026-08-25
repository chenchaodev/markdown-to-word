# 研究结论

> 只记录「换会话仍会用上、且别处查不到」的坑/勿回退事实/库事实。已实施且细节见 CHANGELOG 的条目不再重复;选型见ADR.md。原文存档:docs/archive/。
> **路径迁移注记(2026-08-24)**:目录结构重组(2026-08-23,提交 6f3d72a~9909d74)前历史条目「关联」字段中的扁平路径已失效——对照关系:`src/settings.ts`→`src/main/persist/settings.ts`、`src/index.ts`→`src/main/`(拆 windows/ipc/menu/converter/persist/services)、`src/renderer.ts`→`src/renderer/renderer.ts`+六功能域、`src/core/{i18n-dict}.ts`→`src/core/i18n/`、core 根级散文件→`pipeline/markdown/image/settings/util/` 子域。时间戳记录按规约不改写原文。

### 2026-08-25 功能开发技术路线调研(F7 目录带页码 / F9 docx 模板导入)
- **F9 模板导入**:npm 无现成库做「读任意 .docx 模板套用样式」;Pandoc reference-doc=部件级选择性搬运(styles 替换/numbering 合并魔数隔离/settings 白名单/rels 自建),坑多(#1305 numId 断链/#9522 settings 整搬损坏)。**推荐浅导入 v1**(jszip 读 styles.xml 关键 rPr→映射 theme.ts/settings 字段,3-5 天,契合集中字体配置硬约束),深导入列后续独立候选
- **F7 目录带页码**:Word TOC 域+updateFields 打开必弹更新提示(不可关闭,docx#1212),WPS 可能不响应自动更新;docx 静态页码不可行(OOXML 无 page 实体)。**推荐混合路线**:pdf 两遍法静态页码(占位等高目录保布局一致+PDF.js 文本匹配定位,Typora 因单遍打印流做不到=独占差异化)+docx 默认维持静态目录、新增 opt-in 域目录开关(cachedEntries 预填防空白);WPS 行为纳入双实测
- **用户已拍板(2026-08-25)**:F7 采混合路线、F9 采浅导入 v1;决策记录见 ADR-007/ADR-008
- 来源: @librarian 技术路线调研 + 用户拍板;关联: 原文存档 docs/archive/2026-08-25-182036-功能候选调研与迭代排期.md 第六节

### 2026-08-25 18:20:36 功能候选调研与迭代排期(2.0.0 后新阶段)
- **竞品对标核心结论**:格式错乱/公式/Mermaid/代码高亮/批量五大高频痛点本产品均已解决;剩余真实缺口=页眉页脚自定义(Logo 页眉,V2EX #1098305「交付全家桶」最后缺口;Typora 页码 issue 118+ 赞多年未解的反面印证)、水印(GUI 竞品空白)、转换预检报告(零竞品,AI 生成不规范 md 是新时代格式错乱最大来源)、合并+总目录(手册场景真空)。差异化定位:「易用性×正式交付能力」兼得是竞品格局裂缝
- **架构扩展点**:docx handlers/ switch 分发、pdf rules/ 数组挂载、CROSS_REF_KINDS 表驱动、ConvertContext 只增不改——新语法功能落点现成;但**双管线有意不合并**(docx=remark/mdast,pdf=markdown-it),新语法双侧各实现一次成本双倍
- **用户拍板做 9 项**:A1 页眉页脚自定义/A2 水印/A3 标题排版粒度/B1 图片控制增强/B3 表格列宽/C1 转换预检/C2 合并增强/docx 模板导入(解除暂缓)/目录带页码(**推翻 D1 免更新路线**);B2 HTML 白名单扩展/D1 HTML 导出/D2 frontmatter 扩展记录不排期
- **两项推翻既有决策待调研拍板**:docx 模板导入技术路线(原否 docx4js+OOXML 逆映射)、目录带页码方案(D1 静态注入与页码冲突);调研结论出来后更新 ADR
- 来源: @explorer 能力盘点 + @librarian 竞品对标 + 用户选型;关联: 原文存档 docs/archive/2026-08-25-182036-功能候选调研与迭代排期.md;前序: archive/20260814-201622(docx 模板导入原调研)、批次 8 D1 决策

### 2026-08-24 审计整改记录(依赖钉死策略清单 / highlight.js styles 潜伏副作用)
- **依赖钉死策略显式清单**(收敛自 RESEARCH 散落记载与 CHANGELOG):
  - `markdown-it 14.3`:15.0 与 @mdit/plugin-tasklist@1.0.2 peer(^14.2.0)冲突,升级须连带评估 tasklist/footnote 两插件
  - `@mdit/plugin-footnote 1.0.2`:peer 显式 markdown-it ^14.2.0,随 markdown-it 联动
  - `mermaid 11.16.1`:ESM-only 包,依赖 dist 内 IIFE 产物 file:// 直用规避模块 CORS;升级须重验 IIFE 产物存在性与 securityLevel 行为
  - `electron-builder 26.15.3`:27 alpha 不用;26.x 实测 ESM 入口打包成功,升级须重验 NSIS 链路
  - `docx 9.x`:渲染核心,API 面大(Bookmark/InternalHyperlink/SimpleField 等),major 升级须全量回归
  - `highlight.js`:`lib/common` 经 exports map import 条件解析到 es/,**es/ 不可从打包排除**(ERR_MODULE_NOT_FOUND);styles/ 已排除(模板自带 .hljs 颜色)
- **highlight.js styles 排除的潜伏副作用**:package.json build.files 排除 hljs styles/(主题 CSS 手写内联)。若未来任何代码 `import 'highlight.js/styles/xxx.css'`,dev/smoke 正常(node_modules 完整)但打包后静默 404——**dev 全绿 ≠ 打包可用**的又一实例;引入 styles 导入前必须先移除该排除规则并实测打包
- 来源: 全库审计整改批(2026-08-24);关联: docs/archive/2026-08-24-134811-审计待办清单.md(ENG-8/ENG-9)、下方 G5 打包坑条目

### 2026-08-24 02:26:55 目录结构评审(重组后复核,只读)
- **总体判断**:三层分离(core 纯逻辑/main 编排+IO/renderer DOM)与 core 分域(docx/pdf 输出域+markdown/image/pipeline 共享语法域+settings/i18n/util 横切契约)执行一致,handlers↔rules 粒度对称;真正问题仅两类——跨进程契约类型寄居 main 层、test/ segments 与 main 边界不符自述口径
- **P1 契约类型归位**:`main/ipc/channels.ts` 的 ConvertProgressPayload/ConvertMode 类型与 `main/persist/ui-state.ts` 的 UiState/RecentFile 类型均被 renderer type-only import(1+3 处),构成 renderer→main 反向依赖;建议迁 core(如 core/ipc-contract.ts),channel 常量/IO 实现留 main;可与 BatchResult/BatchItem 收敛合并为同一「契约归位」迭代
- **P2 test 归位**:segments/ 里 ipc-channels/ipc-logic/image-downloader/presets-import 四段实为直测 dist/main → 应入 test/main/;settings-logic/renderer-pure 两段直测 dist/renderer → 新建 test/renderer/(需同步扩展 acceptance.mjs 自动发现根);pdf-css-sample.css 零引用应入 fixtures/manual/
- **口径冲突**:本评审「test 部分镜像 src」与 0823 方案裁定「segments 主题式命名不镜像 src」相抵,实施前需用户裁定,采纳则同步改 acceptance.mjs 头注释与 AGENTS.md 测试体系描述
- **确认合理不动**:mermaid 三同名各归其位(可改名澄清如 pdf/mermaid-placeholder.ts);pipeline/merge vs converter/merge 同名但纯函数 vs IO 分层正确;i18n/settings 三处/image-downloader(IO 属 main)/lang-bootstrap.js/preload.cts/dom 单文件/fixtures 双份 png 均有技术理由
- 来源: @oracle ora-1(全量结构+约 20 文件头部核实);关联: 原文存档 docs/archive/20260824-022655-目录结构评审.md;前序: docs/archive/20260823-230554-目录结构优化方案.md

### 2026-08-23 23:05:54 目录结构优化方案(四轮探查定稿,暂不进迭代)
- **总体判断**:现状约 70% 接近理想;结构性欠账 6 项——①core 根级 20 文件平铺(转换入口/设置/i18n/md 特性/图片/工具混一层,P1);②core/i18n.ts 702 行(字典 ~585 行与逻辑混放,引用面全项目最大 ~20 src 文件+测试 31 处,P1);③renderer/events.ts 607 行单函数闭包混 6 个事件域(P1);④main/index.ts 695 行五块混放(P2);⑤main/converter.ts 524 行三实现混放(P2);⑥core/docx 缺 handlers 层(9 节点处理器与横切关注点平铺,P2)
- **关键事实**:i18n EN 字典 `Record<keyof typeof ZH,...>` 编译期锁定键集→ZH/EN 必须同文件;pdf/rules/ 存在因 markdown-it 有规则可覆盖,docx 走 mdast 无规则层,对应物是 handlers/(节点处理器),theme/ctx/prescan/chrome 属横切留顶层——不对称有技术原因非遗留错误;core 根级 17 文件均为纯 ESM 模块,移动=只改相对 import(无动态路径/__dirname);唯一测试联动 contract-single-source.test.js 路径断言
- **明确不拆**:docx/render.ts(467 编排器)/dom.ts(254 纯映射)/math.ts(265 管线顺序阶段)/ui-state.ts(sanitize 防御性冗余)/settings-panel.ts(零直测系有意分层,缺口走 smoke 扩展)/test 大段(长因覆盖面大)
- **用户裁定边界项**:style.css(1248)随 renderer 重组一并拆 style/ 四文件;smoke.ts 移出生产路径首选 test/tools/smoke/(退一步:留原地但确认打包排除)
- **实施批次**:①i18n+core 归组(~90 处 import)→②docx handlers 归拢→③renderer 功能域重组+events 拆分+style 拆分→④main/index.ts 抽取(ctxByWebContents 先收敛防循环)→⑤converter 拆分+smoke 迁移+resource-dirs 合并;每批独立提交 typecheck/build/test 全绿
- 来源: @explorer exp-1 四轮递进探查 + 用户裁定;关联: 原文存档 docs/archive/20260823-230554-目录结构优化方案.md

### 2026-08-23 B10a 工程基建两坑(copy-renderer 混合目录 / incremental 不重建被删产物)
- **dist/renderer 是混合目录**:tsc 编译产物(pure.js/settings-logic.js 等)与 copy-renderer 拷贝的静态资源(index.html/style.css)同居;copy-renderer 加 clean 步骤时**不可整目录 rmSync**(会删掉编译产物致 acceptance 2 段 ERR_MODULE_NOT_FOUND),只能按扩展名清理 `.html/.css`(脚本自身管辖范围)
- **tsc incremental 不检查产物存在性**:tsbuildinfo 记录输入版本,输出文件被外部删除后 `tsc` 仍跳过重编译(幽灵缺模块);恢复须 `npx tsc --build --force`(`--force` 单独用报 TS5093,必须配 --build)。CI 每次全新检出不受影响;本地手动清 dist 后需 force 全量
- 关联: ROADMAP B10;踩坑现场: acceptance 2/40 失败 → build 后复现 → force 恢复

### 2026-08-23 13:30:05 全库质量审计(代码/文档/可用性,改进迭代规划依据)
- **core(28 文件 ~4440 行)**:top 改进——①convert⇄render 运行时循环依赖(docx/render.ts:56、pdf/render.ts:16 仍从 ../convert.js 导入 DEFAULT_PAGE_SETUP,改 settings-defaults.js 即解);②headingNumbering=false 题注编号双格式分歧(captions.ts:60-66 与自身注释 49-51 及 pdf 行为三方矛盾);③frontmatter 误吞以 `---` 开头文档正文(frontmatter.ts:24 无已知 key 守卫);④docx 图片 resolver 无 memo(pdf 侧已有去重);⑤四组人肉同步契约(CROSS_REF_KINDS/sec-label 正则×4/ImageResolver×3/白名单双扫描器已漂移);⑥docx 悬空引用警告不去重;⑦列表项/引用块内不支持的块级内容静默丢弃无警告;⑧slug 40 字符截断在去重后致书签碰撞跳转错位;⑨pdfCss/KaTeX CSS 注入未净化 `</style>`(配合预览窗口无 CSP 成真实注入面);⑩两大 render 文件继续拆分。次要:theme.ts 死导出、表格对齐 docx 丢失、警告文案硬编码中文、hljs 降级无警告、UTF-16 BE 不识别。
- **main/renderer**:进程健壮性三缺口——①无单实例锁(双开静默互踩设置/最近文件);②关窗时转换进行中无拦截(destroyed window + 半成品文件);③无 unhandledRejection 兜底。预览/打印 HTML 模板完全无 CSP+外链导航未收口(mermaid 窗口反而配了)。IPC 参数校验标准不一(settings 有 sanitize,convert/shell 无类型守卫)。可用性 top5:关窗丢转换/进度 3 档钉死 70% 且 print 阶段不可取消/错误提示直出异常原文不可操作/拖放反馈缺陷组合(转换中静默忽略+重复项冒充非 Markdown 跳过+只报数量)/最近条目单击即重转误触成本高。i18n 残留:converter warnings/throw 文案、Mermaid 降级警告、smoke 断言冻结中文(en 下必炸)、index.html zh 默认文案 FOUC、renderer.ts:192 模块级 t() 冻结。无暗色模式(nativeTheme 未引用)。
- **测试/工程**:最大短板是门禁位置——只有 tag 触发 Release 流水线,无 PR/push CI,typecheck/lint/test 仅发版时跑;test:smoke 不含 build 可测到陈旧 dist;settings/i18n/ui-state 三段直接读写真实 %APPDATA%(污染开发者状态,也是并行化障碍);runner 无逐段超时看门狗;tsconfig.eslint.json 是死文件;缺 noUncheckedIndexedAccess;copy-renderer 无 clean 可留脏产物进安装包;docx 解包 tar/jszip 双轨。盲区:main/index.ts(589 行 IPC/取消语义/预览生命周期)、打包态 katex-dir/mermaid-dir 路径定位、theme.ts eastAsia 规则无专门断言。
- **文档**:docs/README.md:3 自述「命令行工具」失实(GUI 后未更新);convert.ts:12 头注释仍称 docx 无高亮(0.32.0 已有 code-highlight);ui-state.ts panelOpen 注释腐化;USER-GUIDE FAQ 偏薄(公式不编号/图片不显示/SmartScreen 未签名提示缺失);根 README 未提 ELECTRON_MIRROR 前置要求。
- **正面确认**(保持不动):安全基线(isolation/sandbox/preload 白名单/零 XSS 面)、原子写+写队列、per-call 取消上下文、aria/焦点管理、fixtures 单一来源(gen-fixtures --check)、负面断言与清理纪律、断言消息嵌入实际值。
- 来源: @explorer×3 并行深审 + 主会话抽查复核;关联: 原文存档 docs/archive/2026-08-23-133005-全库质量审计.md

### 2026-08-16 11:45:20 文档加密调研(@lib-1,排期功能 3/3 依据)
- **docx 库 9.7.1 不支持加密**(maintainer 确认:密码保护 Word 文档非 OOXML 标准,是 Microsoft 专有 Agile/Standard Encryption;dist 全量搜 encrypt/password 零匹配;isEncrypted 是 JSZip 解压检查)
- **docx 替代**:officecrypto-tool 0.0.19(ECMA-376 Agile AES-256/SHA-512,Word 2007+ 兼容;API `officeCrypto.encrypt(buffer, { password })`;CJS 老库依赖 cfb/xml2js/crypto-js,ESM 默认导入需验证);office-crypto 0.1.0 加密未完成;ooxml-encryption 仅 xlsx
- **pdf-lib 1.17.1 不支持写入加密**(README 官方声明;仅 isEncrypted 检测 + ignoreEncryption 加载);printToPDF 无加密选项
- **pdf 加密**:qpdf(node-qpdf2 Promise+TS,`encrypt({ input, output, password, keyLength: 256 })`;或命令行 `qpdf --encrypt user owner 256`);顺序固定:printToPDF → 书签 → 元数据 → 加密最后一步(pdf-lib 无法 load 加密文档);qpdf 原生二进制需 electron-builder extraResources 分发 + 镜像下载
- 来源: @librarian lib-1;关联: 原文存档 docs/archive/20260816-114520-文档加密调研.md

### 2026-08-15 14:40:57 代码/测试/文档组织形式审计(@exp-1 + @ora-1,批次 14+ 规划依据)
- **组织形式(exp-1)**:12 项可调整点——高收益低成本 4 项(README mermaid 条目重复 7 次 / .gitignore 缺 coverage/ / artifacts.js 注释漂移 / STATUS 标题外悬挂 3 行);中收益(lint 只跑 src/ 未覆盖 test/scripts / gen-fixtures.mjs 在 test/tools/ 非 scripts/ / test/fixtures/manual/ 陈旧 / settings.ts+ui-state.ts 双份原子写+写队列 / smoke 备份逻辑重复有意);低收益(preload.cts 混用合理 / build.files 排除 highlight.js/styles 需确认 / archive 24 条接近清理线);已确认合理:docx/render.ts 1015 行单体、style.css 1391 行、33 段零注册体系
- **重构候选(ora-1)**:R1 theme.ts createDefaultStyles 死代码(0% funcs,删);R2 renderer DOM 层零覆盖→纯函数抽取(settings-logic 模式);R3 settings.ts sanitize 未导出不可直测→导出直测;R4 ui-state 宽松回退 vs settings 整文件回退策略并存需注明;R5 recent-files↔convert-flow ESM 循环依赖;R6 index.ts IPC 面 0% 覆盖→handler 纯逻辑抽可测模块(不做 Electron 集成测试);R7 双管线差异加注释标注;R8 硬约束提醒
- **测试缺口(ora-1)**:G1 math.ts 60.65% branch 最大缺口(munderoverToNary 非 ∑ 回落/moText);G2 pdf postprocess.ts 75% stmts(embedExternalImages worker 错误/checkLocalImages catch);G3 bookmarks.ts 旧式 Dests/decodeURIComponent catch/间接目标;G4 metadata.ts 25% branch(无元数据 passthrough);G5 utils.ts decodeNumeric 非法码点/escapeRegExp;G6 converter.ts open 失败/pdf 分支/stat 失败;G7 mermaid-service png 空/catch/退出兜底;G8 单分支小缺口 10 处;G9 已核实不补(encoding/html-whitelist/slug)
- **优先级建议**:立即=G5/G8/G4(~10 组断言);近期=G1/G2/G3;重构驱动=R1→R3/R4→R6→R2/R5;不做=renderer DOM 集成测试/index.ts Electron 集成测试
- 来源: @explorer exp-1 + @oracle ora-1;关联: 原文存档 docs/archive/20260815-144057-代码测试文档审计.md

### 2026-08-14 20:16:22 模板导入方案选型(@lib-1 + @exp-1,批次 13 规划依据)
- **决策**:批次 13「模板导入」= **预设 JSON 导入/导出**(首选;复用 sanitizeCustomPresets 校验,零新依赖,低风险高价值);CSS 模板覆盖(pdf 路线追加用户 CSS,类名固定可覆盖)次选;docx 模板导入暂缓记 ROADMAP(docx 9.x 仅 patchDocument 占位符替换不提取样式;docx4js 3.3.0 单人维护 2024-09 停更 + OOXML 样式→参数模型逆映射工程量大,与自研渲染管线架构相悖;pandoc reference.docx 机制仅作设计参照)
- **关键事实**:预设=纯数值快照(typography+pageSetup),渲染管线只认最终字段值,无资源字段承载位;pdf CSS 全在 template.ts 模板字符串(无变量机制,追加 <style> 后加载可覆盖,但需防用户 CSS 破坏 .page-break/breakBeforeH1 分页强制规则);docx 路线不消费 CSS(OOXML)
- **JSON 格式**:{schemaVersion:1, presets:[{name,typography,pageSetup}]}(兼容裸数组);导入=读文件→sanitize→追加合并(同名覆盖)→上限 10 截断
- 来源: @librarian lib-1 + @explorer exp-1;关联: 原文存档 docs/archive/20260814-201622-模板导入方案.md

### 2026-08-14 18:51:13 双方向探索方案(@des-1/@ora-1/@lib-1/@exp-1/@exp-2,批次 12 规划依据)
- **方向 A 界面体验优化(用户已选,批次 12)**:20 项问题(P1-P20)+ 12 项候选(C1-C12)三阶段;关键缺陷 **P9 点击拖放区=替换整表但文案声称追加**(误触丢全部选择,无确认,renderer.ts:175/222 vs index.html:63/98)、**P1 设置面板展开后转换按钮/进度被推出 640px 视口**、**P3 模板预设埋在第二折叠面板**;本批实施 Phase 0 速赢(C1/C3/C4/C5/C6/C7/C11);C1 语义=多文件态点击追加、单文件态点击更换
- **方向 B 代码质量与测试(未选,存档备查)**:速赢=tsconfig 4 开关(noUnusedLocals/noImplicitOverride/noFallthroughCasesInSwitch)+ depcheck 一次性 + mermaid-service 超时/崩溃降级测试(199 行 vs 34 行,最高回归风险)+ settings-panel 纯逻辑抽取(470 行零直接测试);低风险=eslint 9 flat(仅 correctness,先验证 TS 7 兼容)+ c8(门槛=Electron 主进程 NODE_V8_COVERAGE 实测,需 sourceMap 且排除出 asar);暂缓=prettier/knip/CI;不做=vitest 迁移/再拆 render.ts 主循环
- **工具链硬事实**:c8 12.x/nyc 18/eslint 10/knip 6 全要求 Node 20.19+(Node 18 需锁 c8 10.1.3/eslint 9.39.x;Node 18 已 2025-04 EOL);eslint 10 起 flat config 唯一(eslintrc 全移除);depcheck 停维护(官方推荐 knip);全部纯 JS npmmirror 无坑(分钟级同步延迟);Electron 快捷键(Menu accelerator)/深色模式(prefers-color-scheme + nativeTheme,官方示例已 v43.4.0)均原生能力,UI 侧零新依赖
- 来源: @designer des-1 + @oracle ora-1 + @librarian lib-1 + @explorer exp-1/exp-2;关联: 原文存档 docs/archive/20260814-185113-双方向探索方案.md

### 2026-08-13 21:18:12 验收样例生成方案选型(@用户拍板,测试基建)
- **问题**:test/fixtures/ 仅图片+陈旧 manual/,测试段 md 全内联,用户 GUI 人工实测无最新功能 md 可用(需自己找/写)
- **选型(拍板)**:测试段导出 `export const fixtures = { main: ... }` → 生成器落盘 test/fixtures/acceptance/<段名>[-key].md——md 唯一事实来源=测试段,零重复/永不漂移/自动跟功能走;不选「独立手写验收样例集」(手工维护 + 与断言漂移);另拍板:试点 4 段先行、触发=手动 npm script + 提交前 --check
- **机制**:gen-fixtures.mjs(纯 Node)扫描 segments/main 动态 import → 落盘 md + 复制图片(存在才复制,缺失静默跳过)+ 生成 README 索引(JSDoc 首行);--check 内存重生成逐字节比对(差异 exit 1);幂等;命令 `npm run gen:fixtures`(需先 build)/`npm run check:fixtures`
- **坑**:test/common/pdf-utils.js 顶层 `import { BrowserWindow } from "electron"` 纯 Node 下必 SyntaxError → electron mock 桥接(node:module.register 最小 mock);含 fixtures 段 import 失败一律 exit 1(防不完整索引覆盖旧产物,Windows 反斜杠 dist\ 路径坑已修)
- 来源: 用户决策(2026-08-13,方案对比见存档);关联: 原文存档 docs/archive/20260813-211812-验收样例生成方案.md

### 2026-08-13 19:35:32 mermaid 集成方案调研结论(@librarian + @explorer,8c 实施依据)
- **依赖**:mermaid **11.16.1 钉死**(镜像安装);ESM-only 包 + dist 内 IIFE 产物 `mermaid.min.js`(3.5MB,file:// 直接可用,规避 v11 ESM 动态 import 的模块 CORS);完全自包含零 CDN;node_modules 约 120-130MB(asar 压缩 60-70%);Node 无 DOM 不能渲染(jsdom 垫片布局全毁)
- **渲染链路(已拍板)**:main 进程单例隐藏 BrowserWindow(show:false, sandbox:true, contextIsolation:true, nodeIntegration:false, **backgroundThrottling:false**)加载本地 HTML(IIFE mermaid.min.js)→ `initialize({startOnLoad:false, securityLevel:'strict', theme:'default', fontFamily:'"Microsoft YaHei",sans-serif'})` → `await mermaid.render(id, code)`(内部串行队列,无需自建锁)→ 注入 #graphDiv → `await document.fonts.ready` → **canvas 2x 光栅化** → toDataURL PNG + getBoundingClientRect 尺寸;返回 { pngBuffer, widthPx, heightPx }
- **docx 端**:PNG 嵌入 `ImageRun({type:'png', data, transformation:{width: widthPx/2, height: heightPx/2}})`(逻辑 1x、像素 2x 保打印清晰);**不用 SVG 嵌入**(Word 2019+/M365 才渲染 + docx issue #3227 bug);transformation width/height 必须同时给
- **pdf 端**:SVG 字符串直接内联进 HTML(矢量、零光栅化);highlight 回调同步限制 → 占位 + 后处理替换;`<!-- page-break -->` 分页不变
- **降级**:`mermaid.parse(code, {suppressErrors:true})` 预检失败 → docx/pdf 均输出等宽代码块原文 + 警告(不中断转换);render 超时/崩溃同上;窗口一次性预热复用
- **安全**:securityLevel:'strict'(loose 有存储型 XSS 先例 CVSS 7.6、思源 2026-04 NTLM 窃取通报);隐藏窗口 HTML 加 CSP `default-src 'none'; img-src data:; style-src 'unsafe-inline'` 断网 → 离线隐私承诺(标签内外部资源引用发不出去)
- **坑**:v11 breaking = ESM-only / mermaidAPI 废弃(统一 mermaid.render) / ELK 拆 @mermaid-js/layout-elk(不用 ELK 无影响);maxTextSize 默认 50000 超大图拒绝;打印主题用 default/neutral 浅色;中文靠系统字体回退(Windows 微软雅黑)
- **不做**:@mermaid-js/mermaid-cli(puppeteer+下载 Chromium)、Kroki 在线(违反离线卖点)、resvg-js(不支持 foreignObject 需 htmlLabels:false + asarUnpack)、jsdom 垫片
- 来源: @librarian lib-1 + @explorer exp-1;关联: 原文存档 docs/archive/20260813-193532-mermaid集成方案.md;验收 docs/ACCEPTANCE.md 批次 10

### 2026-08-11 20:11:45 src 架构审查结论(@oracle,重构规划依据)
- **总体**:分层正确(core/main/renderer 单向依赖,core 纯净可复用),问题集中在「契约重复」与「单体文件」两类;docx/pdf 双管线平行实现(题注/公式编号/白名单)是 ROADMAP 选型代价,维持「契约常量共享 + 测试锁定」,不建议合并
- **高优先级**:H1 内联 HTML 白名单 docx/pdf 逐字复制两份(docx/render.ts L1100-1136 vs pdf/render.ts L270-306,注释自认须同步)→ 抽 src/core/html-whitelist.ts 单一实现;H2 契约类型/默认值三处重复(renderer.ts L74-116 内联复制 core 类型,DEFAULT_SETTINGS/校验常量 renderer vs settings.ts)→ renderer 改 import type(编译期擦除,不违反 contextIsolation)+ DEFAULT_SETTINGS 下沉 core;H3 docx 图片固定 400×300 拉伸变形(docx/render.ts L1073-1077)→ Buffer 解析 PNG/JPEG 尺寸按比例缩放,webp 降级占位+警告
- **中优先级**:M1 merge.ts 图片正则 [^)\s]+ 截断含括号 URL、引用式图片/<img> 不处理;M2 renderPdf 临时 HTML 无随机后缀(批量并发 2 同毫秒竞争,index.ts 预览已用随机后缀);M3 currentCtx 全局变量多窗口取消串台(建议按 webContents id 建 Map);M4 settings:set 并发写丢更新竞态(saveSettings 写盘后才更新 cache,建议写队列串行化);M5 pushRuns/pushRunsSync 约 100 行重复(docx/render.ts L821-1022);M6 三处图片警告收集重叠(convert.ts stat 预扫 + docx/pdf 各自,双 IO);M7 extractHeadings 正则依赖渲染细节(pdf/render.ts L660-668);M8 resolverCache/HTTP 缓存无上限(当前可接受,记录即可)
- **低优先级**:L1 魔数嗅探重复(sniffImageType/mimeFromBuffer)、L2 collectPlainText/collectText 重复、L3 escapeHtml/decodeEntities/escapeRegExp 散落、L4 dialog:openMarkdown 死代码(renderer 只用 openMarkdowns)、L5 lastBatchItems/lastBatchResult 状态重叠、L6 openPreviewWindow/renderPdf 窗口结构相似、L7 smoke/converter.test.js save/restore 设置模式重复、L8 buildTemplateCss 150+ 行模板字符串、L9 renderPdfHtml 假 async
- **推荐顺序**:① H1+H2 契约抽取(纯移动+类型擦除,零行为变化,收益/风险比最高)→ ② H3 图片变形修复(唯一用户可见产物缺陷,需同步测试)→ ③ renderer.ts 拆分(1764 行单体,纯重构无用户可见收益,测试保障后做)
- **四大文件拆分补充评估**(同日追加):docx/render.ts(1295)→ 只拆独立岛(白名单→html-whitelist.ts、预扫上下文→docx/captions.ts+equations.ts、工具→mdast-utils.ts+image-type.ts),主循环保持单体;pdf/render.ts(802)→ 轻量拆 3 组(模板→pdf/template.ts、后处理→pdf/postprocess.ts,converter.ts 的 extractHeadings import 须同批改);renderer.ts(1764)→ 两阶段(阶段一:类型下沉 core+dom.ts 零风险;阶段二:先建 state.ts 再拆 convert-flow/file-list/dialogs,模块互不 import);style.css(1198)→ **不值得拆**(级联顺序风险>拆分收益,维持单体+区块注释);执行顺序:docx 白名单共享 → pdf 模板/后处理移动 → renderer 阶段一 → 阶段二,每次独立提交
- 来源: @oracle ora-2;关联: 原文存档 docs/archive/20260811-201145-src架构审查.md

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
- 关联: src/core/{frontmatter,convert}.ts、src/core/docx/render.ts、src/core/pdf/render.ts、src/main/{index,image-downloader}.ts、原文存档 docs/archive/2026-08-03-2311-批次2-spike与实现结论.md(2026-08-15 archive 清理已删,结论见本条)

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
