// 拷贝 renderer 静态资源(src/renderer 下的 html/css)到 dist/renderer
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "src", "renderer");
const outDir = path.join(root, "dist", "renderer");

fs.mkdirSync(outDir, { recursive: true });
for (const name of fs.readdirSync(srcDir)) {
  if (/\.(html|css)$/.test(name)) {
    fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
    console.log(`copied ${name}`);
  }
}
