# 状态速查

## 当前状态

- 2026-09-25:**发版 3.11.7 完成**(技术债 D 批六项结构重构随版发布;四源同号 package.json=lockfile=tag v3.11.7=CHANGELOG [3.11.7];typecheck/lint/build/70 段/smoke 全绿;GitHub Release 资产 MarkdownToWord-Setup-3.11.7.exe + latest.yml,Release 四源门禁与 CI 流水线均 success;发版内容仅对话框位置记忆一处用户可感知改进,其余为内部重构)
- 2026-09-25:**技术债 D 批(结构重构)六项全部关闭,`docs/TECH-DEBT-PLAN.md` 已回写**:六项独立提交 `fdd132f`(D5 段归位)→`9b57dee`(D6 对话框样板)→`07ee67a`(D4/C5 契约归位)→`fb4c70e`(D3 pdf 模板三拆)→`06a3bd2`(D2 settings 六组拆线)→`b3d7d83`(D1 向导三块拆分),每项 typecheck/lint/build/70 段/smoke 全绿;**GUI 实测已通过(2026-09-25,ACCEPTANCE 两处复测记录回写,无未关闭项)**;E 批(E1-E5)待恢复开发,决策点仅剩 E2

- 2026-09-25:**技术债 D1 完成(`book-wizard.ts` 967 行按「步骤渲染/校验/提交」三块拆五文件)**:`wizard-steps.ts`(408 行,版式四步:模板/封面/页眉页脚/水印 + 封面实时预览与封面控件引用)、`wizard-steps-delivery.ts`(273 行,交付三步:合并源/目录/付印 + 合并源数据操作与当前步渲染 `renderStep`——与 syncSources 互调同岛落位,拆分以依赖无环优先)、`wizard-fields.ts`(180 行,「校验」块:边距/字号/行距/字体钳制校验绑定 + h/radio/开关行等共用零件)、`wizard-runtime.ts`(35 行,草稿/模态容器/步序单例——ESM 导入绑定只读,赋值经 resetDraft/setStep/setWizardEl 收口,避免单例留外壳成环)、`book-wizard.ts`(219 行,外壳/导航/打开关闭 + 「付印提交」节 cleanMetadata/finishWizard);机械化等价核对:差异仅 import 重排/函数 export 化/setter 收口/局部 el 收窄,函数体零行为漂移;外部契约不变(`openBookWizard`/`closeBookWizard` 导出与三处消费点零改动);DEV-GUIDE 代码地图同步;typecheck/lint/build/70 段/smoke 全绿;向导 GUI 实测随 D 批收尾统一走 ACCEPTANCE

- 2026-09-25:**技术债 D2 完成(settings 接线按六组 Tab 拆分)**:`settings-bindings.ts` 710 行 → 8 文件(编排 51 + preset 154 / typography 194 / headerwatermark 129 / numbering 57 / convert 120 / app 93,分组口径 = index.html `data-group`);57 处 addEventListener 逐一搬移零增减,机械化等价核对(除 import 重排与函数 export 化外零行为行差异);`settings-panel.ts` 560 → 443(预设弹窗/保存/删除/导入导出 127 行迁 `settings-preset-actions.ts` 163,四个分组 persist 整体写回收为 panel 单源导出);`applyTemplatePreset` 随预设组落位(book-wizard 改源 import)、`closePresetSaveDialog` 归 preset-actions(dialogs-events 改源),无 re-export 垫片;控件 id/name 零触碰(HTML/refs 未动——refs 类型导出编译期守卫引用完整性 + smoke 控件计数);DEV-GUIDE 代码地图与 BOOK-WIZARD/dialogs-events 依赖注释同步;typecheck/lint/build/70 段/smoke 全绿;GUI 实测随 D 批收尾统一走 ACCEPTANCE

- 2026-09-25:**技术债 D3 完成(`core/pdf/template.ts` 403 行职责拆分)**:拆为三文件——`template.ts`(158 行,模板结构与安全:页眉页脚 chrome/HTML 组装/TEMPLATE_CSP/sanitizeStyleCss/封面)、`template-css.ts`(213 行,文档模板 CSS 纯函数生成)、`katex-css.ts`(44 行,KaTeX CSS 加载,core 唯一 fs 注入点随之归位);消费点同步(render.ts 三 import 分流、formula/page-setup 段注释与 import 路径)、DEV-GUIDE 零 IO 口径 `pdf/template.ts`→`pdf/katex-css.ts` 与 pdf/ 代码地图更新;typecheck/lint/build/70 段/smoke 全绿

