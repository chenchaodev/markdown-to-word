<p align="center">
  <img src="docs/images/banner.svg" alt="MarkdownToWord" width="100%">
</p>

<p align="center">
  <a href="https://github.com/chenchaodev/markdown-to-word/actions/workflows/ci.yml"><img src="https://github.com/chenchaodev/markdown-to-word/actions/workflows/ci.yml/badge.svg" alt="Build"></a>
  <a href="https://github.com/chenchaodev/markdown-to-word/releases/latest"><img src="https://img.shields.io/github/v/release/chenchaodev/markdown-to-word" alt="Latest release"></a>
  <a href="https://github.com/chenchaodev/markdown-to-word/releases"><img src="https://img.shields.io/github/downloads/chenchaodev/markdown-to-word/total" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License">
  <img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Platform">
</p>

<p align="center">
  <a href="#中文">中文</a> · <a href="#english">English</a>
</p>

---

## 中文

Markdown 转 Word / PDF 的 Windows 桌面应用。转换在本地完成，文件不上传，离线可用；输出真正的 Word 文档（非改后缀的网页），中文排版可控。

### ⬇️ 下载安装

普通用户无需配置环境，直接下载安装包即可：

> **[📦 下载最新版安装包（MarkdownToWord-Setup-x.exe）](https://github.com/chenchaodev/markdown-to-word/releases/latest)**

安装包为向导式安装，可选择安装目录；支持单文件、批量、合并三种转换模式，输出文件已存在时自动加序号，绝不覆盖。

开发者如需自行构建，见下方「快速开始」。

### 功能特性

> 完整功能与操作说明以 [用户手册](docs/USER-GUIDE.md) 为唯一权威清单，此处只留一句话概览。

- **转换**：Word (.docx) / PDF (.pdf) 双格式一致渲染；单文件 / 批量 / 合并三种模式；重名自动加序号
- **排版**：中文字体字号行距缩进、纸张边距方向、章节/题注/公式自动编号、目录、封面、页眉页脚页码
- **语法**：GFM 全支持（任务列表/删除线）、脚注、批注、Mermaid 图表、代码高亮、行内 HTML 白名单、`<!-- page-break -->` 分页符
- **学术**：公式（OMML/KaTeX）编号与交叉引用、图/表/章节交叉引用跳转
- **体验**：暗色模式（三态）、界面多语言（注册表驱动，渐进扩展）、模板预设（JSON 导入/导出）、PDF 自定义 CSS、实时预览、最近转换
- **可靠**：编码兼容（UTF-8/UTF-16/GBK）、网络图片下载嵌入（私网拦截+大小上限）、失败原因可操作提示、离线零网络

### 界面截图

<p align="center">
  <img src="docs/images/ui-main.png" alt="主界面（多文件）" width="80%">
  <br><em>主界面：选择文件 → 选择格式 → 开始转换</em>
</p>

<p align="center">
  <img src="docs/images/ui-empty.png" alt="空态主界面" width="48%">
  &nbsp;
  <img src="docs/images/ui-history.png" alt="最近转换面板" width="48%">
  <br><em>左：空态主界面　右：最近转换面板</em>
</p>

### 快速开始（开发者）

环境要求：Node.js >= 20.19（国内网络请先设置 Electron 镜像，详见 [开发者手册](docs/DEV-GUIDE.md#环境)：`ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`）

```bash
# 安装依赖
npm install

# 开发运行（构建 + 启动 Electron）
npm run dev

# 打包 Windows 安装包（NSIS，输出到 release/）
npm run dist
```

### 技术栈

- Electron 43 + Node.js >= 20.19 + TypeScript（ESM）
- docx 9.x（Word 渲染）+ remark（解析）
- markdown-it 14.3（PDF 渲染）+ Electron printToPDF
- pdf-lib（PDF 书签/元数据）、KaTeX（公式）、Mermaid 11（图表）、highlight.js（代码高亮）

### 开发

```bash
npm run typecheck   # TypeScript 类型检查
npm run lint        # ESLint
npm run build       # 构建
npm run test        # 验收测试（62 段零注册测试，按内容主题自动发现）
npm run test:smoke  # Electron smoke 测试
npm run test:coverage  # 覆盖率
npm run test:all    # 验收 + smoke
```

测试体系：`test/` 下按内容主题组织的零注册验收测试（segments 渲染层与纯逻辑 + main 主进程层，当前 62 段），静态样例在 `test/fixtures/`，产物输出到 `output/`。

### 文档

- [用户手册](docs/USER-GUIDE.md)：安装、操作、设置项、支持的 Markdown 语法、FAQ
- [开发者手册](docs/DEV-GUIDE.md)：环境、命令、代码地图、验证基线
- [变更日志](docs/CHANGELOG.md)：版本演进历史
- [路线图](docs/ROADMAP.md)：需求范围、选型、里程碑
- [验收记录](docs/ACCEPTANCE.md)：批次验收清单与实测结果
- [状态速查](docs/STATUS.md)：当前状态与打开事项
- [研究结论](docs/RESEARCH.md) / [架构决策](docs/ADR.md)：技术事实与决策记录

### 许可证

[GPL-3.0](LICENSE)（GNU General Public License v3）：自由软件，允许使用、修改与再分发，但衍生作品必须以相同许可证开源。

---

## English

A Windows desktop app that converts Markdown to Word / PDF. Conversion runs **locally** — your files are never uploaded and it works fully offline. It produces **real Word documents** (not HTML renamed to .docx) with controllable Chinese typesetting.

### ⬇️ Download

No environment setup needed for end users — just grab the installer:

> **[📦 Download the latest installer (MarkdownToWord-Setup-x.exe)](https://github.com/chenchaodev/markdown-to-word/releases/latest)**

The installer is wizard-based and lets you choose the install directory. It supports single-file, batch, and merge modes; existing outputs are auto-renamed (never overwritten).

To build from source, see **Quick start** below.

### Features

- **Convert**: consistent Word (.docx) / PDF (.pdf) rendering; single / batch / merge modes; auto-suffix on name clash
- **Layout**: Chinese fonts, sizes, line spacing & indentation; paper margins & orientation; auto-numbered headings / captions / equations; TOC, cover, header/footer/page numbers
- **Syntax**: full GFM (task lists / strikethrough), footnotes, comments, Mermaid diagrams, code highlighting, inline-HTML allowlist, `<!-- page-break -->` page breaks
- **Academic**: numbered equations (OMML/KaTeX) with cross-references; figure/table/section cross-reference jumps
- **UX**: dark mode (3-state), multi-language UI (registry-driven, progressively extensible), template presets (JSON import/export), custom PDF CSS, live preview, recent conversions
- **Robust**: encoding compatibility (UTF-8/UTF-16/GBK), networked-image embedding (intranet blocked + size cap), actionable failure hints, zero network when offline

### Screenshots

<p align="center">
  <img src="docs/images/ui-main.png" alt="Main window (multiple files)" width="80%">
  <br><em>Main window: pick files → pick format → convert</em>
</p>

<p align="center">
  <img src="docs/images/ui-empty.png" alt="Empty main window" width="48%">
  &nbsp;
  <img src="docs/images/ui-history.png" alt="Recent conversions panel" width="48%">
  <br><em>Left: empty state　Right: recent conversions panel</em>
</p>

### Quick start (developers)

Requirements: Node.js >= 20.19 (in China, set the Electron mirror first — see [DEV-GUIDE](docs/DEV-GUIDE.md#环境): `ELECTRON_MIRROR` and `ELECTRON_BUILDER_BINARIES_MIRROR`)

```bash
npm install
npm run dev     # build + launch Electron
npm run dist    # package the Windows NSIS installer into release/
```

### Tech stack

- Electron 43 + Node.js >= 20.19 + TypeScript (ESM)
- docx 9.x (Word rendering) + remark (parsing)
- markdown-it 14.3 (PDF rendering) + Electron printToPDF
- pdf-lib (PDF bookmarks/metadata), KaTeX (math), Mermaid 11 (diagrams), highlight.js (code)

### Development

```bash
npm run typecheck    # TypeScript type check
npm run lint         # ESLint
npm run build        # build
npm run test         # acceptance tests (62 zero-registration segments)
npm run test:smoke   # Electron smoke test
npm run test:all     # acceptance + smoke
```

### Documentation

- [User Guide](docs/USER-GUIDE.md) · [Dev Guide](docs/DEV-GUIDE.md) · [Changelog](docs/CHANGELOG.md)
- [Roadmap](docs/ROADMAP.md) · [Acceptance](docs/ACCEPTANCE.md) · [Status](docs/STATUS.md)
- [Research](docs/RESEARCH.md) · [ADR](docs/ADR.md)

### License

[GPL-3.0](LICENSE) (GNU General Public License v3): free software; use, modify, and redistribute permitted, but derivative works must be released under the same license.
