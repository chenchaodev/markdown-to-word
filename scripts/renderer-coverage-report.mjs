// renderer 层实测覆盖率报告 —— 纯只读,不改 c8 参数、不改主门禁判定口径、退出码恒 0。
//
// 存在的理由:`test:coverage` 用 `--exclude="dist/renderer/**"` 把整层 renderer 排除在
// 覆盖率门禁之外(它恰是层向越界风险最高的一层,静态断言又进不了分母),于是这层在
// 门禁上「不可见」。本脚本只把那层的**实测数字**摆出来,让人能看见,不因此改动任何
// 判定:四项阈值(90/85/90/90)与 include/exclude 全部原样,主门禁的红绿与本脚本无关。
//
// 事实前提(c8 12 实测自 node_modules/c8/lib/report.js,非猜测):
//   - `--reporter=json-summary` 且未指定 `--report-dir` 时,产物落在 c8 的默认报告目录
//     `./coverage`(parse-args.js 的 reports-dir default),文件名 `coverage-summary.json`;
//   - `--include`/`--exclude` 经 test-exclude 变成 report.js 的 `entryFilter`,**在覆盖率
//     数据收集阶段**就把被排除的脚本滤掉;`--all` 补 0% 文件时的 filter 同样过
//     shouldInstrument。故 `test:coverage` 产出的 summary 里**根本没有 dist/renderer 的
//     条目** —— 不是「数字是 0」,而是「这一层不在产物里」。
//   - 结论:本脚本默认读主门禁那份产物时,只能报出「该层不在产物内」这一事实并给出
//     能取到数字的口径;若把 `--report-dir` 指向一份 renderer 纳入统计的产物,本脚本
//     会正常聚合出四项数字。
//
// 聚合口径:逐文件 sum(covered)/sum(total) 后再算百分比,而非对文件的 pct 求平均 ——
// 后者会让小文件与大文件等权,数字随文件拆分方式漂移,不可比。
//
// 用法:node scripts/renderer-coverage-report.mjs [--report-dir <dir>] [--json]

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, parseArgs } from './check-dist-manifest.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const USAGE = '用法: node scripts/renderer-coverage-report.mjs [--report-dir <dir>] [--json]';

/** c8 报告目录默认值(与 node_modules/c8/lib/parse-args.js 的 reports-dir default 同源) */
const DEFAULT_REPORT_DIR = 'coverage';
/** json-summary 报告文件名(c8 --reporter=json-summary 的固定产物名) */
const SUMMARY_FILE = 'coverage-summary.json';
/** 被排除的那一层:c8 收到的 --exclude 值,与 test:coverage 参数向量逐字一致 */
const EXCLUDED_LAYER = 'dist/renderer';
/** 四项指标(顺序即输出顺序,与 c8 阈值参数同名) */
const METRICS = ['statements', 'branches', 'functions', 'lines'];

/**
 * 归一化产物 key:c8 的 json-summary 用绝对路径作 key(Windows 下是反斜杠),
 * 统一成正斜杠并去掉可能的盘符大小写差异,便于按层匹配。
 * @param {string} key 产物中的文件 key
 * @returns {string} 归一化后的路径文本
 */
function normalizeKey(key) {
  return key.replaceAll('\\', '/');
}

/**
 * 判定某个产物条目是否属于被排除的那一层。
 * @param {string} key 产物中的文件 key
 * @returns {boolean} 命中 `dist/renderer/` 前缀即 true
 */
function isRendererEntry(key) {
  return normalizeKey(key).toLowerCase().includes(`/${EXCLUDED_LAYER}/`);
}

/**
 * 聚合一层文件的四项覆盖率(按 covered/total 求和,不对文件 pct 求平均)。
 *
 * @param {Record<string, unknown>} summary json-summary 解析结果
 * @returns {{files: string[], fileCount: number, metrics: Record<string, {covered: number, total: number, pct: number | null}>}}
 *   命中的文件列表、文件数、四项聚合值(pct 分母为 0 时为 null,表示「无语句可测」而非 0%)
 */
