# 状态速查

## 当前状态

> 当前定位:3.12.0 已发版;封版期维持「暂停新功能开发,文档维护 + 技术债清理」(需求入口见 BACKLOG,确认后排 ROADMAP「当前待办」)。
> 历史批次明细见 `docs/CHANGELOG.md` 与 git log;审计与调研证据链见 `docs/archive/`。

- 2026-09-26:**阶段 6 可执行部分完成，余两项待授权**:冒烟实现下沉到 `src/main/smoke.ts` → `dist/main/smoke.js` 随包分发,修复「打包产物跑不了 --smoke」阻塞缺口(dev-only 入口进不了 app.asar),解包产物冒烟**实跑首次转绿**(退出码 0 + 五条标记齐备);新增解包/安装冒烟脚本(安装脚本默认预演零副作用,`--execute` 才真实装卸并先打印系统改动警告);新增供应链门禁 `check:supply`(SCA 两级扫描 + 离线确定性 SBOM + 许可证/NOTICE,实测**生产树 0 漏洞**、含 dev 全树 16 条全为 dev-only);13 处 action 浮动 tag 固定到 40 位 commit SHA;新增 `docs/SIGNATURE-STATUS.md` 与 `check:signature`(3 个产物实测均 unsigned,与 D-04 声明一致);源文件重命名探针实测出真实边界(发布链因 `clean:dist` 免疫,裸跑 `build` 会留陈旧产物);`verify:ci` 105 段全绿 + `npm run dist` 整链通过;**待授权**:GitHub lane 实跑、真实安装/卸载
- 2026-09-26:**阶段 5 完成，阶段 6 待开始**:传递依赖声明修正(jszip 移入 dependencies + 9 个 core 传递依赖钉版)与 `check:boundary` 导入门禁入 verify:ci(负向夹具 18→21);`logic.ts` 去 electron 依赖 + 跨层类型归位 core;PDF 目录改结构化标题数据(不再正则反解析);21 行双管线差异矩阵(必须一致 12 / 允许不同 9)+ 5 个 differential fixture;DOCX Ctx 拆为 config + 5 个可变状态子对象;测试段改逐段独立 Electron 子进程(硬超时杀进程树、userData 段级隔离、case 级报告、失败 artifact 落盘);fixture 改显式注册 + mock 边界守护(堵出 nativeTheme/webUtils 真实漂移);108 个测试源文件全量 `@ts-check`、清零 2053 条类型错误(新增 `convert-helpers.js` 判别式收窄 + `tscheck-coverage` 守护段);`verify:ci` 101 段全绿且 TS7 CLI 与 TS6 API 探针双侧零类型错误;隔离模型耗时 2.21x(90.2s vs 40.9s)
- 2026-09-26:**阶段 4 自动断言完成，GUI 待用户**:提交 `499a6bc` 收口动态节点 i18n、向导重开/语言、复制/取消中性态、初始化 barrier、main 语言菜单标题栏同步、ARIA/视觉守卫；主会话 `verify:ci` 95 段全绿，geometry 12 场景/10 恒定组；真实窗口/读屏/深浅主题验收待用户
- 2026-09-26:**阶段 3 完成，阶段 4 待开始**:提交 `3c429c8` 落地 core signal/deadline/稳定取消码、resolver/目录/批量/合并预算、KaTeX 资源上限、clipboard/preview/Mermaid 生命周期；主会话 `verify:ci` 90 段全绿；`test/pending/` 红测试已迁入 `test/segments/`，保留历史副本
- 2026-09-26:**阶段 2B 完成，阶段 3 待开始**:提交 `fefbf19` 建立同目录临时文件、魔数校验、硬链接独占提交与 EEXIST 递增选名；无原子提交能力时安全失败，不退化直写；`verify:ci` 84 段全绿；D-03 媒体类型/大小预算转入阶段 3
- 2026-09-26:**阶段 1 实现完成，GUI 待用户**:提交 `a8aa428` 收口真实 IPC single-flight、关闭/取消竞态、预检异常可观察、renderer 命令/向导锁、设置失败草稿与 ui-state 反馈、批量/合并 after-convert 竞态；`verify:ci` 83 段全绿；阶段 1 仅保留用户 GUI 验收
- 2026-09-26:**阶段 0 完成，阶段 1 执行中**:阶段 0 本地门禁与决策台账已通过 `verify:ci`（77 段、coverage、fixtures、smoke、geometry），提交 `eb372b4`；远端 GitHub lane 实跑证据后置，coverage/fixture/smoke 故意失败探针转入阶段 7；当前进入阶段 1 四项验收面，暂不推送远程
- 2026-09-26:**阶段 0 门禁接入(几何/产物/指纹)**:新增稳定入口 `check:env`、`check:geometry`、`gen:dist-manifest`、`check:dist-manifest`、`check:asar`、`check:release`;`verify:ci` 链尾接入几何门禁(build 必在其前),`verify:release` 仍为 verify:ci + dist,dist 内部为 build → dist 清单 → electron-builder → 清单校验/ASAR 核对/发布目标核对(含 SHA-256 报告);契约自检新增「几何在链且在 build 后」「清单基线先于打包、产物核对后于打包」断言(负向夹具 8→18);CI/Release 在 `npm ci` 后落环境指纹(Node/npm/Electron/Chromium/字体/DPI),主 CI 与 Release 均以 `always` 上传几何报告/截图与发布留痕,Release 资产改为按当前版本点名上传(不再 `release/*.exe` 通配);本地 check:contract/selftest/typecheck/lint/几何门禁(12 场景 7 恒定组,exit 0)/dist 清单/环境指纹全绿;**远端 GitHub lane 尚未实跑**
- 2026-09-26:**发布链补前置清理(`clean:dist`/`clean:release`)**:新增 `scripts/clean-artifacts.mjs`,只删 dist/release 两个生成目录 —— 目标写死并与 package.json 打包配置对账,带保护区/上跳段/符号链接/realpath 越界守卫,`--target` 只收 dist/release/all、不接受任意路径,`--dry-run` 可预演,删除失败给可操作提示;置于 dist 链 build 之前,契约断言清理必在、有序、目标不越界(负向夹具 13→18);**关键实测**:只删 dist/ 而保留根目录 `tsconfig.tsbuildinfo` 会让 tsc 判定全部最新、一个文件都不发出(clean 后 build 仅剩 8 个复制资源),故清理连带删除根目录 `*.tsbuildinfo`,配对后 clean build 产出 262 文件且必需入口齐全;残留探针实跑(注入残留 → 清单校验判红 → 移除转绿);本机整条 `npm run dist` 实跑 exit 0(清单 262 文件、asar 10633 个文件交叉核对通过、release 3.12.0 三件套无历史残留、SHA-256 报告已生成),`release/` 已只剩当前版本产物(原 0.5.1/1.0.0/2.1.0 历史产物按授权清除);守卫反例(`--target src`、缺 target、未知参数、打包配置已迁移)全部拒绝且零删除
- 2026-09-25:**全库优化阶段 2A 完成并进入阶段 0 重启**:统一 Markdown 准备链、main/renderer 页面几何迁移与回滚、D-03 路径边界、merge 图片安全重定位已落地；`npm run verify:ci` 通过（72 段、coverage、fixtures、smoke）；OPT-2.3 输出原子提交与 D-03 媒体类型/大小预算仍未完成；阶段 3 红测试仍在 `test/pending/`，不计入实现；下一提交后从阶段 0 checklist 首个未满足项开始，暂不推送远程
- 2026-09-25:**发版 3.12.0 完成**(离线隐私文案区隔 + 双管线差异注释随版;GUI 实测通过 3 项全勾,验收关闭;四源同号 package.json=lockfile=tag v3.12.0=CHANGELOG [3.12.0];本会话 typecheck/lint/build/70 段/smoke 全绿;Release run 36114674025 与 CI run 36114669244 均 success,资产 MarkdownToWord-Setup-3.12.0.exe + latest.yml 已核对)
- 2026-09-25:**BACKLOG 晋升两项开发完成**:「离线隐私文案区隔」(关于页 `about.privacyNote` 说明行 + FAQ「离线与隐私」条目 + i18n 三语;文案如实保留两处联网例外,不写绝对「不联网」)与「双管线差异注释」(14 文件补差异/同步义务头注,纯注释零行为变更);typecheck/lint/build + 70 段 + smoke 全绿;GUI 实测通过(ACCEPTANCE「离线隐私文案区隔」3 项全勾关闭,随 3.12.0 发版)
- 2026-09-25:**发版 3.11.8 完成**(维护版,src 零变更,E 批测试工程化与需求管道 backlog 重组随版;四源同号 package.json=lockfile=tag v3.11.8=CHANGELOG [3.11.8];本地 typecheck/lint/build/70 段/smoke 全绿;GitHub Release 资产 MarkdownToWord-Setup-3.11.8.exe + latest.yml,Release 四源门禁与 CI 均 success;踩坑:typecheck 依赖 dist 于构建前跑必挂,Release/CI 首跑双败,三处 workflow 改 build 先行,经用户确认将首推 tag 移至修复提交 d75fe3f 后发布成功,详见 RESEARCH 同日条目)
- 2026-09-25:**需求管道重组:候选池升格项目 backlog,文件定名 `BACKLOG.md`(所有需求唯一入口)**:backlog 全文重写(功能新增/体验优化/架构优化·技术债/防御·安全分节,处置列标注待拍板/渐进执行中/暂缓/已明确不做,逐项业务价值+工作量;非任务备忘集中「维持人工·已知限制」节);ROADMAP 删处置小节(砍/记录不排期/暂不执行项/测试遗留/功能候选/候选池晋升/已知限制/维持人工不自动化)并入候选池,已完成历史保留;指针同步(RESEARCH/计划归档注记/runner/README);规则写入项目 AGENTS「流程」与全局 WORKFLOW-GUIDE 阶段 0/1(v1.9)
- 2026-09-25:**技术债计划按文档规范归置,原 `docs/TECH-DEBT-PLAN.md` 撤档**:收官后按落盘规范分流——原文存 `docs/archive/20260925-130122-技术债处置计划.md`(头部归档注记含分流指针);结论入 RESEARCH(四路盘点条目「处置/关联」更新);内容入 ROADMAP(「已完成」批次压缩记录)与 BACKLOG(渐进两项/smoke 计数冻结/看门狗悬挂段隔离等处置记录,随同日需求管道重组单源化);索引与指针同步(docs/README 登记、runner.js 局限注释);本文件同步瘦身(已关闭打开事项与过期状态归 CHANGELOG/archive,保持 ≤80 行)
- 2026-09-25:**技术债 E 批(测试体系增强)五项全部关闭,计划收官**:五项独立提交 `45d4b61`(E1 覆盖率门槛)→ `2f38fc8`(E4 自动扫描)→ `eb2d5e5`(E2 等待条件化,拍板「仅动等待,计数全保留」)→ `8186c86`(E3 看门狗试点)→ `ffae14e`(E5 `@ts-check` 渐进);每项独立验证全绿(E1 门禁正反向+70 段+smoke、E2 smoke×2、E3 悬挂探针+全量、E4 等价核对+新目录探针、E5 双配置 typecheck+双探针语义);**至此技术债计划 A-E 五批 24 项全部关闭,无剩余项(决策点 C4/E2 均已拍板)**,逐项记录见计划归档与 RESEARCH 同日条目
- 2026-09-25:**发版 3.11.7 完成**(技术债 D 批六项结构重构随版发布;四源同号 package.json=lockfile=tag v3.11.7=CHANGELOG [3.11.7];typecheck/lint/build/70 段/smoke 全绿;GitHub Release 资产 MarkdownToWord-Setup-3.11.7.exe + latest.yml,Release 四源门禁与 CI 流水线均 success;发版内容仅对话框位置记忆一处用户可感知改进,其余为内部重构)
- 2026-09-25:**技术债 D 批(结构重构)六项全部关闭**:六项独立提交 `fdd132f`(D5 段归位)→`9b57dee`(D6 对话框样板)→`07ee67a`(D4/C5 契约归位)→`fb4c70e`(D3 pdf 模板三拆)→`06a3bd2`(D2 settings 六组拆线)→`b3d7d83`(D1 向导三块拆分),每项 typecheck/lint/build/70 段/smoke 全绿;**GUI 实测已通过(2026-09-25,ACCEPTANCE 两处复测记录回写,无未关闭项)**

