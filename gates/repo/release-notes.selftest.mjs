// @ts-check
/**
 * Release notes 抽取器的自检(验证判据本身会判红,不是跑一遍就算)。
 *
 * 收录判据(ADR-039):门禁自检缺不缺用**两条可 grep 的事实**判,不用主观归属 ——
 * 本文件的存在理由是 extractNotes 的失效形态是**静默取到错的内容**,而错内容在
 * 发布之前不可见(它只在 GitHub Release 页面出现),故必须能在链内证伪。
 *
 * 覆盖两侧:
 *   正向 —— 版本号逐字命中时取到该节正文;`###` 子标题留在正文内
 *   负向 —— ① 本次版本节缺失时**不得**回退到上一版(这正是线上缺陷的形态)
 *          ② `[待发版]` 不是版本节,不被任何版本号命中
 *          ③ `3.16.2` 不得误匹配 `3.16.20`
 *          ④ 节存在但正文为空 → hasSection 真、body 空(与「节不存在」区分)
 *          ⑤ 版本节末尾的下一个 `## ` 正确截断,不吞掉下一版
 *
 * ---- 形态:case 契约接入,但**不接 harness**(ADR-074)----
 *
 * 用 `shared/case.js` 的 `createCaseSuite`,每条断言收进一个 `suite.case`(gates 树接的是
 * ADR-074 决定一落在 shared/ 的真实现:门禁树引不到 `test/harness/case.js`)。
 * **不用合成根 harness**:本文件零临时目录、零 spawn,判定体直接 import 且入参是**字符串**
 * (md 正文 + 版本号),而 harness 的表只收「树型路径 → 正文 + 问题清单正则」且判定体须回吐
 * **问题清单** —— 入参与返回两侧都不对型,塞进去是假接入(ADR-068:bespoke 留在原处)。
 *
 * case 名的取法:原实现是裸 `assert` 累加计数器、没有用例名,故名字取自每条断言**上方那句
 * `// ---- <分组> ----` 分组注的前缀 + 该条失败消息的领起子句** —— 分组注本来就是这份自检
 * 自己的「用例名册」,断言消息本来就是这条断言在讲什么,两者都不新造措辞。
 */
import { assert, createCaseSuite } from '../../shared/case.js';
import { extractNotes, inspectReleaseNotes } from './release-notes.mjs';

/** CHANGELOG 夹具:形态取自真实文件的三种关键状态 */
const MD = [
  '## [待发版]',
  '',
  '## [3.16.2] - 2026-10-02',
  '',
  '本次发布不含功能变更，应用的界面与导出结果与上一版一致。',
  '',
  '## [3.16.1] - 2026-10-01',
  '',
  '### 修复',
  '',
  '- 修复了一些问题。',
  '',
  '## [3.16.20] - 2026-10-03',
  '',
  '### 改进',
  '',
  '- 另一个版本的内容。',
  '',
].join('\n');

const suite = createCaseSuite();

// ---- 正向:逐字命中取到该节正文 ----
await suite.case('正向:3.16.2 逐字命中应取到本节正文', () => {
  assert(
    extractNotes(MD, '3.16.2') === '本次发布不含功能变更，应用的界面与导出结果与上一版一致。',
    `3.16.2 应取到本节正文,实际:${JSON.stringify(extractNotes(MD, '3.16.2'))}`,
  );
});

// ---- 负向①:本次版本节缺失时不得回退到上一版(线上缺陷形态) ----
await suite.case('负向①:缺失版本必须返回空串而不是上一版内容', () => {
  assert(
    extractNotes(MD, '3.17.0') === '',
    `缺失版本必须返回空串而不是上一版内容,实际:${JSON.stringify(extractNotes(MD, '3.17.0'))}`,
  );
});

// ---- 负向②:`[待发版]` 不是版本节,任何版本号都命中不到它 ----
await suite.case('负向②:`[待发版]` 不该被当作版本节命中', () => {
  assert(
    extractNotes(MD, '待发版') === '',
    '`[待发版]` 不该被当作版本节命中',
  );
});
await suite.case('负向②:`[待发版]` 不该被 inspectReleaseNotes 认作版本节', () => {
  assert(
    !inspectReleaseNotes(MD, '待发版').hasSection,
    '`[待发版]` 不该被 inspectReleaseNotes 认作版本节',
  );
});

