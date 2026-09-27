# 状态速查

> **仪表盘,≤10 行。** 每会话入口:看「现在做到哪、接下来做什么」。规则:① 每次收尾**只改 3 行**「阶段」(含项落地数)/「当前项」/「更新时间」,「门禁」非空时改第 4 行;② 模式 3 **不写本文件**;③ **禁编年史**(历史进 `docs/CHANGELOG.md`);④ 可运行数字不写,只写门禁命令;⑤ 大型重构期间本文件只留一行指针,进度在 `docs/campaigns/<工作项ID>-<中文说明>/STATE.md`。
> 已发布变更见 `docs/CHANGELOG.md`;未实现项与已知限制见 `docs/ROADMAP.md`;库事实与踩坑见 `docs/RESEARCH.md`;命令与验证入口见 `docs/DEV-GUIDE.md`。

- **活跃计划**:REF-028 文档容量契约超限动作改写与归档外迁 —— 计划项 `#01`–`#06` 已全部实施,余人工实测(A-059);评估原文 → 全局配置仓 `docs/archive/20260927-090505-文档容量契约与归档外迁评估.md`

阶段      6/6 项落地
当前项    待实测
门禁      `check:contract:selftest` · `check:contract` · `check:archive-index` · `check:docs` 2026-09-27 全绿(指针门禁:项目模式通过,58 文件 0 错误,豁免点名 6 项;脚手架全量拷贝重测 12 文件 0 错误)
阻塞      A-059 待实测(REF-028 收尾;三条人工项见 `docs/ACCEPTANCE.md`「当前待测」) · 2026-09-27
验证基线   命令指针见 `docs/DEV-GUIDE.md`「验证基线」节(完整 `verify:ci` 的 build/typecheck/coverage/smoke/geometry 段本轮未跑:`src/` 与 `test/` 未触碰)
更新时间   2026-09-27(REF-028 `#01`–`#06` 实施完成,待实测)
