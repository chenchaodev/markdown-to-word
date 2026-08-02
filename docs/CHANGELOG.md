# CHANGELOG

## [0.4.3] - 2026-08-02
- 转换完成弹窗:模态提示(遮罩 + 卡片),显示结果文件完整路径(可选中复制),确定/遮罩/Esc 关闭
- 失败路径不变(状态区红字);smoke 诊断保留(api/按钮/点击反馈)

## [0.4.2] - 2026-08-02
- G3 完成:convert IPC 端到端(读→解析→渲染→落盘,同目录换 .docx 扩展名)
- 进度事件 read/render/done 推送 + renderer 进度文案;转换按钮启用(pdf 待 G4)
- convertImpl 抽为纯函数(main 内),smoke 自测覆盖 convert 链路
- 验证:typecheck/build/smoke(docx 8978 bytes)全通过

## [0.4.1] - 2026-08-02
- G2 完成:Electron 43 骨架(主进程窗口/dialog/IPC + preload contextBridge + renderer UI)
- renderer:Win11 浅色风格,文件选择/拖放(md 扩展名校验)/格式单选/状态反馈,CSP 已配置
- 验证:`typecheck`/`build`/`electron . --smoke` 全通过
- .npmrc 固化 electron 双镜像(勿回退)

## [0.4.0] - 2026-08-02
- G1 完成:实现 `src/core` 转换管线(remark + remark-gfm 解析,docx 9.x 渲染)
- 支持:标题1-6/段落/粗斜体/删除线/行内代码/链接/有序无序嵌套列表/表格(表头加粗)/代码块/引用/图片(魔数识别+resolver 注入)/分割线
- 中文:theme.ts 集中配置 eastAsia 微软雅黑,已实测写入 XML
- 验证基线建立:typecheck/build/g1-verify.mjs 全通过,样例含中英混排全要素
- 实测结论落盘 docs/研究结论.md(docx 9.x Numbering/TextRun/ImageRun 用法)

## [0.3.1] - 2026-08-02
- 规划补充:语法覆盖矩阵、renderer 技术选择(vanilla TS)、G1/G4 依赖清单
- 修复里程碑缺口:表格/代码块/引用/图片 渲染并入 G1

## [0.3.0] - 2026-08-02
- 需求变更为 Windows GUI 应用,重新规划:Eelectron 43 + docx 自研渲染 + 自研 printToPDF 管线(弃 md-to-pdf)
- 重写路线图(功能规划 MVP、里程碑 G1-G5);新增 ADR-002,修订 ADR-001 pdf 路线
- 研究结论新增 GUI 调研与 pdf 路线修订;AGENTS.md/状态速查/开发者手册同步

## [0.2.1] - 2026-08-02
- docs/README.md 按全局模板重构(阅读路径/文档登记/维护约定三节,登记全部文档)
- 路线图补充进展状态与里程碑状态列;状态速查同步

## [0.2.0] - 2026-08-02
- 完成选型调研与架构评审:docx 自研渲染管线(remark + docx 9.x)+ md-to-pdf 5.x
- 新增规划文档:`docs/路线图与迭代规划.md`、`docs/研究结论.md`、`docs/架构决策.md`
- AGENTS.md 固化选型硬约束

## [0.1.0] - 2026-08-02
- 初始化项目脚手架:git 仓库、package.json、tsconfig、.npmrc(npmmirror)、docs 骨架
- 技术栈确定为 Node.js/TypeScript(ESM)
