# markdown-to-word 项目约束

## 硬约束(勿回退)
- 技术栈:Node.js + TypeScript,ESM(`"type": "module"`),Node >= 18
- npm 走国内镜像:项目 `.npmrc` 已配置 npmmirror,勿移除;install 失败先怀疑网络
- 转换核心(docx 路线):`docx` 9.x + remark 自研渲染管线;pdf 路线:`md-to-pdf` 5.x;选型结论见 `docs/路线图与迭代规划.md`,实际验证事实记录于 `docs/研究结论.md`
- 架构方向:转换逻辑与 CLI 入口分离,便于测试与复用(开发时细化)

## 规则
- 提交策略:一次提交 = 一个可独立回退的逻辑单元;message 用 prefix 风格(`feat:` / `fix:` / `docs:` / `chore:` / `refactor:`)
- 提交前:过 typecheck / build,`git status` 只含本逻辑单元文件
- 会话收尾:更新 `docs/状态速查.md` 与 `docs/CHANGELOG.md`,保持工作区干净

## 当前阶段
- 仅脚手架初始化,未开始功能开发;首个开发步骤见 `docs/开发者手册.md`
