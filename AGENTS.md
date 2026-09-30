# markdown-to-word 项目约束

> 规则见全局配置目录 `AGENTS.md`;本文件只写全局未覆盖的项目事实与加严项,全局已有的不复写。

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM,Node >= 22.13(勿回退;typescript-eslint 用 TS6 API,`typescript` 别名 `@typescript/typescript6`;`tsc` 为 TS7,`@typescript/native` 别名)
- 镜像:根 `.npmrc` 仅含 registry,勿加 electron 镜像键(npm 警告 + electron-builder 读不到);GUI Electron 43,本地开发经 `scripts/setup-env.ps1` 设 `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 用户级环境变量(写死勿回退,CI 不需要)
- 核心依赖选型:docx 路线 = `docx` 9.x + remark 自研渲染管线;pdf 路线 = markdown-it + HTML 模板 + Electron `printToPDF`(勿回退 md-to-pdf);事实与踩坑见 `docs/evidence/` 技术事实层;钉死:markdown-it 14.3(勿升 15,tasklist peer 冲突)、@mdit/plugin-tasklist、@mdit/plugin-footnote 1.0.2、highlight.js、electron-builder 26.15.3(勿用 27 alpha)
- 架构方向:转换核心 `src/core/` 与 GUI(`src/main/` + `src/renderer/`)分离(便于测试与复用)
- 其他高风险配置:docx 字体必走 `src/core/docx/theme.ts` 集中配置(中文 eastAsia),禁散落硬编码;分页符固定 `<!-- page-break -->`(不占 `---` 的 hr 语义);landscape 传原始(纵向)值,勿手动交换(库自动交换)
- UI 设计(勿回退):界面(网页/「关于」/renderer/GitHub Pages)先读 `docs/design/ui-guidelines.md`(renderer 权威)+ `docs/design/settings-ia.md`;视觉身份 = 冷灰纸 + 朱砂红「排版付梓」,字体三角色(展示衬线只做标题/题字、UI 栈做正文、mono 做数据),签名元素(裁切线+钤印+直排)集中一处,朱砂仅用于「付印」语义,禁绕开 token 硬编码、禁大色块/装饰 emoji
- 项目层文档载体(全局 `docs/` 体系之外):`docs/design/`(UI 规范 + 设置信息架构)、`docs/WPS-COMPAT.md`;签名声明的「三处同改」耦合规则在 `docs/adr/adr-013-发布供应链与明确不签名.md` 的「实施约束」节(原独立状态文件已撤销,勿再新建)
- 文档载体(勿回退):`docs/REQ.md` 按状态分**四节**且**「为什么停在这」与号同行**(拆到第二个文件必然漂移)· `docs/adr/ADR-0NN-*.md`(**大写**、一决策一文件、旧条不改动只标取代)· `docs/evidence/`(只增不改的长分析原文,**禁改正文**,头部必带「结论去向」四选一)· `docs/LESSONS.md`(挂不到任何工作项号的可复用教训,按主题不按号)· `docs/PLAN.md`(小型单任务 / 大型需求加三节,收尾即删);**旧日志载体 LOG.md 与 `docs/large/` 已取消** —— 依据见配置仓 `ADR-004`,本仓落地见 `docs/adr/ADR-034`

## 规则
- 提交 message 的 prefix:全局清单之外本仓另用 `perf:` `test:`,并普遍带作用域(`feat(门禁):` `docs(收尾):`)

## 文件信息
- **本文件容量** ≤2500 字符(先并入既有条目 → 再指向全局规则 → 仍超则提请扩容)
- 版本:v2.0(2026-09-28)
