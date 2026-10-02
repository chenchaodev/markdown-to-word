// 文档指针门禁的**入口**(判定本体在本仓 `gates/repo/check-pointers.mjs`,本文件只做转出 + 守卫)。
//
// ---- 为什么还留着这一层 ----
// ① 门禁注册表(`gates/probe/gate-probes/registry.mjs`)把 `judgment.module` 指向**本文件**,
//    `judgment.export` 指向 `main`。路径不变 ⇒ 注册表、两条以本文件为合成主体的负向夹仓
//    (沙盒探针与验收段各一条)都不必改。
// ② `check-ci-contract.mjs` 的 `SCRIPT_FILE_RE` 会把 package.json script 正文里出现的每个
//    `.mjs` token 拼到**项目根**上判存在性 ⇒ script 里只能写仓内相对路径
//    (`node gates/repo/check-docs.mjs`)。这条断言不扫 `.mjs` 文件内容,故「门禁本体是哪一个文件」
//    必须藏进 `.mjs` —— 就是本文件。
//
// ---- 判定本体的出处与「判据从此两份」(这是本仓自己欠的义务) ----
// 判定本体的内容**逐字搬自**全局配置目录 `tools/check-pointers.mjs`,基线 commit `72f072a`
// (sha256 `4a82b448…d46e3c0b`),并按本仓 `docs/adr/ADR-054-配置仓与项目仓门禁拆分本仓落地.md`
// 决定一裁掉了配置仓独占的那部分(只留项目模式)。
//
// ⚠️ **本仓不持有「唯一一份逻辑」这句话在拆分后已经不成事实** —— 拆分前本文件头写的是
// 「项目侧不持有第二份逻辑:单一事实源不许分叉,规则演进只需改配置仓一处」,而那正是 ADR-054
// 决定一要推翻的现状(它导致任何 Fork 出去的 PR 文档指针零覆盖而门禁报成功)。
// 拆分后的真相是:**判据从此两份,规则演进要改两处**(全局配置目录那份仍判它自己那侧)。
// 这是本仓自己欠的义务,不是上游的。无机器对读(那需要跨仓可达性,ADR-016 备选方案 3 已否决),
// 唯一对冲是本体文件头记录的基线 commit 与删除清单,供人工重核。
//
// 用法:
//   node gates/repo/check-docs.mjs
//
// 退出码:0 = 判定通过;1 = 有错(逐条诊断与覆盖度自报打在 stdout,诊断正文由本体产出)。

import path from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { main as judgmentMain } from './check-pointers.mjs';

const projectRoot = ROOT;

/**
 * 判定本体入口(转出,本层不持有任何判据)。
 *
 * 导出成 `main() -> number` 而不是顶层 `process.exit`,是为了让门禁注册表能把它登记为判定本体
 * 指针并**真 import** 解析 —— 进程级 CLI 与其它驱动器消费的是同一个入口,判定只有一份。
 *
 * 静态 import 本体是安全的:本体的模块级代码**只做常量与函数声明**(扫描根取
 * `resolve(process.cwd())`,不读盘、不打印、不写宿主退出码),副作用一律在它自己的 `main()` 里。
 *
 * 刻意**不接收也不转发任何参数**:本体不接受模式开关 / 环境变量 / `--root`
 * (「能随时关掉的判据等于给橡皮章留后门」;扫描根恒为 `process.cwd()`)。
 * @returns {number} 退出码(0 = 全过,1 = 有错)
 */
export function main() {
  return judgmentMain();
}

// 入口守卫:仅当本文件**就是被执行的入口**时才跑 CLI。写法与
// gates/probe/gate-probes/coverage-gate.mjs 同形(全仓先例),不另创写法。
//
// 为什么必须有守卫(不是「整洁」问题,是危险):验收段跑在 **Electron** 里,顶层自执行会在
// import 本模块的那一刻把整套台账判定跑一遍,并顺手改掉宿主进程的 `process.exitCode`。
// 守卫之后本模块可被安全 import,注册表因此能登记它并真 import 出判定函数。
//
// ⚠️ `process.exitCode = main()` 那行**必须保持缩进**(判定本体注册表的顶层自执行探测是行首
// 锚定正则 `^process\.exitCode\s*=`;顶格写会被判成「顶层自执行」而与「可安全 import」的声明矛盾)。
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.join(projectRoot, 'gates', 'repo', 'check-docs.mjs')) {
  process.exitCode = main();
}