// 指针门禁 + 容量契约门禁薄包装(零依赖,仅 node: 内建模块)。
//
// 为什么要有这层包装,而不是把门禁的绝对路径直接写进 package.json 的 script:
// `check-ci-contract.mjs` 的 `SCRIPT_FILE_RE` 会把 package.json script 正文里出现的每个
// `.mjs` token 拼到**项目根**上判存在性(`C:/Users/<用户>/.config/opencode/tools/…`
// 拼上项目根当然不存在)→ 契约自检恒红。故 script 里只能写仓内相对路径
// (`node gates/repo/check-docs.mjs`),而门禁的绝对/环境变量解析必须藏进 .mjs ——
// 那条断言不扫 .mjs 文件内容。仓内相对路径真实存在即可,门禁的实际载体由本脚本解析。
//
// 门禁本体(判什么、断链/死指针/容量契约怎么算)在全局配置目录 `tools/check-pointers.mjs`,
// 项目侧**不持有第二份逻辑**:单一事实源不许分叉,规则演进只需改配置仓一处。
// 本脚本只做三件事:解析门禁路径 → 委托执行 → 退出码原样传出。
//
// **本检查是本地检查,刻意不在 `verify:ci` 链里**(2026-09-27 起)。理由:门禁载体在
// 全局配置目录,而 CI workflow 不装也不克隆该目录 ⇒ 在 CI 里必然走下面的「不可达」分支,
// 恒 `exit 0`。留在链上等于给「文档正在被 CI 检查」的假象,实则从未校验过任何东西。
// 保留本脚本是因为它**本地确实抓过真问题**(断链、失效小节名指针、已废指针),
// 成本约 1 秒。请在提交前手动跑 `npm run check:docs`。
//
// 退出码:0 = 门禁通过,或门禁不可达而跳过(见下);门禁自身的 1 原样传出。
//
// 用法:
//   node gates/repo/check-docs.mjs           # 校验当前项目仓
//   M2W_GLOBAL_CONFIG=<配置仓根目录> node gates/repo/check-docs.mjs
//   node gates/repo/check-docs.mjs --help    # 参数原样透传给门禁

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;

/**
 * 门禁路径解析:`M2W_GLOBAL_CONFIG` 指向**配置仓根目录**(不是门禁文件本身),
 * 未设置时回退到约定位置 `~/.config/opencode`。
 * @returns {string} 门禁脚本绝对路径
 */
function resolveGatePath() {
  const configured = process.env.M2W_GLOBAL_CONFIG?.trim();
  const configRoot = configured === undefined || configured === '' ? path.join(os.homedir(), '.config', 'opencode') : configured;
  return path.join(configRoot, 'tools', 'check-pointers.mjs');
}

// 门禁不可达 ⇒ 打印提示并 exit 0,**不判红**:本检查已不在 CI 链里(见头部说明),
// 判红只会挡住本地提交,不提供任何保护。但也不许静默 —— 静默跳过的真实含义是
// 「你以为文档被查过了,其实没有」,那正是这道检查最没用的失败形态。
// 故必须留一行显眼痕迹。载体路径不对时用 M2W_GLOBAL_CONFIG=<配置仓根目录> 指定。
/**
 * CLI 主体(判定体 = 委托执行全局指针门禁并原样传出退出码;本函数只做解析与呈现)。
 *
 * 导出成 `main(argv) -> number` 而不是顶层 `process.exit`,是为了让门禁注册表
 * (gates/probe/gate-probes/registry.mjs)能把它登记为判定本体指针并静态核对 ——
 * 进程级 CLI 与其它驱动器消费的是同一个入口。
 * @param {string[]} [argv] 透传给全局门禁的参数(本仓调用时可不带参)
 * @returns {number} 退出码(0 = 通过,或载体不可达而跳过)
 */
export function main(argv = []) {
  const gatePath = resolveGatePath();
  // 载体不可达 ⇒ 打印提示并返回 0,**不判红**:本检查已不在 CI 链里(见头部说明),
  // 判红只会挡住本地提交,不提供任何保护。但也不许静默 —— 静默跳过的真实含义是
  // 「你以为文档被查过了,其实没有」,那正是这道检查最没用的失败形态。
  // 故必须留一行显眼痕迹。载体路径不对时用 M2W_GLOBAL_CONFIG=<配置仓根目录> 指定。
  if (!existsSync(gatePath)) {
    console.log(
      `[check:docs] 跳过:未找到全局指针门禁 ${gatePath};设 M2W_GLOBAL_CONFIG=<配置仓根目录> 可启用。CI 环境无此目录属预期。`,
    );
    // 判别式改为**两种情形都输出「门禁结论」**,用「已判定 / 未判定」区分(2026-09-30,REQ-097)。
    // 原先是「载体可达时必含该四字」的**单向**判别式,而本行走的是跳过分支 —— 两端不对称闭合,
    // 自动化消费者必须特判那句中文跳过文本,才知道「本轮一个指针都没查」。
    // 退出码不变(两情形都是 0),纯增量 stdout,不命中涉架构任一条。
    console.log(`门禁结论:未判定 | 跳过(载体不可达) | 模式:配置 | 载体:${gatePath} | 覆盖:无(本轮一个指针都没查)`);
    return 0;
  }

  try {
    // cwd = 项目仓:门禁据此判「项目模式」(探测判据 = cwd 下存在 docs/REQ.md),
    // 站在配置仓里跑则只跑配置模式。参数原样透传,本仓调用时可不带参。
    execFileSync(process.execPath, [gatePath, ...argv], { cwd: projectRoot, stdio: 'inherit' });
    return 0;
  } catch (error) {
    // 门禁非 0 退出时 execFileSync 抛错(status 带退出码);取不到就按失败处理。
    return error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 1;
  }
}

process.exitCode = main(process.argv.slice(2));
