// 安装包签名状态核对(exit 0/1)。
//
// 用途:ADR-013(发布供应链与「现阶段明确不签名」)裁决「现阶段不接入代码签名,
// 未签名作为**明确风险**保留」。但仅在文档里
// 写一句「未签名」无法防止它悄悄变成假话:哪天有人配了证书、或反过来文档仍宣称未签名
// 而产物已签名,都没有任何断言能发现。本脚本在发布链上核对**事实**与**声明**是否一致。
//
// 三态词汇(刻意不用二值,避免把「无法判定」谎报成「未签名」):
//   - signed        : Authenticode 状态 Valid
//   - unsigned      : Authenticode 状态 NotSigned(即真的没有签名)
//   - indeterminate : 其余状态(UnknownError / NotTrusted / HashMismatch / NotSupportedFileFormat …)
//                     —— 其中 NotTrusted 意味着「有签名但证书链不受信」,与 unsigned 语义相反,
//                     一律按无法判定处理并判红,不得归入 unsigned。
// 另有一类**不属于 Authenticode 状态**:探测命令本身失败(如
// Microsoft.PowerShell.Security 模块加载不了,连 Status 都没取到),记为
// probe-unavailable。它与 indeterminate 分开报,避免把「取不到事实」误导成
// 「签名状态异常」;同样判红 —— 取不到事实不得当作未签名放行。
//
// 声明来源:本脚本内的 EXPECTED_SIGNATURE_STATUS(ADR-013)。文档侧由
// docs/SIGNATURE-STATUS.md 记录同一事实,test/segments/signature-status.test.js
// 断言两者措辞一致 + 打包配置确实无证书 + 用户文档仍保留 SmartScreen 披露,
// 三者共同构成「未签名被如实告知、不伪装为已签名」的守护。
//
// 用法:
//   node scripts/check-signature-status.mjs [--release <dir>] [--json] [--help]
//
// 非 Windows 平台:Authenticode 是 Windows 专有机制,直接以 actionable 提示退出(不判红,
// 也不谎报 unsigned)——本项目发布目标即 Windows,非 Windows 只出现在开发机上。

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isMainModule, parseArgs } from './check-dist-manifest.mjs';

export const EXPECTED_SIGNATURE_STATUS = 'unsigned';
export const DEFAULT_RELEASE_DIR = 'release';

const USAGE = `用法: node scripts/check-signature-status.mjs [选项]
  --release <dir>  发布产物目录(默认 release;取自 build.directories.output)
  --json           以 JSON 输出核对结果(供 CI/其它门禁消费)
  --help           显示本用法`;

/** Windows Get-AuthenticodeSignature 的 Status 值 → 本脚本三态词汇 */
export const AUTHENTICODE_STATUS_MAP = {
  Valid: 'signed',
  NotSigned: 'unsigned',
  // 其余一律 indeterminate(见文件头「三态词汇」)
};

/**
 * 把 Authenticode 原始状态映射为三态词汇。
 * @param {string} rawStatus PowerShell Get-AuthenticodeSignature 的 Status 文本
 * @returns {string} 三态词汇(signed / unsigned / indeterminate)
 */
export function classifyAuthenticode(rawStatus) {
  const key = String(rawStatus).trim();
  return Object.prototype.hasOwnProperty.call(AUTHENTICODE_STATUS_MAP, key)
    ? AUTHENTICODE_STATUS_MAP[key]
    : 'indeterminate';
}

/**
 * 比对实际状态与声明状态。
 * @param {string} actual 实测三态
 * @param {string} expected 声明三态
 * @returns {{ok: boolean, reason?: string}} 判定结果与原因
 */
export function compareStatus(actual, expected) {
  if (actual === expected) return { ok: true };
  if (actual === 'indeterminate') {
    return {
      ok: false,
      reason: '签名状态无法判定(Authenticode 返回非 Valid/NotSigned);不得当作「未签名」放行,需人工核验',
    };
  }
  return {
    ok: false,
    reason: `签名状态与声明不一致:声明 ${expected},实测 ${actual}。若确为有意变更签名状态,须同步更新 scripts/check-signature-status.mjs 的 EXPECTED_SIGNATURE_STATUS 与 docs/SIGNATURE-STATUS.md`,
  };
}

/**
 * 递归收集目录下的 exe 文件(跳过 blockmap/yml 等非可执行产物)。
 * @param {string} dir 目标目录
 * @returns {string[]} exe 绝对路径
 */
export function collectExeFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectExeFiles(full));
    } else if (name.toLowerCase().endsWith('.exe')) {
      out.push(full);
    }
  }
  return out.sort();
}

/**
 * 读取单个文件的 Authenticode 状态(PowerShell)。
 *
 * ⚠️ 必须重置 PSModulePath 再显式导入模块(勿删,这是 CI 上实测踩到的坑):
 * GitHub Actions 会给会话注入一个 **pwsh 口径的 PSModulePath**,子进程
 * `powershell.exe`(Windows PowerShell 5.1)继承后解析不到自己那份
 * Microsoft.PowerShell.Security,`Get-AuthenticodeSignature` 直接不可用,报
 * `CouldNotAutoloadMatchingModule`。故从 Machine/User 环境变量重取一份干净的
 * 模块路径覆盖继承值,并显式 Import-Module —— 只加 -NoProfile 挡不住这个。
 * @param {string} file exe 绝对路径
 * @returns {string} 原始 Status 文本
 */
