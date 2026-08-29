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

## 当前待办(唯一入口)
> 2026-08-13 整理:合并原「待办(排期)」「延后(不排批)」与批次 8/9「备选/暂缓/不做(记后续)」并去重,历史规划压缩至「已完成」节,详情见 archive 存档。
> 2026-08-23 全库质量审计后新增「审计改进排期 B1-B14」(全部待办唯一明细在此;证据链见 archive/2026-08-23-133005)。
> 2026-08-23 目录结构优化方案探查定稿入待办(暂缓排期,排在现有待办之后;实施前须重新探查;证据链见 archive/20260823-230554)。

### 审计改进排期 B1-B14(2026-08-23,完成即勾选)
> 原则:每项独立提交可回退;core 行为改动须补测试段断言;重构行为等价。规模:S≤3 文件 / M 中 / L 大。决策点已于 2026-08-23 全部拍板(见各条「已拍板」)。

#### B14 文档修正(S,零风险;2026-08-23 完成,7 项逐项勾验于 2026-08-24)
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
> B1-B14 与目录结构重组已全部完成(2026-08-24 发版 1.2.0);审计整改 P0~P5 与 i18n 字典拆分已完成(2026-08-24)。当前无未关闭排期项;新需求按全局流程先价值确认再入本节。

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
- [x] **F8 合并总目录增强**(C2):合并已是单 convert 通路(mergeMarkdowns → convert 一次),标题/题注编号本就跨文件连续、TOC 本就覆盖全文;本项固化「合并总目录覆盖全部源文件标题 + 跨文件页码准确」(field 模式两遍法,经文件间 page-break 起新页,B 页码严格大于 A);自动断言见 test/segments/merge-toc.test.js(docx+pdf 双格式总目录覆盖 A+B 共 8 标题、PDF 跨文件页码单调且 B>A、.toc-page 注入);typecheck/lint/build/61 段/smoke 全绿;状态:完成(未发布)
  - [x] **F9 docx 模板导入**:浅导入 v1(ADR-008)已完成——jszip 解包 .docx 提取 Normal/Heading1 样式 rPr(字体 ascii/eastAsia)+ 字号 + 文档 sectPr(页面尺寸/边距),映射回 typography/pageSetup 设置(标题样式字体优先、页面尺寸匹配纸张+朝向判定);UI 设置抽屉 01 预设·管理动作行新增「导入 Word 模板」按钮(F4 同 IA 落位),main 打开对话框→解包合并持久化→回填;颜色等深导入留后续独立候选;自动断言见 test/segments/template-import.test.js(纵向 A4+横向 Letter 两案例);typecheck/lint/build/62 段/smoke 全绿;状态:完成(未发布)

#### 记录不排期(2026-08-25 用户裁定)
- B2 HTML 白名单扩展(块级标签+受控属性)、HTML 导出第三格式、frontmatter 元数据扩展——有价值但未入选本轮,后续可重新提案

### 界面重构 v3「印刷付梓」遗留项(2026-08-26 实测对齐设计稿后记录,不排期)
- [ ] **模板预设卡化**:mockup 01 组为三张预设卡,实现保留 select(自定义预设可达 10 项,sel 形态合规);卡片化需重构 rebuildPresetOptions/resolvePresetSelection/删除/导入导出整条链路——**用户裁定暂不执行,待后续提出**
- [ ] **单文件卡能力 chips**:mockup 展示「表格 ×6」等统计;需文件解析统计管线(TS 新功能),非纯样式项——**用户裁定暂不执行,待后续提出**
- [x] **主按钮 Ctrl+Enter 脉冲动画**:mockup `.btn.main.pulse`;就绪态主按钮(convert/batch/merge)加 `pulse` class,CSS `.btn.pulse:not(:disabled)` 呼吸引导,转换中禁用自动停脉冲——**已完成(2026-08-27)**
- [x] **状态行 busy/ok 呼吸色**:`utils.setStatus` 增 `setStatusTone('busy'|'ok')` tone 类,CSS `.status--busy/--ok::before` 呼吸色,错误/警告自动清 tone,尊重 prefers-reduced-motion——**已完成(2026-08-27)**


