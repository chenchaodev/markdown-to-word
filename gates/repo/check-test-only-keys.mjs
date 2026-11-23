// 生产映射不得写回测试专用键(REQ-280)。
//
// 为什么这道门禁:测试专用参数设计由三处互锁声明 —— `src/core/convert.ts` 的
// `ConvertTestOverrides`(第 4 参)、`src/convert/context.ts` 的 `TEST_ONLY_CONTEXT_KEYS`
// 围墙、`buildConvertContext` 的生产字面量。这些互锁依赖靠 doc 兜底,会被生产侧
// 顺手写进生产字面量 —— 后果是「设了也不生效的假开关」,且没有任何红。本门禁把
// 「生产映射不得写回测试专用键」做成反向不变量:
//
//   不变量 1:`buildConvertContext` 返回字面量(P) ∩ `TEST_ONLY_CONTEXT_KEYS`(A) = ∅;
//   不变量 2:A === `ConvertTestOverrides` 字段集(O) —— 围墙双向登记,无幽灭、无缺席。
//
// 扫描面(纯文本解析、零新增依赖、离线可跑、幂等):
//   - `src/convert/context.ts`:A(TEST_ONLY_CONTEXT_KEYS)与 P(buildConvertContext 返回字面量);
//   - `src/core/convert.ts`:O(ConvertTestOverrides 字段名)。
//
// 防空过(与本仓其余门禁同一纪律):A/O/P 中任一为空(或解析拿不到对应声明) ⇒ 判红。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const USAGE = '用法: node gates/repo/check-test-only-keys.mjs [--help]';

/** `src/convert/context.ts`(A 与 P 同在) */
const CONTEXT_REL = 'src/convert/context.ts';
/** `src/core/convert.ts`(O) */
const CONVERT_REL = 'src/core/convert.ts';

/** 提取 `export const TEST_ONLY_CONTEXT_KEYS... = [...]` 的数组字面量文本 */
export function extractTestOnlyLiteral(contextText) {
  const m = contextText.match(/export const TEST_ONLY_CONTEXT_KEYS[^=;]*=\s*(\[[^\]]*\])/);
  return m ? m[1] : null;
}

/** 字符串字面量元素集合(单/双/反三种引号) */
function parseStringElements(body) {
  const out = [];
  for (const m of body.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
    const v = m[1] ?? m[2] ?? m[3] ?? '';
    if (v !== '') out.push(v);
  }
  return out;
}

/** `buildConvertContext` 返回字面量文本(`return {` 起至匹配闭花,含首尾花) */
export function extractProductionLiteral(contextText) {
  const start = contextText.indexOf('function buildConvertContext');
  if (start === -1) return null;
  const ret = contextText.indexOf('return', start);
  if (ret === -1) return null;
  const open = contextText.indexOf('{', ret);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < contextText.length; i += 1) {
    const ch = contextText[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return contextText.slice(open, i + 1);
    }
  }
  return null;
}

/** 生产字面量的顶层键(行首锚定;先剥注释;字面量在 context.ts 里是扁平形态) */
export function parseProductionKeys(literal) {
  const stripped = literal
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const keys = new Set();
  for (const m of stripped.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*:/gm)) keys.add(m[1]);
  for (const m of stripped.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*(?:,|}|$)/gm)) keys.add(m[1]);
  return keys;
}

/** `ConvertTestOverrides` 接口体文本 */
function extractInterfaceBody(convertText) {
  const m = convertText.match(/interface ConvertTestOverrides\s*\{([^}]*)\}/);
  return m ? m[1] : null;
}

/** `ConvertTestOverrides` 字段名集合(行首 `name?:` 形态) */
function parseInterfaceFields(body) {
  const out = [];
  for (const m of body.matchAll(/^[ \t]*([A-Za-z_$][\w$]*)\s*\??/gm)) out.push(m[1]);
  return out;
}

/** 纯判定层:返回 `{ problems, info, A, O, P }` */
export function analyze({ contextText = '', convertText = '' } = {}) {
  const problems = [];
  const info = [];
  const A = new Set(parseStringElements(extractTestOnlyLiteral(contextText) ?? ''));
  const P = parseProductionKeys(extractProductionLiteral(contextText) ?? '');
  const O = new Set(parseInterfaceFields(extractInterfaceBody(convertText) ?? ''));

  if (A.size === 0) problems.push('[test-only-keys:fail] 解析不到 TEST_ONLY_CONTEXT_KEYS —— 围墙集合为空,防空过');
  if (P.size === 0) problems.push('[test-only-keys:fail] 解析不到 buildConvertContext 的生产字面量 —— 枚举集合为空,防空过');
  if (O.size === 0) problems.push('[test-only-keys:fail] 解析不到 ConvertTestOverrides 字段 —— 枚举集合为空,防空过');

  for (const key of A) {
    if (P.has(key)) problems.push(`[test-only-keys:fail] 生产映射写回了测试专用键「${key}」 —— 它会在生产侧被消费,登记进围墙只会造出「设了也不生效」的假开关`);
  }
  for (const key of A) {
    if (!O.has(key)) problems.push(`[test-only-keys:fail] 围墙集合登记了幽灭项「${key}」 —— 没有在 ConvertTestOverrides 声明`);
  }
  for (const key of O) {
    if (!A.has(key)) problems.push(`[test-only-keys:fail] ConvertTestOverrides 声明了测试参「${key}」但未在 TEST_ONLY_CONTEXT_KEYS 登记 —— 它既不生产也不登记`);
  }

  info.push(`围墙 A(${A.size})=[${[...A].sort().join('、')}];生产 P(${P.size});测试参 O(${O.size})=[${[...O].sort().join('、')}]`);
  return { problems, info, A, O, P };
}

/** CLI 主体:读文件 → analyze → 输出 → 退出码 */
export function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help'] });
  } catch (error) {
    console.error(`[test-only-keys:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  let contextText;
  let convertText;
  try {
    contextText = readFileSync(path.join(projectRoot, ...CONTEXT_REL.split('/')), 'utf8');
    convertText = readFileSync(path.join(projectRoot, ...CONVERT_REL.split('/')), 'utf8');
  } catch (error) {
    console.error(`[test-only-keys:fail] 读文件失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const result = analyze({ contextText, convertText });
  for (const line of result.info) console.log(`[info] test-only-keys:${line}`);
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(problem);
    console.error(`[test-only-keys:fail] 生产映射写回测试专用键自检失败,共 ${result.problems.length} 项`);
    return 1;
  }
  console.log('[ok] 测试专用参围墙自检通过:A=O,P∩A=∅');
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
