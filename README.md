<p align="center">
  <img src="docs/images/banner.svg" alt="MarkdownToWord" width="100%">
</p>

<p align="center">
  <a href="https://github.com/chenchaodev/markdown-to-word/actions/workflows/ci.yml"><img src="https://github.com/chenchaodev/markdown-to-word/actions/workflows/ci.yml/badge.svg" alt="Build"></a>
  <a href="https://github.com/chenchaodev/markdown-to-word/releases/latest"><img src="https://img.shields.io/github/v/release/chenchaodev/markdown-to-word" alt="Latest release"></a>
  <a href="https://github.com/chenchaodev/markdown-to-word/releases"><img src="https://img.shields.io/github/downloads/chenchaodev/markdown-to-word/total" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License">
</p>

<p align="center">
  <a href="README_EN.md">English</a> · <a href="https://chenchaodev.github.io/markdown-to-word/">官网</a>
</p>

---

Markdown 转 Word / PDF 的 Windows 桌面应用。转换在本地完成，文件不上传，离线可用；输出真正的 Word 文档（非改后缀的网页），中文排版可控。

### 下载安装

普通用户无需配置环境，直接下载安装包即可：

> **[下载最新版安装包（MarkdownToWord-Setup-x.exe）](https://github.com/chenchaodev/markdown-to-word/releases/latest)**

安装包为向导式安装，可选择安装目录。

### 功能特性

#### 核心转换

- **双格式输出**：Word (.docx) / PDF (.pdf) 一致渲染，所见即所得
- **三种模式**：单文件 / 批量（每个文件一个文档）/ 合并（多文件合为一个文档）
- **剪贴板直转**：主界面空态「粘贴 Markdown 转换」按钮，直接读取剪贴板文本转换；剪贴板是文件路径时复用拖入队列

#### 排版控制

- **中文字体字号**：西文/中文字体独立设置，正文字号 8-24pt
- **行距缩进**：1.0-2.5 倍行距，首行缩进 2 字符
- **纸张设置**：A4/A3/A5/Letter/Legal，纵向/横向，边距 0-1000mm
- **目录模式**：静态目录（默认）或 Word 域目录（带真实页码）；PDF 始终带页码
- **标题排版**：标题字号缩放/间距三档（紧凑/标准/舒展），docx 与 PDF 一致

#### 自动编号

- **章节编号**：标题自动生成「1 / 1.1 / 1.1.1」编号
- **题注编号**：图/表自动编号（全文连续）
- **公式编号**：独立公式块自动编号，行内公式不编号

#### 学术功能

- **公式支持**：docx 原生 OMML / PDF KaTeX 渲染
- **交叉引用**：公式/图/表/章节交叉引用跳转
- **Mermaid 图表**：`mermaid` 围栏代码块渲染为图表（docx 嵌入图片 / PDF 矢量渲染）

#### 成书向导

七步引导式串联所有功能，全程无需打开设置面板：

1. **模板/预设**：选择内置预设或导入 Word 模板
2. **封面页**：从 frontmatter 或向导输入取标题/作者，生成独立封面
3. **页眉页脚**：默认/自定义/无三种模式，支持 logo 和分栏
4. **水印**：文字/角度/不透明度/浅灰经典观感
5. **合并源**：多选 Markdown + 排序，以 page-break 拼接
6. **目录/页码**：开 TOC + 选择模式
7. **输出**：单个 docx/pdf，含封面页和完整目录

#### 智能处理

- **AI 清理前置**：转换前自动规整智能引号、破折号、列表空格与空行
- **Obsidian 兼容**：自动转换 `[[双链]]` / `![[嵌入]]` 为标准 Markdown
- **转换预检**：转换前扫描缺失图片、悬空引用、未标语言代码块
- **编码兼容**：自动识别 UTF-8/UTF-16/GBK，无需手动处理

#### 模板预设

- **内置预设**：默认/学术论文/商务简报/公文/长文阅读/极简
- **预设覆盖**：页眉页脚/水印/公式编号/H1 前分页等
- **导入导出**：JSON 格式，支持导入/导出自定义预设
- **Word 模板导入**：解包 .docx 提取字体与页面设置

#### 界面体验

- **响应式布局**：最小宽度 640，四档断点（舒适/紧凑/窄窗/矮窗）
- **暗色模式**：跟随系统/浅色/深色三态切换
- **多语言界面**：中文/English/日本語三语切换
- **首次引导**：首次启动出现「选预设 → 向导 → 转换」引导路径
- **最近转换**：转换后显示最近记录，单击加载/双击重转
- **实时预览**：转换前可预览源文件，跟随文件刷新
- **更新提示**：关于窗口自动检查 GitHub 最新版本

#### 可靠性

- **网络图片**：自动下载嵌入（私网拦截+20MB 大小上限）
- **失败提示**：错误原因可操作提示（文件被占用/不存在/权限不足）
- **离线运行**：零网络依赖，完全本地转换

### 界面截图

<p align="center">
  <img src="docs/images/ui-main.jpg" alt="主界面（多文件）" width="80%"><br>
  <em>主界面：选择文件 → 选择格式 → 开始转换</em>
</p>
<p align="center">
  <img src="docs/images/ui-empty.jpg" alt="空态主界面" width="48%">&nbsp;
  <img src="docs/images/ui-settings.jpg" alt="设置面板" width="48%"><br>
  <em>左：空态主界面　右：设置面板（6 组标签页）</em>
</p>

### 开发与打包

环境要求：Node.js >= 22.13。国内网络请先设 Electron 镜像，详见 [开发者手册](docs/DEV-GUIDE.md)。

```bash
npm install        # 安装依赖
npm run dev        # 构建 + 启动 Electron 开发态
npm run dist       # 打包 Windows 安装包（NSIS，输出到 release/）
```

技术栈：Electron 43 + TypeScript（ESM）；docx 9.x + remark（Word 渲染）、markdown-it 14.3 + Electron printToPDF（PDF 渲染）、KaTeX / Mermaid 11 / highlight.js / pdf-lib。

```bash
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm run build       # 构建
npm run test        # 验收测试（零注册，按内容主题自动发现）
npm run test:smoke  # Electron smoke 测试
npm run test:all    # 验收 + smoke
```

测试体系：`test/` 下按内容主题零注册，分 `segments` / `main` / `renderer` 三层；样例在 `test/fixtures/`，产物在 `output/`。段数以 `npm run test` 的实际输出为准。

### 文档

**面向用户**

- [用户手册](docs/USER-GUIDE.md)：安装、操作、设置项、支持的 Markdown 语法、FAQ
- [官网单页](docs/index.html)：功能演示与下载入口（GitHub Pages）
- [变更日志](docs/CHANGELOG.md)：版本演进历史
- [兼容性矩阵](docs/WPS-COMPAT.md)：Word / WPS 实测结论与图片取值边界

**面向开发**

- [文档索引](docs/README.md)：全部文档入口、目录结构与容量契约
- [开发者手册](docs/DEV-GUIDE.md)：环境、命令、代码地图、验证基线
- [路线图与候选区](docs/ROADMAP.md)：需求唯一入口、已排期、编号台账
- [验收矩阵](docs/ACCEPTANCE.md)：验收清单与实测结果
- [状态速查](docs/STATUS.md)：当前状态与打开事项
- [研究结论](docs/RESEARCH.md) / [架构决策](docs/ADR.md)：技术事实与决策记录
- [UI 规范](docs/design/ui-guidelines.md) / [设置信息架构](docs/design/settings-ia.md)：改界面前必读

**参与**

- [贡献指南](CONTRIBUTING.md) · [安全策略](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md)

### 反馈与支持

问题反馈、功能建议与漏洞报告请走 [GitHub Issues](https://github.com/chenchaodev/markdown-to-word/issues)。本软件由 [chenchaodev](https://github.com/chenchaodev) 独立开发与维护，定位是「本地离线、中文排版可控」的 Markdown 转换工具。

### 许可证

[GPL-3.0](LICENSE)（GNU General Public License v3）：自由软件，允许使用、修改与再分发，但衍生作品必须以相同许可证开源。