### 功能候选(排期)
- [x] **8c Mermaid 渲染导出**(中;无依赖)——PDF 近白送(Chromium 有 DOM,隐藏窗口渲染),docx 嵌入 SVG/PNG;原「砍」理由「无 DOM 环境」在 Electron 内不成立(批次 8 已重新评估升回);差异化亮点,建议起手;**已完成(2026-08-13 提交 a89507a,0.23.0,用户实测通过)**
- [x] **题注/章节交叉引用**(中;依赖 8b 补 label 机制)——承接批次 8/9 决策链(D1-D4 免更新路线,静态注入编号 + 超链接跳转);学术正式化闭环,建议起手;**已完成(2026-08-13,160b0d1,0.24.0,用户实测通过,验收见 ACCEPTANCE.md 批次 10 功能 2 节)**
- [x] **模板导入**(中高)——批次 13「预设 JSON 导入/导出」+ 批次 16「CSS 覆盖 pdf 路线」已完成(0.27.0/0.29.0,用户实测通过);docx 模板导入暂缓(docx4js 停维护 + OOXML 样式逆映射工程量大,方案对比见 archive/20260814-201622)
- [x] **代码块语法高亮写 docx**(中;无依赖)——逐 token 着色;pdf 侧 hljs 已就绪可复用,docx 侧需 token→TextRun 转换器 + 颜色映射(~200 行新模块 + 测试段);**已完成(2026-08-16,3eb22c7,0.32.0,用户实测通过)**
- [x] **i18n**(中)——界面文案抽离 + 多语言(中文为主,英文兜底);**已完成(2026-08-16,218b183,用户 GUI 实测通过,验收见 ACCEPTANCE.md)**
- [ ] **文档加密**(低-中)——docx 库原生加密;pdf 侧 pdf-lib 后处理(书签注入已有经验可复用);**已决策不做(2026-08-16 用户确认,见「砍」节;调研依据 archive/20260816-114520)**
- [x] **公式编号开关**(低)——已完成(2026-08-16,66681a9,0.29.0,用户实测通过)
- [x] **批注**(低)——已完成(2026-08-16,308769e,0.31.0,用户实测通过;语法 [锚定文本]{批注=内容})
- [x] **WPS 兼容矩阵**(低)——已完成(2026-08-16,4be7012,0.31.0,用户 Word/WPS 双实测通过;矩阵见 docs/WPS-COMPAT.md)

### 测试遗留
- [x] **B1 renderer 纯函数段**(2026-08-11 R8 收尾评审提出,未执行;低风险纯测试)——抽 `src/renderer/pure.ts`(isMarkdown/baseName/truncateMiddle/stageText/STAGE_PERCENT 等零 DOM 函数,现居 utils.ts),utils.ts 改 re-export(renderer 内部 import 路径不变),新建 segments/renderer-pure.test.js;建议作为下一个小迭代(零行为改动);**已完成(2026-08-13,482160e,renderer-pure.test.js 已建,缺口清零)**
- [x] C4(不排期):isCaptionTarget/buildEquationContext/collectPlainText 直测——产物断言(toc-caption/formula/eq-numbering)已间接覆盖,边际收益低,不做
- [x] R10-7(不做留档):pdf/render.ts 容器深度跟踪 helper——收益 ~20 行且 token 流语义敏感,评审结论「可不做」

### 砍(已决策不做)
- CLI 转正(无用户需求,调试可走脚本/直接调 core)、自动更新与签名(本地离线隐私卖点,更新反噬)、目录监视与同步、PDF 多栏、批量重命名
- 完整 CSL 参考文献(成本高≈重写 citeproc,ROI 低)、AI 改写(与本地离线隐私卖点冲突)、表格合并单元格(markdown 无标准语法,需自定义+双格式对齐)、代码高亮主题切换(仅 pdf 有意义,打印需求趋零)——2026-08-16 用户确认不做
- 文档加密(2026-08-16 用户确认不做):docx 库不支持加密(非 OOXML 标准),替代需引入 officecrypto-tool 新依赖;pdf 侧需 qpdf 原生二进制分发,成本高 ROI 低;调研依据 archive/20260816-114520
- 完整 Mermaid 取消不再成立(已升回功能候选 8c)
- 最近文件:批次 11 I1 已实现(一键重转/会话恢复),原延后项作废

