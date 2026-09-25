# 路线图与迭代规划

> 2026-08-02 18:20:36 制定,19:20:18 因需求变更(GUI)修订;21:43:23 二期规划经 @oracle 评审重排。迭代完成记录见 `docs/CHANGELOG.md`;选型结论见 `docs/ADR.md`(ADR-001/002);调研证据见 `docs/RESEARCH.md` 与 `docs/archive/` 存档。
> 2026-08-13 整理:待办收敛为「当前待办」唯一入口(合并原待办排期/延后/批次 8-9 备选暂缓,去重),历史规划压缩至「已完成」节,详情见 archive 存档。
> 2026-08-23 全库质量审计后新增「审计改进排期 B1-B14」(全部待办唯一明细在此;证据链见 archive/2026-08-23-133005)。

## 需求范围
- Windows 桌面 GUI 应用:选择 markdown 文件 → 转 .docx / .pdf
- GUI 界面中文;中文内容排版可控(硬需求);架构预留其他格式扩展(「等」)

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

## 当前待办(需求经候选池确认后移入)
> 2026-08-13 整理:合并原「待办(排期)」「延后(不排批)」与批次 8/9「备选/暂缓/不做(记后续)」并去重,历史规划压缩至「已完成」节,详情见 archive 存档。
> 2026-08-23 全库质量审计后新增「审计改进排期 B1-B14」(全部待办唯一明细在此;证据链见 archive/2026-08-23-133005)。
> 2026-08-23 目录结构优化方案探查定稿入待办(暂缓排期,排在现有待办之后;实施前须重新探查;证据链见 archive/20260823-230554)。
> 2026-08-31 **封版暂停开发**:版本 3.11.5 封版,暂停新功能开发,进入文档技术债清理阶段。此前待办 D1 GUI 易用反制 AIDOC 三批已随 3.10.1 完成(GUI 实测通过 2026-08-29),关于页更新提示已完成,当前无未关闭排期项(2026-09-25 状态回写)。**技术债处置五批 24 项已于 2026-09-25 全部完成**(计划归档 archive/20260925-130122-技术债处置计划.md;批次压缩记录见「已完成」节,渐进遗留见候选池)。
> 2026-09-25 **需求入口调整**:所有新需求/候选/曾砍重提统一登记 `BACKLOG.md`(项目 backlog:分类 + 业务价值/工作量评估),经用户确认后移入本节;处置记录(不做/暂缓/已知限制)集中候选池,本节只放已确认项,已完成历史见「已完成」节。

### 审计改进排期 B1-B14(2026-08-23,完成即勾选)
> 原则:每项独立提交可回退;core 行为改动须补测试段断言;重构行为等价。规模:S≤3 文件 / M 中 / L 大。决策点已于 2026-08-23 全部拍板(见各条「已拍板」)。

#### B14 文档修正(S,零风险;2026-08-23 完成,7 项逐项勾验于 2026-08-24)

#### 关于页更新提示(S,零风险;2026-08-30 规划落盘,已完成)
- [x] main 进程新增 `about:check-update` IPC(handle),查 GitHub Releases latest API(`https://api.github.com/repos/<REPO>/releases/latest`,UA=markdown-to-word),语义化比对 `app.getVersion()` 与 `tag_name`,返回 `{status:'latest'|'available'|'error', current, latest?, url?}`
- [x] `about-preload.cjs` 暴露 `aboutApi.checkUpdate()` → `ipcRenderer.invoke`
- [x] `about.ts` 开窗即异步调用渲染状态行(版本徽章下,发丝线分隔):检查中/已最新/发现新版本+墨色下载按钮/离线静默;手动「检查更新」按钮重试
- [x] `about.html` 状态行 DOM + 内联样式(沿用现有配色,禁朱砂红)
- [x] i18n 三语补齐 `about.updateChecking/updateLatest/updateAvailable/updateError/checkUpdate`
- [x] 版本比较纯函数 `compareVersions()` 单测段 `test/main/about-update.test.js`
- [x] GUI 实测项见 ACCEPTANCE「关于页更新提示」(GUI 实测通过 2026-09-25 关闭)
- [x] docs/README.md:3 自述改「Windows 桌面应用」
- [x] convert.ts 头注释代码高亮差异行更新(双格式均走 hljs)
- [x] WPS-COMPAT.md 目录条目矛盾修正(非域、无需更新域)+ 矩阵状态回填
- [x] ui-state.ts panelOpen 默认值注释修正(缺省折叠=false)
- [x] 根 README 安装节补 ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR 前置说明
- [x] USER-GUIDE FAQ 扩充(公式未编号 / 图片不显示 / SmartScreen 未签名)

