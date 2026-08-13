# 路线图与迭代规划

> 2026-08-02 18:20:36 制定,19:20:18 因需求变更(GUI)修订;21:43:23 二期规划经 @oracle 评审重排。迭代完成记录见 `docs/CHANGELOG.md`;选型结论见 `docs/ADR.md`(ADR-001/002);调研证据见 `docs/RESEARCH.md` 与 `docs/archive/` 存档。
> 2026-08-13 整理:待办收敛为「当前待办」唯一入口(合并原待办排期/延后/批次 8-9 备选暂缓,去重),历史规划压缩至「已完成」节,详情见 archive 存档。

## 需求范围
- Windows 桌面 GUI 应用:选择 markdown 文件 → 转 .docx / .pdf
- GUI 界面中文;中文内容排版可控(硬需求);架构预留其他格式扩展(「等」)

## 语法覆盖范围(转换矩阵)
| 语法 | 支持 | 阶段 |
| ---- | ---- | ---- |
| 标题/段落/粗斜体/行内代码/链接/引用 | ✅ | G1 |
| 无序/有序/嵌套列表 | ✅ | G1 |
| 表格/代码块(等宽字体)/图片(本地路径) | ✅ | G1 |
| GFM 删除线/任务列表 | ✅ | G3 联调期顺手 |
| 脚注/公式/docx 代码高亮/目录 TOC | ✅ | 二期 |
| raw HTML 白名单(14 个无属性内联标签) | ✅ | 批次 5 |

## 里程碑(全部完成)
| 阶段 | 内容 | 状态 |
| ---- | ---- | ---- |
| G1 core 打底 | remark 管线 + docx 完整渲染 + eastAsia 字体 | ✅ |
| G2 Electron 骨架 | 窗口 + preload + IPC + 文件选择/拖放 | ✅ |
| G3 转换联调 | convert IPC + 进度事件 + 输出落盘 | ✅ |
| G4 PDF 自研 | markdown-it + HTML 模板 + printToPDF + 高亮 | ✅ |
| G5 收尾 | 错误处理 + electron-builder(NSIS)打包实测 | ✅ |

## 当前待办(唯一入口)
> 2026-08-13 整理:合并原「待办(排期)」「延后(不排批)」与批次 8/9「备选/暂缓/不做(记后续)」并去重;功能项按价值/成本建议排期,完成即勾选。

### 功能候选(批次 10,起手 2 项,待用户确认优先级)
- [x] **8c Mermaid 渲染导出**(中;无依赖)——PDF 近白送(Chromium 有 DOM,隐藏窗口渲染),docx 嵌入 SVG/PNG;原「砍」理由「无 DOM 环境」在 Electron 内不成立(批次 8 已重新评估升回);差异化亮点,建议起手;**已完成(2026-08-13 提交 a89507a,0.23.0,用户实测通过)**;**调研完成(2026-08-13,方案见 RESEARCH.md 条目 + archive 20260813-193532),实现进行中**;**调研完成(2026-08-13,方案见 RESEARCH.md 条目 + archive 20260813-193532),实现进行中**;**调研完成(2026-08-13,方案见 RESEARCH.md 条目 + archive 20260813-193532),实现进行中**;**调研完成(2026-08-13,方案见 RESEARCH.md 条目 + archive 20260813-193532),实现进行中**;**调研完成(2026-08-13,方案见 RESEARCH.md 条目 + archive 20260813-193532),实现进行中**
- [x] **题注/章节交叉引用**(中;依赖 8b 补 label 机制)——承接批次 8/9 决策链(D1-D4 免更新路线,静态注入编号 + 超链接跳转);学术正式化闭环,建议起手;**已完成(2026-08-13,160b0d1,0.24.0,用户实测通过,验收见 ACCEPTANCE.md 批次 10 功能 2 节)**
- [ ] **模板导入**(中高;无依赖,先导出侧)——用户上传 docx/CSS 作为样式模板;原「延后」项,排在功能候选后段
- [ ] **代码块语法高亮写 docx**(低中;无依赖)——逐 token 着色;pdf 侧已有高亮,docx 侧成本中高
- [ ] **公式编号开关**(低;无依赖)——批次 9「不做(记后续)」转回,默认开
- [ ] **批注**(低;无依赖)
- [ ] **WPS 兼容矩阵**(低;无依赖)——守护既有功能,Word/WPS 双实测清单化

### 测试遗留
- [ ] **B1 renderer 纯函数段**(2026-08-11 R8 收尾评审提出,未执行;低风险纯测试)——抽 `src/renderer/pure.ts`(isMarkdown/baseName/truncateMiddle/stageText/STAGE_PERCENT 等零 DOM 函数,现居 utils.ts),utils.ts 改 re-export(renderer 内部 import 路径不变),新建 segments/renderer-pure.test.js;建议作为下一个小迭代(零行为改动)
- [x] C4(不排期):isCaptionTarget/buildEquationContext/collectPlainText 直测——产物断言(toc-caption/formula/eq-numbering)已间接覆盖,边际收益低,不做
- [x] R10-7(不做留档):pdf/render.ts 容器深度跟踪 helper——收益 ~20 行且 token 流语义敏感,评审结论「可不做」

### 暂缓(不排批)
- 完整 CSL 参考文献、AI 改写、表格合并单元格、文档加密

### 延后(不排批)
- 代码高亮主题切换:PDF 模板硬编码 GitHub Light,打印场景需求趋零
- 最近文件:低价值低成本,尾部便利

