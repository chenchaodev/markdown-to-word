// 拷贝 renderer 静态资源(src/renderer 下的 html/css + lang-bootstrap.js)到 dist/renderer。
// lang-bootstrap.js 为 <head> 语言引导脚本(纯 JS,不经 tsc 编译),
// 显式按文件名拷贝而非扩展名通配——dist/renderer 是混合目录(tsc 编译的 pure.js 等
// 也在其中),按 .js 通配清理/拷贝会误伤编译产物。
// css 拆入 src/renderer/style/ 子目录,html/css 拷贝与清理为
// 递归遍历(保持相对路径);tsc 未开 declaration,只产出 .js/.js.map,
// 递归清理 .html/.css 不会误删编译产物。
//
// 构建边界(清理范围刻意保守):本脚本在 tsc 之后运行,只对自己拷贝过的东西
// 负责——递归 html/css + 两个显式单文件。tsc 的 .js/.js.map 不在管辖范围
// (含生成物如 dist/main/preload.cjs,反向映射不可靠),src 删文件后残留的编译
// 产物靠「clean build」消除,不是本脚本能判定的;残留检测由
// scripts/check-dist-manifest.mjs(清单比对)承担。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMainModule, parseArgs } from "./check-dist-manifest.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SRC_DIR = path.join(root, "src", "renderer");
const DEFAULT_OUT_DIR = path.join(root, "dist", "renderer");

/** 除 html/css 外显式拷贝的单个文件(不经 tsc 编译的脚本,与 lang-bootstrap 对称处理) */
const SINGLE_FILES = ["lang-bootstrap.js", "about-preload.cjs"];

/** 递归收集 base 下匹配 match 的文件路径(相对 base,含子目录)。 */
export function collectRelFiles(base, match, dir = base) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectRelFiles(base, match, abs));
    else if (match(entry.name)) found.push(path.relative(base, abs));
  }
  return found;
}

/**
 * 自底向上清掉 rootDir 下的空目录(不含 rootDir 本身)。
 * 清理后残留的空目录(源文件已删/已改名)会原样进入安装包,属陈旧产物;
 * 非空目录(内含 tsc 编译产物)不受影响。
 */
export function pruneEmptyDirs(rootDir) {
  const removed = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
    if (dir === rootDir) return;
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      removed.push(path.relative(rootDir, dir).split(path.sep).join("/"));
    }
  };
  walk(rootDir);
  return removed.sort();
}

/**
 * 执行一次拷贝:先清掉上次拷贝的静态资源再重建(防改名/删除后的陈旧残留),
 * 返回 { copied, removed, prunedDirs } 供直测断言。
 */
export function copyRenderer({ srcDir, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });

  // 清理上次拷贝的静态资源再重建:防止改名/删除后的陈旧 html/css 残留进安装包。
  // 注意 dist/renderer 是混合目录(tsc 编译的 pure.js/settings-logic.js 也在此),
  // 只能按扩展名清理本脚本管辖的 html/css,不可整目录 rmSync(会误删编译产物);
  // 递归清理覆盖 style/ 等子目录(css 拆分后静态资源不再全在根级)。
  const cleaned = [];
  for (const rel of collectRelFiles(outDir, (name) => /\.(html|css)$/.test(name))) {
    fs.rmSync(path.join(outDir, rel), { force: true });
    cleaned.push(rel.split(path.sep).join("/"));
  }

  const copied = [];
  for (const rel of collectRelFiles(srcDir, (name) => /\.(html|css)$/.test(name))) {
    const target = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(srcDir, rel), target);
    copied.push(rel.split(path.sep).join("/"));
  }

  // <head> 语言引导脚本与「关于」窗口 preload(纯 CJS,不经 tsc 编译)。
  // 清理对称:src 已删除该文件时同步移除 dist 旧副本,防陈旧脚本残留进安装包。
  const removed = [];
  for (const name of SINGLE_FILES) {
    const target = path.join(outDir, name);
    if (fs.existsSync(path.join(srcDir, name))) {
      fs.copyFileSync(path.join(srcDir, name), target);
      copied.push(name);
    } else if (fs.existsSync(target)) {
      fs.rmSync(target, { force: true });
      removed.push(name);
    }
  }

  // 清理后的空目录同样是陈旧产物(会被打进 asar),一并清掉
  const prunedDirs = pruneEmptyDirs(outDir);
  // 「陈旧」只报清理掉且没有重新拷贝的条目:被原样重建的 html/css 不是残留
  const copiedSet = new Set(copied);
  const stale = [...cleaned.filter((rel) => !copiedSet.has(rel)), ...removed];
  return { copied: copied.sort(), removed: stale.sort(), prunedDirs };
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ["help"], values: ["src", "out"] });
  } catch (error) {
    console.error(`[copy-renderer:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log("用法: node scripts/copy-renderer.mjs [--src <dir>] [--out <dir>]");
    return 0;
  }
  const srcDir = path.resolve(root, options.src ?? DEFAULT_SRC_DIR);
  const outDir = path.resolve(root, options.out ?? DEFAULT_OUT_DIR);
  const { copied, removed, prunedDirs } = copyRenderer({ srcDir, outDir });
  for (const rel of copied) console.log(`copied ${rel}`);
  for (const rel of removed) console.log(`removed stale ${rel}`);
  for (const rel of prunedDirs) console.log(`removed stale dir ${rel}`);
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
