// @ts-check
/**
 * Release notes 静态面判据的**变异测试**:逐条改坏被守护对象(release.yml),证明
 * check-release-notes.mjs 的每条判据都会真判红,而不是恒绿。
 *
 * 为什么需要它:静态面判据的失效形态与夹具断言同型 —— 「目标被整块删除时判据落空」
 * 会让判据**报绿**。正向跑一次证明不了这一点,只有改坏目标才证明得了。
 * 本轮实施时正是这样撞出两个判据缺陷(判据②被写成两个独立 if,整块删除后双双失效;
 * problems 写成模块级数组导致诊断累积),两者都只在本脚本下暴露。
 *
 * 为什么由 release-notes.selftest.mjs import 调起、而不是单开一条 npm script:
 * 链上「一条 script 串两个载体」的形态不被门禁注册表判据接受(它要求每个载体文件都被
 * 登记为某道门禁的探针,而一个 script 名只能映射一个载体)。变异脚本与行为自检本是
 * 一件事的两面,合并入口比拆分更贴合。
 *
 * 直接运行本文件也可以(便于单独调试),但链内入口是 selftest。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule } from '../../shared/cli.mjs';
import { checkReleaseNotesContract } from './check-release-notes.mjs';

const TARGET = '.github/workflows/release.yml';

/** @type {{ name: string, mutate: (t: string) => string }[]} */
const MUTATIONS = [
  {
    name: '① 重新引入 --generate-notes 回退',
    mutate: (t) => t.replace('--notes "$NOTES"', '--notes "$NOTES" --generate-notes'),
  },
  {
    name: '② 整块删掉「空 NOTES ⇒ exit 1」分支',
    mutate: (t) => t.replace(/ *if \[ -z "\$NOTES" \]; then[\s\S]*?exit 1\s*\n\s*fi\n/, ''),
  },
  {
    name: '③ 去掉 pkg.version 实参(退回取第一个版本节)',
    mutate: (t) => t.replace(', pkg.version)', ')'),
  },
  {
    name: '④ 去掉对抽取模块的引用(退回内联自造)',
    // 必须全局替换:注释行里也出现该路径,只替换首个匹配删掉的是注释,判据仍绿。
    mutate: (t) => t.replace(/.*release-notes\.mjs.*\n/g, ''),
  },
  {
    name: '⑤ 去掉 extractNotes 调用',
    mutate: (t) => t.replace(/extractNotes\(/, 'extractNotesX('),
  },
];

/**
 * 跑一轮变异,每个都改坏 release.yml 后调判据,再写回。
 * @returns {number} 未达预期的项数(0 = 全部变异都被判红)
 */
export function runMutationTest() {
  const original = readFileSync(TARGET, 'utf8');
  let bad = 0;
  for (const m of MUTATIONS) {
    const mutated = m.mutate(original);
    if (mutated === original) {
      bad += 1;
      console.error(`[fail] 变异未生效(字符串没匹配上):${m.name}`);
      continue;
    }
    writeFileSync(TARGET, mutated, 'utf8');
    const problems = checkReleaseNotesContract();
    writeFileSync(TARGET, original, 'utf8');
    if (problems.length === 0) {
      bad += 1;
      console.error(`[fail] 变异未被判红:${m.name}`);
    } else {
      console.log(`[ok] ${m.name} → 判红 ${problems.length} 条`);
      for (const p of problems) console.log(`       ${p}`);
    }
  }
  // 恢复后必须绿(证明上面每次都真的写回过)
  const after = checkReleaseNotesContract();
  if (after.length > 0) {
    bad += 1;
    console.error(`[fail] 恢复后仍判红:${after.join(' | ')}`);
  } else {
    console.log('[ok] 恢复后判据通过');
  }
  return bad;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runMutationTest() === 0 ? 0 : 1;
}