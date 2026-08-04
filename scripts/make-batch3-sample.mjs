/**
 * 生成二期批次 3「批量 + 合并」验收样例:
 *   output/批次3验收/
 *     images/logo.png     - 01 引用的品牌渐变图
 *     images/chart.png    - chapters/05 引用的柱状图(跨层相对路径 ../images/)
 *     01-简介.md ... 10-附录.md + chapters/05..08
 *   - 10 个 md(覆盖 frontmatter/多级标题/表格/代码/列表/引用/分页符/图片)
 *   - 10-附录.md 引用缺失图片 images/missing.png(测批量警告/失败汇总)
 * 用法: node scripts/make-batch3-sample.mjs
 * 纯 Node 零依赖(PNG 手写编码,无 canvas 依赖)。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../output/批次3验收");

// ---------- 最小 PNG 编码器(8-bit RGB,无依赖) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(width, height, pixelFn) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const o = row + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// 渐变 logo(400x240)
const logo = makePng(400, 240, (x, y) => [
  Math.round(30 + (x / 400) * 200),
  Math.round(60 + (y / 240) * 120),
  Math.round(200 - (x / 400) * 100),
]);
// 柱状图(400x240):三根柱 + 浅灰底
const chart = makePng(400, 240, (x, y) => {
  const bars = [0.75, 0.5, 0.9];
  const i = Math.min(2, Math.floor((x / 400) * 3));
  const bh = Math.round(240 * bars[i]);
  const colors = [
    [220, 80, 60],
    [80, 180, 90],
    [70, 110, 230],
  ];
  return y >= 240 - bh ? colors[i] : [245, 245, 245];
});

mkdirSync(path.join(root, "images"), { recursive: true });
mkdirSync(path.join(root, "chapters"), { recursive: true });
writeFileSync(path.join(root, "images/logo.png"), logo);
writeFileSync(path.join(root, "images/chart.png"), chart);

// ---------- 10 个 md(按文件序合并时模拟文档章节) ----------
const files = [
  {
    name: "01-简介.md",
    body: `---
title: 产品白皮书
author: 演示团队
date: 2026-08-04
---

# 简介

本白皮书演示批量转换与多文件合并。本文档引用相对路径图片:

![品牌图](images/logo.png)

## 背景

- 支持批量转换:多选文件、拖放文件夹
- 支持多文件合并:frontmatter 仅取首个文件
- 图片相对路径在合并时自动转为绝对路径

## 目标

1. 验证 10 文件批量转换
2. 验证失败汇总报告逐条正确
3. 验证合并后图片路径不破、目录层级正确`,
  },
  {
    name: "02-安装.md",
    body: `---
title: 安装指南
---

# 安装

\`\`\`bash
npm install
npx electron .
\`\`\`

> 提示:Windows 下安装包位于 release/ 目录。`,
  },
  {
    name: "03-快速开始.md",
    body: `---
title: 快速开始
---

# 快速开始

1. 打开应用
2. 拖入 Markdown 文件或文件夹
3. 选择输出格式 **docx** 或 *pdf*
4. 点击转换

内联代码 \`convertBatch\` 与 \`convertMerge\` 分别对应批量与合并转换。`,
  },
  {
    name: "04-功能清单.md",
    body: `---
title: 功能清单
---

# 功能清单

| 功能 | 状态 | 说明 |
| ---- | ---- | ---- |
| 批量转换 | 已支持 | 队列并发 2 |
| 多文件合并 | 已支持 | 自动分页 |
| 封面页 | 已支持 | YAML frontmatter |
| 目录 TOC | 已支持 | Word 域 / PDF 锚点 |

- [x] 批量转换
- [x] 合并转换
- [ ] 长文档书签(批次 4)`,
  },
  {
    name: "chapters/05-配置说明.md",
    body: `---
title: 配置说明
---

# 配置说明

跨目录相对路径图片(../../ 层级解析):

![柱状图](../images/chart.png)

## 页面设置

### 纸张

支持 A4 / A3 / A5 / Letter / Legal。

### 边距

四边距以毫米为单位。`,
  },
  {
    name: "chapters/06-命令行.md",
    body: `---
title: 命令行
---

# 命令行

\`\`\`js
const { mergeMarkdowns } = await import("./core/merge.js");
const out = mergeMarkdowns(files.map(f => ({
  content: f.content,
  baseDir: path.dirname(f.path),
})));
\`\`\``,
  },
  {
    name: "chapters/07-常见问题.md",
    body: `---
title: 常见问题
---

# 常见问题

**Q: 转换失败怎么办?**

A: 批量转换失败不中断,结果弹窗逐条展示失败原因。

**Q: 图片缺失会报错吗?**

A: 不会,仅以黄色警告提示,转换继续。`,
  },
  {
    name: "chapters/08-性能数据.md",
    body: `---
title: 性能数据
---

# 性能数据

| 场景 | 耗时 |
| ---- | ---- |
| 单文件 docx | 约 0.5s |
| 10 文件批量 | 约 3s |
| 多文件合并 | 约 1s |

<!-- page-break -->

分页符之后的内容另起一页。`,
  },
  {
    name: "09-进阶技巧.md",
    body: `---
title: 进阶技巧
---

# 进阶技巧

<!-- page-break -->

## 模板复用

合并结果保留首个文件的 frontmatter,封面与全局目录自动成立。

## 自定义分页

使用 \`<!-- page-break -->\` 在任意位置强制分页。

### 层级示例

多级标题用于验证目录层级正确。`,
  },
  {
    name: "10-附录.md",
    body: `---
title: 附录
---

# 附录

以下图片引用**故意缺失**,用于验证警告提示:

![缺失图片](images/missing.png)

转换应正常完成,并以黄色警告提示缺少图片文件。`,
  },
];

for (const f of files) {
  writeFileSync(path.join(root, f.name), f.body.trim() + "\n");
}

console.log(`[ok] 验收样例已生成: ${root}`);
console.log(`  - ${files.length} 个 md(含 chapters/ 子目录递归收集)`);
console.log(`  - images/logo.png(01 引用)+ images/chart.png(chapters/05 跨层引用)`);
console.log(`  - 10-附录.md 引用缺失图片 → 批量警告路径`);
console.log(`验收步骤: GUI 全选 10 文件批量转换(应 10 成功/缺失图仅警告)→ 合并全部(检查图片/封面/分页)`);
