# 状态速查

## 当前状态

> 当前定位:3.12.0 已发版;封版期维持「暂停新功能开发,文档维护 + 技术债清理」(需求入口见 BACKLOG,确认后排 ROADMAP「当前待办」)。
> 历史批次明细见 `docs/CHANGELOG.md` 与 git log;审计与调研证据链见 `docs/archive/`。

- 2026-09-25:**发版 3.12.0 完成**(离线隐私文案区隔 + 双管线差异注释随版;GUI 实测通过 3 项全勾,验收关闭;四源同号 package.json=lockfile=tag v3.12.0=CHANGELOG [3.12.0];本会话 typecheck/lint/build/70 段/smoke 全绿;Release run 36114674025 与 CI run 36114669244 均 success,资产 MarkdownToWord-Setup-3.12.0.exe + latest.yml 已核对)
- 2026-09-25:**BACKLOG 晋升两项开发完成**:「离线隐私文案区隔」(关于页 `about.privacyNote` 说明行 + FAQ「离线与隐私」条目 + i18n 三语;文案如实保留两处联网例外,不写绝对「不联网」)与「双管线差异注释」(14 文件补差异/同步义务头注,纯注释零行为变更);typecheck/lint/build + 70 段 + smoke 全绿;GUI 实测通过(ACCEPTANCE「离线隐私文案区隔」3 项全勾关闭,随 3.12.0 发版)
- 2026-09-25:**发版 3.11.8 完成**(维护版,src 零变更,E 批测试工程化与需求管道 backlog 重组随版;四源同号 package.json=lockfile=tag v3.11.8=CHANGELOG [3.11.8];本地 typecheck/lint/build/70 段/smoke 全绿;GitHub Release 资产 MarkdownToWord-Setup-3.11.8.exe + latest.yml,Release 四源门禁与 CI 均 success;踩坑:typecheck 依赖 dist 于构建前跑必挂,Release/CI 首跑双败,三处 workflow 改 build 先行,经用户确认将首推 tag 移至修复提交 d75fe3f 后发布成功,详见 RESEARCH 同日条目)
- 2026-09-25:**需求管道重组:候选池升格项目 backlog,文件定名 `BACKLOG.md`(所有需求唯一入口)**:backlog 全文重写(功能新增/体验优化/架构优化·技术债/防御·安全分节,处置列标注待拍板/渐进执行中/暂缓/已明确不做,逐项业务价值+工作量;非任务备忘集中「维持人工·已知限制」节);ROADMAP 删处置小节(砍/记录不排期/暂不执行项/测试遗留/功能候选/候选池晋升/已知限制/维持人工不自动化)并入候选池,已完成历史保留;指针同步(RESEARCH/计划归档注记/runner/README);规则写入项目 AGENTS「流程」与全局 WORKFLOW-GUIDE 阶段 0/1(v1.9)
- 2026-09-25:**技术债计划按文档规范归置,原 `docs/TECH-DEBT-PLAN.md` 撤档**:收官后按落盘规范分流——原文存 `docs/archive/20260925-130122-技术债处置计划.md`(头部归档注记含分流指针);结论入 RESEARCH(四路盘点条目「处置/关联」更新);内容入 ROADMAP(「已完成」批次压缩记录)与 BACKLOG(渐进两项/smoke 计数冻结/看门狗悬挂段隔离等处置记录,随同日需求管道重组单源化);索引与指针同步(docs/README 登记、runner.js 局限注释);本文件同步瘦身(已关闭打开事项与过期状态归 CHANGELOG/archive,保持 ≤80 行)
- 2026-09-25:**技术债 E 批(测试体系增强)五项全部关闭,计划收官**:五项独立提交 `45d4b61`(E1 覆盖率门槛)→ `2f38fc8`(E4 自动扫描)→ `eb2d5e5`(E2 等待条件化,拍板「仅动等待,计数全保留」)→ `8186c86`(E3 看门狗试点)→ `ffae14e`(E5 `@ts-check` 渐进);每项独立验证全绿(E1 门禁正反向+70 段+smoke、E2 smoke×2、E3 悬挂探针+全量、E4 等价核对+新目录探针、E5 双配置 typecheck+双探针语义);**至此技术债计划 A-E 五批 24 项全部关闭,无剩余项(决策点 C4/E2 均已拍板)**,逐项记录见计划归档与 RESEARCH 同日条目
- 2026-09-25:**发版 3.11.7 完成**(技术债 D 批六项结构重构随版发布;四源同号 package.json=lockfile=tag v3.11.7=CHANGELOG [3.11.7];typecheck/lint/build/70 段/smoke 全绿;GitHub Release 资产 MarkdownToWord-Setup-3.11.7.exe + latest.yml,Release 四源门禁与 CI 流水线均 success;发版内容仅对话框位置记忆一处用户可感知改进,其余为内部重构)
- 2026-09-25:**技术债 D 批(结构重构)六项全部关闭**:六项独立提交 `fdd132f`(D5 段归位)→`9b57dee`(D6 对话框样板)→`07ee67a`(D4/C5 契约归位)→`fb4c70e`(D3 pdf 模板三拆)→`06a3bd2`(D2 settings 六组拆线)→`b3d7d83`(D1 向导三块拆分),每项 typecheck/lint/build/70 段/smoke 全绿;**GUI 实测已通过(2026-09-25,ACCEPTANCE 两处复测记录回写,无未关闭项)**

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

- (无未关闭项,2026-09-25 收尾回写。新打开项记于此,完成即勾选关闭)
