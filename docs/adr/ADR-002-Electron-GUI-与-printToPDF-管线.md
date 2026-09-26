# ADR-002 Electron GUI + 自研 printToPDF 管线

> 规则见全局配置目录 @WORKFLOW-PLAN.md 阶段 1;全量索引与编号唯一真值 → `docs/ADR.md`「编号台账」。

### 2026-08-02 19:20:18 Electron GUI + 自研 printToPDF 管线(ADR-002)
- 决策:产品形态改为 Windows GUI(Electron 43);pdf 路线弃 md-to-pdf,改「markdown-it → HTML 模板 → `webContents.printToPDF()`」;转换在主进程执行;IPC 用 `contextIsolation` + preload 白名单(`invoke`/`send`);新增 `src/main/` 与 `src/renderer/`,core 与注册表设计不变
- 理由:主进程即 Node,转换核心零改造复用;Electron 自带 Chromium 一份两用(GUI + PDF 打印),避免双份 ~300MB 体积;HTML 模板为二期预览铺路
- 修订:ADR-001 中 pdf 路线(md-to-pdf)被本条目取代;docx 自研管线与格式注册表不变
- 来源: @oracle
- 关联: docs/ROADMAP.md
