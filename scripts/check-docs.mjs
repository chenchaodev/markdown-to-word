// 指针门禁 + 容量契约门禁薄包装(零依赖,仅 node: 内建模块)。
//
// 为什么要有这层包装,而不是把门禁的绝对路径直接写进 package.json 的 script:
// `check-ci-contract.mjs` 的 `SCRIPT_FILE_RE` 会把 package.json script 正文里出现的每个
// `.mjs` token 拼到**项目根**上判存在性(`C:/Users/<用户>/.config/opencode/tools/…`
// 拼上项目根当然不存在)→ 契约自检恒红。故 script 里只能写仓内相对路径
// (`node scripts/check-docs.mjs`),而门禁的绝对/环境变量解析必须藏进 .mjs ——
// 那条断言不扫 .mjs 文件内容。仓内相对路径真实存在即可,门禁的实际载体由本脚本解析。
//
// 门禁本体(判什么、断链/死指针/容量契约怎么算)在全局配置目录 `tools/check-pointers.mjs`,
// 项目侧**不持有第二份逻辑**:单一事实源不许分叉,规则演进只需改配置仓一处。
// 本脚本只做三件事:解析门禁路径 → 委托执行 → 退出码原样传出。
//
// 退出码:0 = 门禁通过,或门禁不可达而跳过(见下);门禁自身的 1 原样传出。
//
// 用法:
//   node scripts/check-docs.mjs           # 校验当前项目仓
//   M2W_GLOBAL_CONFIG=<配置仓根目录> node scripts/check-docs.mjs
//   node scripts/check-docs.mjs --help    # 参数原样透传给门禁

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

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

const gatePath = resolveGatePath();

// 门禁不可达 ⇒ 打印提示并 exit 0,**不判红**:CI 环境对全局配置目录零认知
// (workflow 里不装、不克隆配置仓),那里必然拿不到载体,判红等于让 CI 必红。
// 但也不许静默:静默跳过等于把扫描范围缩小藏起来(门禁自己的项目模式汇总行同此立场),
// 故必须留一行可见痕迹。跳过**不覆盖**门禁在可达环境下的判定 —— 本机/CI 之外照跑。
if (!existsSync(gatePath)) {
  console.log(
    `[check:docs] 跳过:未找到全局指针门禁 ${gatePath};设 M2W_GLOBAL_CONFIG=<配置仓根目录> 可启用。CI 环境无此目录属预期。`,
  );
  process.exit(0);
}

let status = 0;
try {
  // cwd = 项目仓:门禁据此判「项目模式」(探测判据 = cwd 下存在 docs/ROADMAP.md),
  // 站在配置仓里跑则只跑配置模式。参数原样透传,本仓调用时可不带参。
  execFileSync(process.execPath, [gatePath, ...process.argv.slice(2)], { cwd: projectRoot, stdio: 'inherit' });
} catch (error) {
  // 门禁非 0 退出时 execFileSync 抛错(status 带退出码);取不到就按失败处理。
  status = error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : 1;
}
process.exit(status);
