# CHANGELOG

## [3.4.0] - 2026-08-28
- **F8 合并总目录增强(固化,无核心代码新增;typecheck/lint/build/61 段/smoke 全绿)**:合并本就走单 convert 通路(mergeMarkdowns → convert 一次),标题/题注编号本就跨文件连续、TOC 本就覆盖全文;本版补测试固化「合并总目录覆盖全部源文件标题 + 跨文件页码准确」(field 模式两遍法,经文件间 page-break 起新页,B 页码严格大于 A);自动断言见 test/segments/merge-toc.test.js(docx+pdf 双格式总目录覆盖 A+B 共 8 标题、PDF 跨文件页码单调且 B>A、.toc-page 注入);GUI 实测待用户复核(ACCEPTANCE F8 D1)

## [3.3.0] - 2026-08-28
- **F7 目录带页码(混合路线,部分推翻 ADR-007 D1 免更新路线;typecheck/lint/build/60 段/smoke 全绿)**:新增「目录模式」设置 `tocMode: static | field`(单源 + 双格式一致开关 + 设置抽屉 L2 下拉 + i18n zh/en/ja),GUI 实测通过(ACCEPTANCE D1/D2 全勾);docx field 模式 `beginDirty:true` 触发 Word/WPS 打开更新域、注入真实页码(toc-caption.test.js 断言);PDF field 模式触发两遍法静态页码——复用既有 `/Dests` 命名目标解析定位标题页码(与书签大纲同源,免 pdfjs 文本匹配)→ 第二遍注入 `.toc-page` 点线引导页码重印,TOC 后硬分页符保正文布局一致(toc-pagenum.test.js 断言);默认 static 维持升级前免更新行为

