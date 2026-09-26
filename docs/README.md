# docs/ 文档索引

markdown-to-word: Markdown 转 Word / PDF 的 Windows 桌面应用。项目知识库：跨会话需要保留的结论、决策、手册都在本目录；本文件是索引与维护约定。

## 阅读路径（按场景）

- **新手上手** → `USER-GUIDE.md`（使用说明）→ `STATUS.md`（当前状态）
- **搭环境/跑命令/找代码** → `DEV-GUIDE.md`
- **追溯设计决策** → `RESEARCH.md` / `ADR.md`
- **排查故障** → `RESEARCH.md`（坑/根因沉淀）
- **查看进度/找需求入口** → `BACKLOG.md`（项目 backlog,需求唯一入口）→ `ROADMAP.md` / `STATUS.md` / `CHANGELOG.md`
- **交付实测** → `ACCEPTANCE.md`
- **UI 设计** → `design/` 目录

## 文档登记

| 文档 | 用途 | 更新时机 |
|---|---|---|
| `STATUS.md` | 当前状态/验证基线/打开事项 | 每次收尾 |
| `CHANGELOG.md` | 变更历史（面向用户） | 每次发版 |
| `RESEARCH.md` | 库/技术事实、调研结论 | 得出已验证结论时 |
| `ADR.md` | 架构决策（ADR） | 做架构决策/审查时 |
| `ROADMAP.md` | 需求范围/选型/架构/里程碑 | 规划变更或里程碑完成时 |
| `BACKLOG.md` | 项目 backlog（所有需求唯一入口,分类 + 业务价值/工作量评估） | 新需求登记/处置变更时 |
| `DEV-GUIDE.md` | 环境/命令/代码地图/验证方式 | 环境或代码结构变化时 |
| `USER-GUIDE.md` | 终端用户使用说明（安装/操作/设置/FAQ） | 功能或设置变化时 |
| `ACCEPTANCE.md` | 批次验收清单与实测结果记录 | 验收变更/实测完成时 |
| `WPS-COMPAT.md` | Word/WPS 双实测兼容矩阵 | 实测完成/发现问题时 |
| `design/ui-guidelines.md` | UI 视觉规范（冷灰纸+朱砂红、字体三角色、签名元素） | UI 设计变更时 |
| `design/settings-ia.md` | 设置信息架构（设置面板布局与交互） | 设置重组时 |
| `design/book-wizard.md` | 成书向导设计（UI/交互稿） | 向导功能变更时 |
| `design/ui-mockup.html` | UI 交互原型（HTML） | 界面重构时 |
| `OPTIMIZATION-PLAN.md` | 全库代码优化开发计划（裁决、阶段、验收与回退） | 优化排期/裁决变更时 |
| `OPTIMIZATION-CHECKLIST.md` | 全库优化逐阶段执行门禁与证据台账 | 每阶段开始/结束更新 |

## 维护约定

- 条目格式遵循全局 AGENTS.md「落盘格式」节。
- 累积型文件（研究结论/架构决策/CHANGELOG）：行数自然增长，不设上限、不做全量审计；新条目在上，同主题更新旧条目并置顶。
- 使用中顺手清理：读到已失效的研究结论 → 删除该条目；读到被推翻的架构决策 → 旧条目首行标「已被 YYYY-MM-DD HH:mm:ss 条目取代」，保留不删。
- 状态速查是每会话入口，保持 ≤80 行：收尾更新时顺手删除已关闭的打开事项与过期状态，超线当场瘦身。
