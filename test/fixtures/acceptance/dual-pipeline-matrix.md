---
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

```ts
const x = 1;
```

# 第二章

![章二图](g1-tiny.png)

图: 章二图 {#fig:gamma}