#### B1 安全加固·预览链路(M,P0;2026-08-23 完成,commit cb40e04)
> 6 项全部完成:模板 CSP meta/CSS 注入净化 `</style`/四窗口外链导航收口(setWindowOpenHandler deny+will-navigate preventDefault)/IPC 参数类型守卫统一/permission 全拒/mermaid CSP 接受项注释固化。

#### B2 主进程健壮性(M,P0;2026-08-23 完成,commit ac1b357)
> 9 项全部完成:单实例锁/unhandledRejection 兜底/关窗转换拦截/preview loadFile cleanup/activate 时序/mergeConvertImpl 尊重 skipAfterConvert/resolverCache 上限/mermaid 超时重建/smoke 断言去中文冻结。

#### B3 core 数据与渲染正确性(L,P0;2026-08-23 完成,提交 7d85fad/c9e16b6/B3c 批次)
> 16 项全部完成:frontmatter 守卫/slug 截断碰撞/题注编号全文档连续/表格列对齐/eq label pdf 放宽/UTF-16 BE/白名单大小写+自闭合 br/merge 代码块感知+分页符防叠加/脚注共享 id/悬空引用去重/metadata date/未知图片跳过。明细与证据链见 git log 对应提交。

#### B10 工程门禁与测试基建(M,P1;2026-08-23 完成,B10a/b/c 三波)
> 10 项全部完成:ci.yml 新建/release.yml 加固/userData 隔离/逐段看门狗/incremental/noUncheckedIndexedAccess(约 145 错清零)/删死配置/smoke 守卫/copy-renderer 清理/jszip 统一。两枚踩坑记 RESEARCH(混合目录不可整删/incremental 不重建被删产物)。

#### B6 i18n 收口(M,P1;2026-08-23 完成,commit 9d6a2d5)
> 9 项全部完成:警告文案 key 化(ConvertWarning/KeyedWarning+formatWarning)/converter 与 main throw 文案接字典/Mermaid 降级 key 化/renderer ERROR_MESSAGE 使用点求值/版本 title 字典化/EN 键集编译期锁定/preset.nameLimit 标点/lang-bootstrap FOUC 缓解。

#### B4 降级与失败可见性(M,P1;2026-08-23 完成,commit d6dd721)
> 4 项全部完成:容器块级内容降级渲染+警告/hljs 降级警告/katexCss 加载失败上报/图片读取失败原因细分(双格式对齐)。

#### B5 性能(S-M,P1;2026-08-23 完成,commit 3ebec63)
> 完成:docx 图片 resolver memo/embedExternalImages cursor 分段/checkLocalImages exists 通道;(可选)buildMarkdownIt 复用评估后不做(闭包捕获 warnings)。

#### B7 契约单源与解环(M-L,P1 重构;行为零变化;2026-08-23 完成,三波提交 089eac3/e471d2d/0694814)
> 14 项全部完成:循环依赖解除/CROSS_REF_KINDS 单源/sec-label 正则族单源/ImageResolver 单源/pdf 深度跟踪器/eq-xref 二遍合并/bookmarkChildren 共享/decodeEntities 统一/白名单恒等断言/typography type-only 共享/matchesPreset 数组驱动/theme 死导出处置/链接文本提取复用/mermaid 信任边界注释/颜色字号魔法数字收敛。