### 已知限制(技术债/不做,记录不遗忘)
- **M7 extractHeadings 正则依赖渲染细节**(pdf/render.ts):标题提取正则与渲染结构耦合,重构需谨慎(2026-08-11 审计记录)
- **M8 resolverCache/HTTP 缓存无上限**:当前可接受,记录即可(2026-08-11 审计记录)
- **printToPDF 产物图片显示无法自动化断言**:smoke 可见图人工验证(维持人工不自动化)
- **renderer 交互 / IPC dialog / preview 生命周期**:维持 GUI 实测,不自动化(见「维持人工不自动化」节)
- **docx 侧任务列表无 checkbox 视觉**:设计如此(与 pdf ☐/☑ 字符替代不同)

### 候选池晋升待办（2026-08-29 从 ROADMAP-CANDIDATES 挑选，规划即契约）
> 来源：ROADMAP-CANDIDATES.md（剪贴板直转 综合 70 / 成书向导 综合 85）。设计决策已拍板（见各条）。开发前确认，独立提交可回退；GUI 面走 ACCEPTANCE 人工实测。

#### 剪贴板直转 / 拖放增强（体验）
- [x] **剪贴板直转**：主界面空态/拖放区加「粘贴 Markdown 转换」按钮；新增 IPC `clipboard:read` 返回 `{type:'text'|'files', text?, paths?}`（走 Electron `clipboard`，区分文本与文件路径）；Markdown 文本写入 userData 临时目录后走现有 `convert:single`（`convert-flow.ts:55 runConvert`）；剪贴板为文件路径时复用现有 drop 逻辑（`collectMarkdowns`）——**GUI 实测通过 2026-08-29 随 3.9.0 发版关闭**
  - 设计决策（已拍板）：① **不做热键**（仅按钮显式触发，避免与文本框粘贴冲突）；② **剪贴板内容始终当 Markdown**（符合工具定位，不启发式判断）
  - i18n：按钮/反馈文案键（zh/en/ja）
  - 自动断言：建议补 test/segments 或 main 段覆盖临时文件→convert 通路
- [x] **拖放增强（打磨）**：文件夹递归（`collectMarkdownPaths`）与去重（`partitionDuplicates`）已具备；仅打磨——拖入即追加到合并队列、去重/跳过反馈更明显（复用现有 selectionStatus）——**GUI 实测通过 2026-08-29 随 3.9.0 发版关闭**
  - 工作量小，可与剪贴板直转同批

#### 成书向导（体验）
- [x] **成书向导**：renderer 内自建 stepper 模态（复用 `trapFocus` 焦点陷阱，参考 about 模态；不新建 BrowserWindow，保持共享 state）；串联 F4/F5/F8/F9 + 预设系统 + 封面页——**GUI 实测通过 2026-08-29 随 3.9.0 发版关闭**
  - 步骤（每步可跳过）：① 模板/预设（`applyTemplatePreset` 或 `template:importDocx` 回填 typography/pageSetup）② 封面页（从 frontmatter 或向导输入取标题/作者，生成独立封面：docx 走封面节 / pdf 走 HTML 模板封面，双格式均支持）③ 页眉页脚（`headerFooter`）④ 水印（`watermark`）⑤ 合并源多选+排序（`mergeMarkdowns` 以 page-break 拼接）⑥ 目录/页码（开 `toc` + `tocMode:'field'`）→ 合并草稿 settings 后调 `runMerge`（`convert-flow.ts:165`）输出单 docx/pdf
  - 设计决策（已拍板）：① **封面页纳入成书向导范围**（docx 封面节 + pdf HTML 模板封面，双格式均支持）；② 向导编排 F4/F5/F8/F9+预设+封面页，封面页需新增 docx 封面节与 pdf 封面模板（双格式必要新增，非纯编排）；③ 输出支持 docx 与 pdf（双格式）
  - 设计细化决策（已拍板）：封面不含「单位」字段（不扩展核心）；向导入口仅空态投放区按钮（不做菜单）；向导内设置实时写入 `state.settings` + autosave（与抽屉一致）
  - 与 D1 协同：向导即「复杂能力藏进向导」范例，做完反哺 D1
  - i18n：多步骤键 + 封面字段文案键（zh/en/ja）
  - 自动断言：stepper 状态机纯函数可单测；转换通路复用现有 merge 断言；封面 docx 封面节 / pdf 封面模板断言
  - 设计文档：`docs/design/book-wizard.md`（UI/交互稿已定稿；含剪贴板直转按钮）