// ---- 负向③:不得误匹配前缀相同的更长版本号 ----
await suite.case('负向③:3.16.2 与 3.16.20 必须取到各自的节', () => {
  assert(
    extractNotes(MD, '3.16.2') !== extractNotes(MD, '3.16.20'),
    '3.16.2 与 3.16.20 必须取到各自的节',
  );
});
await suite.case('负向③:3.16.20 应取到自己的节', () => {
  assert(
    extractNotes(MD, '3.16.20') === '### 改进\n\n- 另一个版本的内容。',
    `3.16.20 应取到自己的节,实际:${JSON.stringify(extractNotes(MD, '3.16.20'))}`,
  );
});

// ---- 负向④:节存在但正文为空 → hasSection 真、body 空(与「节不存在」区分) ----
const EMPTY_MD = ['## [4.0.0] - 2026-11-01', '', '## [3.9.0] - 2026-10-01', '', '### 修复', '', '- 旧内容。', ''].join('\n');
await suite.case('负向④:空节仍应算「节存在」', () => {
  const r = inspectReleaseNotes(EMPTY_MD, '4.0.0');
  assert(r.hasSection, '空节仍应算「节存在」');
});
await suite.case('负向④:空节 body 应为空', () => {
  const r = inspectReleaseNotes(EMPTY_MD, '4.0.0');
  assert(r.body === '', `空节 body 应为空,实际:${JSON.stringify(r.body)}`);
});
await suite.case('负向④:不存在的版本 hasSection 应为假', () => {
  const missing = inspectReleaseNotes(EMPTY_MD, '4.0.1');
  assert(!missing.hasSection, '不存在的版本 hasSection 应为假');
});
await suite.case('负向④:不存在的版本 body 应为空', () => {
  const missing = inspectReleaseNotes(EMPTY_MD, '4.0.1');
  assert(missing.body === '', '不存在的版本 body 应为空');
});

// ---- 负向⑤:下一个 `## ` 正确截断,不吞掉下一版 ----
await suite.case('负向⑤:3.16.1 的正文不得吞进 3.16.20 的内容', () => {
  assert(
    !extractNotes(MD, '3.16.1').includes('另一个版本'),
    '3.16.1 的正文不得吞进 3.16.20 的内容',
  );
});

// ---- 输入边界:非字符串 / 空串 ----
await suite.case('输入边界:空 CHANGELOG 应返回空串', () => {
  assert(extractNotes('', '3.16.2') === '', '空 CHANGELOG 应返回空串');
});
await suite.case('输入边界:空版本号应返回空串', () => {
  assert(extractNotes(MD, '') === '', '空版本号应返回空串');
});
await suite.case('输入边界:版本号带 v 前缀不该被命中(调用方负责剥前缀)', () => {
  assert(extractNotes(MD, 'v3.16.2') === '', '版本号带 v 前缀不该被命中(调用方负责剥前缀)');
});

// ---- 收口:段级成败按 case 结果判(与旧实现的 failed 计数等价:任一 case 失败即非零退出) ----
// 失败文案逐条点名是哪个 case(旧实现只有消息、没有名字),否则「十几条断言里哪条红了」无从读起。
const cases = suite.results;
const failures = suite.failures;
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[fail] release-notes-selftest:${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(
    `[fail] release-notes-selftest: ${String(failures.length)}/${String(cases.length)} 条断言失败`,
  );
  process.exit(1);
}
console.log(`[ok] release-notes-selftest:${String(cases.length)} 条断言通过(正向取到本节 / 缺失不回退上一版 / 待发版非版本节 / 版本号前缀不误匹配 / 空节与缺节可区分 / 截断正确)`);

// ---- 变异测试:证明静态面判据自己不会恒绿 ----
// 刻意由本文件 import 调起(而不是给变异脚本单开一条 npm script):链上「一个 script 串
// 两个载体」的形态不被门禁注册表判据接受,而变异脚本与行为自检本就是一件事的两面 ——
// 变异脚本改坏 release.yml 后,静态面判据必须真判红,才说明静态面那五条不是摆设。
const { runMutationTest } = await import('./release-notes.mutation-test.mjs');
const mutated = runMutationTest();
if (mutated > 0) {
  // 这里**不能**替逐项原因下结论:失败项可能是「变异脚本与 release.yml 不同步」,
  // 也可能是「判据恒绿」,两者排查方向相反。逐项 [fail] 行已各自点名该查哪一侧,
  // 本行只负责汇总并指路 —— 上一次 CI 恒红时,本行无条件断言「判据可能恒绿」,
  // 把排查从真正的原因引到了另一侧。
  console.error(`[fail] release-notes-selftest:变异测试 ${mutated} 项未达预期(逐项原因见上方 [fail] 行:「变异未生效」查变异脚本的匹配模式,「已写入但判据未判红」查 check-release-notes.mjs)`);
  process.exit(1);
}
console.log('[ok] release-notes-selftest:变异测试通过(五条静态面判据逐条改坏均真判红)');