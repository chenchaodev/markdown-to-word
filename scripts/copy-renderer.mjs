// 拷贝 renderer 静态资源(src/renderer 下的 html/css)到 dist/renderer
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "renderer");
const outDir = path.join(root, "dist", "renderer");

// 清理上次拷贝的静态资源再重建:防止改名/删除后的陈旧 html/css 残留进安装包。
// 注意 dist/renderer 是混合目录(tsc 编译的 pure.js/settings-logic.js 也在此),
// 只能按扩展名清理本脚本管辖的 html/css,不可整目录 rmSync(会误删编译产物)。
fs.mkdirSync(outDir, { recursive: true });
for (const name of fs.readdirSync(outDir)) {
  if (/\.(html|css)$/.test(name)) {
    fs.rmSync(path.join(outDir, name), { force: true });
  }
}
for (const name of fs.readdirSync(srcDir)) {
  if (/\.(html|css)$/.test(name)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
    console.log(`copied ${name}`);
  }
}