#### B8 大文件拆分(L,P2 重构;依赖 B7;2026-08-23 完成,两波提交 20ed1c8/0a6c9ce)
> 7 项全部完成:docx/render.ts 1262→467(8 模块)/pdf/render.ts 790→209(rules 化)/renderer.ts 705→147(events 抽取)/settings-bindings 抽离/renderer 卫生三项。(后续审计整改批已进一步拆至 ~256 行并新增 heading/table/numbering 模块。)

#### B11 测试盲区补齐(S-M,P2;依赖 B10 userData 隔离;2026-08-23 完成,commit dd9dfbd)
> 5 项全部完成:atomic-json 直测/resource-dirs 直测/theme-fonts 专断言/converter fixtures 迁移/runConvertTask 纯逻辑直测。

#### B9 UX 体验批(M,P1-P2;2026-08-23 完成,提交 8780c14 视觉批+46c0d4d 交互逻辑批;GUI 实测已通过 2026-08-24,随 1.2.0 发版)
- [x] 进度分阶段:PDF parse/inline/katex/mermaid/print 上报(core onStage 回调协议只增不改向后兼容);print 阶段取消置灰+「正在写入」文案
- [x] 错误码→可操作文案映射(EBUSY/ENOENT/EACCES/ENOSPC/长路径;actionableError 纯函数直测,未识别透传)
- [x] 转换中拖入文件 setStatus 提示(drop.busy 提示不再静默)
- [x] 拖放反馈:重复文件单独计数;skipped 列具体文件名(可折叠 details+smoke diag 守卫)
- [x] 最近条目交互:单击=加载到列表/双击=直接重转(title/aria 同步字典)
- [x] 窗口最大化状态记忆 isMaximized(ui-state 持久化+恢复时 maximize)
- [x] 边距输入 HTML max 属性 + marginError 文案对称(max=1000 与 MARGIN_MAX_MM 对称)
- [x] 弹窗动画尊重 prefers-reduced-motion(降瞬时出现,keyframes 终态=自然态无跳变)
- [x] .settings-grid 窄窗响应式断点(≤720px 降单列)

#### B13 暗色模式(M,P2 功能新增;已拍板做;2026-08-23 完成,commit 5a91a4a,GUI 实测已通过 2026-08-24,随 1.2.0 发版)
- [x] CSS 变量双主题(33 个语义化变量,data-theme=dark 与 prefers-color-scheme 双作用域同套深色值)+设置「跟随系统/浅色/深色」三态(AppSettings.theme 全链路,applyThemeOn 纯函数直测)

#### B12 IPC 面整理(M,P3;面广靠后;已拍板做;2026-08-23 完成,commit 2df5e35)
- [x] channel 命名统一「域:动作」(23 channel 单源 main/ipc-channels.ts,8 个改名;preload 沙箱侧镜像+dist 恒等断言)
- [x] convert:progress 事件带 mode 标识,去 renderer 侧推断耦合(payload {stage,mode},renderer 直接消费)
- [x] preload/renderer/smoke/测试全量同步(smoke 新增 IPC 端到端 diag+ipc-channels 测试段)

