# 贡献指南

欢迎参与 markdown-to-word 项目！无论是报告问题、提交功能建议还是贡献代码，我们都欢迎。

## 行为准则

本项目采用 [Contributor Covenant v2.1](CODE_OF_CONDUCT.md) 行为准则，请在参与前阅读。

## 如何报告问题

请使用 [Issue 模板](https://github.com/chenchaodev/markdown-to-word/issues/new/choose) 提交 Bug 报告或功能请求，包含必要的环境信息和复现步骤。

## 开发环境

- **Node.js** >= 20.19（ESM 模式）
- **npm** 依赖安装使用国内镜像（项目 `.npmrc` 已配置 npmmirror）
- **Electron 镜像**：国内网络需设置环境变量（详见 [开发者手册](docs/DEV-GUIDE.md)）：
  ```
  ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  ```

## 本地构建与测试

```bash
npm install          # 安装依赖
npm run build        # 构建
npm run dev          # 启动开发（构建 + Electron）
npm run test         # 验收测试
npm run test:smoke   # 冒烟测试
npm run test:all     # 验收 + 冒烟
npm run lint         # ESLint 检查
npm run typecheck    # TypeScript 类型检查
```

测试体系为按内容主题零注册（新增测试 = 新建段文件），详见 [开发者手册](docs/DEV-GUIDE.md)。

## 提交规范

提交信息使用 prefix 风格，中文 message：

| Prefix | 用途 |
|--------|------|
| `feat:` | 新功能 |
| `fix:` | 修复 |
| `docs:` | 文档 |
| `chore:` | 杂务（构建、CI 等） |
| `refactor:` | 重构 |
| `perf:` | 性能优化 |
| `test:` | 测试 |

**示例**：`feat: 新增导出 PDF 书签目录功能`

提交前请确保：
- 通过 `npm run typecheck`、`npm run lint`、`npm run build`
- `git status` 只包含本逻辑单元的文件

## 分支与 PR 流程

1. Fork 仓库并从 `master` 创建特性分支（如 `feat/my-feature`）
2. 开发完成后确保所有检查通过
3. 提交 PR，关联相关 Issue
4. 等待审查与合并

## 文档驱动约定

本项目遵循文档驱动开发（见 [AGENTS.md](AGENTS.md)）：需求/设计文档 → 规划文档 → 开发前确认。**规划即契约**，开发中不反复更新，收尾统一同步。

## 许可证

贡献即表示您同意您的贡献以 [GPL-3.0](LICENSE) 许可证发布。
