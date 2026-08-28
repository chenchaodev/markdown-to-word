// 拷贝 renderer 静态资源(src/renderer 下的 html/css + lang-bootstrap.js)到 dist/renderer。
// lang-bootstrap.js 为 B6 FOUC 缓解的 <head> 引导脚本(纯 JS,不经 tsc 编译),
// 显式按文件名拷贝而非扩展名通配——dist/renderer 是混合目录(tsc 编译的 pure.js 等
// 也在其中),按 .js 通配清理/拷贝会误伤编译产物。
// 批③目录重组:css 拆入 src/renderer/style/ 子目录,html/css 拷贝与清理改为
// 递归遍历(保持相对路径);tsc 未开 declaration,只产出 .js/.js.map,
// 递归清理 .html/.css 不会误删编译产物。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "renderer");
const outDir = path.join(root, "dist", "renderer");

/** 递归收集 base 下指定扩展名的文件路径(相对 base,含子目录)。 */
function walkRel(base, dir = base) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkRel(base, abs));
    else if (/\.(html|css)$/.test(entry.name)) found.push(path.relative(base, abs));
  }
  return found;
}

fs.mkdirSync(outDir, { recursive: true });
// 清理上次拷贝的静态资源再重建:防止改名/删除后的陈旧 html/css 残留进安装包。
// 注意 dist/renderer 是混合目录(tsc 编译的 pure.js/settings-logic.js 也在此),
// 只能按扩展名清理本脚本管辖的 html/css,不可整目录 rmSync(会误删编译产物);
// 递归清理覆盖 style/ 等子目录(css 拆分后静态资源不再全在根级)。
for (const rel of walkRel(outDir)) {
  fs.rmSync(path.join(outDir, rel), { force: true });
}
for (const rel of walkRel(srcDir)) {
  const target = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(srcDir, rel), target);
  console.log(`copied ${rel}`);
}

// B6:<head> 语言引导脚本(显式单文件,见上;批③后仍留 renderer 根级)。
// 清理对称(审计 ENG-7):src 已删除该文件时同步移除 dist 旧副本,
// 防陈旧脚本残留进安装包——与上方 html/css 的「先清后拷」语义一致。
const bootstrap = "lang-bootstrap.js";
const bootstrapTarget = path.join(outDir, bootstrap);
if (fs.existsSync(path.join(srcDir, bootstrap))) {
  fs.copyFileSync(path.join(srcDir, bootstrap), bootstrapTarget);
  console.log(`copied ${bootstrap}`);
} else if (fs.existsSync(bootstrapTarget)) {
  fs.rmSync(bootstrapTarget, { force: true });
  console.log(`removed stale ${bootstrap}`);
}

// 关于窗口 preload(纯 CJS,不经 tsc 编译;显式单文件拷贝,与 lang-bootstrap 对称)。
const aboutPreload = "about-preload.cjs";
const aboutPreloadTarget = path.join(outDir, aboutPreload);
if (fs.existsSync(path.join(srcDir, aboutPreload))) {
  fs.copyFileSync(path.join(srcDir, aboutPreload), aboutPreloadTarget);
  console.log(`copied ${aboutPreload}`);
} else if (fs.existsSync(aboutPreloadTarget)) {
  fs.rmSync(aboutPreloadTarget, { force: true });
  console.log(`removed stale ${aboutPreload}`);
}