#### 目录结构重组(L,P2 重构;2026-08-23 探定稿;已完成 6 批提交 6f3d72a/b1e50e9/061e8dd/d31cb21/2819a2a/9909d74,GUI 回归实测已通过 2026-08-24)
> 方案全文见 archive/20260823-230554-目录结构优化方案.md(目标结构树/拆分明细/纯移动清单/划分原则/明确不做清单);RESEARCH 同日条目有摘要。
- [x] **前置:实施前对代码做再次探查**(exp-1 结论:欠账①②③④⑤仍成立且 events/index 因 B9/B12 略加重;⑥已被 B8 大部分消化降级纯移动;i18n 引用面实测 35 处 import 远低于原估 ~90)
- [x] 批① core/i18n.ts 拆 dict/index(i18n-dict.ts 同文件保键集编译期锁定+facade re-export 引用面零改动)+ core 根级 16 文件归组 pipeline/settings/markdown/image/util(~107 处 import 改写;contract-single-source.test.js 路径断言同步)
- [x] 批② core/docx handlers/ 归拢 11 个节点处理器(theme/render/ctx/prescan/chrome 留顶层不动)
- [x] 批③ renderer 功能域归组 dom/state/settings/convert/ui 六域+events.ts 按域拆 4+1 文件+style.css 拆 base/drop/settings/dialogs 四文件多 link 引入(copy-renderer 改递归拷贝;openPreviewFor 归 selection 防环为方案偏差已注释)
- [x] 批④ main/index.ts 抽 windows/main-window+windows/preview+ipc/register+menu(ctxByWebContents 前置收敛 ipc/register 防循环;708→74 行)
- [x] 批⑤ main/converter.ts 拆 context/single/batch/merge/paths 五子模块(原文件桶导出 import 面零变化)+ smoke.ts 迁 test/tools/smoke/(纯 .mjs 直连 dist,dist 递归扫描 0 个 smoke 文件=打包天然排除)+ mermaid-dir/katex-dir 合并 resource-dirs.ts
- [x] 批⑥ main 根级文件归组补遗(2026-08-24,方案漏排经用户指出补齐;9909d74):ipc/(channels+logic)/persist/(settings/ui-state/atomic-json)/services/(image-downloader/mermaid-service/resource-dirs/web-hardening/temp-html);menu.ts 留根级单文件锚点;resolveMermaidDir 相对定位深度随产物层级同步调整
> 每批独立提交,typecheck/build/test 全绿验证;批③④⑤ 有 GUI 面列入人工实测。

#### 审计整改 P0~P5(2026-08-24,五车道并行实施,依据 archive/2026-08-24-134811-审计待办清单.md)
> 61 项待办中约 54 项实施、7 项不做/仅记录(裁决见 archive/2026-08-24-193838-审计整改裁决与不做项.md);DECIDE-1 已拍板统一 Word 口径「1」。明细落点见各提交。
- [x] P0 流程洞:lockfile 同步(ac8a685)+ 发版 checklist 四源统一 + release.yml tag↔version 校验;.gitattributes + check:fixtures EOL 归一进 CI
- [x] P1 文档同步债:DEV-GUIDE 代码地图重写/README+USER-GUIDE 补暗色模式与交互修正/段数单一出处/ROADMAP 回填压缩/STATUS 整形/ACCEPTANCE 整形/注释勘误批(CORE-6+MR-8)
- [x] P2 单源化重构:标题编号共享纯函数(heading-numbering.ts)/正则族并入 cross-ref.ts/mermaid 警告工厂/renderer errorMessage/md 扩展名单源/ConvertFormat 收敛/Ctx 可选性统一/docx render.ts 拆分(467→256)
- [x] P3 守护补测:恒等守护段(identity-guards)/temp-html/web-hardening/mdast-utils/ipc-register 补测/runner M2W_ONLY 单段筛选+死旋钮清理+看门狗硬退出
- [x] P4 安全加固:image-downloader 私网拦截+20MB 上限/shell.openPath 会话产物白名单/webPreferences 显式化
- [x] P5 卫生杂项:死导出死键清理/sourcemap 与打包卫生/magic number 具名/t() I18nKey 编译期检查
- [x] i18n 多语言架构改造(方案A 分文件+注册表):src/core/i18n/(zh.ts 键集唯一事实源+en 全量 satisfies+ja/ko/fr/ru Partial),回退链 当前语言→en→key,Language 类型从注册表派生收拢 4 处硬编码(i18n.ts 类型/html lang 映射/settings 校验/settings 面板选项)

#### 排期结论
> B1-B14 与目录结构重组已全部完成(2026-08-24 发版 1.2.0);审计整改 P0~P5 与 i18n 字典拆分已完成(2026-08-24)。当前无未关闭排期项;新需求先进 `BACKLOG.md` 评估登记,确认后移入本节。

### 功能开发排期 F1-F9(2026-08-25 立项,2.0.0 后新阶段)
> 依据:@explorer 能力盘点 + @librarian 竞品对标双路调研(存档 archive/2026-08-25-182036-功能候选调研与迭代排期.md);用户拍板 9 项做、3 项记录不排期。**两项推翻既有决策**:目录带页码推翻批次 8 的 D1 免更新路线决策(拍板后须更新 ADR);docx 模板导入解除 2026-08-14 暂缓裁决(原否 docx4js+OOXML 逆映射,须重新探技术路线)。每批独立提交可回退,GUI 面改动走 ACCEPTANCE 人工实测。

