# ADR-002 · Electron GUI 与自研 printToPDF 管线

| 项 | 值 |
|---|---|
| 状态 | 部分被取代 |
| 日期 | 2026-08-02 |

> 取号与字段骨架见 [README.md](README.md)（一决策一文件，号不复用；本文件不改动正文，只由新文件声明取代关系）。

## 背景

本条是在 ADR-001 落地过程中改的方向：pdf 路线弃 md-to-pdf 改自研。动因有三条（原文「理由」行）：主进程即 Node，转换核心零改造即可复用；Electron 自带 Chromium 一份两用（GUI + PDF 打印），避免双份约 300MB 体积；HTML 模板为二期预览铺路。产品形态同时定为 Windows GUI（Electron 43），转换在主进程执行，IPC 用 `contextIsolation` + preload 白名单。来源：@oracle。

## 决定

### 2026-08-02 19:20:18 Electron GUI + 自研 printToPDF 管线(ADR-002)
- 决策:产品形态改为 Windows GUI(Electron 43);pdf 路线弃 md-to-pdf,改「markdown-it → HTML 模板 → `webContents.printToPDF()`」;转换在主进程执行;IPC 用 `contextIsolation` + preload 白名单(`invoke`/`send`);新增 `src/main/` 与 `src/renderer/`,core 与注册表设计不变
- 理由:主进程即 Node,转换核心零改造复用;Electron 自带 Chromium 一份两用(GUI + PDF 打印),避免双份 ~300MB 体积;HTML 模板为二期预览铺路
- 修订:ADR-001 中 pdf 路线(md-to-pdf)被本条目取代;docx 自研管线与格式注册表不变
- 来源: @oracle
- 关联: docs/REQ.md

### 2026-09-27 08:48:38 「格式注册表不变」的表述随之作废(ADR-002 修订)
- 修订:上方条目「docx 自研管线与格式注册表不变」中的**「格式注册表」部分不成立** —— 该注册表从未实施(详见 ADR-001 同日修订条目)。本 ADR 的两个决策**仍然有效**:docx 自研渲染、pdf 走 markdown-it → HTML 模板 → `webContents.printToPDF()`
- 来源:REF-025 #01 人工验收(三处表述一致性核对)查出
