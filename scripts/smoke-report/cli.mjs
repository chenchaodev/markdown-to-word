// CLI 装配层:参数解析、路径推导、跑进程 → 组装报告 → 落盘 → 打摘要,并把状态映射成退出码
// (0 通过 / 1 跑了但没过 / 2 未执行)。**不判定**:判定在 report.mjs 与 smoke-proc.mjs,这里只编排。
//
// 退出码语义是这份产物的关键:「没跑」(2)必须与「跑了没过」(1)、「通过」(0)都区分开,
// 否则 CI 会把「本机没装 Electron」读成「冒烟正常」。

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../check-dist-manifest.mjs';
import { DEFAULT_SMOKE_TIMEOUT_MS, createUserData, describeSmokeCommand, disposeUserData, outputTail, runSmokeProcess } from '../smoke-proc.mjs';
import {
  DEFAULT_RELEASE_DIR,
  DEFAULT_REPORT_REL,
  DEFAULT_SCRATCH_REL,
  EXIT,
  LOG_SUFFIX,
  projectRoot,
  REPORT_STATUS,
  UNPACKED_DIR_NAME,
} from './contract.mjs';
import { buildNotRunReport, buildSmokeReport, exitCodeForStatus, renderSmokeSummary } from './report.mjs';
import {
  findAppExe,
  preflight,
  readProductName,
  removeScratch,
  repoRelative,
  resolveElectronBinary,
} from './process.mjs';

const USAGE = `用法: node scripts/smoke-report.mjs [选项]
  --source <dev|unpacked>  冒烟来源(默认 unpacked;dev = 以 electron 启动仓库根,
                           unpacked = 以解包目录内的应用 exe 启动)
  --release <dir>          发布产物根目录(默认 ${DEFAULT_RELEASE_DIR};解包目录取其下 ${UNPACKED_DIR_NAME})
  --unpacked <dir>         显式指定解包目录(覆盖 --release 推导)
  --exe <file>             显式指定应用可执行文件(仅 unpacked 来源)
  --out <file>             报告 JSON 落点(默认 ${DEFAULT_REPORT_REL})
  --scratch <dir>          一次性 userData 根目录(默认 ${DEFAULT_SCRATCH_REL})
  --timeout <ms>           硬超时(ms,默认 ${DEFAULT_SMOKE_TIMEOUT_MS};0 = 不启用,不建议)
  --help                   显示本用法

退出码:0 = 通过(标记齐 + 退出码 0);1 = 跑了但没过(缺标记/非零退出/超时/启动失败);
        2 = 未执行(无产物/无 Electron/未构建)。2 与 0 必须区分,不得把「没跑」读成通过。`;

/**
 * 写报告产物(固定 2 空格缩进 + 末尾换行;不写时间戳/绝对路径,故同输入产物同字节)。
 * @param {string} outPath 落点
 * @param {object} report 报告对象
 * @returns {string} 落点绝对路径
 */
function writeReport(outPath, report) {
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outPath;
}

/**
 * CLI 主体。
 * @param {string[]} [argv] 参数
 * @returns {Promise<number>} 进程退出码
 */
export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, {
      booleans: ['help'],
      values: ['source', 'release', 'unpacked', 'exe', 'out', 'scratch', 'timeout'],
    });
  } catch (error) {
    console.error(`[smoke-report:fail] ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.fail;
  }
  if (options.help) {
    console.log(USAGE);
    return EXIT.pass;
  }
  const source = options.source ?? 'unpacked';
  if (source !== 'unpacked' && source !== 'dev') {
    console.error(`[smoke-report:fail] --source 只接受 dev|unpacked,实际 ${source}`);
    return EXIT.fail;
  }
  const timeoutMs = options.timeout === undefined ? DEFAULT_SMOKE_TIMEOUT_MS : Number(options.timeout);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    console.error(`[smoke-report:fail] --timeout 须为非负毫秒数,实际 ${String(options.timeout)}`);
    return EXIT.fail;
  }
  const releaseDir = path.resolve(projectRoot, options.release ?? DEFAULT_RELEASE_DIR);
  const unpackedDir = path.resolve(
    projectRoot,
    options.unpacked ?? path.join(releaseDir, UNPACKED_DIR_NAME),
  );
  const outPath = path.resolve(projectRoot, options.out ?? DEFAULT_REPORT_REL);
  const scratchRoot = path.resolve(projectRoot, options.scratch ?? DEFAULT_SCRATCH_REL);
  const exeOption = options.exe === undefined ? undefined : path.resolve(projectRoot, options.exe);

  const blocked = preflight({ source, unpackedDir, exeOption, productName: readProductName() });
  if (blocked !== null) {
    const report = buildNotRunReport({ source, reason: blocked });
    writeReport(outPath, report);
    console.error(renderSmokeSummary(report));
    console.error(
      `[smoke-report:fail] 冒烟未执行(exit ${EXIT.notRun});已写出如实报告:${repoRelative(outPath)}`,
    );
    return EXIT.notRun;
  }

  const electron = source === 'dev' ? resolveElectronBinary(projectRoot) : null;
  const exePath =
    source === 'dev' ? (electron ?? '') : (exeOption ?? findAppExe(unpackedDir, readProductName()) ?? '');
  const launcher = source === 'dev' ? '.' : undefined;
  const runtime = source === 'dev' ? (electron ?? undefined) : undefined;
  const userDataDir = createUserData(scratchRoot);
  console.log(
    `[info] smoke-report: 启动 ${describeSmokeCommand({ exePath, launcher, runtime, userDataDir })}`,
  );
  const startedAt = Date.now();
  /** @type {import('./smoke-proc.mjs').ProcessRunResult} */
  let result;
  try {
    result = await runSmokeProcess({ exePath, launcher, runtime, userDataDir, timeoutMs });
  } finally {
    disposeUserData(userDataDir);
  }
  const elapsedMs = Date.now() - startedAt;
  removeScratch(scratchRoot);
  const report = buildSmokeReport({
    result,
    source,
    target: source === 'dev' ? '仓库根(electron .)' : repoRelative(exePath),
  });
  writeReport(outPath, report);
  if (report.status === REPORT_STATUS.fail) {
    // 原始输出留痕(不进报告 JSON:里面有临时目录绝对路径,会让产物不可复现);
    // 排查直接看尾部,完整内容在同目录的 .log
    const logPath = `${outPath}${LOG_SUFFIX}`;
    writeFileSync(logPath, `${result.output}\n`, 'utf8');
    console.error(renderSmokeSummary(report, { elapsedMs }));
    console.error(`[smoke-report:fail] 输出尾部:\n${outputTail(result.output)}`);
    console.error(`[smoke-report:fail] 完整输出已留痕:${repoRelative(logPath)}`);
  } else {
    console.log(renderSmokeSummary(report, { elapsedMs }));
  }
  console.log(
    `[smoke-report] 报告已写出:${repoRelative(outPath)}(退出码 ${exitCodeForStatus(report.status)};` +
      `未执行 = ${EXIT.notRun},失败 = ${EXIT.fail},通过 = ${EXIT.pass})`,
  );
  return exitCodeForStatus(report.status);
}
