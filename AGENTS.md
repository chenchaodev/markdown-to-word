# markdown-to-word 项目约束

> 规则见全局配置目录 `AGENTS.md`

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM,Node >= 22.13(勿回退;typescript-eslint 用 TS6 API,`typescript` 别名 `@typescript/typescript6`;`tsc` 为 TS7,`@typescript/native` 别名)
- 镜像:`.npmrc` 已配 npmmirror 且仅含 registry(勿移除,勿加 electron 镜像键:npm 警告 + electron-builder 读不到);GUI Electron 43,本地开发经 `scripts/setup-env.ps1` 设 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 用户级环境变量(写死勿回退,CI 不需要)
- 核心依赖选型:docx 路线 = `docx` 9.x + remark 自研渲染管线;pdf 路线 = markdown-it + HTML 模板 + Electron `printToPDF`(勿回退 md-to-pdf);结论 `docs/ROADMAP.md` / 事实 `docs/RESEARCH.md`;钉死:markdown-it 14.3(勿升 15,tasklist peer 冲突)、@mdit/plugin-tasklist、@mdit/plugin-footnote 1.0.2、highlight.js、electron-builder 26.15.3(勿用 27 alpha)
- 架构方向:转换核心 `src/core/` 与 GUI(`src/main/` + `src/renderer/`)分离(便于测试与复用)
- 其他高风险配置:docx 字体必走 `src/core/docx/theme.ts` 集中配置(中文 eastAsia),禁散落硬编码;分页符固定 `<!-- page-break -->`(不占 `---` 的 hr 语义);landscape 传原始(纵向)值,勿手动交换(库自动交换)
- UI 设计(勿回退):界面(网页/「关于」/renderer/GitHub Pages)先读 `docs/design/ui-guidelines.md`(renderer 权威)+ `docs/design/settings-ia.md`;视觉身份 = 冷灰纸 + 朱砂红「排版付梓」,字体三角色(展示衬线只做标题/题字、UI 栈做正文、mono 做数据),签名元素(裁切线+钤印+直排)集中一处,朱砂仅用于「付印」语义,禁绕开 token 硬编码、禁大色块/装饰 emoji
- 文档分层:`docs/` 常驻 · `docs/campaigns/` 用完即删 · `docs/archive/` 只增不改;模式 2 禁写清单 → 全局配置目录 `CAMPAIGN-GUIDE.md` 1.2/1.3

## 规则
- 提交:一次提交 = 一个可独立回退的逻辑单元;message 用 prefix(`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`perf:`、`test:`);提交前过 typecheck/build,`git status` 只含本逻辑单元文件;`docs/CHANGELOG.md` 平时不写,发版按全局配置目录 `PUBLISH-GUIDE.md` 面向用户重写;实测状态变化同批更新 `docs/ACCEPTANCE.md` / `docs/STATUS.md` 阻塞行并同步仪表盘
- 版本号三统一(1.0.0 起):package.json / git tag / `docs/CHANGELOG.md` 同号
- 规划编号不进交付物:候选区 `B1`–`B11` 属规划内部用语,晋升后改用描述性功能名(如 成书向导/剪贴板直转),禁写入代码注释/文件名/`docs/CHANGELOG.md`/`docs/STATUS.md`/`docs/ACCEPTANCE.md`/`docs/ROADMAP.md` 小节标题;发版前做「编号→功能名」重命名
- pwsh 坑:commit message 用单引号包裹(内嵌 ASCII 双引号会被拆包);跨项目通用坑(pwsh 引号/MAX_PATH/EBUSY/编码)见全局配置目录 `ENV-GUIDE.md`「一、Windows 平台坑」,本仓具体坑见 `docs/RESEARCH.md`
- 测试体系:`test/` 镜像 `src/` 三层(segments/ · main/ · renderer/),按内容主题零注册;入口 `npm run test`(acceptance)/`test:smoke`/`test:all`;新增能力须补测试段,缺口见 `docs/ROADMAP.md`;核心路径改动跑对应测试段 + smoke,外围按影响面跑
- 流程(全局配置目录 `WORKFLOW-PLAN.md`/`WORKFLOW-DELIVER.md` 阶段 0-8):文档驱动,规划即契约;排期先价值确认;**需求入口单源 = `docs/ROADMAP.md`「候选区」**(分类 + 价值/工作量 → 确认 → 移「已排期」);`docs/ACCEPTANCE.md` 只列人工 GUI 实测项,自动断言只留指针;代码结构与质量(注释/命名/契约单源/测试细则)见全局配置目录 `CODE-GUIDE.md`,改代码/重构/测试前先读

## 文件信息
- **本文件容量** ≤2500 字符(砍除顺序见全局配置目录 `META-GUIDE.md` 四)
- 版本:v1.7(2026-09-26)
