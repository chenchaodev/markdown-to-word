# markdown-to-word

Markdown 转 Word / PDF 的 Windows 桌面应用。转换在本地完成，文件不上传，离线可用；输出真正的 Word 文档（非改后缀的网页），中文排版可控。

## 功能特性

> 完整功能与操作说明以 [用户手册](docs/USER-GUIDE.md) 为唯一权威清单,此处只留一句话概览。

- **转换**:Word (.docx) / PDF (.pdf) 双格式一致渲染;单文件 / 批量 / 合并三种模式;重名自动加序号
- **排版**:中文字体字号行距缩进、纸张边距方向、章节/题注/公式自动编号、目录、封面、页眉页脚页码
- **语法**:GFM 全支持(任务列表/删除线)、脚注、批注、Mermaid 图表、代码高亮、行内 HTML 白名单、`<!-- page-break -->` 分页符
- **学术**:公式(OMML/KaTeX)编号与交叉引用、图/表/章节交叉引用跳转
- **体验**:暗色模式(三态)、界面多语言(注册表驱动,渐进扩展)、模板预设(JSON 导入/导出)、PDF 自定义 CSS、实时预览、最近转换
- **可靠**:编码兼容(UTF-8/UTF-16/GBK)、网络图片下载嵌入(私网拦截+大小上限)、失败原因可操作提示、离线零网络

## 安装与使用

环境要求：Node.js >= 20.19（国内网络请先设置 Electron 镜像，详见 [开发者手册](docs/DEV-GUIDE.md#环境)：`ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR`）

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
npm run test        # 验收测试（51 段零注册测试，按内容主题自动发现）
npm run test:smoke  # Electron smoke 测试
npm run test:coverage  # 覆盖率
npm run test:all    # 验收 + smoke
```

测试体系：`test/` 下按内容主题组织的零注册验收测试（segments 渲染层与纯逻辑 + main 主进程层，当前 51 段），静态样例在 `test/fixtures/`，产物输出到 `output/`。

## 文档

- [用户手册](docs/USER-GUIDE.md)：安装、操作、设置项、支持的 Markdown 语法、FAQ
- [开发者手册](docs/DEV-GUIDE.md)：环境、命令、代码地图、验证基线
- [变更日志](docs/CHANGELOG.md)：版本演进历史
- [路线图](docs/ROADMAP.md)：需求范围、选型、里程碑
- [验收记录](docs/ACCEPTANCE.md)：批次验收清单与实测结果
- [状态速查](docs/STATUS.md)：当前状态与打开事项
- [研究结论](docs/RESEARCH.md) / [架构决策](docs/ADR.md)：技术事实与决策记录

## 许可证

[GPL-3.0](LICENSE)（GNU General Public License v3）：自由软件，允许使用、修改与再分发，但衍生作品必须以相同许可证开源。