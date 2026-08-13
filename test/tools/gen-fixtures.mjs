#!/usr/bin/env node
/**
 * 验收 md 样例生成器(纯 Node,无 Electron 依赖):
 * 扫描 test/segments/ 与 test/main/ 下的 *.test.js,动态 import 段模块,
 * 将 `export const fixtures`(key=场景名,value=md 字符串)落盘为
 * test/fixtures/acceptance/<段基名>[-<场景>].md,复制 md 中引用的本地图片
 * (引用路径不改写,GUI 按 md 所在目录解析),最后生成 README.md 索引。
 * 幂等:同一输入重复生成结果逐字节一致。
 *
 * 用法:
 *   node test/tools/gen-fixtures.mjs           # 生成(需先 npm run build)
 *   node test/tools/gen-fixtures.mjs --check   # 内存重生成比对,有差异 exit 1
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, FIXTURES_DIR } from "../common/paths.js";

// 纯 Node 下段模块依赖链(common/pdf-utils.js 等)import electron 命名导出会
// 抛 SyntaxError,注册 loader 将其解析为 mock(Node < 18.19 无 register 时跳过,
// 相关段会走 import 失败分支)。
try {
  const { register } = await import("node:module");
  register("./electron-mock-loader.mjs", import.meta.url);
} catch {
  // Node 过旧,无 register:依赖 electron 的段将 import 失败并跳过
}

const ACCEPTANCE_DIR = path.join(FIXTURES_DIR, "acceptance");
const CHECK = process.argv.includes("--check");

/** md 中图片引用:![...](path) 与 src="path" */
const IMG_MD_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
const IMG_SRC_RE = /src="([^"]+)"/g;

/** 扫描测试段文件(segments + main,排序保证幂等) */
function listTestFiles() {
  const files = [];
  for (const dir of [path.join(ROOT, "test", "segments"), path.join(ROOT, "test", "main")]) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(".test.js")) files.push(path.join(dir, name));
    }
  }
  return files;
}

/** 段文件头 JSDoc 注释第一行文本(/** 后第一个非空行) */
function jsdocFirstLine(source) {
  const m = source.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return "";
  const lines = m[1]
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\*\s?/, "").trim());
  return lines.find((l) => l.length > 0) ?? "";
}

/** 动态 import 段模块;含 fixtures 导出的段必须可解析(否则产物不完整 → exit 1),
 *  dist/ 未构建时给明确提示;无 fixtures 的段失败仅告警跳过 */
async function importModule(file, hasFixtures) {
  try {
    return await import(pathToFileURL(file).href);
  } catch (err) {
    const msg = String(err?.message ?? err);
    const isDistMissing = /dist[\\/]/.test(msg);
    if (hasFixtures) {
      console.error(
        isDistMissing
          ? "[gen-fixtures] 段模块 import 失败,请先 npm run build(段模块依赖 dist/ 编译产物)"
          : "[gen-fixtures] 段模块 import 失败,无法生成完整验收样例"
      );
      console.error(`  ${path.relative(ROOT, file)}: ${msg.split("\n")[0]}`);
      process.exit(1);
    }
    console.warn(`[gen-fixtures] 跳过 ${path.relative(ROOT, file)}:import 失败(${msg.split("\n")[0]})`);
    return null;
  }
}

/** 收集 md 中的本地图片引用(排除外链/锚点/data URI,剥离 title 与尖括号) */
function collectImageRefs(md) {
  const refs = new Set();
  for (const re of [IMG_MD_RE, IMG_SRC_RE]) {
    for (const m of md.matchAll(re)) {
      let p = m[1].trim().replace(/^<|>$/g, "").split(/\s+/)[0];
      if (!p || /^https?:\/\//i.test(p) || /^#/.test(p) || /^data:/i.test(p)) continue;
      refs.add(p);
    }
  }
  return [...refs];
}

/** 首处差异行号(1 起;一致返回 -1) */
function firstDiffLine(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return i + 1;
  }
  return -1;
}