## [3.2.0] - 2026-08-28
- **转换预检报告(F6)实现 + GUI 实测通过**(版本号四源统一 package.json=lockfile=tag v3.2.0=CHANGELOG [3.2.0];typecheck/lint/build/59 段/smoke 全绿):转换前静态体检三类问题——缺失本地图片、悬空交叉引用(#sec:x 无对应 {#sec:x})、未标注语言代码块;核心 src/core/markdown/precheck.ts 纯函数 + DI(exists 默认 fs.existsSync),复用 imageNotFoundWarning/crossRefNotFoundWarning + 新增 unlabeledCodeBlockWarning;i18n zh/en/ja 补齐 warn.unlabeledCodeBlock/precheck.*;IPC convert:precheck 单源通道 + preload 镜像 + 报告弹窗(「校」校勘印章,复用既有朱砂警示语汇);单文件/批量/合并转换前统一触发,无问题静默继续、有问题弹报告(继续/取消);自动断言见 test/segments/precheck.test.js
- **F5 文字水印 GUI 实测通过**(随本版关闭:W1 四项全勾——docx/PDF 水印旋转置底、空文字零渲染、浅灰开关、恢复默认不入预设);详见 3.1.0 条目

## [3.1.0] - 2026-08-27
- **文字水印(F5)全链路实现**(版本号四源统一 package.json=lockfile=tag v3.1.0=CHANGELOG [3.1.0];typecheck/lint/build/58 段/smoke 全绿):控制项=文字/旋转角度/不透明度/浅灰经典观感;双管线——docx 走 DrawingML 旋转置底(header 内 `Drawing` `behindDoc` + `wps:wsp`/`a:xfrm rot`,经典对角 zIndex:-1),pdf 走 body 固定覆盖层 `.wm`(rotate/opacity);UI 抽屉 05 组「文字水印」挂「不入预设」徽标(与页眉页脚同组概念,不随预设保存);设置契约单源 settings-defaults WatermarkSettings/DEFAULT_WATERMARK,main persist 双侧防御 sanitizeWatermark,context 构建透传,renderer settings-logic/bindings/panel/refs 接线;i18n zh/en/ja 补齐;自动断言见 test/segments/watermark.test.js(docx 文字/配色/空 text 零渲染 + pdf 覆盖层/旋转/不透明度)
- **设置抽屉收窄打磨**:宽度 402→340px(桌面)/372→320px(≤1080)/402→300px(≤900),响应式三档产生可见差异,修正此前 356 档近似无变化的偏差;贴合「印刷付梓」仪器面板比例
- **修复**:settings 契约守卫补 watermark 为第 15 键(DEFAULT_SETTINGS 计数 14→15,F5 漏更,CI 门禁拦截)

## [3.0.1] - 2026-08-27
- **界面打磨遗留项③+④**(v3「印刷付梓」设计稿还原收尾;typecheck/lint/build 全绿):③主按钮就绪态脉冲引导(convert/batch/merge 加 `pulse` class,CSS `.btn.pulse:not(:disabled)` 呼吸光环,转换中禁用自动停脉冲);④状态行 busy/ok 呼吸色(`utils.setStatus` 增 `setStatusTone` tone 类,CSS `.status--busy/--ok::before` 圆点呼吸,错误/警告自动清 tone,尊重 prefers-reduced-motion);①模板预设卡化 / ②单文件卡能力 chips 用户裁定暂不执行,记 ROADMAP 待后续

## [3.0.0] - 2026-08-27
- **界面重大重构:合并发布 v3「印刷付梓」与 v4「常驻文稿台」**(主版本号跃迁 2→3;GUI 实测全部通过;typecheck/lint/build/57 段/smoke 全绿;版本号四源统一 package.json=lockfile=tag v3.0.0=CHANGELOG [3.0.0]):
- **v3「印刷付梓」**(界面重构主体,原 2.2.0 并入本主版本统一发布;设计三件套 docs/design/(样稿/信息架构/规范)落盘):应用图标朱砂钤印母题重做(渐变圆角方块+内描白环+衬线「梓」path 轮廓),ico 六尺寸重生成 + dev/任务栏图标接线;主进程 win32 无边框自绘标题栏(titleBarStyle:hidden+titleBarOverlay 保留原生控制钮与 Snap 布局),overlay 配色单源 + 启动按持久化主题同步 + 跟随系统深浅色;renderer 设计令牌 CSS 变量双主题 + 纸张颗粒氛围层 + 响应式四档;抽屉七组编号 01-07 控件形态按规范映射(seg 分段×6/字号 stepper/行距 range+mono 回显/PDF CSS 文本域/恢复默认);最近转换改常驻折叠历史条(rrow 行内重转);toast 单实例轻提示;align 布尔升级枚举分段(存储契约不变旧档归一化);i18n 三语各 +51 键;实测反馈修复设置按钮归位右上角窗口控制区左侧
- **v4「常驻文稿台」**(44cbe1a;四项 GUI 实测全部通过,r2r1/r2r2 补丁齐备):①舞台常驻纸面化——.stage 即文稿台纸面容器,空/文件/参数脚注共用一张纸,切换只换内容消除突变,队列行直接排纸面去嵌套卡;②全界面宽度统一——历史/消息/动作栏内容对齐 760 统一内容列(窄窗 padding-inline max 公式),色带仍全宽;③minWidth 880→640 半屏可用,新增 ≤720 档参数条折两行(qb-output flex:0 0 100% 禁收缩),舞台高度改 min(100%,设计高) 任意窗口参数条在视野内零滚动;④设计同步——ui-guidelines §2/§5 重写(常驻纸面/列贯穿/级联纪律/视觉验证节),mockup 头部 v4r2 差异注记
- **踩坑与修复**:base→drop 级联序压掉舞台域响应式(纪律:舞台域覆盖住 drop.css §7)/隐藏窗口 transition 时钟不推进致截图半透明帧(ui:shots 注入动效冻结)/flex 容器 margin:auto 吸收交叉轴;r2r1 移除 scrollbar-gutter(单侧沟槽顶偏居中列,舞台高度 min(100%) 后已无滚动无需沟槽),四角裁切线上移挂 .stage 容器角(仅空态显示);r2r2 转换开始舞台跳动根治——进度行改与动作按钮同行(弃独占行,动作栏恒高),转换中 :has 隐藏快捷键提示腾位,消息区改固定槽高 96/矮窗 86(内容超长内部滚动,safe center 防裁顶);ui:shots 8 场景(含 640 空态 + 转换中零跳动逐像素断言)全过
- **遗留项**(记 ROADMAP 不排期):预设卡化 / 单文件卡能力 chips / Ctrl+Enter 脉冲动画 / 状态行呼吸色

## [2.2.0] - 2026-08-26
- **界面重构 v3「印刷付梓」**(设计三件套落盘 docs/design/(样稿/信息架构/规范);typecheck/lint/build/57 段/smoke 全绿;实测反馈修复含设置按钮归位):
- 应用图标(80cdbdd):朱砂钤印母题重做(渐变圆角方块+内描白环+衬线「梓」path 轮廓),ico 六尺寸重生成;BrowserWindow icon 接线补齐 dev 窗口/任务栏图标缺口
- 主进程窗口改造(1ed73a0):win32 无边框自绘标题栏(titleBarStyle:hidden+titleBarOverlay 保留原生控制钮与 Snap 布局);overlay 配色单源 title-bar-overlay.ts,启动按持久化主题同步+跟随系统深浅色切换;theme:syncOverlay IPC 三侧镜像;新增 main 测试段
- renderer 重构(a610899):设计令牌 CSS 变量双主题+纸张颗粒氛围层+响应式四档;抽屉七组编号 01-07,控件形态按规范映射(seg 分段×6/字号 stepper/行距 range+mono 回显/PDF CSS 文本域/恢复默认);最近转换改常驻折叠历史条(rrow 行内重转);toast 单实例轻提示;align 布尔升级枚举分段(存储契约不变旧档归一化);i18n 三语各 +51 键;smoke 断言同步
- 设计稿对齐批(并入 a610899):标题栏设置按钮归位右上角窗口控制区左侧;状态行圆点/进度区旋转指示/多文件队列行/完成弹窗钤印等缺失样式补齐;分段选择器误伤嵌套与窄窗死选择器修复
- 遗留项(docs dcac423):预设卡化/单文件卡能力 chips/Ctrl+Enter 脉冲动画/状态行呼吸色记 ROADMAP 不排期

## [2.1.0] - 2026-08-25
- **功能开发阶段第一批:F1-F4 四批**(GUI 实测全部通过;每批独立提交,typecheck/lint/build/smoke 全绿;测试 51→56 段):
- 功能立项(docs 1bd8b41):双路调研(@explorer 能力盘点+@librarian 竞品对标)拍板 9 项做、3 项记录不排期;批次表 F1-F9 依次实施
- F1 图片控制增强(ede4c4a):Pandoc 风格 `{width=..}`/`{height=..}` 图片属性语法(百分比相对正文内容宽,一维等比/两维定形)+ 独立成段图片 figure 居中;解析纯函数单源 core/markdown/image-size.ts 双管线共用;非法值 keyed 警告三语言
- F2 表格列宽控制(09b248e):GFM 分隔行 dash 计数比例作为列宽信号(max(dash)≥5 且 max/min≥3);docx tblGrid+固定布局,pdf table-layout:fixed+首行百分比;解析单源 core/markdown/table-width.ts
- F3 标题排版粒度(7b35089):typography 新增 headingScale/headingSpacing 三档枚举(紧凑/标准/舒展),docx 与 pdf 双管线同源纯函数消费;抽屉 L2 两下拉;预设字段自动纳入
- 技术路线拍板(docs 1a3d0a4):ADR-007 目录带页码混合路线(pdf 两遍法静态页码+docx opt-in 域目录,部分推翻 D1)/ADR-008 模板导入浅导入 v1(jszip 提取样式映射现有设置)
- F4 页眉页脚自定义(cc4b65f):settings 新增 headerFooter 对象(页眉三模式 default/custom/none+自定义文字+logo+居中/左右分栏+页脚开关);docx chrome Header 扩展(分栏制表位+logo ImageRun),pdf printToPDF headerTemplate(base64 logo);logo 读失败 keyed 警告降级;抽屉 L2 新区块+header-logo:select IPC

## [2.0.0] - 2026-08-24
- **界面整体重构(大版本:界面布局与交互变化显著)**(五批次提交 87edaf1/367d1f8/3eabfe1/635aaa8/af77703;每批 typecheck/lint/build/51 段/smoke 全绿;GUI 实测全部通过):
- 批次一 布局稳定性(87edaf1):主舞台固定高度+Grid 轨道钉死 footer;status/dropSkipped/resultSummary 合并常驻消息槽——根治导入文件后布局跳动;顺带修复版本号折行缺陷
- 批次二 设置抽屉化(367d1f8):主页面设置面板墙(40+ 控件)迁出为右侧滑出抽屉,主页配置清零;抽屉内 L1 常用/L2 排版/L3 高级/L4 应用偏好四层频率分层;格式选择上移顶栏分段控件;trapFocus 升级栈式协调支持弹窗叠加(Esc 关闭链弹窗优先)
- 批次三 反馈统一+视觉打磨(3eabfe1):转换完成弹窗默认不弹,汇总条/消息槽承接(已存偏好尊重);最近转换改主舞台空态 chips(单击加载/hover ↻ 重转,删除不可发现的双击与冗余按钮);多文件行 4 控件减至手柄+移除(Alt+↑/↓ 键盘排序补偿);错误/警告升级可换行语义底色条完整展示;空态补能力说明行;type scale(20/15/13/12)+三态切换 150ms 微动效(respect prefers-reduced-motion)
- 实测反馈修复批(635aaa8):响应式布局——主舞台改 minmax(min(300px,40vh),1fr) 弹性撑满视口;根治页面级滚动条(body overflow 传播致 BFC 失效+.app 边距塌陷,文档高超出视口 32px);修复窄窗下文件框体右侧裁切(Grid 隐式列 min-content 撑宽);移除顶栏摘要 chip(与设置按钮功能重叠),「当前预设·纸张」信息并入抽屉头副标题;深色主题切换加 200ms 颜色过渡;smoke 新增 docScrollOk 文档级滚动守卫断言
- 多语言精简(af77703):界面语言保留 中文/English/日本語,删除 ko/fr/ru;isValidSettings 由 language 整文件拒绝改为字段级回退——已存被删语言的 settings.json 启动后回退中文且其余偏好(输出目录/主题/排版/自定义预设)原样保留(迁移测试固化);smoke 新增 languageOptionCount===3 守卫
- 附带修复(412919e/35b9eba):htmlLang 镜像化消除 lang-bootstrap 硬编码映射(1.3.0 已知限制关闭);fixtures 禁绝路径入库修复 CI 漂移误报

## [1.3.0] - 2026-08-24
- **全库审计整改 P0~P5 + i18n 多语言架构改造**(61 项审计待办约 54 项实施、7 项不做/仅记录见 archive/2026-08-24-193838;typecheck/lint/build/51 段/smoke 全绿;GUI 实测通过):
- P0 流程洞(eb5f912):release.yml 增加 tag↔package.json 版本校验;CI 补 fixtures 漂移校验+smoke+node20-floor 地板守卫 job;npm start 构建新鲜度守卫;.gitattributes fixtures EOL 策略
- 测试基建(b6556fd):runner M2W_ONLY 单段筛选;看门狗超时改「标记失败→中止→硬退出」;gen-fixtures --check EOL 归一修复 Windows autocrlf 全量误报;g4-smoke.png 更名 g4-preview.png;删死资产 png-utils.js/pdf-css-sample.css
- core 单源化(6a8be81,行为等价,DECIDE-1 除外):标题编号计数共享纯函数 markdown/heading-numbering.ts(docx prescan/pdf xref/CSS counter 三镜像收编);无 h1 文档章节引用统一 Word 口径「1」;契约正则族并入 cross-ref.ts;mermaid/webp 警告工厂;docx/render.ts 467→256 行拆分(numbering/heading/table);Ctx 可选性统一构造时解析默认;ConvertFormat 收敛;死导出清理;pdf 分支跳过冗余 remark 解析
- i18n 字典拆分(e2d6375):src/core/i18n/ 注册表(zh 键集唯一事实源/en 全量 satisfies/ja ko fr ru Partial 263 键近全量);t() 回退链 当前语言→en→key;Language 类型注册表派生收拢 4 处硬编码(htmlLang 映射/settings 校验×3/设置面板语言选项动态生成);新增 i18n-registry 守护段(ru 缺 1 键为回退夹具)
- main/renderer 重构与安全加固(7af6a61):image-downloader 私网拦截+20MB 上限+重定向逐跳校验(allowPrivateAddresses 可放宽);shell.openPath/showItemInFolder 会话产物白名单;temp-html randomUUID+'wx';webPreferences 显式化;ctxByWebContents 下沉 web-contents-registry 解除反向依赖;register 导入 handler 模板收缩;renderer errorMessage() 单源替换 15 处;批量契约类型收敛+PreloadApi 类型推导;recent-files 迁 bindRecentFilesEvents 范式;预览窗尺寸记忆+错误页主题适配;magic number 具名
- 测试补强(b6556fd/7af6a61/e2d6375/692ff56):恒等守护段 identity-guards(zh 文案/MAX_RECENT_FILES/设置合并双侧/白名单扫描)+temp-html/web-hardening/mdast-utils/ipc-register 四新段,45→51 段;web-hardening 段桩替换 openExternal 隔离真实外开副作用(修复验收机唤起浏览器踩坑)
- 文档同步债(8329aef):DEV-GUIDE 代码地图重写+lint 范围修正;README 功能清单收敛(USER-GUIDE 为权威)+暗色模式;USER-GUIDE 交互描述修正+外观主题节;ROADMAP B14 勾验+B1-B11 完成批压缩+审计整改登记;STATUS 整形(顶部登记/日志瘦身/基线 51 段);ACCEPTANCE 整形(H1 压平/批次14 改指针);RESEARCH 依赖钉死清单+highlight.js styles 副作用+路径迁移注记;AGENTS.md 前缀补 perf:/test:
- 工程卫生(094d6c9):仓库级 .gitattributes(* text=auto)全库 EOL 规范化
- 已知限制:lang-bootstrap.js htmlLang 映射仍硬编码 zh/en(FOUC 缓解部分失效,功能无损,记 ROADMAP)

## [1.2.0] - 2026-08-24
- **审计改进第三批(B9/B12/B13)+目录结构重组落地**(GUI 实测通过;typecheck/lint/build/45 段/smoke 全绿;重组全程行为零变化):
- B9 UX 体验批(8780c14 视觉/46c0d4d 交互):PDF 链路进度五阶段细分(parse/inline/katex/mermaid/print,onStage 回调协议只增不改)+print 阶段取消置灰;错误码可操作文案映射(EBUSY/ENOENT/EACCES/ENOSPC/长路径);转换中拖入文件状态提示;重复文件单独计数+skipped 具体文件名可折叠;最近条目单击=加载/双击=重转;窗口最大化状态记忆;边距输入 max 属性;弹窗动画尊重 prefers-reduced-motion;设置栅格 ≤720px 单列断点
- B13 暗色模式(5a91a4a):style.css 颜色收敛 33 个语义化 CSS 变量,data-theme 与 prefers-color-scheme 双作用域同套深色值;设置「跟随系统/浅色/深色」三态即时生效(AppSettings.theme 全链路);浅色路径零视觉变化;color-scheme 跟随原生控件
- B12 IPC 面整理(2df5e35):23 个 channel 统一「域:动作」命名并收敛单源(main/ipc/channels.ts,preload 沙箱侧镜像+dist 恒等断言);convert:progress payload 加 mode 标识去 renderer 推断耦合;smoke 新增 IPC 端到端 diag
- 目录结构重组(前置再探查核对欠账成立性;6 批独立提交 6f3d72a/b1e50e9/061e8dd/d31cb21/2819a2a/9909d74,方案见 archive/20260823-230554):
  - 批① core:i18n.ts 拆 dict/index(ZH/EN 同文件保键集编译期锁定,facade 引用面零改动)+根级 16 文件归组 pipeline/settings/markdown/image/util
  - 批② docx:11 个节点处理器归拢 handlers/(theme/render/ctx/prescan/chrome 留顶层)
  - 批③ renderer:11 文件归组六功能域+events.ts 按域拆 4+1 文件+style.css 拆 base/drop/settings/dialogs 四文件(copy-renderer 改递归拷贝)
  - 批④ main:index.ts 708→74 行,抽 windows/main-window+windows/preview+ipc/register+menu(ctxByWebContents 前置收敛防循环)
  - 批⑤ converter 拆 context/single/batch/merge/paths 五子模块桶导出+smoke 迁出生产路径(test/tools/smoke/,打包天然排除)+resource-dirs 合并
  - 批⑥ main 根级归组补遗(ipc/persist/services 域;menu.ts 留单文件锚点)
- 文档:目录结构优化方案入册(8994c7e);测试 44→45 段(新增 ipc-channels)

## [1.1.0] - 2026-08-23
- **全库质量审计改进第二批落地**(B6/B4/B5/B7/B8/B11 共约 30 项;typecheck/lint/build/44 段/smoke 全绿;重构批全程行为零变化,功能项 zh 界面文案逐字等价):
- B6 i18n 收口(9d6a2d5):core 警告通道改 ConvertWarning(string|KeyedWarning)+显示层 formatWarning 按当前语言格式化(缺失 key 回退中文 fallback,zh 行为逐字等价);公式/Mermaid/图片/GBK/路径回落等全部 push 点 keyed 化;throw 文案生成期 t() 本地化(error.message 单次通道无法显示层重映射);修 renderer 模块级 t() 求值致语言切换后仍中文的 bug;DICT en 键集编译期锁定(ZH as const+EN Record 缺键/多键编译报错);zh FOUC 缓解(localStorage 语言镜像+lang-bootstrap.js 引导设 html lang);preset.nameLimit 全角逗号统一
- B4 降级与失败可见性(d6dd721):docx 列表/引用块内不支持的块级内容(公式/表格/html/代码块)由静默丢弃改降级渲染+去重警告;hljs 高亮降级补警告(onFallback 回调保持纯模块,pdf 同 key 同口径);loadKatexCss 失败经 warnings 上报;图片读取失败按 fs 错误码细分 ENOENT/EACCES/EPERM/兜底(docx/pdf 双侧对齐)
- B5 性能(3ebec63):docx 图片 resolver 加 ctx 级 Promise memo(并发同 URL 共享在途请求,失败不缓存可重试);pdf embedExternalImages 改 cursor 分段单遍遍历(只处理 img 标签内 src,比旧全局 replace 更精确,产物等价);ImageResolver 契约加 optional exists 轻量存在性通道(main 侧 fs.access 实现);buildMarkdownIt 实例复用评估后不做(highlight 回调闭包捕获 warnings 会丢警告)
- B7 契约单源与解环(089eac3/e471d2d/0694814,行为零变化):循环依赖解除(DEFAULT_PAGE_SETUP 改从 settings-defaults 导入);新增 core/cross-ref.ts(CROSS_REF_KINDS+章节 label 正则族)与 core/image-resolver.ts 类型单源;decodeEntities 双实现统一;typography 平行 type 改派生;matchesPreset 字段数组驱动;theme.ts 死导出删除;魔法数字收敛常量(颜色入 theme);白名单标签集恒等断言;mermaid SVG 信任边界注释;pdf createDepthTracker/forEachRefLink 提取;新增 core/docx/bookmark.ts wrapBookmark 收敛书签块与 as unknown 断言
- B8 大文件拆分(20ed1c8/0a6c9ce,行为零变化):docx/render.ts 1262→467 行(抽 ctx/chrome/prescan/link-xref/image-run/code-block/fallback/content 8 模块,依赖单向无环);pdf/render.ts 790→209 行(渲染规则按 rule 拆 rules/* 六文件+shared 契约,overrideXrefRule 三段拆分);renderer.ts 705→147 行(events.ts 集中事件绑定);settings-panel.ts 656→374 行(settings-bindings.ts);renderer 卫生(state 删 converting 改 mode!==null 单源/trapFocus 二次调用防御/unload 生命周期注明)
- B11 测试盲区补齐(dd9dfbd):atomic-json 直测段(原子写/20 并发串行序/失败不破坏旧文件);katex-dir/mermaid-dir 抽纯函数+三态参数化直测;theme-fonts 段锁「eastAsia 集中配置」硬约束(16 文件零 CJK 硬编码扫描+styles.xml 产物一致);converter.test.js 内联样例迁 test/fixtures/main/;runWithCtx 抽 runConvertTask 纯逻辑入 ipc-logic.ts 直测(preview 生命周期维持人工不自动化)
- 存量修复(083de0d):code-highlight 验收 fixtures 补生成(check:fixtures 恢复通过)

## [1.0.1] - 2026-08-23
- **全库质量审计改进第一批落地**(3 子代理深审全库,B1-B14 排期;本版含 B1-B3+B10+B14,约 40 项;typecheck/lint/build/40 段/smoke 全绿):
- 安全加固(cb40e04):预览/打印窗口 open-navigate 全拦截 + 外链仅 http(s) 经系统浏览器;模板 CSS 剥离 `</style>` 注入序列 + TEMPLATE_CSP;IPC convert/batch/merge/shell/preview/paths 参数类型守卫;权限请求显式全拒
- 主进程健壮性(ac1b357):单实例锁(双开聚焦既有实例);unhandledRejection/uncaughtException 兜底;转换中关窗拦截确认(30s 超时强杀);mermaid 超时后销毁重建窗口防僵尸;resolver 缓存上限
- core 数据正确性(7d85fad/c9e16b6/8ea2e28):frontmatter 已知 key 守卫防吞正文;UTF-16 BE 识别;slug 截断加短哈希防书签碰撞;题注编号开关双格式对齐;脚注重复引用共享 id 与警告去重;GFM 表格列对齐 docx 补齐;eq label 粗斜体包裹 pdf 口径放宽;自闭合 `<br/>` 白名单放行;merge 代码块内示例图片不改写+分页符防叠加空白页;未知魔数图片跳过嵌入+警告(不再伪装 png);metadata date 解析失败不兜底当前时间
- 工程基建(62b4d5c/9f12d61/5d742f2):新增 CI 流水线(push master/PR:typecheck+lint+验收)与 release.yml 加固(concurrency/超时/失败产物留存);acceptance 测试 userData 临时目录隔离(不再读写真实 %APPDATA%);runner 逐段超时看门狗+耗时统计;tsconfig incremental+noUncheckedIndexedAccess(存量适配约 145 处行为等价);test:smoke 构建新鲜度守卫;docx 解包统一 jszip(删 tar,验收提速 ~19%)
- 文档修正(3ca85df):docs/README 自述、convert.ts 注释、WPS-COMPAT 矩阵回填说明等审计文档项

## [1.0.0] - 2026-08-16
- **首个正式版;版本号三统一**(package.json / git tag v1.0.0 / CHANGELOG 同号,AGENTS.md 规则同步;0.32.0 及以前为迭代序列与发布号解耦的历史)
- i18n 界面多语言(218b183;typecheck/lint/build/40 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md):
  - 新模块 core/i18n.ts:zh/en 字典 + t() 参数插值 + applyStaticTexts(data-i18n 系列属性),main/renderer 共享,缺失 key 回退 key 本身
  - AppSettings 加 language(默认 zh):白名单/形状校验/兜底/sanitize 全链路透传,旧 settings.json 兼容
  - 设置面板「界面语言」radio 即时切换(静态文案重刷 + 动态区域显式重渲染);main 菜单/对话框标题/预览错误页/关于弹窗按语言输出
  - 测试:新增 i18n 段 + settings 段更新(12 键白名单)
- 界面版本信息(71eda87):标题区显示版本号(main IPC app:version,与「关于」对话框同源;失败静默)
- 文档加密决策不做(adad6b8 调研 + db7459c 决策):docx 库不支持加密(非 OOXML 标准),替代需引入 officecrypto-tool 新依赖;pdf 侧需 qpdf 原生二进制分发;ROADMAP 转「砍」
- 发布文档更新(15ee2d2):README 功能特性补 7 条 + 测试段数 36→40;USER-GUIDE 设置面板结构/批注语法/公式编号开关;docs/README archive 登记表补齐

## [0.32.0] - 2026-08-16
- 代码块语法高亮写 docx(3eb22c7;typecheck/lint/build/39 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md):
  - 新模块 core/docx/code-highlight.ts:hljs token → TextRun 序列,GitHub Light 色板与 pdf 侧 template.ts 一致(comment 斜体/strong 加粗)
  - renderCode 接入:已知语言走高亮;无语言/未知语言/解析失败(含文本完整性校验)降级等宽文本,行为不变
  - 嵌套 span 类栈处理(hljs-params 包 attr/built_in),实体单遍解码防二次转义
  - 测试:新增 code-highlight 段 5 组断言;basic-render/mermaid 断言更新为高亮拆分形态
- 文档:待办排期决策(acf072f:排期 3 项——代码块高亮/i18n/文档加密,其余候选转砍)+ 待办状态同步(eb9e858)+ STATUS/ACCEPTANCE 登记

## [0.31.0] - 2026-08-16
- 批注(308769e;typecheck/lint/build/38 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md):
  - 语法 `[锚定文本]{批注=内容}`(行内,单段落锚定 + 内容行内 rich;与链接 `[..](..)`、`{#eq:label}` 不冲突)
  - remark 插件(src/core/comment.ts:micromark text 扩展 + from-markdown 扩展,anchor/content 经同一扩展集重新解析支持 rich)
  - docx 渲染:CommentRangeStart/End/Reference + comments 容器(id 渲染期计数器唯一,author 固定 markdown-to-word);表格单元格内生效
  - mdast-utils 仅锚定文本入纯文本(批注内容不进标题 slug/目录/题注识别);pdf 路线原样输出(仅 docx 生效)
  - 测试:新段 comments.test.js(部件/内容 rich/结构/id 唯一/回归/pdf 原样)
- WPS 兼容矩阵(4be7012;用户 Word/WPS 双实测全部通过):
  - docs/WPS-COMPAT.md 建立:28 项功能 4 组(基础排版/学术功能/页面与样式/流程与兼容)+ 实测指引 + 问题记录 + 历史修复(公式 w:tab/书签 w:id/PDF 书签跳转)
- release notes 从 CHANGELOG 提取(c346c88):gh release create 用 CHANGELOG 最新版本条目作为 notes(人工整理的功能汇总;提取为空回退 --generate-notes)
- 文档:STATUS/ACCEPTANCE/ROADMAP 登记(批注 + WPS 矩阵勾选)

## [0.30.0] - 2026-08-16
- 界面配置区重构(d225a76;typecheck/lint/build/37 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md):
  - 配置收敛为 1 个折叠面板「设置」+ 内部 4 子组(模板/页面/排版/导出,组头 + 分隔线,不嵌套折叠)——界面只突出主流程(文件区 → 结果 → 最近转换 → 底部操作栏)
  - 模板预设从常显卡片收进「模板」子组(一次配置后不再动,不常驻占位);两行结构保留(主行选择+另存为/删除,辅助行导入/导出预设、导入/清除 CSS + hint,ghost 弱化)
  - 最近转换限高 240px + 滚动条(历史再多不撑高界面)
  - 语义归位:公式编号移入排版(与章节/题注编号聚合为自动编号组);导出后/完成弹窗提示/输出目录独立成「导出」组(页面设置回归纯页面语义)
  - 标题区去副标题;panelOpen 默认折叠(已记忆展开态优先恢复,存量用户不受影响)
  - typographyPanel 合并删除(dom/recent-files 引用清理;panelOpen.typography 兼容保留镜像同值)
- 文档:STATUS/ACCEPTANCE 登记

## [0.29.0] - 2026-08-16
- 公式编号开关(66681a9;typecheck/lint/build/36 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md):
  - AppSettings 加 equationNumbering(默认 true);关闭时 docx/pdf 一致:公式不编号、{#eq:label} 段隐藏(语法标记)、[式](#eq:label) 引用保持原文本(不降级不警告)
  - 设置面板「公式编号」checkbox + 全链路透传(settings → convert context → docx/pdf 渲染)
  - 实测修复(f9b7d09):关编号时 label 段原样显示 → 隐藏;「清空最近」不生效 → saveUiState 空数组=清空语义(新增 test/main/ui-state.test.js)
  - 实测修复(308ebc4):转换完成弹窗提示 checkbox 语义反转(勾选=提示=suppress=false,回显与事件取反)
- PDF 自定义 CSS 模板导入(32235a7;37 段新增 pdf-css.test.js + smoke 全绿,用户 GUI 实测通过):
  - AppSettings 加 pdfCss(默认空);pdf 渲染追加到默认样式之后(同一 style 内后声明覆盖);docx 路线不消费 CSS
  - main 侧 import:pdf-css IPC(dialog 选文件 + fs 读 + 100KB 上限 + 取消 canceled);renderer 模板行「导入 CSS…/清除」+ 状态显示
  - 测试样例 test/fixtures/pdf-css-sample.css(ccf5385)
- 模板行 UI 优化(5466f83 + d2147be;用户 GUI 实测通过):
  - hint 单行省略 + title 悬浮全文(信息保留 + 行高固定)
  - 两行布局:主行(模板选择 + 另存为/删除)+ 辅助行(导入/导出预设、导入/清除 CSS + hint,ghost 弱化 + 窄窗口 wrap)
- 文档:STATUS/ACCEPTANCE 登记

## [0.28.0] - 2026-08-15
- 批次 14「测试补齐」(43452ca + 9dd272e;typecheck/lint/build/36 段/smoke 全绿,纯测试补齐无 GUI 实测项,验收见 ACCEPTANCE.md 批次 14 节):
  - **core**:formula 非 ∑ munderover 回落 + moText 文本化(G1)/utils 新建段 decodeNumeric 越界码点 + escapeRegExp(G5)/merge 空文件跳过/cross-ref chapter null + 空题注文本/eq-numbering 孤立 label 警告/basic-render warnings ?? [] 兜底 + 脚注定义内 blockquote/thematicBreak(G8)
  - **pdf**:pdf-postprocess 新建段 worker 抛错/空结果降级 + URL 替换循环 + checkLocalImages catch(G2)/pdf-bookmarks 旧式 Dests/decodeURIComponent catch/间接目标(G3)/pdf-meta 无元数据 passthrough(G4)/hljs 抛错兜底/mermaid resolver 抛错/loadKatexCss catch(G8)
  - **main**:converter open 失败降级 + merge pdf 分支 + filterExistingPaths(G6)/mermaid-service catch 文案 + 无逗号空 PNG + will-quit 兜底(G7)/settings 非法边距/ui-state 非对象回退(G8)
  - 33→36 段(新增 utils/pdf-postprocess)
- 批次 15「重构」(1d91d9e + 29c078c;typecheck/lint/36 段/smoke 全绿):
  - R1 theme.ts 删 createDefaultStyles 死代码/R3 导出 isValidSettings 直测(合法保留/旧文件兼容/7 非法用例)/R4 settings/ui-state 回退策略差异注释(整文件 vs 字段级,有意勿对齐)
  - R6 index.ts IPC 纯逻辑抽 ipc-logic.ts(5 纯函数:errorMessage/buildRecentFileEntries/baseNameFromMdPath/importPresetsFromText/buildPresetsExportPayload)+ 新段 ipc-logic.test.js,行为零变化
  - R2 settings-panel 抽 8 纯函数到 settings-logic.ts(mergeSettingsWithDefaults/resolvePresetHint/outputDirDisplayText/buildCustomPresetEntry/removeCustomPresetByName/parseMarginValue/validateNumberRange/settingsToControlValues)+ 8 组断言
  - R5 recent-files↔convert-flow ESM 环经 state.recentRefreshHandler 回调打破(renderer.ts 组合根接线)
  - R7 convert.ts 头部双管线差异注释(解析/公式/代码高亮/mermaid/目录/脚注 + 测试段映射)
- 顺手项(025f651):README archive 登记表 mermaid 条目 7 次重复删至 1 行/.gitignore 加 coverage//artifacts.js 注释修正/STATUS 悬挂行移入
- 审计剩余项(193feb4 + 89b5860):
  - settings/ui-state 双份「原子写 tmp+rename + 写队列」抽共享工具 src/main/atomic-json.ts(createJsonWriter 工厂,独立队列实例,行为零变化)
  - lint 范围扩 `eslint src/ test/ scripts/`(projectService allowDefaultProject,不改 tsconfig 结构;首跑修 2 处真实错误:acceptance.mjs 浮空 promise/merge.test.js 死导入)
  - build.files 排除 highlight.js/styles 确认安全(主题 CSS 为 template.ts 手写内联,运行时不加载 styles/)
  - archive 清理(删 3 条结论固化存档,24→21 条)+ DEV-GUIDE 注明 gen-fixtures 位置
- 文档:审计落盘(archive/20260815-144057 + RESEARCH 条目)/ACCEPTANCE 批次 14 勾选/STATUS 登记

## [0.27.0] - 2026-08-14
- 批次 13「模板导入(预设 JSON 导入/导出)」(cf2f630;typecheck/lint/33 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md 批次 13 节):
  - **方案**(archive/20260814-201622):lib-1 五方案对比拍板首选「预设 JSON 导入/导出」(复用 sanitize 校验,零新依赖);CSS 覆盖 pdf 路线次选、docx 模板导入暂缓(docx4js 停维护 + OOXML 样式逆映射工程量大)记 ROADMAP
  - **导入**:main IPC presets:import(dialog 选文件 → parsePresetsFile 校验:schemaVersion:1 / 裸数组兼容 / 逐条 sanitize → mergePresets 同名覆盖合并 → 上限 10 截断 → 持久化,记忆目录);错误二分类可读文案(「文件不是有效的 JSON」/「不支持的模板文件版本」/「文件不含有效预设」)
  - **导出**:presets:export(全部 customPresets → {schemaVersion:1, presets} 保存对话框,documents/presets.json);空预设前置拦截;尾部换行与 settings.json 风格一致
  - **UI**:模板预设行「导入预设…」「导出预设…」按钮(settings-panel + window.api 类型同步),导入后下拉重刷不强制切换选中项,状态区反馈「已导入 N 个预设(覆盖 M 个同名)」
  - **测试**:新段 presets-import.test.js(14 组断言:解析 7 + 合并 7,32→33 段)
- **修复**(f6e3304):预设下拉选中自定义预设被弹回——matchesPreset 值全等 + find 硬编码优先回填 select,自定义预设值与硬编码相同时选中被弹回(实测复现);resolvePresetSelection 纯函数优先保持当前选中 + saveCustomPreset 显式选中新预设(settings-logic.test.js 补 5 组断言)
- 文档:模板导入方案选型 RESEARCH 条目 + ROADMAP 拆解;ACCEPTANCE 批次 13 T1-T3 全勾;STATUS 登记

## [0.26.0] - 2026-08-14
- 批次 12「界面体验优化」(方向 A;typecheck/build/31 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md 批次 12 节):
  - **Phase 0 速赢 7 项**(拆 4 提交):U1 点击行为对齐(af572e4,多文件态点击=追加/单文件态点击=更换,文案同步)/U2 窗口最小尺寸 720×560 + 密度上限(740dd5d)/U3 快捷键提示 + 文案统一(22cd5ab)/U4 预设上限提示(dfd9a40);C5 核实已满足零改动
  - **Phase 1**(a6d16ea):C2 底部操作区 sticky 常驻/C10 双击预览可见提示 + 删 selected 死代码/C9 弹窗焦点陷阱(trapFocus)
  - **Phase 2 + 用户反馈**(fde3b1c):C8 模板预设上移全局常显(两面板之上,控件 id 不变)/C12 最近条目「仅加载」(载入不转换)/单文件态「追加文件」按钮(拖入=追加已核实为现状)
- 方向 B「代码质量与测试」(迭代 1-3;typecheck/lint/32 段/smoke 全绿):
  - **迭代 1 维护顺手项**(7eb82af):smoke 隔离 ui-state 会话残留(经 saveUiState 同步磁盘+缓存,回归锁断言);USER-GUIDE/ROADMAP 核对去重(Mermaid 行 7 份重复)
  - **迭代 2 速赢批**:settings-logic 抽取(abed9b7,零 DOM 纯函数层 + 22 断言直测,31→32 段);tsconfig 4 严格开关 + 依赖声明补齐(e526060,depcheck 修复 jszip/@types/mdast/katex);mermaid-service 降级路径测试(e6e48a9,超时/畸形返回值/崩溃/加载失败 4 组)
  - **迭代 3 工具链**(18d4e0b):eslint 10 flat + typescript-eslint 8.67 side-by-side TS6 API(TS 7 无 JS API,官方推荐;tsc 二进制仍 TS 7),首跑修 5 处真实 floating/misused promise;c8 12 覆盖率(main 97%/core-docx 93%/core-pdf 95%/renderer 100%,sourceMap + NODE_V8_COVERAGE);engines >=20.19
- 文档:USER-GUIDE 批次 12 交互同步;AGENTS/DEV-GUIDE/STATUS 工具链基线同步

## [0.25.0] - 2026-08-14
- 批次 11「体验打磨」(11 项候选全选拆 4 迭代单元独立提交可回退;typecheck/build/31 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md 批次 11 节):
  - **I1 状态记忆**(e0262e1):新增 src/main/ui-state.ts(原子写 + 宽松校验,损坏回退不碰 settings)+ src/renderer/recent-files.ts;最近转换区块(≤10 条 ts 降序 path 去重,点击一键重转沿用条目格式,清空);会话恢复(重启恢复上次文件列表,缺失文件剔除);文件/输出对话框记忆上次目录;窗口 bounds 记忆(工作区钳制,最大化跳过);设置面板展开态记忆;filterExistingPaths IPC
  - **I2 结果增强**(dd16075):批量失败详情弹窗「重试失败项」(非取消项替换列表按原格式立即重转,单文件放宽 ≥2 守卫)/「复制全部路径」(成功项输出路径,禁用态 + 已复制反馈);完成弹窗「不再提示」checkbox + 设置面板「转换完成弹窗提示」双向同步(suppressCompleteDialog,失败弹窗一并抑制)
  - **I3 预览与模板**(7d87bed):预览注册表 previews Set + refreshPreviewWindow(设置写盘成功后 preview:refresh 即时刷新)+ focus 时源文件 mtime 对比刷新 + 源文件缺失显示窗口内错误页;settings.json 契约扩展 customPresets(上限 10,sanitize 逐条校验/同名保留先出现/截断/非法丢弃,3 硬编码预设不动)+ 另存为预设弹窗(空名/同名拒绝)+ 删除预设回退默认
  - **I4 顺手项**(ebc5d88):多文件列表行双击预览(复用 openPreviewFor,按钮目标/converting 跳过;单文件态未做——dropZone 双击会误触);应用菜单 buildAppMenu(文件:打开文件…/退出,帮助:关于 showAboutDialog 显示 app.getVersion())+ onMenuOpen 订阅
  - **测试**:新段 test/main/ui-state.test.js(8 场景:默认值/原子写/宽松校验/损坏回退/钳制/去重/截断/suppressCompleteDialog);renderer-pure.test.js 补 batchRetryPaths/batchSuccessPaths/formatRecentTime;settings.test.js 场景 11 customPresets;smoke diag 守卫(控件存在性 + 菜单),30→31 段
- 文档:批次 11 验收清单 + STATUS 登记(f319363);修复 ACCEPTANCE/STATUS 批次 11 节重复内容(上一轮编辑误追加多份,去重后 590→122 行)

## [0.24.0] - 2026-08-13
- 批次 10 功能 2「题注/章节交叉引用」(9d;typecheck/build/30 段/smoke 全绿,用户 GUI 实测通过,验收见 ACCEPTANCE.md):
  - **语法拍板**:题注 `图: 标题 {#fig:label}` / `表: 标题 {#tab:label}`;标题 `## 标题 {#sec:label}`;引用 `[图](#fig:label)` / `[表](#tab:label)` / `[章节](#sec:label)`;label 剥离不渲染,不进标题文本/slug/TOC
  - **docx**:题注 label 登记 + fig-/tab- 书签(bookmarkNextId 唯一);引用默认文本 → 静态编号「图 1.1」/「表 1.1」/「1.1」+ InternalHyperlink 跳转,非默认文本保持原样仍跳转;renderDocx 预扫登记(引用先于目标标题出现也命中);悬空 → 占位「图 (?)」/「(?)」+ 警告「交叉引用未找到<图/表/章节> label: <prefix>:<label>」
  - **pdf**:xref_recognize 规则(计数/剥离/登记 + 链接替换两遍式)+ 题注/标题锚点注入;编号镜像模板 CSS(hasH1 时「图 h1c.figc」);悬空解包为纯文本(无 href 死链)+ 警告按「前缀:label」去重;无 h1 章节号「0.1」与 CSS 显示一致(与 docx「1」的差异注释声明)
  - **修复**:pdf template.ts 补 `.fig-caption/.tab-caption { counter-increment: figc/tabc }`(8b 遗留——此前 PDF 题注序号恒 0,现有测试为 contains 断言未抓出)
  - **测试**:新段 test/segments/cross-ref.test.js(12 条验收点:书签/锚点/静态编号/预扫/悬空/开关/编号同步/公式不回归),29→30 段
- 测试基建:验收样例生成器(试点 2eeddfc + 全量 29e834a;30 段全绿):
  - **机制**:测试段顶层 `export const fixtures = { main: ... }` → `npm run gen:fixtures` 按功能自动生成 `test/fixtures/acceptance/<功能>.md`(16 段 21 样例 + README 索引 + 图片复制),GUI 人工实测直接拖入,与自动化断言同源永不漂移;`npm run check:fixtures` 幂等漂移校验(exit 0/1);新增功能=段加导出,生成器零改动自动纳入
  - **基建**:electron mock 桥接(纯 Node import 段模块);10 段评估跳过(纯逻辑/工具/契约段无 md 主样例)
- 文档:交叉引用盘点(20260813-202816)+ 验收样例生成方案选型(20260813-211812)落盘 archive + RESEARCH 摘要

## [0.23.0] - 2026-08-13
- 批次 10 功能 1「Mermaid 渲染导出」(8c;typecheck/build/29 段/smoke 全绿,用户实测通过):
  - **语法**:```mermaid 围栏 → docx 嵌入 PNG(2x 高清,≤400 等比缩)/ PDF 内联 SVG(矢量,Chromium 原生渲染);语法错误/超时 → 等宽代码块原文 + 警告,不中断转换;非 mermaid 围栏行为不变
  - **core**:新增 src/core/mermaid.ts 契约(MermaidResult/MermaidResolver),ConvertContext 注入;docx renderCode async 化(三调用点:mermaid 围栏 → ImageRun PNG/失败降级),scaleToFit 抽取复用 imageToDocx;pdf highlight 拦截产占位 → 返回前串行替换(内联 SVG/mermaid-fallback 降级),无 resolver 时输出字节级不变
  - **main**:src/main/mermaid-service.ts 单例隐藏窗口(sandbox + CSP 断网 + parse 预检 + 2x canvas 光栅化 + 15s 超时 + 串行队列),mermaid-dir.ts 按 import.meta 定位(dev/test/打包一致),converter/index/smoke 注入 renderMermaid;离线零 CDN 隐私承诺不变
  - **依赖**:mermaid 11.16.1 钉死(镜像安装,IIFE dist/mermaid.min.js 本地加载)
  - **测试**:新段 test/segments/mermaid.test.js(fake resolver 9 断言点)+ test/main/mermaid-service.test.js(真实渲染:PNG 魔数/尺寸/svg 结构/语法错误降级),27→29 段
- R 系列重构 × T 组测试(B1 前积累,逐迭代独立提交可回退;26 段/smoke 全绿):
  - **R1 契约收敛**(394950f):白名单/设置默认值下沉 core 单一来源;R2 docx/render.ts 拆分(f7063c9,题注/公式/图片类型独立模块);R3 pdf/render.ts 拆分(da3d4d0,template/postprocess);R4 图片变形修复 + webp 降级 + L1 mime 统一(82b26d0)
  - **R5/R6 中优先级快修**(863adb3/95ea259):M1 括号 URL 截断/M2 随机后缀/M5 pushRuns 统一;M4 settings 写队列串行化/M6 图片缺失检查并入 resolver(单次 IO)
  - **R7/R8 renderer 拆分**(8e7673e/6860504):阶段一 dom.ts 抽取 + L4 死代码 + L5 状态合并;阶段二五模块(state/utils/file-list/dialogs/convert-flow),renderer.ts 1596→~950 留组合根
  - **R10 系列**(e015fae~5454426):convert context 构造收敛(buildConvertContext)/renderPhrasingSync 合并/runWithCtx 收敛/HTTP 失败不缓存/行内 HTML 抽 inline-html.ts/设置面板抽 settings-panel.ts;R10-7 不做(收益 ~20 行)
  - **T 组测试安全网**(8fa48db,26 段):T2 merge→pdf 中间 HTML 断言/T3 docx 书签 w:id 唯一性/T4 renderPdf 失败路径/T5 行内 HTML 边界/T7 image-downloader 超时注入/T8 resolver 同一性;T1 GBK 端到端(002a313);R8 收尾测试 5 批(测试锚点/smoke 下沉/清扫/中风险)
  - **B1 renderer 纯函数段**(482160e):抽 src/renderer/pure.ts 零 import 层,utils.ts re-export,测试缺口 25 项清零
- P0 修复:merge 图片相对路径反斜杠致 pdf 缺图(392fca1,smoke 样例图 100x80 可见化 a3a7a07,用户验证通过);smoke 输出隔离 + 命名描述化(f78d93b)
- 文档:src 架构审查落盘(20260811-201145)+ 重构规划;ROADMAP 整理为「当前待办」唯一入口;Mermaid 集成方案落盘(archive 20260813-193532)

## [0.22.0] - 2026-08-11
- 迭代 3 测试缺口收尾(豁免并入;build/验收 20 段/smoke 全绿):
  - **低优先级可自动化 2 项**:新段 test/main/paths.test.js 直测 collectMarkdownPaths(目录递归/点目录跳过/非 md 静默/skipped/大小写不敏感排序/seen 去重)与 resolveOutputPath(outputDir 空串/有效目录/超长 >250 回落/mkdir 失败回落)——重构后函数已导出,原 smoke 扩展计划升级直测
  - **GUI 实测 3 项用户通过**(2026-08-11):renderer 全部交互、IPC dialog/预览、afterConvert show-in-folder/open;runAfterConvert none 分支由 converter.test.js 隐式覆盖
- 迭代 4「预览入口迁移」(用户实测 6 项清单全通过):
  - **预览迁移到转换前**:单文件态拖放区操作行 + 多文件态列表每行新增「预览」按钮(点击经 window.api.openPreview 打开与 PDF 同排版的预览窗口,转换前不产生产物);完成弹窗「预览」按钮移除(保留复制路径/打开所在文件夹/打开文件/确定)
  - 失败提示:状态区三要素(文件名 + 原因 + 操作),不崩溃;转换中禁用/拦截;stopPropagation 避免误触发文件选择对话框
  - smoke renderer diag 补迁移守护(previewBtn 存在且初始禁用、completeDialogPreview 已移除)

## [0.21.0] - 2026-08-11
- 测试补齐迭代 1+2(豁免并入;build/验收 19 段/smoke 全绿):
  - **高优先级 10 项**:新段 cover(封面双格式)/task-list(任务列表)/image-downloader(外链图片下载);formula 降级分支、basic-render 缺失图警告、heading-links h4-h6 补断言;smoke 扩展取消链路/重名保护/breakBeforeH1/分页符断言
  - **中优先级 9 项**:新段 settings(钳制边界)/slug(三函数)/frontmatter(边界)/page-setup(非 A4 纸张);typography 行距缩进、basic-render 代码块/引用/列表/表头、外链 rels、页眉页脚补断言
  - 修复:PDF 任务列表 checkbox 替换正则对齐插件实际输出(289b837);frontmatter 空块剥除期望值按实现行为对齐(f4fa79a)
- 主进程重构(行为等价,四步独立提交可回退;19 段 + smoke 全绿为安全网):
  - **取消状态参数化**:模块级全局 cancelRequested → ConvertContext 随调用携带(每次调用新建,根治 fd40480/f809c57 残留误判)
  - **抽取 src/main/converter.ts**:转换编排独立模块并导出,index.ts 瘦身为窗口生命周期 + IPC 薄层
  - **smoke 独立瘦身**:SMOKE 块迁 src/main/smoke.ts,纯逻辑断言迁 test/main/converter.test.js,smoke 只留必须 Electron 断言(约 360 行 → 176 行)
  - **测试目录分层**:test/segments/(core 渲染)+ test/main/(主进程层),runner 多目录零注册
- 文档:测试覆盖盘点原文落盘(archive + RESEARCH 摘要);项目 AGENTS.md 提交规则对齐全局 v3.44(CHANGELOG 平时提交不写、发版时汇总)

## [0.20.1] - 2026-08-10
- 测试体系目录瘦身(承接 0.20.0;typecheck/build/验收 11 段/smoke 全绿,纯路径调整无逻辑变更):
  - 测试代码 `scripts/test/` 上移至顶层 `test/`(acceptance/common/segments/fixtures),scripts/ 只留构建工具(copy-renderer/svg-to-ico);段文件 import 相对路径同步
  - 产物目录扁平化:`output/test/{artifacts,smoke}` → `output/{artifacts,smoke}`(output/ 本就只承载测试产物,再套一层冗余);smoke 迁移 src/main/index.ts、package.json test 入口、docs 活文档引用全部同步
  - 最终结构:测试代码 `test/`,样例数据 `test/fixtures/`,产物 `output/artifacts/` + `output/smoke/`

## [0.20.0] - 2026-08-10
- 测试体系重组(技术债整理;typecheck/build/验收 11 段/smoke 全绿,无功能变更):
  - **验收脚本按内容主题拆分、去批次化**:删除 `scripts/make-batch3-sample.mjs` / `make-batch4-sample.mjs` / `g1-verify.mjs`,新建 `scripts/test/`(acceptance.mjs 入口自动发现 `segments/*.test.js`,零注册;common/ 公共工具:paths/runner/docx-utils/pdf-utils/png-utils/artifacts);原 10 段断言按主题拆为 11 段(basic-render/merge/footnotes/pdf-meta/heading-links/typography/raw-html/formula/encoding/toc-caption/eq-numbering),断言 needle 一字未改(62 项唯一 needle 比对);pdf-meta 段独立化(原段 4 复用段 2 产物 → 自建样例,消除段间依赖)
  - **样例数据静态化**:原 make-batch3-sample.mjs 生成的 10 个手册 md + PNG 图片改为静态入仓 `scripts/test/fixtures/manual/`(可版本化);PNG 编码器保留为 common/png-utils.js 工具
  - **输出目录按用途分**:验收产物 → `output/test/artifacts/`(按主题命名,无编号,新增无冲突);smoke 临时样例 → `output/test/smoke/`(src/main/index.ts 迁移);旧产物(output/批次1~4验收、根目录散落)全部清理
  - **npm 入口**:`test`(验收)/ `test:smoke` / `test:all`;docs(STATUS/DEV-GUIDE/ROADMAP/ACCEPTANCE/RESEARCH)引用同步至新路径

- 批次 9 实测修复(2 个,typecheck/build/验收脚本 10 段/smoke 全绿,用户复测通过):
  - **WPS 公式段显示异常**(实测:公式左侧出现 TeX 源码文本):公式编号段输出裸 `<w:tab/>`(OOXML 中 w:tab 属 run 内元素,必须包在 `<w:r>` 内)→ WPS 解析异常把 m:oMath 降级为纯文本;修复:Tab 包进 `TextRun({ children: [new Tab()] })`(输出 `<w:r><w:tab/></w:r>`)
  - **书签 w:id 冲突**:docx 库 Bookmark 组件每实例独立 id 计数器(源码实证 index.mjs:17027),文档内所有书签 w:id 恒为 1,违反 Word 书签 id 全局唯一要求 → 改用 BookmarkStart/BookmarkEnd + 模块级自增计数器(标题/公式书签 id 1/2/3 唯一)
  - 验收脚本第 10 段 PDF 转换补传 katexDir(此前缺失 → 产物无 KaTeX CSS,公式行间距/字体异常,与 07 段对齐)
- 批次 9 用户实测通过(09-公式编号测试.docx/pdf:公式渲染、编号右对齐、引用跳转正常),验收记录 docs/ACCEPTANCE.md 批次 9 节全部勾选;批次 9 关闭,路线图批次 9 行补实测结论

## [0.19.0] - 2026-08-09
- 批次 9「公式编号 + 交叉引用」(原 8d;typecheck/build/验收脚本 10 段/smoke 全绿,待用户实测)
  - **display 公式自动编号**:$$ 块/`\[..\]`/```math 围栏按文档顺序全文连续编号 (1)(2)(3)…,docx/PDF 一致;行内公式不编号;降级(TeX 源码)公式同样占号
  - **编号排版**:docx 公式段落「居中公式 + 右对齐编号」(center+right 双制表位,landscape 文本区宽取纸高语义);PDF `.eq-block` flex 定位 + `.eq-num` 右缘垂直居中
  - **label 锚点**:公式后独立行 `{#eq:label}`(label 为 [\w-]+)→ 该行不渲染,docx 登记为书签(eq-label 命名,Word 书签命名约束经 docxBookmarkId 兜底)、PDF 生成页内锚点 id="eq:label"
  - **交叉引用**:`[式](#eq:label)` / `[公式](#eq:label)` → 静态文本「式 (N)」/「公式 (N)」+ 超链接跳转(免更新路线,改号重新导出);其他文本的 #eq: 链接保持原文本;悬空引用 → 「式 (?)」+ warnings 提示(两者均验证)
  - **实证修复**:markdown-it 主渲染循环对 inline token 直接 renderInline(children),不检查 inline 自身 hidden(仅 renderToken 检查)→ label 段除三 token 置 hidden 外必须清空 children(源码核查 renderer.mjs 179/244)
  - 验收:make-batch4-sample.mjs 第 10 段 9 断言(docx 编号/制表位/书签/引用文本/label 不渲染/悬空兜底 + PDF eq-block/锚点/引用/label 不渲染);smoke 顺带修复:合并 docx/pdf 产物断言兼容重名序号变体(输出目录可配置后断言遇 (N) 后缀失败,与批次 8 batch 断言同源修复)
  - 待实测:docs/ACCEPTANCE.md 批次 9 节(编号排版目测、引用跳转、悬空提示)

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
