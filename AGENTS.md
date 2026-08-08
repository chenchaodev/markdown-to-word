# markdown-to-word 项目约束

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM(`"type": "module"`),Node >= 18
- npm 走国内镜像:项目 `.npmrc` 已配置 npmmirror,勿移除;install 失败先怀疑网络
- 转换核心(docx 路线):`docx` 9.x + remark 自研渲染管线;pdf 路线:markdown-it + HTML 模板 + Electron `printToPDF`(勿回退到 md-to-pdf);选型结论见 `docs/路线图与迭代规划.md`,实际验证事实记录于 `docs/研究结论.md`
- GUI:Electron 43;安装/打包走镜像,`ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 写死勿回退
- 架构方向:转换核心 `src/core/` 与 GUI(`src/main/` + `src/renderer/`)分离,便于测试与复用(开发时细化)

## 规则
- 提交策略:一次提交 = 一个可独立回退的逻辑单元;message 用 prefix 风格(`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`)
- 提交前:过 typecheck / build,`git status` 只含本逻辑单元文件
- 提交即固化:每个逻辑单元提交时同批更新 `docs/CHANGELOG.md`(修复另在验收记录标「待复测」),状态速查打开事项随提交同步;勿依赖「迭代完成」「会话切换」判断(见全局 AGENTS.md「提交时状态固化」)
- pwsh 环境坑:commit message 用单引号包裹,避免内嵌 ASCII 双引号被拆包(已踩坑)
- CHANGELOG 版本号 = 迭代序列(0.NN.M),与 package.json 发布号(0.5.x)解耦,勿混用