- 2026-09-25:**技术债 D4/C5 完成(跨进程契约类型归位 core + convert.ts 双入口收口)**:新建 `core/ipc-contract.ts` 单源承载全部跨进程契约(ConvertProgressPayload/ConvertMode、BatchItem/BatchProgressInfo/BatchResult、UiState/PanelOpen/WindowBounds/RecentFile),main 侧(channels/persist/converter)与 renderer 侧共同 import 同一契约,renderer→main type-only 反向依赖清零——仅剩 `renderer.ts` 的 `type PreloadApi`,属 preload「实现即契约」推导设计(评审 P1 未列入迁移范围,维持不动并声明);C5 并入:`core/convert.ts` 的 DEFAULT_*/ConvertFormat re-export 双入口删除,7 处消费点(6 main + 1 测试)直连 settings-defaults;RESEARCH 2026-08-24 条目补处置行(P1/P2/口径冲突关闭)、候选池 E1 状态回写、ROADMAP 已知限制关闭、DEV-GUIDE 代码地图增列;typecheck/lint/build/70 段/smoke 全绿

- 2026-09-25:**技术债 D6 完成(打开对话框样板收口 + compareVersions 单源化)**:抽 `selectAndRememberDir` 助手,四处 handler(fileOpenDialog/dirSelect/headerLogoSelect/templateImportDocx)的「开对话框→默认目录回落→记忆所选」三连样板收口;**行为等价偏离声明**:模板导入的目录记忆时机由「处理成功后」提前为「选择成功即记忆」(读取失败也记住刚浏览的位置),importFileViaDialog 维持原有「处理失败跳过记忆」语义;`compareVersions` 自 register.ts 下沉 `ipc/logic.ts` 纯逻辑层,`about-update` 段的内联同逻辑副本删除、改直测 dist 真实实现(双源清零)并按镜像口径归位 `test/main/`(段分布 47+19+4);typecheck/lint/70 段/smoke 全绿
- 2026-09-25:**技术债 D 批开工,D5 test 段归位完成(用户裁定「全量镜像三层」口径)**:test 树镜像 src 分层——9 个 main 主题段→`test/main/`、4 个 renderer 主题段→新建 `test/renderer/`(acceptance.mjs 扩第三发现根),segments 只留 48 个 core 渲染主题与跨层契约守护段;目录组织标准由「三条并存」改镜像三层(AGENTS/DEV-GUIDE/acceptance·runner 头注释与 6 处指针同步);eslint `allowDefaultProject` 手工清单补 `test/renderer/*.js`(E4 风险实证);段数 70 不变(48+18+4),typecheck/lint/70 段/smoke 全绿;后续 D6→D4/C5→D3→D2→D1 逐项独立提交
- 2026-09-25:**发版 3.11.6 完成**(技术债 A/B/C 三批随版发布,封版期维护批收官;四源同号 package.json=lockfile=tag v3.11.6=CHANGELOG [3.11.6];typecheck/lint/70 段/smoke 全绿;GitHub Release 资产 MarkdownToWord-Setup-3.11.6.exe + latest.yml,Release 四源门禁与 CI 流水线均 success)
- 2026-09-25:**技术债 C 批完成(core 双源收敛 + 零 IO 口径,封版期 A/B/C 三批全部收官)**(C3 水印色三处+表格边框色收 `core/style/colors.ts`/theme 单源;C2 hljs 30 色板抽 `core/style/hljs-palette.ts` 共享常量,docx/pdf 双侧引用;C1 警告去重抽 i18n 共享 `warnDedupKey`/`pushWarningOnce`,docx ctx 薄封装+pdf equation/xref/image 三处自建 Set 归零;C4 决策点拍板 **①a 最小注入**:`loadKatexCss` 增 `deps.read` 注入与 precheck 同构、DEV-GUIDE「零 IO」口径订正「常态零 IO+两处注入默认值」;每批核心回归,全量 typecheck/lint/70 段/smoke 全绿;C5 并入 D4;自动断言见 test/segments/{watermark,table-width,code-highlight,i18n,eq-numbering,image-size,formula}.test.js)

