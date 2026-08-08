# markdown-to-word 项目约束

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM(`"type": "module"`),Node >= 18
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
- 提交即固化:每个逻辑单元提交时同批更新 `docs/CHANGELOG.md`(修复另在验收记录标「待复测」),状态速查打开事项随提交同步;勿依赖「迭代完成」「会话切换」判断(见全局 AGENTS.md「提交时状态固化」)
- pwsh 环境坑:commit message 用单引号包裹,避免内嵌 ASCII 双引号被拆包(已踩坑)
- CHANGELOG 版本号 = 迭代序列(0.NN.M),与 package.json 发布号(0.5.x)解耦,勿混用
