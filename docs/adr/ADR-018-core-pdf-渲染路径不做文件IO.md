# adr-018 · core 的 pdf 渲染路径不做文件 IO

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-09-27 |

> 取号与字段骨架见 [README.md](README.md)（一决策一文件，号不复用；本文件不改动正文，只由新文件声明取代关系）。

### 2026-09-27 08:48:38 core 的 pdf 渲染路径不做文件 IO,能力经入参注入(ADR-018)
- 决策:`core/pdf/**` 不得直接 import `node:fs` 与 `node:fs/promises`。其仅有的两次读 —— 图片路径边界的 `realpathSync`(同步)与 KaTeX CSS 的文本读取 —— 改由 main 经 `RenderPdfHtmlOptions.fs`(类型 `PdfFsCapabilities`)注入;`core/convert.ts` 负责从 `ConvertContext.fs` 透传,并在 pdf 分支**强校验**(缺则抛错)。能力面只声明这两个函数,**不暴露整个 `fs` 模块**,新增用途必须显式改接口。门禁新增规则 `core-pdf-no-fs` 锁死这条
- 理由:改动前 `core/pdf/render.ts` → `pdf/rules/image.ts` → `pipeline/precheck.ts` → `node:fs`,使 core 的纯 PDF 渲染路径传递依赖文件系统;而 `core/pdf/katex-css.ts` 自身还直连 `readFileSync`。两者都是 ADR-012 图片信任边界的执行点。把它们改成注入后,「core 的 pdf 渲染路径不做文件 IO」成为**门禁可断言的不变量** —— 这比"白名单少几条"更有价值,也更耐久
- 刻意保留的例外:`node:path` 与 `node:url` 在 `core/pdf` 仍然允许。策略代码需要 `node:path` 的 7 个函数(`resolve` / `relative` / `isAbsolute` / `sep` / `win32` / `posix`),它们是符号链接逃逸判定(ADR-012)的**承重逻辑**,纯字符串运算但仍是 `node:` 导入;**自己实现一份就是制造安全漏洞**,故宁可留在白名单内也不摘。因此白名单由 4 条变 5 条,而非变少
- 缺能力时为何抛错而非降级:若静默跳过 `realpath`,图片的符号链接逃逸防线就变成一个**可静默关闭的开关**。同理 `ConvertContext.fs` 虽为可选(该上下文由 docx 与 pdf 共用,设为必填会强制 40 个只测 docx 的文件提供它),pdf 分支仍强校验
- 能力默认值的归属:放在**持有 fs 的层**而非 core。`main/services/image-downloader.ts` 补 `options.realpath ?? fs.realpath`(与改动前取值来源相同),`main/converter/context.ts` 构造 `PdfFsCapabilities`。这条是实施中补的 —— 两个生产调用方都不显式传 `realpath`,默认值若不补,异步图片边界校验会从"正常工作"变成"抛错"
- 来源:REF-025 #07(用户裁决:做 B 且连带 `katex-css`)
- 关联:`docs/adr/adr-012`(图片信任边界与资源上限)、`docs/REQ.md` REF-025、`scripts/check-import-boundary.mjs` 的 `core-pdf-no-fs`
