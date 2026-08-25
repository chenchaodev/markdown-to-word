# 状态速查

## 当前状态

- 2026-08-25:**F1 图片控制增强完成,待 GUI 实测**(Pandoc 风格 `{width/height}` 属性语法+figure 居中;image-size.ts 纯函数单源双管线共用;52 段全绿;F2 表格列宽进行中)
- 2026-08-25:**功能开发阶段立项「F1-F9」**(双路调研后用户拍板 9 项:图片控制/表格列宽/标题排版粒度/页眉页脚自定义/水印/转换预检/目录带页码[推翻 D1]/合并增强/docx 模板导入[解除暂缓];F7/F9 技术路线调研已完成待拍板;调研存档 archive/2026-08-25-182036;每批独立提交,逐批实施)
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
- 验收脚本:`npm run test`(test/acceptance.mjs 自动发现 `segments/`(core 渲染与纯逻辑)与 `main/`(主进程层)下 `*.test.js`,当前 **51 段**;单段筛选 `M2W_ONLY='段名子串'`;新增测试=新建段文件零注册);main 侧行为已有 `main/converter.test.js` 断言,smoke 保留必须 Electron 的断言(printToPDF 产物/书签/renderer diag/设置持久化往返)
- 恒等守护:`test/segments/identity-guards.test.js` 锁已知双源(zh 文案↔字典/MAX_RECENT_FILES/设置合并双侧/白名单扫描一致性)
- 验收样例:`npm run gen:fixtures`(需先 build)按功能自动生成 `test/fixtures/acceptance/*.md`(GUI 人工实测直接拖入);`npm run check:fixtures` 漂移校验(EOL 归一化,.gitattributes 双保险;CI 门禁步骤);新增功能=测试段顶层加 `export const fixtures = { main: ... }`
- smoke 自清理 output/smoke 临时产物(Windows 占用文件 EBUSY 容错跳过)
- 打包:`npm run dist`(electron-builder NSIS);验证链:--dir → asar list → win-unpacked 启动存活 → 静默安装/卸载(退出码 0);打包版 `--smoke` 不可用(asar 内只读);镜像环境变量见 DEV-GUIDE
- CI 门禁:.github/workflows/ci.yml(windows-latest node22 全量 + node20-floor 地板守卫 + check:fixtures + smoke);release.yml 含 tag↔package.json 版本校验

## 铁律(勿回退)
> 项目级硬约束(技术栈/镜像/字体/分页符/依赖钉死)已全部迁至项目 `AGENTS.md`「硬约束」节,以彼处为准。

## 打开事项
- [x] 审计整改 P0~P5 + i18n 字典拆分:人工 GUI 实测通过(2026-08-24),随 1.3.0 发版关闭
- [x] 功能候选全部收口(批次 10:8c Mermaid / 交叉引用 / 模板导入 / 公式编号开关 / 批注 / WPS 兼容矩阵;排期 3 项全部关闭或转砍);ROADMAP「当前待办」无未关闭排期项
- [x] 测试缺口(24 项)已全部补齐(2026-08-13);新增缺口按需入 ROADMAP