- [x] **F1 图片控制增强**(B1):`{width=..}`/`{height=..}` 图片属性语法(Pandoc 风格)+ figure 题注语义绑定(图片独立成段且后跟「图：」行时绑定居中);落点 image-run handler + CROSS_REF_KINDS 表驱动;双格式对齐——**已完成(2.1.0,GUI 实测通过)**
- [x] **F2 表格列宽控制**(B3):列宽语法支持与自适应策略;双格式对齐——**已完成(2.1.0,GUI 实测通过)**
- [x] **F3 标题排版粒度**(A3):各级标题字号/间距独立设置(settings typography 扩展 + 抽屉 L2)——**已完成(2.1.0,GUI 实测通过)**
- [x] **F4 页眉页脚自定义**(A1):页眉文字/logo 图片/左右分栏模板(docx header/footer 扩展 + pdf printToPDF headerFooter);补齐「交付全家桶」最后缺口——**已完成(2.1.0,GUI 实测通过)**
- [x] **F5 文字水印**(A2):内容/角度/透明度/灰度(docx 置底 VML Textbox 旋转 + pdf 打印覆盖层);不入预设;自动断言 test/segments/watermark.test.js——**已完成(3.1.0,自动断言全绿;GUI 实测通过 2026-08-28 随 3.2.0 关闭)**
- [x] **F6 转换预检报告**(C1):转换前体检(缺失图片/悬空引用/未标语言代码块等汇总);warnings 通道现成;零竞品差异化项——**已完成(自动断言 test/segments/precheck.test.js 全绿;报告弹窗 GUI 实测通过 2026-08-28 随 3.2.0 关闭)**
- [x] **F7 目录带页码**(ADR-007 混合路线,部分推翻 D1;批①/批②均已完成 2026-08-28):**已完成(3.3.0,GUI 实测通过 2026-08-28 随 3.3.0 关闭)**
  - [x] **F7-① docx opt-in Word 域目录**:settings 新增 `tocMode: 'static' | 'field'`(默认 static=现状免更新静态目录);field=真实 TOC 域(beginDirty 触发 Word/WPS 打开更新、注入真实页码);双格式一致开关;`toc-caption.test.js` 补断言;UI 抽屉 L2 目录模式下拉 + i18n 三语
  - [x] **F7-② PDF 两遍法静态页码**:field 模式触发——第一遍打印经既有 /Dests 命名目标解析定位标题页码(pageNumbersForNames,与书签大纲同源,免 pdfjs 文本匹配)→ 第二遍注入目录页码 span(.toc-page 点线引导)重印;TOC 后硬分页符保正文布局一致;自动断言见 test/segments/toc-pagenum.test.js(/Dests 解析页码 + 注入一致、随文档顺序单调);WPS 行为纳入双实测
- [x] **F8 合并总目录增强**(C2):合并已是单 convert 通路(mergeMarkdowns → convert 一次),标题/题注编号本就跨文件连续、TOC 本就覆盖全文;本项固化「合并总目录覆盖全部源文件标题 + 跨文件页码准确」(field 模式两遍法,经文件间 page-break 起新页,B 页码严格大于 A);自动断言见 test/segments/merge-toc.test.js(docx+pdf 双格式总目录覆盖 A+B 共 8 标题、PDF 跨文件页码单调且 B>A、.toc-page 注入);typecheck/lint/build/61 段/smoke 全绿;状态:已完成(随 3.4.0 发布)
  - [x] **F9 docx 模板导入**:浅导入 v1(ADR-008)已完成——jszip 解包 .docx 提取 Normal/Heading1 样式 rPr(字体 ascii/eastAsia)+ 字号 + 文档 sectPr(页面尺寸/边距),映射回 typography/pageSetup 设置(标题样式字体优先、页面尺寸匹配纸张+朝向判定);UI 设置抽屉 01 预设·管理动作行新增「导入 Word 模板」按钮(F4 同 IA 落位),main 打开对话框→解包合并持久化→回填;颜色等深导入留后续独立候选;自动断言见 test/segments/template-import.test.js(纵向 A4+横向 Letter 两案例);typecheck/lint/build/62 段/smoke 全绿;状态:已完成(随 3.5.0 发布)

