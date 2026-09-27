# markdown-to-word 项目约束

> 规则见全局配置目录 `AGENTS.md`

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM,Node >= 22.13(勿回退;typescript-eslint 用 TS6 API,`typescript` 别名 `@typescript/typescript6`;`tsc` 为 TS7,`@typescript/native` 别名)
- 镜像:`.npmrc` 已配 npmmirror 且仅含 registry(勿移除,勿加 electron 镜像键:npm 警告 + electron-builder 读不到);GUI Electron 43,本地开发经 `scripts/setup-env.ps1` 设 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 用户级环境变量(写死勿回退,CI 不需要)
- 核心依赖选型:docx 路线 = `docx` 9.x + remark 自研渲染管线;pdf 路线 = markdown-it + HTML 模板 + Electron `printToPDF`(勿回退 md-to-pdf);事实与踩坑见 `docs/archive/` 技术事实层;钉死:markdown-it 14.3(勿升 15,tasklist peer 冲突)、@mdit/plugin-tasklist、@mdit/plugin-footnote 1.0.2、highlight.js、electron-builder 26.15.3(勿用 27 alpha)
- 架构方向:转换核心 `src/core/` 与 GUI(`src/main/` + `src/renderer/`)分离(便于测试与复用)
- 其他高风险配置:docx 字体必走 `src/core/docx/theme.ts` 集中配置(中文 eastAsia),禁散落硬编码;分页符固定 `<!-- page-break -->`(不占 `---` 的 hr 语义);landscape 传原始(纵向)值,勿手动交换(库自动交换)
- UI 设计(勿回退):界面(网页/「关于」/renderer/GitHub Pages)先读 `docs/design/ui-guidelines.md`(renderer 权威)+ `docs/design/settings-ia.md`;视觉身份 = 冷灰纸 + 朱砂红「排版付梓」,字体三角色(展示衬线只做标题/题字、UI 栈做正文、mono 做数据),签名元素(裁切线+钤印+直排)集中一处,朱砂仅用于「付印」语义,禁绕开 token 硬编码、禁大色块/装饰 emoji
- 文档分层:`docs/` 常驻 7 份根 md(`REQ`/`LOG`/`PLAN`/`large`/`adr`/`archive` + `CHANGELOG`/`USER-GUIDE`/`DEV-GUIDE`)+ 项目层(`docs/design/`、`docs/WPS-COMPAT.md`、`docs/SIGNATURE-STATUS.md`)+ 只增不改的 `docs/archive/`;载体职责与写入判据见全局配置目录 `AGENTS.md` 六

## 规则
- 提交:一次提交 = 一个可独立回退的逻辑单元;message 用 prefix(`feat:`、`fix:`、`docs:`、`chore:`、`refactor:`、`perf:`、`test:`)并尾带 `(REQ-0NN)`;提交前过 typecheck/build,`git status` 只含本逻辑单元文件;`docs/CHANGELOG.md` 平时不写,发版按全局配置目录 `PUBLISH-GUIDE.md` 面向用户重写;收尾把 `docs/REQ.md` 该行改「已完成」,并逐条划完 `docs/PLAN.md` 的完成标准后删它
- 版本号三统一(1.0.0 起):package.json / git tag / `docs/CHANGELOG.md` 同号
- 规划编号不进交付物:工作项号只许出现在 `docs/REQ.md`;晋升后一律改用描述性功能名(如 成书向导/剪贴板直转),禁写入代码注释/文件名/小节标题
- pwsh 坑:commit message 用单引号包裹(内嵌 ASCII 双引号会被拆包);跨项目通用坑(pwsh 引号/MAX_PATH/EBUSY/编码)见全局配置目录 `ENV-GUIDE.md`「一、Windows 平台坑」,本仓具体坑见 `docs/archive/` 技术事实层
- 测试体系:`test/` 镜像 `src/` 三层(segments/ · main/ · renderer/),按内容主题零注册;入口 `npm run test`(acceptance)/`test:smoke`/`test:all`;新增能力须补测试段;核心路径改动跑对应测试段 + smoke,外围按影响面跑
- 流程(全局配置目录 `WORKFLOW.md` 路径判定):**需求清单与状态的唯一分配源 = `docs/REQ.md`**;判断依据与被否决方案看 `docs/LOG.md`「判断依据」(开工前扫一眼);正在做的看 `docs/PLAN.md`(单任务)或 `docs/large/NN-*.md`(大型需求);人工 GUI 实测项写进完成标准,自动断言只留测试文件指针;代码结构与质量见全局配置目录 `CODE-GUIDE.md`,改代码/重构/测试前先读

## 文件信息
- **本文件容量** ≤2500 字符(先并入既有条目 → 再指向全局规则 → 仍超则提请扩容)
- 版本:v1.9(2026-09-27)