- 2026-09-25:**技术债 B 批完成**(B1 about 外链 IPC 收口 channels 单源+镜像恒等;B3 ja 字典 satisfies 全量锁 441 键;B4 令牌破例清零[新增 --switch-knob/--seal-ring/--shadow-drawer]+关于窗底色随系统主题;B2+A5 关于窗 sandbox:true+CSP 与主窗同口径[一次性脚本 13 项断言];B5 深色双块恒等断言段,段数 69→70;typecheck/lint/70 段全绿+ui:shots 双主题抽查;GUI 实测通过 2026-09-25,ACCEPTANCE「关于窗沙箱与 CSP」3 项全勾关闭)

- 2026-09-25:**技术债 A 批完成**(A1 段数订正 STATUS/ci.yml→69 段;A2 沉没债补登记 ROADMAP「已知限制」:契约类型归位 core+test 段归位;A3 coverage/tmp 残留清理;A4 G1-G9 盘点全部关闭[G1-G8 断言证据齐全,G9 维持不补,关闭记录入 RESEARCH+候选池 E2];A5 关于窗 CSP 随 B2;纯文档提交,typecheck/lint 基线见下条)

- 2026-09-25:**封版期文档一致性回写 + 发版门禁补强**(lockfile 版本 3.10.2→3.11.5 修正、release.yml 增 tag↔package.json↔lockfile 四源校验、ROADMAP D1/F8/F9 状态回写、ACCEPTANCE 删陈旧副本、关于页更新提示 GUI 实测通过 U1-U3 关闭;typecheck/lint 全绿;代码分析四路盘点落盘 archive 原文+RESEARCH 摘要+README 登记,处置计划 docs/TECH-DEBT-PLAN.md)

- 2026-08-31:**封版暂停开发,文档全面重写完成(3.11.5 发版)**(typecheck/lint 全绿;README/README_EN/USER-GUIDE 按最新功能全面重写;版本号三统一 package.json=tag v3.11.5=CHANGELOG [3.11.5])

- 2026-08-31:**封版暂停开发,文档技术债清理完成(3.11.4 发版)**(typecheck/lint/build/smoke 全绿;文档更新至最新状态;版本号三统一 package.json=tag v3.11.4=CHANGELOG [3.11.4];暂停新功能开发,专注文档维护与技术债清理)

- 2026-08-30:**3.10.1 修复发版(合并 3.9/3.10 两次失败发版的全部功能:剪贴板直转+成书向导+D1 GUI 易用反制 AIDOC+实测修复;另修 CI smoke 菜单守卫陈旧断言)**(typecheck/lint/build/本地 smoke 全绿;GUI 实测通过 2026-08-29;版本号三统一 package.json=tag v3.10.1=CHANGELOG [3.10.1];远程无 v3.9.0/v3.10.0 tag,功能并入本版)

