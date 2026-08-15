# markdown-to-word

Markdown 转 Word / PDF 的 Windows 桌面应用。转换在本地完成，文件不上传，离线可用；输出真正的 Word 文档（非改后缀的网页），中文排版可控。

## 功能特性

- **双格式输出**：Word (.docx) 与 PDF (.pdf)，同一份 Markdown 两种格式一致渲染
- **中文排版**：西文/中文字体、正文字号（8–24 pt）、行距（1.0–2.5 倍）、首行缩进 2 字符、两端对齐、章节自动编号（1 / 1.1 / 1.1.1）
- **页面设置**：纸张（A4 / A3 / A5 / Letter / Legal）、纵向/横向、四边距（mm）、显式分页符（`<!-- page-break -->`）、每个一级标题前分页
- **目录**：自动生成静态目录页，Word 打开即见，无需更新域
- **页眉页脚页码**：原生 Word 域，可正常编辑
- **封面**：Markdown 开头 `---` 区域的 `title` / `author` / `date` 自动生成封面页与页眉
- **脚注**：`[^1]` 语法，docx 原生脚注 / PDF 脚注区
- **公式**：`$...$` / `$$...$$` / ` ```math `，docx 输出可编辑的 OMML 公式，PDF 用 KaTeX 渲染；公式自动编号与交叉引用
- **Mermaid 图表**：` ```mermaid ` 围栏导出为图表（docx 嵌入图片 / PDF 矢量渲染），语法错误时降级为代码块并提示
- **代码高亮**：highlight.js 高亮，等宽字体
- **交叉引用**：图/表/章节/公式引用（`[图](#fig:label)` 等）渲染为静态编号 + 可点击跳转
- **任务列表**：GFM 任务列表（☐/☑）
- **编码兼容**：自动识别 UTF-8 / UTF-16 / GBK（含 GB18030），无需手动处理
- **批量转换与合并**：多文件批量转换（每个文件一个文档）或合并转换（合成一个文档）
- **模板预设**：默认 / 学术论文 / 商务简报一键套用，可另存自定义预设（上限 10 个），支持预设 JSON 导入/导出
- **实时预览**：转换前预览窗口，与 PDF 同排版
- **离线零网络**：转换全程本地完成，文件不上传；Mermaid 等资源本地加载，无 CDN 依赖

## 安装与使用

环境要求：Node.js >= 20.19

```bash
# 安装依赖
npm install

# 开发运行（构建 + 启动 Electron）
npm run dev

# 打包 Windows 安装包（NSIS，输出到 release/）
npm run dist
```

安装包为向导式安装（`MarkdownToWord-Setup-<版本>.exe`），可选择安装目录。

转换流程：选择文件（或拖入文件/文件夹）→ 选择格式（Word / PDF）→ 开始转换。支持单文件、批量、合并三种模式；输出文件已存在时自动加序号，绝不覆盖。

## 技术栈

- Electron 43 + Node.js >= 20.19 + TypeScript（ESM）
- docx 9.x（Word 渲染）+ remark（解析）
- markdown-it 14.3（PDF 渲染）+ Electron printToPDF
- pdf-lib（PDF 书签/元数据）、KaTeX（公式）、Mermaid 11（图表）、highlight.js（代码高亮）

## 开发

```bash
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm run build       # 构建
npm run test        # 验收测试（36 段零注册测试，按内容主题自动发现）
npm run test:smoke  # Electron smoke 测试
npm run test:coverage  # 覆盖率
npm run test:all    # 验收 + smoke
```

测试体系：`test/` 下按内容主题组织的 36 段零注册验收测试（segments 渲染层 + main 主进程层），静态样例在 `test/fixtures/`，产物输出到 `output/`。

## 文档

- [用户手册](docs/USER-GUIDE.md)：安装、操作、设置项、支持的 Markdown 语法、FAQ
- [开发者手册](docs/DEV-GUIDE.md)：环境、命令、代码地图、验证基线
- [变更日志](docs/CHANGELOG.md)：版本演进历史
- [路线图](docs/ROADMAP.md)：需求范围、选型、里程碑
- [验收记录](docs/ACCEPTANCE.md)：批次验收清单与实测结果
- [状态速查](docs/STATUS.md)：当前状态与打开事项
- [研究结论](docs/RESEARCH.md) / [架构决策](docs/ADR.md)：技术事实与决策记录

## 许可证

未指定（待定）。