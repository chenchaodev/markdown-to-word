#!/usr/bin/env node
// @ts-check
/**
 * 发布链路的两条静态面判据(纯文本判定,无产物、幂等,exit 0/1)。
 *
 * 为什么需要它:`release.yml` 里「notes 怎么抽」的实现,其失效形态是**静默取到错的
 * 内容** —— 它只在 GitHub Release 页面出现,发布之前不可见。此前那段内联 `node -e`
 * 没有单测也没有静态面,于是「取第一个版本节」这种判据能长期存在:线上实测 3.16.2
 * 发布出去的是 3.16.1 的条目(见 REQ-145)。
 *
 * 两条判据:
 *   ① **抽取按版本号定位**:release.yml 必须调 `gates/repo/release-notes.mjs` 的
 *      `extractNotes(…, pkg.version)`,不得再内联自造正则。判据形态是「引用存在 +
 *      版本号作为实参出现」,两者缺一即判红。
 *   ② **notes 抽不到即失败**:release.yml 必须有「空 notes ⇒ exit 1」的分支,
 *      不得回退 `--generate-notes`(那是 commit 列表,指南已列为反模式),也不得
 *      静默发布空 notes。
 *
 * ① ② 都是**静态面**判据(读 workflow 文本),不是行为判据;行为由
 * `release-notes.selftest.mjs` 在链内实跑覆盖(9 条断言含 4 条负向)。两层都要:
 * 静态面答「发布时会不会用错实现」,自检答「那个实现本身对不对」。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../shared/paths.js';
import { isMainModule } from '../../shared/cli.mjs';

const RELEASE_YML = path.join(ROOT, '.github', 'workflows', 'release.yml');
const MODULE_REL = 'gates/repo/release-notes.mjs';

/**
 * 读取 release.yml。
 * @returns {string}
 */
function readReleaseYml() {
  try {
    return readFileSync(RELEASE_YML, 'utf8');
  } catch {
    return '';
  }
}

/**
 * 判据 ①②。
 *
 * ⚠ `problems` 必须是**函数内局部**的:写成模块级数组时,第二次调用会把上一次的诊断
 * 一并返回(累积),链内被调两次就假红。变异脚本第一次跑就撞出这个形态。
 * @returns {string[]} 问题列表(空数组 = 通过)
 */
export function checkReleaseNotesContract() {
  /** @type {string[]} */
  const problems = [];
  const text = readReleaseYml();
  if (text === '') {
    problems.push(`读不到 ${RELEASE_YML}(发版链路判据无法求值)`);
    return problems;
  }
  // 已抹注释再判定:注释里为说明「历史上长这样」而写的片段不是可执行依赖
  // (判红它只会逼人把注释改写得更含糊,同 check-import-boundary 的处理)。
  const code = text.replace(/^\s*#.*$/gm, '');

  // ---- 判据①:抽取必须走模块且按版本号定位 ----
  if (!code.includes(MODULE_REL)) {
    problems.push(`判红:release.yml 未引用 ${MODULE_REL}(notes 抽取逻辑必须单源,不得内联自造)`);
  }
  if (!/extractNotes\s*\(/.test(code)) {
    problems.push('判红:release.yml 未调用 extractNotes(抽取实现必须来自该模块)');
  }
  if (!/\bpkg\.version\b/.test(code)) {
    problems.push('判红:release.yml 未把 pkg.version 作为版本号传入(按「第一个版本节」抽会取到上一版)');
  }

  // ---- 判据②:空 notes 必须失败,不得回退 commit 列表 ----
  if (/--generate-notes/.test(code)) {
    problems.push('判红:release.yml 仍回退 --generate-notes(那是 commit 列表,已列为反模式;空 notes 应响亮失败)');
  }
  // 「判红条件与 exit 同在一个 if 块内」是判据②的全部事实。写成两个独立 if(一个查
  // guard 存在、一个查 exit 1 出现过)会在 guard 被整块删除时**双双失效** —— 实测过:
  // 删掉整个 `if [ -z "$NOTES" ] … fi` 块后两个 if 都落空,判据却报绿。
  const guard = /if\s*\[\s*-z\s+"\$NOTES"\s*\][\s\S]*?exit\s+1[\s\S]*?fi/.exec(code);
  if (guard === null) {
    problems.push('判红:release.yml 未把「NOTES 为空 ⇒ exit 1」写在同一个 if 块内(缺该分支时抽不到条目会静默发布空 notes)');
  }
  return problems;
}

export function main() {
  const found = checkReleaseNotesContract();
  if (found.length > 0) {
    for (const p of found) console.error(`[release-notes:fail] ${p}`);
    return 1;
  }
  console.log('[ok] release-notes 判据通过:release.yml 的 notes 抽取走单源模块且按 pkg.version 定位;空 notes 响亮失败,不回退 commit 列表');
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main();
}