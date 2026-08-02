/**
 * SVG → ICO:读取 build/icon.svg,渲染多尺寸 PNG,合成 build/icon.ico。
 * 用法:node scripts/svg-to-ico.mjs(需先 build,无依赖构建)。
 */
import sharp from "sharp";
import pngToIco from "png-to-ico";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(root, "build", "icon.svg");
const icoPath = path.join(root, "build", "icon.ico");

const svg = await fs.readFile(svgPath);
// density 提高 SVG 矢量渲染精度(默认 72dpi,放大后边缘毛糙)
const pngs = await Promise.all(
  [256, 128, 64, 48, 32, 16].map((size) =>
    sharp(svg, { density: 300 }).resize(size, size).png().toBuffer(),
  ),
);
const ico = await pngToIco(pngs);
await fs.writeFile(icoPath, ico);
console.log(`icon.ico written: ${ico.length} bytes (sizes: 256/128/64/48/32/16)`);