#### D1 GUI 易用反制 AIDOC（防御主题；2026-08-29 从 ROADMAP-CANDIDATES 晋升，规划即契约）
> 来源：ROADMAP-CANDIDATES D1（GUI 易用反制 AIDOC，综合 65，防御）。目标：持续打磨零配置/向导化，预设默认即正确、复杂能力藏进向导，区隔 AIDOC Station 配置复杂（竞品研判：注入式强依赖 Word/WPS 宿主、配置面宽；我方独立生成 .docx + 合理默认 + 向导化占优）。每批独立提交可回退；GUI 面走 ACCEPTANCE 人工实测。

- [ ] **预设扩面覆盖交付链**（M,P1；反转「页眉页脚/水印 不入预设」决策）：`TemplatePreset` 增可选 `headerFooter`/`watermark`/`equationNumbering`/`breakBeforeH1`；6 个内置预设补 sane 值（页眉页脚默认=标题居中+页码、水印空、编号按场景）；`matchesPreset`/`PRESET_COMPARE_FIELDS` 同步；`applyTemplatePreset`(settings-bindings.ts:225)合并新字段（不碰 toc/tocMode/自定义预设）；`presetCoveredGroupLabels` 增组；i18n `settings.presetScopeNote`/`settings.watermarkNote` 更新；自动断言见 test/segments/presets.test.js（字段命中矩阵 + 套用生效）
- [ ] **向导补全高频复杂项**（M-L,P1；依赖预设扩面）：成书向导 step 增边距/字体微调入口/标题档位/编号开关/输出目录/afterConvert/页眉 logo 选择（复用 settings-bindings 控件）；全程不进 35 控件抽屉即可产出复杂成书；GUI 实测
- [ ] **首次启动引导**（M,P2；依赖上两项）：renderer 首启 tour 或增强空态（引导「选预设→向导→转换」），firstRun 持久化、可跳过、尊重 prefers-reduced-motion；GUI 实测

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
- **R10-1 convert context 收敛**(e015fae)、**R10-2 renderPhrasing 合并**(ec26a4b)、**R10-3 runWithCtx**(16c3d3f)、**R10-4 HTTP 失败不缓存**(5abe4fe)、**R10-5 settings-panel.ts**(5454426)、**R10-6 inline-html.ts**(ffa5e7c);R10-7 不做(见当前待办)

### 其他完成项
- **待修复**:PDF 任务列表 checkbox 替换失效(289b837,2026-08-10);docx 侧无 checkbox 视觉为设计如此
- **迭代 4「预览入口迁移」**(2026-08-11):单/多文件态预览按钮 + 完成弹窗移除预览,用户 6 项清单全通过
- **P0 bug:smoke-merge-1-合并.pdf 图片未显示**(392fca1,2026-08-11 用户验证通过)——merge 反斜杠绝对路径 %5C 编码 bug + 样例图可见化;不加端到端断言(printToPDF 图片自动化检测不可靠,实证),由 smoke 可见图人工验证

### 维持人工不自动化
- printToPDF 产物图片显示(smoke 可见图人工验证)、renderer 交互、preview:open 生命周期、IPC dialog(ACCEPTANCE GUI 实测清单)
