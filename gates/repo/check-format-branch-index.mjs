// 格式分支索引漂走护栏(REQ-277)。
//
// 为什么这道门禁:src/core/convert.ts 头注手工维护了「全库的 format 类型分支落在下列 N 个点,
// 跨 3 层(本文件 · src/convert/run.ts×2 · src/convert/paths.ts · src/cli/index.ts)」清单 ——
// 那份索引是人写的,且曾实测漂移过;新增格式必须逐处改判定。没有门禁,清单会静默漂走。
// 本门禁把「实现漂走」做成反向不变量:src/** 里实际的 `format === "pdf"|"docx"` 实现分支点
// (不含注释行)计数恒等 EXPECTED_FORMAT_BRANCHES。新增格式时红即提示:①改判定处 ②改本常量
// ③补头注索引。声明层的漂走(头注清单缺出现点)是人的问题,余地记在 REQ-277 的「跨层收敛
// 到 dispatch table」,本门禁不兜(已知盲区,如实在出现可再登记豁免)。
//
// 扫描面(纯文本解析、零新增依赖、离线可跑、幂等):`src/**/*.{ts,cts,js}` 实现行 ——
// 先剥行首 `//` / `*` / `/*` 注释行,再逐行正则 `format\s*===\s*["'](pdf|docx)["']`(大小写
// 敏感,`artifact.format === "pdf"` 形态也算,见 mcp/tools.ts:446;`both` 形态按 convert.ts
// 头注与 mcp/cli/options 的 CliFormat 口径刻意不计)。
//
// 防空过(与本仓其余门禁同一纪律):src 根不存在、扫描面为空或 hits 计数≠ EXPECTED ⇒ 判红。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const USAGE = '用法: node gates/repo/check-format-branch-index.mjs [--src <src绝对路径>] [--help]';

/** 当前 src/ 里 `format === "pdf"|"docx"` 的实现分支点数(rg 经自检实测,2026-11-24) */
export const EXPECTED_FORMAT_BRANCHES = 7;

/** 源码扩展名(与 check-transform-dispatch 的 src 形态同口径) */
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.cts', '.js']);

/** 实现分支点正则:`format === "pdf"|"docx"`,接受单双引号 */
const FORMAT_BRANCH_RE = /\bformat\s*===\s*["'](pdf|docx)["']/;

/** 递归列 src 下参与扫描的源文件(仓相对 POSIX 路径,已排序 —— 与 check-transform-dispatch 同形) */
function listSourceFiles(absRoot) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(childRel);
    }
  };
  walk(absRoot, '');
  return out.sort((a, b) => a.localeCompare(b));
}

/** 扫描 `srcRoot` 下的实现分支点:剥注释行后逐行正则,按命中行计,升序排列 */
export function scanFormatBranches(srcRoot) {
  const out = [];
  const re = new RegExp(FORMAT_BRANCH_RE.source, 'g');
  for (const rel of listSourceFiles(srcRoot)) {
    let text;
    try {
      text = readFileSync(path.join(srcRoot, ...rel.split('/')), 'utf8');
    } catch {
      continue; // 单文件读失败不静默放过:整棵扫描面为空/缺失会让 hits 计数变红
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
      for (const m of line.matchAll(re)) {
        out.push({ file: rel, line: i + 1, text: trimmed });
      }
    }
  }
  return out;
}

/** 判定(纯函数):返回 `{ problems, info, hits }` */
export function analyze({ srcRoot }) {
  const problems = [];
  const hits = scanFormatBranches(srcRoot);
  const info = [];
  if (hits.length !== EXPECTED_FORMAT_BRANCHES) {
    const where = hits.map((h) => `${h.file}:${h.line}`).join('、');
    problems.push(
      `[format-branch-index:fail] src 里 format === "pdf"|"docx" 实现分支点应为 ${EXPECTED_FORMAT_BRANCHES} 处,`
      + `实际 ${hits.length} 处${where ? `:${where}` : '无'} —— 新增格式须改判定处 + 改本常量 + 补头注索引(见 src/core/convert.ts 头注)`,
    );
  }
  info.push(`format 实现分支点:${hits.length}/${EXPECTED_FORMAT_BRANCHES}(${hits.length === EXPECTED_FORMAT_BRANCHES ? '一致' : '漂移'})`);
  return { problems, info, hits };
}

/** CLI 主体:扫描 → 判定 → 输出 → 退出码 */
export function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help'], values: ['src'] });
  } catch (error) {
    console.error(`[format-branch-index:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const srcRoot = path.resolve(projectRoot, options.src ?? 'src');
  const result = analyze({ srcRoot });
  for (const line of result.info) console.log(`[info] format-branch-index:${line}`);
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(problem);
    console.error(`[format-branch-index:fail] 格式分支索引自检失败,共 ${result.problems.length} 项`);
    return 1;
  }
  console.log('[ok] 格式分支索引漂走护栏通过:format 实现分支点计数与手工索引声明一致');
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