### 界面重构 v3「印刷付梓」遗留项(2026-08-26 实测对齐设计稿后记录)
- [x] **主按钮 Ctrl+Enter 脉冲动画**:mockup `.btn.main.pulse`;就绪态主按钮(convert/batch/merge)加 `pulse` class,CSS `.btn.pulse:not(:disabled)` 呼吸引导,转换中禁用自动停脉冲——**已完成(2026-08-27)**
- [x] **状态行 busy/ok 呼吸色**:`utils.setStatus` 增 `setStatusTone('busy'|'ok')` tone 类,CSS `.status--busy/--ok::before` 呼吸色,错误/警告自动清 tone,尊重 prefers-reduced-motion——**已完成(2026-08-27)**

## 已完成(历史规划压缩;详情见 CHANGELOG 对应版本与 archive 存档)

### 二期批次 1-9(按批独立交付,含验收标准)
- 批次 1「排版控制 + 设置底座」✅ 0.6.0
- 批次 2「保真 + 正式文档化」✅ 0.7.0
- 批次 3「批量 + 合并」✅ 0.8.0 + 0.8.1
- 批次 4「长文档」✅ 0.9.x~0.10.0(书签/脚注/页眉页脚)
- 批次 5「中文排版深化 + 保真补全」✅ 0.11.0~0.14.0
- 批次 6「学术正式化」✅ 0.15.0~0.16.0(模板包/公式双格式)
- 批次 7「体验优化 + 流程简化」✅ 0.17.0 + 0.17.1,用户 GUI 实测通过(0.17.3,见 ACCEPTANCE.md)
- 批次 8「功能扩展:学术正式化延伸」✅ 0.18.0~0.18.1——**D1=免更新路线**(beginDirty:false + 渲染期静态注入,零提示全端一致,改标题后需重新导出)、**D2=前缀行识别**(图/表后紧跟「图: 标题」行);8a TOC 开关化 + 静态标题列表(无页码,右键更新域可刷新)、8b 题注全文连续编号(图 1/2/3、表 1/2 独立计数);验收 toc-caption.test.js 9 断言 + 用户实测通过(2026-08-09)
- 批次 9「学术正式化:公式编号 + 交叉引用」✅ 0.19.0~0.19.1——**D3=免更新路线延续**(静态「(N)」编号 + 静态「式 (N)」超链接,改号后重新导出)、**D4 语法拍板**($$ 块自动编号全文连续 (1)(2)(3)…;锚点 `{#eq:label}` 独立行不渲染;引用 `[式](#eq:label)`);验收 eq-numbering.test.js 9 断言,待 GUI 实测(ACCEPTANCE.md 批次 9 节)

