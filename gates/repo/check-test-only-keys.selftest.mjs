// check-test-only-keys.mjs 的回归守护(负向夹具;纯函数自检,零文件变异)。
//
// 若门禁被改成「永远通过」、某条不变量的断言被误删、或 `parseProductionKeys` 的行首锚定
// 形态被改坏 ⇒ 本脚本会打印 `[ok]` 而没人察觉。此处逐条制造漂移(写回 / 幽灭 / 未登记 /
// 防空过),断言门禁以非零码拒绝,并断言正例(真仓库状态)恒绿。
//
// 形态:case 契约接入(`shared/case.js`),档名即 case 名,已登记于
// `check-test-layout.mjs#GATE_SELFTEST_CASE_SOURCES`(inline-case)。

import { assert, createCaseSuite } from '../../shared/case.js';
import { analyze } from './check-test-only-keys.mjs';

const suite = createCaseSuite();

/** 真仓库状态的骨架(A=O={headingNumbering, captionNumbering},P∩A=∅),规模极小、语义同真仓 */
const CLEAN_CONTEXT = `export const TEST_ONLY_CONTEXT_KEYS = ["headingNumbering", "captionNumbering"];
function buildConvertContext() {
  return {
    typography: {},
    headerFooter,
  };
}`;
const CLEAN_CONVERT = `export interface ConvertTestOverrides {
  headingNumbering?: boolean;
  captionNumbering?: boolean;
}`;

const GREEN = analyze({ contextText: CLEAN_CONTEXT, convertText: CLEAN_CONVERT });

/** 断言构造结果为红且点名 `needle`(构造载体是内存里的,若构造不出红即失败:防假绿) */
function assertRed(result, needle) {
  assert(result.problems.length > 0, `构造载体应判红(problems=0,防假绿): ${JSON.stringify(result.problems)}`);
  assert(
    result.problems.some((p) => p.includes(needle)),
    `应点名「${needle}」,实际 ${JSON.stringify(result.problems)}`,
  );
}

await suite.case('真仓库状态:A=O,P∩A=∅ → 恒绿', () => {
  assert(GREEN.problems.length === 0, JSON.stringify(GREEN.problems));
});

await suite.case('生产字面量写回围墙键 → 红', () => {
  assertRed(
    analyze({
      contextText: CLEAN_CONTEXT.replace('    typography: {},', '    typography: {},\n    headingNumbering: true,'),
      convertText: CLEAN_CONVERT,
    }),
    '生产映射写回了测试专用键「headingNumbering」',
  );
});

await suite.case('围墙登记了没在 ConvertTestOverrides 声明的幽灭项 → 红', () => {
  assertRed(
    analyze({
      contextText: CLEAN_CONTEXT.replace('["headingNumbering", "captionNumbering"]', '["headingNumbering", "captionNumbering", "foo"]'),
      convertText: CLEAN_CONVERT,
    }),
    '围墙集合登记了幽灭项「foo」',
  );
});

await suite.case('ConvertTestOverrides 声明了没登记的测试参 → 红', () => {
  assertRed(
    analyze({
      contextText: CLEAN_CONTEXT,
      convertText: CLEAN_CONVERT.replace('  captionNumbering?: boolean;', '  captionNumbering?: boolean;\n  foo?: boolean;'),
    }),
    'ConvertTestOverrides 声明了测试参「foo」但未在 TEST_ONLY_CONTEXT_KEYS 登记',
  );
});

await suite.case('解析塌缩(A 为空) → 防空过红', () => {
  assertRed(analyze({ contextText: 'export const TEST_ONLY_CONTEXT_KEYS = [];', convertText: CLEAN_CONVERT }), '防空过');
});

const cases = suite.results;
if (suite.failures.length > 0) {
  for (const failure of suite.failures) {
    console.error(`[check-test-only-keys-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(`[check-test-only-keys-selftest:fail] 围墙自检守护失败,共 ${suite.failures.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] check-test-only-keys-selftest:围墙自检守护5/5通过(正例 + 写回/幽灭/未登记/防空过)`);