async function main() {
  const files = listTestFiles();
  const entries = []; // { relDir, baseName, desc, outputs: [{ name, content }] }
  let scanned = 0;

  for (const file of files) {
    scanned++;
    const source = fs.readFileSync(file, "utf8");
    // 无 fixtures 导出 → 静默跳过(不 import,避免无谓的 electron 依赖失败)
    if (!/\bexport\s+const\s+fixtures\b/.test(source)) continue;
    const mod = await importModule(file, true);
    if (!mod?.fixtures || typeof mod.fixtures !== "object") continue;
    const keys = Object.keys(mod.fixtures)
      .filter((k) => typeof mod.fixtures[k] === "string")
      .sort();
    if (keys.length === 0) continue;
    const baseName = path.basename(file, ".test.js");
    const relDir = path.relative(path.join(ROOT, "test"), path.dirname(file)).replace(/\\/g, "/");
    const outputs = keys.map((key) => ({
      name: key === "main" ? `${baseName}.md` : `${baseName}-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}.md`,
      content: mod.fixtures[key],
    }));
    entries.push({ relDir, baseName, desc: jsdocFirstLine(source), outputs });
  }

  // 排序保证幂等(README 行序与写盘顺序一致)
  entries.sort((a, b) => a.baseName.localeCompare(b.baseName));

  // 图片复制清单(去重;源不存在 → 静默跳过,该样例本就是演示缺失警告)
  const imageCopies = [];
  for (const e of entries) {
    for (const o of e.outputs) {
      for (const ref of collectImageRefs(o.content)) {
        const src = path.resolve(FIXTURES_DIR, ref);
        if (!src.startsWith(FIXTURES_DIR + path.sep)) continue; // 防跳出 fixtures
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
        const dest = path.join(ACCEPTANCE_DIR, ref);
        if (!imageCopies.some((c) => c.dest === dest)) imageCopies.push({ src, dest });
      }
    }
  }

  // README 索引
  const readmeLines = [
    "# 验收样例",
    "",
    "由 `test/tools/gen-fixtures.mjs` 从测试段命名导出自动生成(勿手改),",
    "供 GUI 人工实测直接拖入。重新生成:`npm run gen:fixtures`;校验:`npm run check:fixtures`。",
    "",
    "| 文件 | 功能/场景 | 对应测试段 |",
    "| --- | --- | --- |",
  ];
  for (const e of entries) {
    for (const o of e.outputs) {
      const desc = (e.desc || "-").replace(/\|/g, "\\|");
      readmeLines.push(`| ${o.name} | ${desc} | test/${e.relDir}/${e.baseName}.test.js |`);
    }
  }
  const readme = readmeLines.join("\n") + "\n";

  // ---- --check:内存重生成比对,不落盘 ----
  if (CHECK) {
    let ok = true;
    const report = (name, detail) => {
      ok = false;
      console.error(`[check] ${name}:${detail}`);
    };
    for (const e of entries) {
      for (const o of e.outputs) {
        const file = path.join(ACCEPTANCE_DIR, o.name);
        if (!fs.existsSync(file)) {
          report(o.name, " 缺失(应生成)");
          continue;
        }
        const existing = fs.readFileSync(file, "utf8");
        if (existing !== o.content) {
          const line = firstDiffLine(existing, o.content);
          const ex = existing.split("\n")[line - 1] ?? "<无此行>";
          const want = o.content.split("\n")[line - 1] ?? "<无此行>";
          report(o.name, ` 内容不一致(首处差异第 ${line} 行)\n    现有: ${ex}\n    应生成: ${want}`);
        }
      }
    }
    const readmeFile = path.join(ACCEPTANCE_DIR, "README.md");
    if (!fs.existsSync(readmeFile)) {
      report("README.md", " 缺失(应生成)");
    } else {
      const existing = fs.readFileSync(readmeFile, "utf8");
      if (existing !== readme) {
        const line = firstDiffLine(existing, readme);
        report("README.md", ` 内容不一致(首处差异第 ${line} 行)`);
      }
    }
    for (const c of imageCopies) {
      if (!fs.existsSync(c.dest)) {
        report(path.relative(ACCEPTANCE_DIR, c.dest), " 图片缺失(应复制)");
        continue;
      }
      if (!fs.readFileSync(c.src).equals(fs.readFileSync(c.dest))) {
        report(path.relative(ACCEPTANCE_DIR, c.dest), " 图片与源文件字节不一致");
      }
    }
    if (!ok) {
      console.error("[gen-fixtures] --check 失败:acceptance/ 与生成内容存在差异");
      process.exit(1);
    }
    console.log(`[gen-fixtures] --check 通过:${entries.length} 段 ${entries.reduce((n, e) => n + e.outputs.length, 0)} 个 md + README.md + ${imageCopies.length} 个图片与生成内容一致`);
    process.exit(0);
  }

  // ---- 落盘 ----
  fs.mkdirSync(ACCEPTANCE_DIR, { recursive: true });
  for (const e of entries) {
    for (const o of e.outputs) {
      fs.writeFileSync(path.join(ACCEPTANCE_DIR, o.name), o.content, "utf8");
    }
  }
  for (const c of imageCopies) {
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    fs.copyFileSync(c.src, c.dest);
  }
  fs.writeFileSync(path.join(ACCEPTANCE_DIR, "README.md"), readme, "utf8");

  console.log(`[gen-fixtures] 扫描 ${scanned} 个测试段,${entries.length} 段含 fixtures 导出`);
  for (const e of entries) {
    for (const o of e.outputs) {
      console.log(`  + ${o.name} (${o.content.length} 字符,${e.desc || "-"})`);
    }
  }
  for (const c of imageCopies) {
    console.log(`  + 图片 ${path.relative(ACCEPTANCE_DIR, c.dest)} (${fs.statSync(c.src).size} 字节)`);
  }
  console.log(`  + README.md (${entries.length} 行索引)`);
  console.log(`[gen-fixtures] 完成:${path.relative(ROOT, ACCEPTANCE_DIR)}/`);
}

main().catch((err) => {
  console.error(`[gen-fixtures] 失败:${err?.stack ?? err}`);
  process.exit(1);
});