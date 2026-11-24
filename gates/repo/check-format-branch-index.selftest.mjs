// check-format-branch-index.mjs 的负向载体(L11 载体;fixture 构造,全在 tmpdir,零文件变异)。
//
// 若门禁被改成「永远通过」、EXPECTED 常量被批量修改、scan 谓词被破坏(如把 pdf 改 docx 绿) ——
// 本脚本会打印 [ok] 而没人察觉。此处逐条制造漂移,断言门禁以非零码拒绝,并断言真仓库绿。
//
// 形态:case 契约接入(shared/case.js)。CASES 表 + 档名即 case 名,登记于
// check-test-layout.mjs#GATE_SELFTEST_CASE_SOURCES(table-field CASES.name)。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assert, createCaseSuite } from '../../shared/case.js';
import { ROOT } from '../../shared/paths.js';
import { analyze, EXPECTED_FORMAT_BRANCHES } from './check-format-branch-index.mjs';

const suite = createCaseSuite();
const REAL_SRC = path.join(ROOT, 'src');

/** 造 N 个文件,每个出一个 `format === "pdf"` 实现分支点(fixture 即「索引声称」的体现) */
function createFixture(count) {
  const dir = mkdtempSync(path.join(tmpdir(), 'm2w-format-branch-index-selftest-'));
  const src = path.join(dir, 'src');
  mkdirSync(src, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    writeFileSync(path.join(src, `part-${i}.ts`), `export const f${i} = () => { if (format === "pdf") return 1; };\n`, 'utf8');
  }
  return dir;
}

const CASES = [
  {
    name: '真仓库当前未漂移 → 通过',
    run: () => {
      const result = analyze({ srcRoot: REAL_SRC });
      assert(result.problems.length === 0, JSON.stringify(result.problems));
    },
  },
  {
    name: '夹具分支齐全(7) → 通过',
    run: () => {
      const dir = createFixture(EXPECTED_FORMAT_BRANCHES);
      try {
        const result = analyze({ srcRoot: path.join(dir, 'src') });
        assert(result.problems.length === 0, JSON.stringify(result.problems));
        assert(result.hits.length === EXPECTED_FORMAT_BRANCHES, `hits 应为 ${EXPECTED_FORMAT_BRANCHES},实际 ${result.hits.length}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: '夹具缺一个分支(6) → 红',
    run: () => {
      const dir = createFixture(EXPECTED_FORMAT_BRANCHES - 1);
      try {
        const result = analyze({ srcRoot: path.join(dir, 'src') });
        assert(result.problems.length > 0, '缺一个分支应判红(problems=0,防假绿)');
        assert(result.problems.some((p) => p.includes('应为')), `应点名缺口,实际 ${JSON.stringify(result.problems)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

for (const c of CASES) {
  await suite.case(c.name, c.run);
}

const cases = suite.results;
if (suite.failures.length > 0) {
  for (const failure of suite.failures) {
    console.error(`[check-format-branch-index-selftest:fail] ${failure.name}:${failure.message ?? '(无失败消息)'}`);
  }
  console.error(`[check-format-branch-index-selftest:fail] 格式分支索引门禁回归守护失败,共 ${suite.failures.length}/${cases.length} 条`);
  process.exit(1);
}
console.log(`[ok] check-format-branch-index-selftest:分支索引自检守护 ${cases.length}/${cases.length} 通过(真仓库绿 + 夹具齐全 + 夹具缺一)`);