### 测试缺口补齐(2026-08-10~13,24 项全部完成)
- 高 10 项 ✅:封面双格式/breakBeforeH1 产物/取消链路/重名保护/缺失图片警告/公式降级/外链图片下载/任务列表/h4-h6/分页符产物
- 中 9 项 ✅:settings sanitize 边界/slug/frontmatter/非 A4 纸张与边距/行距缩进值/代码块序列化/引用块列表表格/外链 rels/页脚文案
- 低 5 项 ✅:renderer 交互与 IPC dialog 转 GUI 实测(2026-08-11 用户实测通过)/runAfterConvert/collectMarkdownPaths/resolveOutputPath
- R8 收尾评审 A 组 ✅(A1 分页符下沉、A2 书签端到端、A3 smoke diag 修盲区);B1 未执行,转「当前待办」
- R10 评审 T 组 ✅(T1 GBK 端到端、T2 merge→pdf file:// 守卫、T3 书签 w:id 唯一性、T4 renderPdf 失败路径、T5 行内 HTML 交叉边界、T6 核实覆盖免补、T7 超时注入、T8 resolver 同一性)

### 重构 R1-R10(2026-08-10~13,审计驱动,全部行为等价/注明修复项,每迭代独立提交可回退)
- **R1 契约共享**(394950f):白名单/settings-defaults 下沉 core
- **R2 docx/render.ts 拆分**(1295→~850):captions/equations/mdast-utils/image-type
- **R3 pdf/render.ts 拆分**(802→~250):template/postprocess
- **R4 H3 图片变形修复 + L1 类型统一**:PNG/JPEG 原始尺寸等比缩放,webp 降级
- **R5 中优先级快修(M1/M2/M5)**:括号 URL/临时 HTML 随机后缀/pushRuns 统一 async
- **R6 中优先级快修(M4/M6)**:settings 写队列串行化/图片缺失检查并入 resolver
- **R7 renderer 阶段一**:dom.ts 抽取/删 L4 死代码/L5 状态合并
- **R8 renderer 阶段二**:拆分 state/utils/convert-flow/file-list/dialogs,组合根 ~950 行
- **R9 低风险清扫**:L6/L7(批 3)+ L3/M3(批 4)完成,L9 取消(不值得重构);M7/M8 已知限制不动
- **R10-1 convert context 收敛**(e015fae)、**R10-2 renderPhrasing 合并**(ec26a4b)、**R10-3 runWithCtx**(16c3d3f)、**R10-4 HTTP 失败不缓存**(5abe4fe)、**R10-5 settings-panel.ts**(5454426)、**R10-6 inline-html.ts**(ffa5e7c);R10-7 不做(见候选池)

### 其他完成项
- **待修复**:PDF 任务列表 checkbox 替换失效(289b837,2026-08-10);docx 侧无 checkbox 视觉为设计如此
- **迭代 4「预览入口迁移」**(2026-08-11):单/多文件态预览按钮 + 完成弹窗移除预览,用户 6 项清单全通过
- **P0 bug:smoke-merge-1-合并.pdf 图片未显示**(392fca1,2026-08-11 用户验证通过)——merge 反斜杠绝对路径 %5C 编码 bug + 样例图可见化;不加端到端断言(printToPDF 图片自动化检测不可靠,实证),由 smoke 可见图人工验证

### 技术债处置五批（2026-09-25 全部关闭；计划原文与逐项记录见 archive/20260925-130122-技术债处置计划）
- 封版期维护 4 项 + 关于窗 CSP 并入安全批：段数订正、沉没债补登记（契约归位与测试段归位，闭环见候选池）、coverage 残留清理、G1-G9 盘点关闭（证据入 RESEARCH）；纯文档提交
- 安全与契约收口 5 项：关于页外链 IPC 收口单源、ja 字典 satisfies 全量锁 441 键、令牌破例清零、关于窗沙箱+CSP 与主窗同口径（GUI 实测通过，ACCEPTANCE 关闭）、深色双块恒等断言
- core 双源收敛 4 项：水印与表格边框色收单源、highlight.js 30 色板共享常量、警告去重 i18n 共享、KaTeX CSS 加载拍板「常态零 IO+两处注入默认值」——与安全批同随 3.11.6 发版
- 结构重构 6 项：测试段镜像三层归位、打开对话框样板收口与版本比较单源、跨进程契约归位 core/ipc-contract.ts、pdf 模板三拆、settings 六组拆线、成书向导五文件拆分——GUI 实测通过，随 3.11.7 发版（提交链见 STATUS）
- 测试增强 5 项：覆盖率门槛 90/85/90/90 进 CI（本地与 CI 同门禁）、eslint 项目 globs 运行时自动扫描、smoke 固定等待改条件等待（拍板「仅动等待，计数全保留」）、看门狗超时改「记录失败继续跑」、测试段 `// @ts-check` 首批 13 文件渐进——无用户可见变化
- 两个决策点均已拍板（KaTeX 加载取最小注入、smoke 仅动等待）；逐项提交链 git log 可查，批次详情见 STATUS 顶部条目与计划归档；渐进遗留见候选池
