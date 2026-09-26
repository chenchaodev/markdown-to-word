// @ts-check
/**
 * 双管线差异矩阵的行输入样例(markdown 源),测试树共享的单源。
 *
 * 为何与判定分离:样例是「喂给双侧转换的输入」,矩阵行是「对产物下什么判定」,两者
 * 生命周期不同 —— 样例会被 gen-fixtures 落盘成验收样例供 GUI 实测拖入,判定只活在段内。
 * 分开后新增场景只需动样例,新增维度只需动矩阵行,不必在同一文件里互相牵扯。
 *
 * 依赖方向单向:本文件零 import(纯 markdown 字面量);被 dual-sandbox(装配)与
 * 差异矩阵段(落盘契约)单向消费。
 */

/* ---------- 落盘为验收样例的场景(经矩阵段 re-export 给 gen-fixtures) ---------- */

/** 主样例:一次覆盖 frontmatter / 白名单 / 分页 / 目录层级 / 题注编号 /
 *  label 剥离 / 交叉引用 / 公式编号 / 任务列表 / 脚注 / 代码高亮 */
export const mainMd = `---
title: 矩阵样例文档
author: 测试作者
---

# 一级标题 {#sec:top}

正文首段,含行内 <strong>白名单粗体</strong> 与 <sub>下标</sub>;危险片段 <div class="x">块级标签</div> 与 <script>alert(1)</script>。

<!-- page-break -->

## 二级标题 {#sec:mid}

![样例图](g1-tiny.png)

图: 样例图 {#fig:alpha}

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

表: 样例表 {#tab:beta}

见 [图](#fig:alpha)、[表](#tab:beta)、[章节](#sec:mid)、[式](#eq:energy) 与悬空 [图](#fig:none)。

$$
E = mc^2
$$

{#eq:energy}

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

- [x] 已完成
- [ ] 待办

脚注引用[^note]。

[^note]: 脚注内容。

\`\`\`ts
const x = 1;
\`\`\`

# 第二章

![章二图](g1-tiny.png)

图: 章二图 {#fig:gamma}
`;

/** 深标题:h1-h6 全有 id,目录只收 h1-h3 */
export const deepHeadingsMd = `# 一级

## 二级

### 三级

#### 四级

##### 五级

###### 六级

# 第二章
`;

/** 题注先于首个 h1(docx 章节号 null → 纯序数;pdf h1c 计数器仍为 0) */
export const captionBeforeH1Md = `![章前图](g1-tiny.png)

图: 章前图

# 第一章

![章内图](g1-tiny.png)

图: 章内图
`;

/** 题注 label(captionNumbering 关闭时的 label 原样保留对照样例) */
export const captionLabelMd = `# 甲

![样例图](g1-tiny.png)

图: 样例图 {#fig:alpha}

表: 样例表 {#tab:beta}

见 [图](#fig:alpha)。
`;

/** 公式边界样本:maxExpand 失控 / 解析失败 / 外部引用指令 / mstyle 未覆盖 */
export const katexBoundaryMd = `# 公式边界

宏展开失控:

$$
\\def\\a{\\a}\\a
$$

解析失败:

$$
\\frac{1}{
$$

外部引用指令:

$$
\\includegraphics[width=1cm]{a.png}
$$

未覆盖结构:

$$
\\color{red}{x}
$$
`;

/* ---------- 其余行内样例(与矩阵逐行对应,不落盘) ---------- */

/** 白名单:合法行内标签 + 白名单外块级/脚本标签 */
export const whitelistMd = `行内 <strong>粗</strong> 与 <sub>下标</sub>。

<div class="x">块级标签</div>

<script>alert(1)</script>
`;
/** 分页符(隔离样本:无 frontmatter、无目录,排除封面/目录页的分页) */
export const pageBreakMd = "# 分页\n\n<!-- page-break -->\n\n第二页\n";
/** hr 语义对照:`---` 不产生分页 */
export const hrMd = "第一段\n\n---\n\n第二段\n";
/** 题注编号(图/表独立计数 + h1 重置 + 引用编号) */
export const captionMd = `# 第一章

![样例图](g1-tiny.png)

图: 样例图 {#fig:alpha}

| 列 A | 列 B |
| --- | --- |
| 1 | 2 |

表: 样例表 {#tab:beta}

见 [图](#fig:alpha) 与悬空 [图](#fig:none)。

# 第二章

![章二图](g1-tiny.png)

图: 章二图 {#fig:gamma}
`;
/** 公式编号(label + 引用) */
export const equationMd = `# 公式编号

$$
E = mc^2
$$

{#eq:energy}

见 [式](#eq:energy)。
`;
/** fig/tab 同名 label(查表键按 kind 分命名空间) + 跨 kind 引用必须悬空:
 *  fig:same / tab:same 共存互不覆盖;fig:onlytab / tab:onlyfig 各自只存在于
 *  另一 kind 的命名空间,按 fig/tab 引用均查不到 → 悬空 */
export const sameLabelMd = `![图一](g1-tiny.png)

图: 图一 {#fig:same}

| A | B |
| --- | --- |
| 1 | 2 |

表: 表一 {#tab:same}

![图二](g1-tiny.png)

图: 图二 {#fig:onlyfig}

| C | D |
| --- | --- |
| 3 | 4 |

表: 表二 {#tab:onlytab}

见 [图](#fig:same) 与 [表](#tab:same)。另见 [图](#fig:onlytab) 与 [表](#tab:onlyfig)。
`;
/** 同一 kind 内 label 重名:后写覆盖(先到先得语义不变,与 kind 分域正交) */
export const dupLabelMd = `![图一](g1-tiny.png)

图: 图一 {#fig:dup}

![图二](g1-tiny.png)

图: 图二 {#fig:dup}

见 [图](#fig:dup)。
`;
/** 脚注 */
export const footnoteMd = "正文脚注[^a]。\n\n[^a]: 脚注内容。\n";
/** 任务列表 */
export const taskListMd = "- [x] 已完成\n- [ ] 待办\n";
/** 标题 id 取源兜底:标题内含内联链接 */
export const headingLinkMd = "## 见 [附录](#sec:tail)\n\n正文。\n";
/** 目录页码回填样本 */
export const tocMd = `# 一级

正文一。

## 二级

正文二。
`;
/** mermaid 围栏 */
export const mermaidMd = "```mermaid\ngraph TD;\nA-->B;\n```\n";
/** 外链图片(图片预算记账口径探针) */
export const externalImageMd = "![外链图](https://example.com/a.png)\n";
/** 无 h1 的单题注文档 */
export const noH1CaptionMd = "![图](g1-tiny.png)\n\n图: 无章节图\n";
