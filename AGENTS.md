# markdown-to-word 项目约束

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM(`"type": "module"`),Node >= 20.19(勿回退;typescript-eslint 经 side-by-side 用 TS 6 API(`typescript` 别名 `@typescript/typescript6`),`tsc` 二进制仍为 TS 7(`@typescript/native` 别名))
- npm 走国内镜像:项目 `.npmrc` 已配置 npmmirror,勿移除;install 失败先怀疑网络
- 转换核心(docx 路线):`docx` 9.x + remark 自研渲染管线;pdf 路线:markdown-it + HTML 模板 + Electron `printToPDF`(勿回退到 md-to-pdf);选型结论见 `docs/ROADMAP.md`,实际验证事实记录于 `docs/RESEARCH.md`
- GUI:Electron 43;安装/打包走镜像,`ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 写死勿回退
- 架构方向:转换核心 `src/core/` 与 GUI(`src/main/` + `src/renderer/`)分离,便于测试与复用(开发时细化)
- docx 渲染必须走 `core/docx/theme.ts` 集中字体配置(中文 eastAsia),不允许散落硬编码
- 显式分页符语法固定 `<!-- page-break -->`(不占 `---` 的 hr 语义);docx landscape 尺寸传原始(纵向)值,勿手动交换(docx 库自动交换)
- 依赖钉死:markdown-it 14.3(勿升 15,@mdit/plugin-tasklist peer 冲突)、@mdit/plugin-tasklist、@mdit/plugin-footnote(1.0.2,peer 显式 markdown-it ^14.2.0)、highlight.js、electron-builder 26.15.3(勿用 27 alpha)

## 规则
- 提交策略:一次提交 = 一个可独立回退的逻辑单元;message 用 prefix 风格(`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`)
- 提交前:过 typecheck / build,`git status` 只含本逻辑单元文件
- 提交即固化:一次提交 = 一个可独立回退的逻辑单元;`docs/CHANGELOG.md` 平时提交不写(流水查 git log,完整迭代发版时从 git log 汇总写版本条目,小型/琐碎并入下次);实测状态变化同批更新验收记录与 `docs/STATUS.md` 打开事项,收尾同步「当前状态」;勿依赖「迭代完成」「会话切换」判断(见全局 AGENTS.md「提交时」)
- pwsh 环境坑:commit message 用单引号包裹,避免内嵌 ASCII 双引号被拆包(已踩坑)
- 版本号三统一(1.0.0 起):package.json / git tag / CHANGELOG 同号(如 1.0.0 → tag v1.0.0 → CHANGELOG [1.0.0]);0.32.0 及以前为迭代序列 0.NN.M 与发布号 0.5.x 解耦的历史,勿回退
- 测试体系:`test/`(segments/ core 渲染 + main/ 主进程层,按内容主题零注册 + fixtures/ 静态样例 + common/ 工具),入口 `npm run test`(acceptance)、`test:smoke`、`test:all`;产物 `output/artifacts` + `output/smoke`;新增能力须补对应测试段,缺口清单见 ROADMAP

## 流程(遵循全局配置目录 WORKFLOW-GUIDE.md 阶段 0-8)
- 文档驱动:需求/设计文档 → 规划文档(STATUS 顶部一条 + ACCEPTANCE 清单 + ROADMAP 变更)→ 开发前确认,规划即契约;开发中不反复更新,收尾统一同步
- 排期先价值确认:高确定性直接规划;探索性先确认值得否,不值记「砍」不投调研预算(文档加密即此类:调研后确认不做)
- ACCEPTANCE 只列人工 GUI 实测项,可自动断言项写「自动断言见 test/segments/X.test.js」指针,不重复描述
- 同轮实测反馈的多个小修复合并为一个修复批次提交(仍保持逻辑单元独立),减少收尾往返
- 回归守护:核心路径(转换/渲染/格式输出)改动跑对应测试段 + smoke;外围(设置/UI)按影响面跑受影响段
- Windows 坑:跨项目通用坑(pwsh 引号/MAX_PATH/EBUSY/编码)见全局配置目录 `WINDOWS-GUIDE.md`;本仓库具体坑见 `docs/RESEARCH.md`

- 版本:v1.1(改本文件时递增版本号,超限先瘦身)
