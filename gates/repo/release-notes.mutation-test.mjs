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
    // 行尾必须写成 EOL 无关:ci job 跑在 Windows runner 上(core.autocrlf=true),
    // 检出的 release.yml 是 CRLF,字面 \n 匹配不上会让本条变异「未生效」而恒红。
    // 只加 \r?,不加 \s* —— 后者会跨空行把不该删的块一起吞掉,变异就失去意义。
    mutate: (t) => t.replace(/ *if \[ -z "\$NOTES" \]; then[\s\S]*?exit 1\s*\r?\n\s*fi\r?\n/, ''),
  },
  {
    name: '③ 去掉 pkg.version 实参(退回取第一个版本节)',
    mutate: (t) => t.replace(', pkg.version)', ')'),
  },
  {
    name: '④ 去掉对抽取模块的引用(退回内联自造)',
    // 必须全局替换:注释行里也出现该路径,只替换首个匹配删掉的是注释,判据仍绿。
    // 行尾必须写成 EOL 无关:ci job 跑在 Windows runner 上(core.autocrlf=true),
    // 检出的 release.yml 是 CRLF,字面 \n 匹配不上会让本条变异「未生效」而恒红。
    mutate: (t) => t.replace(/.*release-notes\.mjs.*\r?\n/g, ''),
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
    // 下面两条 [fail] 的排查方向**相反**,措辞必须各自点名要查哪一侧:
    //   · 目标串没匹配上 → 本脚本的匹配模式与 release.yml 不同步(查 MUTATIONS);
    //   · 已改坏却没判红 → 判据失效(查 check-release-notes.mjs)。
    // 二者原共用同一句「变异未生效/未被判红」,读者在 CI 输出里无从分辨,只能回去
    // 比对 MUTATIONS 表 —— 上一次 CI 恒红命中的是前者,却被顺着文案读成「静态面
    // 判据恒绿」,把排查引到了错误的一侧。
    if (mutated === original) {
      bad += 1;
      console.error(`[fail] 变异未生效:脚本与目标文件不同步,MUTATIONS 的目标串没匹配上 → 查本脚本:${m.name}`);
      continue;
    }
    writeFileSync(TARGET, mutated, 'utf8');
    // 还原必须挂在 finally 上:判据函数一旦抛错,写在它下面的写回就不会执行,
    // release.yml 会被**永久**留在被改坏的状态。而这一污染是**静默**的 —— 本轮跑
    // 完退出码非零、CI 报错,没人知道工作树脏了,下次 git status 只看到该文件有
    // 一条 diff,极易被当成有意改动一并提交进仓。
    // try 起点紧贴「已写坏」这一步:本函数开头的 readFileSync 若抛错(TARGET 不存在),
    // 此时还没动过工作树,无需也不该还原,故不把它圈进 try。
    /** @type {string[]} */
    let problems = [];
    try {
      problems = checkReleaseNotesContract();
    } finally {
      writeFileSync(TARGET, original, 'utf8');
    }
    if (problems.length === 0) {
      bad += 1;
      console.error(`[fail] 变异已被写入但判据未判红 → 查 check-release-notes.mjs(不是本脚本的问题):${m.name}`);
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