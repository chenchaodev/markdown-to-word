# adr-006 · 公式路线:KaTeX → docx Math(OMML),PDF 复用 KaTeX 渲染

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-08-08 |

> 取号与字段骨架见 [README.md](README.md)（一决策一文件，号不复用；本文件不改动正文，只由新文件声明取代关系）。

### 2026-08-08 10:20:16 公式路线:KaTeX → docx Math(OMML),PDF 复用 KaTeX 渲染(ADR-006)
- 决策:docx 公式走 KaTeX MathML 输出 → 转 docx Math(OMML,超出调研范围超额交付);PDF 公式直接 KaTeX HTML+字体渲染(与已有 printToPDF 管线一致);MathML 转换失败时降级为 TeX 源码纯文本兜底
- 理由:单一公式源(KaTeX)双格式复用;OMML 为 Word 原生公式格式,可编辑;PDF 侧无需第二套公式引擎
- 来源: @librarian(lib 调研)+ 自查(落地验证)
- 关联: docs/archive/ 2026-08-08 10:20:16 批次6公式链路条目、docs/archive/2026-08-06-2229-批次6公式链路调研.md、CHANGELOG 0.16.0