- 2026-08-29:**D1 GUI 易用反制 AIDOC 晋升并开工**(预设扩面覆盖交付链/向导补全高频复杂项/首次启动引导三批,从 ROADMAP-CANDIDATES 晋升,规划即契约入 ROADMAP 当前待办 + ACCEPTANCE;独立提交可回退;每批 GUI 实测走 ACCEPTANCE)
- 2026-08-29:**剪贴板直转 + 成书向导 完成并随 3.10.1 发版(3.9.0 发版失败,功能并入本版)**(typecheck/lint/build/68 段全绿;GUI 实测通过 2026-08-29;版本号三统一 package.json=tag v3.10.1=CHANGELOG [3.10.1];剪贴板直转决策:①不做热键仅按钮 ②剪贴板始终当 Markdown ③文件路径当文件加入队列;成书向导决策:封面页双格式 docx+pdf/仅空态按钮入口/设置实时写入/封面不含单位):剪贴板直转落盘 main IPC clipboard:read+临时 md+renderer 空态按钮+i18n(GUI 实测通过);成书向导落盘 renderer 向导 stepper 模态+核心 metadata 透传+readFrontmatter IPC+空态按钮+i18n(68 段测试全绿);设计文档 docs/design/book-wizard.md;GUI 实测项见 ACCEPTANCE;独立提交可回退
- 2026-08-28:**设置抽屉重组为 6 组 Tab 导航完成并随 3.8.0 发版**(typecheck/65 段全绿;smoke 本沙箱环境受限未跑,GUI 实测待补;版本号三统一 package.json=tag v3.8.0=CHANGELOG [3.8.0]):原 9 分区归并为 6 组(01 预设/02 排版/03 页眉页脚与水印/04 编号与目录/05 转换/06 应用),左侧 tab 栏导航+右侧当前组独立滚动;抽屉加宽 100px 选项不拥挤、tab 标签折行禁横向滚动;预设作用域收敛「排版·编号与目录」;导出后行为文案「打开所在文件夹」→「打开文件夹」;i18n 增删组名键;settings-ia.md 同步;控件 id/name 全保留
- 2026-08-28:**B1 AI 清理 + A1 中文排版预设 + C1 Obsidian 兼容 完成并随 3.7.0 发版**(typecheck/lint/build/65 段全绿;smoke 本沙箱环境受限未跑,GUI 实测待补;版本号三统一 package.json=lockfile=tag v3.7.0=CHANGELOG [3.7.0]):B1 新增 core/markdown/ai-cleanup.ts + preprocessMarkdown 编排 + 转换入口注入 + 09 分区开关 + i18n;A1 TEMPLATE_PRESETS 增 official-cn/cn-reader/cn-minimal + 预设下拉动态化(allPresets());C1 新增 core/markdown/obsidian.ts + 转换入口注入 + 09 分区开关 + i18n;自动断言见 test/segments/{ai-cleanup,chinese-presets,obsidian,presets,settings}.test.js
- 2026-08-28:**关于页重构完成并随 3.6.0 发版**(typecheck/lint/build/62 段全绿;GUI 实测通过;版本号三统一 package.json=lockfile=tag v3.6.0=CHANGELOG [3.6.0]):自研关于页面(纸感卡片+钤印+三语),去重+快速上手/特性标签+手册按钮(中性墨色),入口置标题栏设置右侧、弹窗居中主窗口;作者链接 GitHub 主页;手册链接 master 分支
- 2026-08-28:**F7 目录带页码完成并随 3.3.0 发版**(ADR-007 混合路线,部分推翻 D1;typecheck/lint/build/60 段/smoke 全绿;GUI 实测通过 ACCEPTANCE F7 D1/D2 全勾):批① docx opt-in「Word 域目录」(tocMode:'static'|'field' 设置单源 + 双格式一致开关 + UI 抽屉 L2 目录模式下拉 + i18n 三语 + toc-caption.test.js 补断言);批② PDF 两遍法静态页码(field 模式触发——第一遍打印经既有 /Dests 命名目标解析定位标题页码,免 pdfjs 文本匹配 → 第二遍注入 .toc-page 点线引导页码重印,正文布局一致;自动断言见 test/segments/toc-pagenum.test.js)
- 2026-08-28:**F8 合并总目录增强完成并随 3.4.0 发版**(typecheck/lint/build/61 段/smoke 全绿;GUI 实测通过 ACCEPTANCE F8 D1(2026-08-28 随 3.4.0 验收关闭):现状合并已是单 convert 通路(mergeMarkdowns → convert 一次),标题/题注编号本就跨文件连续、TOC 本就覆盖全文;F8 仅固化「合并总目录覆盖全部源文件标题 + 跨文件页码准确」行为(无需新增核心代码,仅补测试防止回归);自动断言见 test/segments/merge-toc.test.js(docx+pdf 双格式总目录覆盖 A+B 共 8 标题、PDF 跨文件页码单调且 B>A、.toc-page 注入)
- 2026-08-28:**F9 docx 模板导入完成并随 3.5.0 发版**(typecheck/lint/build/62 段/smoke 全绿;GUI 实测通过 ACCEPTANCE F9 D1(2026-08-28 随 3.5.0 验收关闭):浅导入 v1(ADR-008)——jszip 解包 .docx 提取 Normal/Heading1 样式 rPr(字体 ascii/eastAsia)+ 字号 + 文档 sectPr(页面尺寸/边距),映射回 typography/pageSetup 设置(标题样式字体优先、页面尺寸匹配纸张+朝向判定);UI 设置抽屉 01 预设·管理动作行新增「导入 Word 模板」按钮,main 打开对话框→解包合并持久化→回填控件;i18n zh/en/ja 补齐;颜色等深导入列后续独立候选;自动断言见 test/segments/template-import.test.js(纵向 A4+横向 Letter 两案例)
- 2026-08-28:**F5 文字水印 + F6 转换预检 GUI 实测全部通过**(随 3.2.0 发版关闭);F6 核心 src/core/markdown/precheck.ts 纯函数+DI(exists 默认 fs.existsSync),复用 imageNotFoundWarning/crossRefNotFoundWarning + 新增 unlabeledCodeBlockWarning;i18n 三语补齐 warn.unlabeledCodeBlock/precheck.*;IPC convert:precheck 单源通道 + preload 镜像 + 报告弹窗(「校」校勘印章,复用既有朱砂警示语汇);单文件/批量/合并转换前统一触发,无问题静默继续、有问题弹报告(继续/取消);typecheck/lint/build/59 段/smoke 全绿;自动断言见 test/segments/precheck.test.js;F5 水印 W1 四项 + F6 预检 P1 四项用户 GUI 实测全勾;版本号四源统一 package.json=lockfile=tag v3.2.0=CHANGELOG [3.2.0]
- 2026-08-27:**发版 3.1.0 完成**(F5 文字水印全链路 + 设置抽屉收窄打磨;版本号四源统一 package.json=lockfile=tag v3.1.0=CHANGELOG [3.1.0];typecheck/lint/build/58 段/smoke 全绿;F5:docx DML 旋转置底(zIndex:-1,经典对角)+pdf CSS 覆盖(.wm rotate/opacity),双格式通用,UI 抽屉 05 组挂「不入预设」,自动断言见 test/segments/watermark.test.js;抽屉 340/320/300 响应式档位修正此前近似无变化的 356 档;fix:settings 契约守卫补 watermark 第 15 键)
- 2026-08-27:**发版 3.0.1 完成**(界面打磨遗留③主按钮脉冲 ④状态行呼吸色;最小变更补丁号;版本号四源统一 package.json=lockfile=tag v3.0.1=CHANGELOG [3.0.1];typecheck/lint/build 全绿;①模板预设卡化/②单文件卡能力 chips 暂缓记 ROADMAP)
- 2026-08-27:**发版 3.0.0 完成**(界面重大重构合并发布 v3「印刷付梓」+ v4「常驻文稿台」:主版本号跃迁 2→3;GUI 实测全部通过;版本号四源统一 package.json=lockfile=tag v3.0.0=CHANGELOG [3.0.0];测试 57 段/smoke 全绿;遗留 4 项记 ROADMAP 不排期)
- 2026-08-26:**UI 改版 v4r2 完成,待 GUI 实测**(用户实测反馈四项全落地:①舞台常驻纸面化——.stage 即文稿台纸面容器,空/文件/参数脚注共用一张纸,切换只换内容消除突变;队列行直接排纸面去嵌套卡;②全界面宽度统一——历史/消息/动作栏内容对齐 760 统一内容列(padding-inline max 公式),色带仍全宽;③minWidth 880→640 半屏可用,新增 ≤720 档参数条折两行(qb-output flex:0 0 100% 禁收缩),舞台高度改 min(100%,设计高) 任何窗口参数条都在视野内零滚动;④设计同步——ui-guidelines §2/§5 重写(常驻纸面/列贯穿/级联纪律/视觉验证节),mockup 头部 v4r2 差异注记;踩坑:base→drop 级联序压掉舞台域响应式(纪律:舞台域覆盖住 drop.css §7)、隐藏窗口 transition 时钟不推进致截图半透明帧(ui:shots 注入动效冻结)、flex 容器 margin:auto 吸收交叉轴;ui:shots 6 状态视觉验证全过;typecheck/lint/build/test 57 段/smoke 全绿;r2r1 补丁:移除 scrollbar-gutter(单侧沟槽顶偏居中列 5px,舞台高度 min(100%) 后已无滚动无需沟槽),四角裁切线上移挂 .stage 容器角(令牌反推在参数条折行时错位),仅空态显示;ui:shots 增 640 空态场景共 7 图全过;typecheck/lint/test 57 段/smoke 全绿;r2r2 补丁:转换开始舞台跳动根治——进度行改与动作按钮同行(弃 1 1 100% 独占行,动作栏恒高),转换中 :has 隐藏快捷键提示腾位,消息区改固定槽高 96/矮窗 86(内容超长内部滚动,safe center 防裁顶),矮窗 .feed padding 覆盖破坏列对齐一并修正;ui:shots 新增转换中零跳动断言(stage/actionbar rect 逐像素恒定)+3b 截图,8 场景全过;typecheck/lint/test 57 段/smoke 全绿)
- 2026-08-26:**发版 2.2.0 完成**(界面重构 v3「印刷付梓」:主进程无边框标题栏+titleBarOverlay 主题同步/renderer 设计令牌+七组抽屉+历史折叠条+toast+align 枚举迁移/设计稿对齐批——seg·stepper·range 控件形态+恢复默认+PDF CSS 文本域+队列行样式/应用图标钤印重做+dev 窗口图标接线/i18n 三语补齐;测试 56→57 段全绿;实测反馈修复:设置按钮归位右上角;遗留 4 项记 ROADMAP 不排期)
- 2026-08-25:**界面重构 v3「印刷付梓」实施完成**(设计已确认:样稿 docs/design/ui-mockup.html + 信息架构 settings-ia.md + 规范 ui-guidelines.md;范围=主进程无边框标题栏+titleBarOverlay 主题同步/renderer 设计令牌与七组抽屉/历史常驻折叠区/空态签名元素/toast/align 枚举迁移)
- 2026-08-25:**发版 2.1.0 完成**(功能开发阶段 F1-F4 四批 GUI 实测全部通过;版本号四源统一 package.json=lockfile=tag v2.1.0=CHANGELOG [2.1.0];测试 54→56 段全绿;**剩余 F5 水印/F6 转换预检/F7 目录带页码/F8 合并增强/F9 模板导入暂停开发**,排期与已拍板路线见 ROADMAP/ADR-007/008)
- 2026-08-25:**F4 页眉页脚自定义完成,待 GUI 实测**(settings 新增 headerFooter 契约单源不入预设体系;docx chrome 页眉三模式 default/custom/none+左右分栏制表位+logo ImageRun 内嵌,pdf printToPDF headerTemplate(base64 data URI,7pt/#888888 与 docx 对齐);logo 读失败 keyed 警告降级;抽屉 L2 新区块+header-logo:select IPC;buildConvertContext async 化;56 段全绿)
- 2026-08-25:**F7/F9 技术路线已拍板(ADR-007/008),规划定稿待执行指令**(F7=混合路线:pdf 两遍法静态页码+docx opt-in 域目录开关;F9=浅导入 v1:jszip 提取模板样式映射现有设置;F4 页眉页脚/F5 水印/F6 转换预检/F8 合并增强按批次表依次实施)
- 2026-08-25:**F3 标题排版粒度完成,待 GUI 实测**(typography 新增 headingScale/headingSpacing 三档枚举,双管线同源纯函数消费,抽屉 L2 两下拉,预设字段同步;54 段全绿)
- 2026-08-25:**F2 表格列宽控制完成**(已提交 09b248e;dash 比例列宽信号;53 段全绿)
- 2026-08-25:**F1 图片控制增强完成**(已提交 ede4c4a;`{width/height}` 属性语法+figure 居中;52 段全绿)
- 2026-08-25:**功能开发阶段立项「F1-F9」**(双路调研后用户拍板 9 项;F7/F9 技术路线调研已完成待拍板:推荐 pdf 两遍法静态页码+docx opt-in 域目录 / 模板导入浅导入 v1;调研存档 archive/2026-08-25-182036;每批独立提交,逐批实施)
- 2026-08-24:**发版 2.0.0 完成**(界面整体重构大版本:布局稳定性/设置抽屉化/反馈统一打磨/响应式修复/多语言精简 zh-en-ja 五批次;GUI 实测全部通过;版本号四源统一 package.json=lockfile=tag v2.0.0=CHANGELOG [2.0.0];测试 51 段全绿)
- 2026-08-24:**多语言精简批次「保留 zh/en/ja」完成,GUI 实测通过**(删除 ko/fr/ru 字典+注册表收敛;isValidSettings 放宽 language 校验为字段级回退——已存 ko/fr/ru 启动回退 zh 且其余偏好保留,迁移测试固化;smoke 新增 languageOptionCount===3 守卫)
- 2026-08-24:**界面改进三批 + 实测反馈修复批次 GUI 实测全部通过**(批次一布局稳定性/批次二设置抽屉化/批次三反馈统一打磨/修复批响应式+滚动条根治+chip移除+主题过渡;ACCEPTANCE 全部关闭)
- 2026-08-24:**实测反馈修复批次「响应式+滚动条+chip+主题过渡」完成**(主舞台改 minmax(min(300px,40vh),1fr) 弹性撑满;根治页面级滚动条:html/body overflow 传播+BFC 边距塌陷致文档高 592>560,.app 高度算术闭合+overflow hidden;文件框体右侧裁切=Grid 隐式列 min-content 撑宽,显式 minmax(0,1fr);移除顶栏 chip 信息并入抽屉头副标题;主题切换 200ms 过渡;tooltip 裁切修复;smoke 新增 docScrollOk 守卫)
- 2026-08-24:**界面改进批次三「反馈统一+空态导航+行降噪+视觉打磨」完成,待 GUI 实测**(P1-2 完成弹窗默认不弹走汇总条;P1-3 最近转换改空态 chips+↻ 重转,删双击与仅加载按钮;P1-4 多文件行减至手柄+移除,Alt+↑/↓ 键盘排序;P1-5 错误警告可换行底色条;P1-6 空态能力说明;P2 type scale+微动效+进度行精简;typecheck/lint/build/smoke/51 段全绿)
- 2026-08-24:**界面改进批次二「设置抽屉化」完成,待 GUI 实测**(P0-3 主页面设置面板→右侧滑出抽屉,主页配置清零;P0-4 抽屉内 L1 常用/L2 排版/L3 高级/L4 应用偏好四层频率分层;P1-1 格式选择上移顶栏分段控件;焦点陷阱栈式协调支持弹窗叠加;typecheck/lint/build/smoke/51 段全绿)
- 2026-08-24:**界面改进批次一「布局稳定性」完成,待 GUI 实测**(P0-1 主舞台固定高度 clamp(280px,40vh,400px)+Grid 六轨道钉死 footer;P0-2 status/dropSkipped/resultSummary 合并常驻消息槽;根治导入跳动;typecheck/build/smoke 全绿)
- 2026-08-24:**发版 1.3.0 完成**(审计整改 P0~P5+i18n 字典拆分:61 项审计待办约 54 项实施、7 项不做/仅记录见 archive/2026-08-24-193838;GUI 实测通过;版本号四源统一 package.json=lockfile=tag v1.3.0=CHANGELOG [1.3.0];测试 45→51 段全绿;DECIDE-1 统一 Word 口径「1」)
- 2026-08-24:**全库审计整改 P0~P5 + i18n 字典拆分完成,GUI 实测通过**(五车道并行实施:工程化CI/core 单源化重构/main+renderer 重构加固/测试体系/文档同步债;新增能力:image-downloader 私网拦截+大小上限/shell 白名单/M2W_ONLY 单段筛选/i18n 注册表化+ja/ko/fr/ru 四语)

## 近期日志

- 2026-08-24:**发版 1.2.0 完成**(审计改进第三批+目录结构重组:B9 UX 体验批/B13 暗色模式/B12 IPC 面整理/目录重组 6 批;GUI 实测通过;版本号三统一 package.json=tag v1.2.0=CHANGELOG [1.2.0];Release run success,资产 MarkdownToWord-Setup-1.2.0.exe + latest.yml;测试 44→45 段;审计排期 B1-B14 与目录结构重组全部关闭)
- 2026-08-24:**GUI 实测全部通过+目录重组批⑥补遗完成**
- 2026-08-23:**B12/B13/目录结构重组全批完成,待 GUI 实测**(每批独立提交 typecheck/lint/build/45 段/smoke 全绿)
- 2026-08-23:**发版 1.1.0 完成**(审计改进第二批:B6 i18n 收口/B4 失败可见性/B5 性能/B7 契约单源解环/B8 大文件拆分/B11 测试盲区补齐,约 30 项;docx render.ts 1262→467/pdf 790→209/renderer 705→147;测试 40→44 段)
- 2026-08-23:**发版 1.0.1 完成**(审计改进第一批:B1 安全加固/B2 健壮性/B3 数据渲染正确性/B10 工程基建/B14 文档修正,约 40 项;CI 首跑 success)
- 2026-08-23:**全库质量审计 + 改进排期落盘**(3 子代理并行深审;全部待办 B1-B14 约 90 项入 ROADMAP;6 个决策点用户全部拍板)
- 2026-08-16:**i18n 界面多语言实测通过**;**文档加密决策不做**(砍);**界面版本信息完成**
- 2026-08-16:**代码块语法高亮写 docx 完成+实测通过**(0.32.0)
- 历史批次明细见 `docs/CHANGELOG.md` 与 git log;审计证据链见 `docs/archive/`

## 验证基线

- 已跑通:`npm run typecheck`、`npm run lint`、`npm run build`、`npx electron . --smoke`(启动 + docx/pdf 双链路 + 设置持久化/landscape 端到端 + 批量/合并端到端 + renderer 诊断)、`npm run test:coverage`(c8)
- 验收脚本:`npm run test`(test/acceptance.mjs 自动发现 `segments/`(core 渲染与跨域守护)、`main/`(主进程层)与 `renderer/`(UI 层)下 `*.test.js`,当前 **70 段 = segments 47 + main 19 + renderer 4**;单段筛选 `M2W_ONLY='段名子串'`;新增测试=新建段文件零注册);main 侧行为已有 `main/converter.test.js` 断言,smoke 保留必须 Electron 的断言(printToPDF 产物/书签/renderer diag/设置持久化往返)
- 恒等守护:`test/segments/identity-guards.test.js` 锁已知双源(zh 文案↔字典/MAX_RECENT_FILES/设置合并双侧/白名单扫描一致性)
- 验收样例:`npm run gen:fixtures`(需先 build)按功能自动生成 `test/fixtures/acceptance/*.md`(GUI 人工实测直接拖入);`npm run check:fixtures` 漂移校验(EOL 归一化,.gitattributes 双保险;CI 门禁步骤);新增功能=测试段顶层加 `export const fixtures = { main: ... }`
- smoke 自清理 output/smoke 临时产物(Windows 占用文件 EBUSY 容错跳过)
- 打包:`npm run dist`(electron-builder NSIS);验证链:--dir → asar list → win-unpacked 启动存活 → 静默安装/卸载(退出码 0);打包版 `--smoke` 不可用(asar 内只读);镜像环境变量见 DEV-GUIDE
- CI 门禁:.github/workflows/ci.yml(windows-latest node22 全量 + node20-floor 地板守卫 + check:fixtures + smoke);release.yml 含 tag↔package.json↔lockfile 版本校验(四源统一门禁)

## 铁律(勿回退)
> 项目级硬约束(技术栈/镜像/字体/分页符/依赖钉死)已全部迁至项目 `AGENTS.md`「硬约束」节,以彼处为准。

## 打开事项

- [x] UI 改版 v4 四项人工 GUI 实测(①三态舞台同高/历史开合零跳动 ②单↔多文件切换形态连续 ③快速参数条与抽屉双向同步 ④历史浮出面板外点关闭/不遮挡),随 3.0.0 发版关闭(2026-08-27)
- [x] 审计整改 P0~P5 + i18n 字典拆分:人工 GUI 实测通过(2026-08-24),随 1.3.0 发版关闭
- [x] 功能候选全部收口(批次 10:8c Mermaid / 交叉引用 / 模板导入 / 公式编号开关 / 批注 / WPS 兼容矩阵;排期 3 项全部关闭或转砍);ROADMAP「当前待办」无未关闭排期项
- [x] 测试缺口(24 项)已全部补齐(2026-08-13);新增缺口按需入 ROADMAP
- [x] 关于页更新提示:main 进程查 GitHub Releases latest API,关于窗开启即异步检查,版本徽章下显示状态行(检查中/已最新/发现新版本+墨色下载按钮/离线静默),i18n 三语;自动断言见 test/main/about-update.test.js(版本比较纯函数),GUI 实测通过(2026-09-25,ACCEPTANCE U1-U3 全勾关闭)
