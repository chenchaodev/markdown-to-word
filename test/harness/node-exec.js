// @ts-check
/**
 * 「真 node 可执行文件」的解析 —— **全仓单一来源**。
 *
 * ## 为什么收口到本模块
 *
 * 本函数此前有 **4 份逐字相同的副本**(散在 `test/cli/options.test.js`、
 * `test/convert/run-headless.test.js`、`test/core/frontmatter-once.test.js`、
 * `test/gates/clean-artifacts-gate.test.js`、`test/gates/install-smoke.test.js`、
 * `test/renderer/version-chip.test.js`)。副本本身就是缺陷:「怎么找真 node」是**一条跨面
 * 契约**(退出码、temp 前缀、跨面行为都栽在「两处各写一遍」上),而 6 份里只要有一份被
 * 「顺手改一下」,两段就会用不同的 node 跑同一批夹具,且没有任何东西变红。
 *
 * 其中 `test/cli/pdf-launch.test.js` 曾直接 `import { resolveNode } from "./options.test.js"`
 * 来避免第 7 份 —— 但那是**段 import 段**,与 `check-test-layout.mjs` 的 L4
 * (`test-layer-self-hosted`)冲突:段是**发现与隔离的单位**(runner 逐段起子进程),
 * 段间 import 让「一段失败」不再可归因,且被 import 的那段会在自己的进程里再跑一遍
 * (双跑 + 顺序耦合)。本模块是那个「既单一来源、又非段」的落点。
 *
 * ## 为什么放在 `test/harness/`
 *
 * `test/harness/` 收测试框架自身与跨段共用助手(runner / assert / 夹具助手),
 * 是本仓唯一的「非段共享代码」位置。⚠ 本文件名**不得**以 `.test.js` 结尾 ——
 * 那会让它自己被 `test/harness/runner.js` 的段发现(逐目录 `readdir` 过滤
 * `.endsWith(".test.js")`)当成一个段,并触发 `check-test-layout.mjs` 的 L8
 * (`test-harness-not-segment`:harness 下不得有段文件)。
 *
 * ## 一处刻意的差异(不要顺手抹平)
 *
 * `test/gates/install-smoke.test.js` 的同名私有函数在候选链里**多一个
 * `process.env.NODE`**。那是该段自己的口径(它要尊重显式 `NODE=` 覆盖),本模块
 * 不含那一项 —— 抹平会改动 `install-smoke` 的实际行为,属另一个段的语义,不在本次收口范围。
 * 那一份仍留在该段内,未改为 import 本模块。
 */

/**
 * 解析**真 node** 可执行文件:验收入口跑在 Electron 里(`process.execPath` 是
 * `electron.exe`),故优先取 npm 注入的 `npm_node_execpath`,再退回按名找 `node`。
 *
 * 刻意不接受 `electron.exe` —— 用它就必须设 `ELECTRON_RUN_AS_NODE`,那就不是纯 node 了
 * (段要断言的「不经 electron」这条语义会静默失真)。
 *
 * @returns {string} 可直接 spawn 的 node 可执行文件路径
 */
export function resolveNode() {
  for (const candidate of [process.env.npm_node_execpath, process.execPath]) {
    if (candidate && /node(\.exe)?$/i.test(candidate)) return candidate;
  }
  return process.platform === "win32" ? "node.exe" : "node";
}