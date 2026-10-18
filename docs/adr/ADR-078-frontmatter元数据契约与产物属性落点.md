# ADR-078 · frontmatter 元数据契约与产物属性落点

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-18 |
| 关联 | 解析单点 [`src/core/pipeline/frontmatter.ts`](../../src/core/pipeline/frontmatter.ts) ｜ 两个消费端 [`src/core/docx/render.ts`](../../src/core/docx/render.ts) 与 [`src/core/pdf/metadata.ts`](../../src/core/pdf/metadata.ts) ｜ **不触发** [ADR-028](ADR-028-持久化schema表与上下文契约.md)（frontmatter 进的是产物属性，不是设置持久化 schema）、[ADR-024](ADR-024-设置分组与渲染前变换层下沉.md)（不新增设置键）；[ADR-030](ADR-030-水印与页眉裁决及矩阵补行.md) 的水印 / 页眉面不涉 |

---

## 决定

frontmatter 的**输入契约**与它到**产物属性的落点**固定为四条：

1. **只认认得上的键**：`title` / `author` / `date` / `keywords` 四种，白名单单点在上方「关联」的解析单点里。此后每加一个键由对应工作项单独授权，**本条不预先批准**。
2. **值一律取标量原文**：不解析 YAML 列表（`[a, b]` 会被当作字面量）、不解析嵌套。理由是解析器自带的「零依赖手写最简子集」口径（见该文件头注）。
3. **落点是两渲染器各自的原生位置，但键清单只有一份**：docx → `docProps/core.xml`（`dc:title` / `dc:creator` / `cp:keywords`）；PDF → Info（`Title` / `Author` / `Keywords`）。两侧消费同一个 `DocMetadata`，**不在渲染器侧另建键清单**。
4. **判定面扩大是接受的后果**：白名单多一个键，就意味着「只写了该键的文档块」从**当正文原样保留**变成**被剥除**。这是行为变更，不是纯增量。

## 背景

用户侧诉求是「frontmatter 里写了关键词却没进产物属性」。取证发现两侧都**只差接线**：docx 的 `Document` 构造器本就有 `creator` / `keywords` 字段而从未传值，PDF 侧本就逐项 set 而漏了 Keywords。同时暴露两个既有事实：

- docx 产物的作者属性此前**恒为库默认 `Un-named`** —— frontmatter 的 `author` 只进了封面，没进产物属性。这是本条的顺带修复项。
- 「什么算 frontmatter」是全有全无判定：加键即扩大判定面，老文档里刚好只写了这个键的块会从正文变成被剥除。

## 备选方案

1. **支持 YAML 列表**（`keywords: [排版, 归档]` → 多关键词）—— 否决。要么引 `gray-matter` 一类 YAML 解析器（与该文件「零依赖手写最简子集」的既有口径冲突），要么自写列表解析并把「半坏输入怎么兜底」变成第二条契约；而 docx 的 `keywords` 与 PDF 的 `Keywords` 对多值语义本就不同（前者单字符串、后者数组）。取名不副实的最简做法：取标量原文。
2. **在两个渲染器侧各建一份「键 → 产物属性」映射** —— 否决。两份清单必然分叉，且两个渲染器已经共用同一个 `DocMetadata`；映射应落在解析单点。
3. **只补 docx 一条线** —— 否决。同一份输入在 Word 与 PDF 两条交付线上应有同语义，否则「写没写 keywords」会变成选格式才决定的事。

## 后果

- **行为变更一（判定面）**：只写 `keywords:` 的文档块由此前「当正文原样保留」变为「被剥除」，已由断言锁住（`test/core/frontmatter.test.js`）。
- **行为变更二（产物字节）**：docx 的 `docProps/core.xml` **内容**变化 —— 有 `author` 时 `dc:creator` 由库默认 `Un-named` 变为作者，有 `keywords` 时新增 `cp:keywords` 元素。⚠ **不是「多出一个部件」**：docx 的 `File` 构造器恒建 `CoreProperties`，该部件此前就存在（此前的取证说法与之相反，已在 [`docs/evidence/20261017-091039-三条待拍板工作项取证与建议.md`](../evidence/20261017-091039-三条待拍板工作项取证与建议.md) 订正）。
- **已知缺口（本条不改）**：**覆盖语义是整对象替换**（`context.metadata ?? md.metadata`）⇒ 向导侧只填任一个封面字段时，frontmatter 的其余字段会被整体吃掉。与 `title` 的既有问题同源，要改须另起一条 ADR。
- **未实测**：WPS 对 `cp:keywords` 的读取行为（见 [`docs/WPS-COMPAT.md`](../WPS-COMPAT.md) 的未验项）。