function readAuthenticodeStatus(file) {
  // 单引号包裹并把路径内单引号转义,避免破坏命令
  const safe = file.replace(/'/g, "''");
  const script = [
    // 丢掉继承来的 PSModulePath,改用机器/用户级的那份(缺失项跳过,避免尾随分号)
    "$ErrorActionPreference = 'Stop';",
    "$mp = @(",
    "  [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine'),",
    "  [Environment]::GetEnvironmentVariable('PSModulePath', 'User')",
    ") | Where-Object { $_ };",
    "$env:PSModulePath = ($mp -join ';');",
    "Import-Module Microsoft.PowerShell.Security -ErrorAction Stop;",
    `(Get-AuthenticodeSignature -LiteralPath '${safe}').Status`,
  ].join(' ');
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
  }).trim();
}

/**
 * 探测单个产物并产出一条核对结论(纯函数,probe 可注入故失败路径可测)。
 *
 * 探测手段本身不可用(如 Microsoft.PowerShell.Security 模块加载不了)与
 * 「拿到了状态但判读不出」是两回事:前者连事实都没取到,不能混进 indeterminate
 * 一起报,否则排查时会被误导成签名状态异常。故单列 probe-unavailable 并同样判红。
 * @param {string} file exe 绝对路径(用于错误信息)
 * @param {() => string} probe 返回 Authenticode 原始 Status;抛错即视为探测手段不可用
 * @param {string} expected 声明状态
 * @returns {{ file: string; raw: string; status: string; ok: boolean; reason?: string }} 核对结论
 */
export function buildEntry(file, probe, expected = EXPECTED_SIGNATURE_STATUS) {
  /** @type {string} */
  let raw;
  try {
    raw = probe();
  } catch (error) {
    // PowerShell 报错里最具诊断价值的是 FullyQualifiedErrorId(如
    // CouldNotAutoloadMatchingModule),它通常在末行。只取首行会把它丢掉,让
    // 「模块加载失败」退化成一句难定位的残句,故两段都留。
    const message = error instanceof Error ? error.message : String(error);
    const firstLine = message.split('\n')[0].trim();
    const errorId = /FullyQualifiedErrorId\s*:\s*(\S+)/.exec(message)?.[1];
    const detail = errorId ? `${firstLine} [${errorId}]` : firstLine;
    return {
      file: path.relative(process.cwd(), file),
      raw: '(探测手段不可用)',
      status: 'probe-unavailable',
      ok: false,
      reason:
        `无法读取 Authenticode 状态(探测命令失败):${detail}\n` +
        '      这是探测手段不可用,不是签名状态异常;不得据此推断「未签名」。' +
        'Windows 上先确认 Get-AuthenticodeSignature 可用(Get-Command),' +
        '若为模块加载问题检查 PSModulePath 是否被 CI 注入值污染。',
    };
  }
  const status = classifyAuthenticode(raw);
  const verdict = compareStatus(status, expected);
  return {
    file: path.relative(process.cwd(), file),
    raw,
    status,
    ok: verdict.ok,
    ...(verdict.reason ? { reason: verdict.reason } : {}),
  };
}

/**
 * 主流程:收集产物 → 读取状态 → 与声明比对。
 * @param {string[]} argv 命令行参数
 * @returns {number} 进程退出码
 */
export function main(argv = []) {
  /** @type {{release?: string, json?: boolean, help?: boolean}} */
  let options;
  try {
    options = parseArgs(argv, { booleans: ['json', 'help'], values: ['release'] });
  } catch (error) {
    console.error(`[signature] 参数错误:${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  if (process.platform !== 'win32') {
    console.log('[signature] 当前平台非 Windows,Authenticode 不适用;跳过签名核对(不判红、不谎报状态)');
    return 0;
  }

  const releaseDir = path.resolve(options.release ?? DEFAULT_RELEASE_DIR);
  const exes = collectExeFiles(releaseDir);
  if (exes.length === 0) {
    console.error(
      `[signature] 未在 ${releaseDir} 找到任何 .exe 产物。\n` +
        '  先执行发布构建: npm run dist\n' +
        '  (本检查只核对已产出物的真实签名状态,不会替你构建)',
    );
    return 1;
  }

  const entries = exes.map((file) => buildEntry(file, () => readAuthenticodeStatus(file)));

  const failed = entries.filter((e) => !e.ok);
  if (options.json) {
    console.log(JSON.stringify({ expected: EXPECTED_SIGNATURE_STATUS, entries, ok: failed.length === 0 }, null, 2));
  } else {
    for (const e of entries) {
      console.log(`${e.ok ? '[ok]' : '[fail]'} ${e.file}: ${e.status}(Authenticode=${e.raw})`);
      if (e.reason) console.log(`      ${e.reason}`);
    }
  }

  if (failed.length > 0) {
    console.error(
      `[signature] ${failed.length}/${entries.length} 个产物签名状态与声明(${EXPECTED_SIGNATURE_STATUS})不一致,判红。\n` +
        '  ADR-013(发布供应链与「现阶段明确不签名」)裁决:现阶段不接入代码签名,未签名作为明确风险保留;'
        + '不得在未更新声明与文档的情况下改变状态。',
    );
    return 1;
  }
  console.log(
    `[signature] 全部 ${entries.length} 个产物签名状态与声明一致(${EXPECTED_SIGNATURE_STATUS});` +
      '未签名风险须随发布说明与 SHA-256 一并告知用户',
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