## 验证基线

- 已跑通:`npm run typecheck`、`npm run lint`、`npm run build`、`npx electron . --smoke`、`npm run test:coverage`(c8，core/main 自动产物口径；GUI renderer 编排层按人工验收边界排除，renderer 断言仍执行)
- 验收脚本:`npm run test`(test/acceptance.mjs 自动发现 `segments/`(core 渲染与跨域守护)、`main/`(主进程层)与 `renderer/`(UI 层)下 `*.test.js`,当前 **77 段 = segments 53 + main 19 + renderer 5**;单段筛选 `M2W_ONLY='段名子串'`;新增测试=新建段文件零注册);main 侧行为已有 `main/converter.test.js` 断言,smoke 保留必须 Electron 的断言(printToPDF 产物/书签/renderer diag/设置持久化往返)
- 恒等守护:`test/segments/identity-guards.test.js` 锁已知双源(zh 文案↔字典/MAX_RECENT_FILES/设置合并双侧/白名单扫描一致性)
- 验收样例:`npm run gen:fixtures`(需先 build)按功能自动生成 `test/fixtures/acceptance/*.md`(GUI 人工实测直接拖入);`npm run check:fixtures` 漂移校验(EOL 归一化,.gitattributes 双保险;CI 门禁步骤);新增功能=测试段顶层加 `export const fixtures = { main: ... }`
- smoke 自清理 output/smoke 临时产物(Windows 占用文件 EBUSY 容错跳过)
- 打包:`npm run dist`(`clean:dist` + `clean:release` → build → dist 清单 → electron-builder NSIS → `check:dist-manifest`/`check:asar`/`check:release`);`clean:dist` 必须连带删根目录 `*.tsbuildinfo`,否则 tsc 增量缓存会让 clean 后的 build 不产出任何文件;清理只覆盖 dist/release 两个生成目录,`node scripts/clean-artifacts.mjs --target dist|release|all [--dry-run]` 可单独预演;验证链:--dir → asar list → win-unpacked 启动存活 → 静默安装/卸载(退出码 0);打包版 `--smoke` 不可用(asar 内只读);镜像环境变量见 DEV-GUIDE
- 产物与布局门禁:`npm run check:geometry`(真实 Electron 窗口采样 renderer 几何,报告+截图落 `output/artifacts/ui-geometry/`,`verify:ci` 链尾一步);`npm run gen:dist-manifest`/`check:dist-manifest`(dist 规范化清单)、`check:asar`(app.asar 结构+与清单 SHA-256 交叉核对)、`check:release`(当前版本安装包/blockmap/latest.yml 一致性 + SHA-256 报告,拒绝历史产物残留);`npm run check:env`(Node/npm/Electron/Chromium/字体/DPI 指纹,探针缺值不阻断)
- CI 门禁:.github/workflows/ci.yml(windows-latest Node 22.13 主门禁 + Node 22 稳定线 + verify:ci 全链含几何门禁 + `always` 上传环境指纹与几何报告/截图);release.yml 含 tag↔package.json↔lockfile 版本校验、verify:release 全链(含打包后产物核对)、`always` 上传诊断留痕,Release 资产按当前版本点名上传(安装包 + blockmap + latest.yml)

## 铁律(勿回退)
> 项目级硬约束(技术栈/镜像/字体/分页符/依赖钉死)已全部迁至项目 `AGENTS.md`「硬约束」节,以彼处为准。

## 打开事项

- (无未关闭项,2026-09-25 收尾回写。新打开项记于此,完成即勾选关闭)
