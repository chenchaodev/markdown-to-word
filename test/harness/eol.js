// @ts-check
/**
 * 文本行尾(EOL)归一 —— 测试树内的单一来源。
 *
 * ## 为什么收口到本模块
 *
 * 检出态的行尾由各端 `autocrlf` 决定(`.gitattributes` 首部裁决:入库统一 LF、检出交由各端),
 * 而本仓有判据**读源码文本再用字面量 `\n` 匹配**。这类判据在 CRLF 检出下会一条都匹配不上,
 * 抽出空表/空集,于是以「与本次改动无关」的行数红或恒绿挂掉 —— 与被测行为毫无关系。
 *
 * 与 `node-exec.js` 同款的形状:「行尾是什么」是一条**跨段契约**(每个读文本的段都要面对它),
 * 各段各写一遍 `.replace(/\r\n/g, "\n")` 就是下一次漂移的起点。
 *
 * ## 为什么放在 `test/harness/`
 *
 * `test/harness/` 收测试框架自身与跨段共用助手,是本仓唯一的「非段共享代码」位置。
 * ⚠ 本文件名**不得**以 `.test.js` 结尾 —— 那会让它被 `test/harness/runner.js` 的段发现
 * (逐目录 `readdir` 过滤 `.endsWith(".test.js")`)当成一个段,并触发 `check-test-layout.mjs`
 * 的 L8(`test-harness-not-segment`)。同 `node-exec.js`。
 *
 * ## 为什么不放 `shared/`
 *
 * 门禁 L5(`test-layer-cross-import`)按**层语义**判:`test/harness/` 是自指层,
 * 它的段只许引本层(`test/harness/**`)与 `node:*`(ADR-062 L5 给它的允许清单不含 `shared/`);
 * `shared/**` 对它是别层主体。跨层引共享机制层必须逐条登记豁免,而豁免表的 26 条里
 * `test/harness/` 段**零条** —— 在从未破例的层开首例不合适。层内助手是零豁免的正路。
 *
 * ⚠ 与 `gates/**` 的关系:那边 `gates/fixtures/gen-fixtures.mjs`、
 * `gates/repo/gen-archive-index.mjs` 各自有一份私有归一,属**另一棵树**的收口(后续任务),
 * 本模块不覆盖它们 —— 两棵树之间的这份重复是结构性的,不是漏收口。
 */

/**
 * 文本 EOL 归一(CRLF → LF):只放过**纯行尾差异**,内容差异一字不动。
 *
 * 归一放在**读入侧**:调用方的判据表达式一个字都不用动(不必逐处把 `\n` 写成 `\r?\n`),
 * 且此处**不落盘** —— 没有写回,就没有「按原文件折行还原」那套义务。
 *
 * 边界:只做 `\r\n` → `\n`,不碰单独的 `\r`(老 Mac 折行);也不做任何内容级改写 ——
 * 它的作用是让判据**对行尾不变**,不是让它对内容宽容。
 * @param {string} text 原文
 * @returns {string} 行尾全为 LF 的文本
 */
export function normalizeEol(text) {
  return text.replace(/\r\n/g, "\n");
}