### 砍(已决策不做)
- CLI 转正(无用户需求,调试可走脚本/直接调 core)、自动更新与签名(本地离线隐私卖点,更新反噬)、i18n、目录监视与同步、PDF 多栏、批量重命名
- 完整 Mermaid 取消不再成立(已升回功能候选 8c)

## 已完成(历史规划压缩;详情见 CHANGELOG 对应版本与 archive 存档)

### 二期批次 1-9(按批独立交付,含验收标准)
- 批次 1「排版控制 + 设置底座」✅ 0.6.0
- 批次 2「保真 + 正式文档化」✅ 0.7.0
- 批次 3「批量 + 合并」✅ 0.8.0 + 0.8.1
- 批次 4「长文档」✅ 0.9.x~0.10.0(书签/脚注/页眉页脚)
- 批次 5「中文排版深化 + 保真补全」✅ 0.11.0~0.14.0
- 批次 6「学术正式化」✅ 0.15.0~0.16.0(模板包/公式双格式)
- 批次 7「体验优化 + 流程简化」✅ 0.17.0 + 0.17.1,用户 GUI 实测通过(0.17.3,见 ACCEPTANCE.md)
- 批次 8「功能扩展:学术正式化延伸」✅ 0.18.0~0.18.1——**D1=免更新路线**(beginDirty:false + 渲染期静态注入,零提示全端一致,改标题后需重新导出)、**D2=前缀行识别**(图/表后紧跟「图: 标题」行);8a TOC 开关化 + 静态标题列表(无页码,右键更新域可刷新)、8b 题注全文连续编号(图 1/2/3、表 1/2 独立计数);验收 toc-caption.test.js 9 断言 + 用户实测通过(2026-08-09)
- 批次 9「学术正式化:公式编号 + 交叉引用」✅ 0.19.0~0.19.1——**D3=免更新路线延续**(静态「(N)」编号 + 静态「式 (N)」超链接,改号后重新导出)、**D4 语法拍板**($$ 块自动编号全文连续 (1)(2)(3)…;锚点 `{#eq:label}` 独立行不渲染;引用 `[式](#eq:label)`);验收 eq-numbering.test.js 9 断言,待 GUI 实测(ACCEPTANCE.md 批次 9 节)

### 测试缺口补齐(2026-08-10~13,24 项全部完成)
- 高 10 项 ✅:封面双格式/breakBeforeH1 产物/取消链路/重名保护/缺失图片警告/公式降级/外链图片下载/任务列表/h4-h6/分页符产物
- 中 9 项 ✅:settings sanitize 边界/slug/frontmatter/非 A4 纸张与边距/行距缩进值/代码块序列化/引用块列表表格/外链 rels/页脚文案
- 低 5 项 ✅:renderer 交互与 IPC dialog 转 GUI 实测(2026-08-11 用户实测通过)/runAfterConvert/collectMarkdownPaths/resolveOutputPath
- R8 收尾评审 A 组 ✅(A1 分页符下沉、A2 书签端到端、A3 smoke diag 修盲区);B1 未执行,转「当前待办」
- R10 评审 T 组 ✅(T1 GBK 端到端、T2 merge→pdf file:// 守卫、T3 书签 w:id 唯一性、T4 renderPdf 失败路径、T5 行内 HTML 交叉边界、T6 核实覆盖免补、T7 超时注入、T8 resolver 同一性)

### 重构 R1-R10(2026-08-10~13,审计驱动,全部行为等价/注明修复项,每迭代独立提交可回退)
- **R1 契约共享**(394950f):白名单/settings-defaults 下沉 core
- **R2 docx/render.ts 拆分**(1295→~850):captions/equations/mdast-utils/image-type
- **R3 pdf/render.ts 拆分**(802→~250):template/postprocess
- **R4 H3 图片变形修复 + L1 类型统一**:PNG/JPEG 原始尺寸等比缩放,webp 降级
- **R5 中优先级快修(M1/M2/M5)**:括号 URL/临时 HTML 随机后缀/pushRuns 统一 async
- **R6 中优先级快修(M4/M6)**:settings 写队列串行化/图片缺失检查并入 resolver
- **R7 renderer 阶段一**:dom.ts 抽取/删 L4 死代码/L5 状态合并
- **R8 renderer 阶段二**:拆分 state/utils/convert-flow/file-list/dialogs,组合根 ~950 行
- **R9 低风险清扫**:L6/L7(批 3)+ L3/M3(批 4)完成,L9 取消(不值得重构);M7/M8 已知限制不动
- **R10-1 convert context 收敛**(e015fae)、**R10-2 renderPhrasing 合并**(ec26a4b)、**R10-3 runWithCtx**(16c3d3f)、**R10-4 HTTP 失败不缓存**(5abe4fe)、**R10-5 settings-panel.ts**(5454426)、**R10-6 inline-html.ts**(ffa5e7c);R10-7 不做(见当前待办)

### 其他完成项
- **待修复**:PDF 任务列表 checkbox 替换失效(289b837,2026-08-10);docx 侧无 checkbox 视觉为设计如此
- **迭代 4「预览入口迁移」**(2026-08-11):单/多文件态预览按钮 + 完成弹窗移除预览,用户 6 项清单全通过
- **P0 bug:smoke-merge-1-合并.pdf 图片未显示**(392fca1,2026-08-11 用户验证通过)——merge 反斜杠绝对路径 %5C 编码 bug + 样例图可见化;不加端到端断言(printToPDF 图片自动化检测不可靠,实证),由 smoke 可见图人工验证

### 维持人工不自动化
- printToPDF 产物图片显示(smoke 可见图人工验证)、renderer 交互、preview:open 生命周期、IPC dialog(ACCEPTANCE GUI 实测清单)