export function aggregateLayer(summary) {
  const files = [];
  /** @type {Record<string, {covered: number, total: number}>} */
  const sums = Object.fromEntries(METRICS.map((metric) => [metric, { covered: 0, total: 0 }]));

  for (const [key, entry] of Object.entries(summary)) {
    // istanbul 的汇总条目(total)不是文件,不参与分层聚合
    if (key === 'total' || !isRendererEntry(key)) continue;
    if (typeof entry !== 'object' || entry === null) continue;
    files.push(normalizeKey(key));
    for (const metric of METRICS) {
      const bucket = /** @type {Record<string, unknown>} */ (entry)[metric];
      if (typeof bucket !== 'object' || bucket === null) continue;
      const { covered, total } = /** @type {Record<string, unknown>} */ (bucket);
      if (typeof covered === 'number' && typeof total === 'number') {
        sums[metric].covered += covered;
        sums[metric].total += total;
      }
    }
  }

  /** @type {Record<string, {covered: number, total: number, pct: number | null}>} */
  const metrics = {};
  for (const metric of METRICS) {
    const { covered, total } = sums[metric];
    metrics[metric] = { covered, total, pct: total === 0 ? null : (covered / total) * 100 };
  }
  return { files: files.sort(), fileCount: files.length, metrics };
}

/**
 * 百分比文本:分母为 0 时输出 `n/a`(无可测语句),不谎报 0%。
 * @param {number | null} pct 百分比
 * @returns {string} 形如 `92.71%` 或 `n/a`
 */
function pctText(pct) {
  return pct === null ? 'n/a' : `${pct.toFixed(2)}%`;
}

/**
 * 取一份 json-summary 产物。只读,不创建目录、不跑测试、不落任何文件。
 * @param {string} reportDir 报告目录(仓库相对或绝对)
 * @returns {{summary: Record<string, unknown> | null, file: string, reason: string | null}}
 *   summary 为 null 时 reason 说明取不到的原因
 */
export function readSummary(reportDir) {
  const file = path.resolve(projectRoot, reportDir, SUMMARY_FILE);
  if (!existsSync(file)) {
    return { summary: null, file, reason: `产物不存在:${path.relative(projectRoot, file).replaceAll('\\', '/')}` };
  }
  try {
    return { summary: JSON.parse(readFileSync(file, 'utf8')), file, reason: null };
  } catch (error) {
    return {
      summary: null,
      file,
      reason: `产物不可解析:${path.relative(projectRoot, file).replaceAll('\\', '/')}(${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help', 'json'], values: ['report-dir'] });
  } catch (error) {
    // parseArgs 报出的用法文本来自被复用的解析器模块,故此处补上本脚本自己的用法
    console.error(`[info] renderer-coverage: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`[info] renderer-coverage: ${USAGE}`);
    return 0;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const reportDir = options['report-dir'] ?? DEFAULT_REPORT_DIR;
  const { summary, file, reason } = readSummary(reportDir);

  // 产物缺席不是失败:纯报告工具,恒 0 退出,只提示怎么取到数字
  if (summary === null) {
    const target = path.relative(projectRoot, path.resolve(projectRoot, reportDir, SUMMARY_FILE)).replaceAll('\\', '/');
    console.log(`[info] renderer-coverage: 读不到覆盖率产物(${reason});先跑 \`npm run test:coverage\` 生成 ${DEFAULT_REPORT_DIR}/${SUMMARY_FILE},或用 --report-dir 指向一份已有产物目录(本次找的是 ${target})。`);
    return 0;
  }

  const layer = aggregateLayer(summary);

  if (options.json === true) {
    console.log(
      JSON.stringify(
        {
          layer: EXCLUDED_LAYER,
          partOfGate: false,
          source: path.relative(projectRoot, file).replaceAll('\\', '/'),
          fileCount: layer.fileCount,
          metrics: layer.metrics,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`[info] renderer-coverage: 以下是**被排除层** \`${EXCLUDED_LAYER}/**\` 的实测覆盖率 —— 不参与主门禁阈值判定,也不是 total 的一部分。`);
  if (layer.fileCount === 0) {
    console.log(`[info] renderer-coverage: 该层在 ${path.relative(projectRoot, file).replaceAll('\\', '/')} 中**没有任何条目**(文件数 0)。`);
    console.log('[info] renderer-coverage: 原因不是「这层 0%」,而是 c8 的 `--include/--exclude` 经 test-exclude 成为 report.js 的 entryFilter,在数据收集阶段就把被排除的脚本滤掉了,`--all` 补 0% 文件时同样过这道 filter。');
    console.log('[info] renderer-coverage: 故 `npm run test:coverage` 那份产物结构上取不到这层数字;要取到,需另跑一次把该层纳入统计的 c8(不改动 test:coverage 的参数与阈值),再用 --report-dir 指向那份产物目录。');
    return 0;
  }

  console.log(`[info] renderer-coverage: 文件数 ${layer.fileCount}`);
  for (const metric of METRICS) {
    const { covered, total, pct } = layer.metrics[metric];
    console.log(`[info] renderer-coverage:   ${metric.padEnd(10)} ${pctText(pct)} (${covered}/${total})`);
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
