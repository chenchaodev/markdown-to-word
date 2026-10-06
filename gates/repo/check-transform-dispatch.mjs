// 渲染前变换层分派点门禁(纯文本判定、零新增依赖、离线可跑、幂等,exit 0/1)。
//
// 为什么这道门禁取「反」:规格原来的退出条件是「core/convert.ts 对这批设置的引用数
// 从 0 变为 1」,方向是错的 —— 分派点搬进 core 之后,渲染层去枚举它恰恰是错的方向
// (那等于把变换又接回渲染,阶段契约变成类型谎言)。该守的是三条**反向不变量**:
//
//   1. 渲染层不得枚举变换类设置:`src/core/convert.ts` + `src/core/docx/**` +
//      `src/core/pdf/**` 出现 `aiCleanup` / `obsidian` 即判红(adr-026 决定要点三)。
//   2. main 的转换层薄壳不得枚举变换类设置:`src/main/converter/**` 零命中。薄壳只做
//      frontmatter 隔离与 IO;这批键名一旦落在这里,「新增一个变换键组时 main 侧改动
//      恒为 0」就不成立了(adr-027 决定要点三)。
//   3. 变换类设置的枚举点**恰为 2 处且都在 `src/core/markdown/**`**:分派 1 处 +
//      档位映射 1 处。计数漂移即红 —— 多一处就多一个 mapper,而本门禁自己就是
//      「第三个 mapper」时的报案器。
//
// 扫描面与排除项(每条都有理由,勿随手放宽也勿随手收紧):
//   - 扫 `src/` 源码树。dist 是 tsc 产物,同一份源码的编译输出,单源在 src;逐产物
//     再判一遍只会引入「注释是否被 tsc 保留」这种与本门禁无关的耦合。
//   - 枚举点计数扫 `src/core/**`,排除两项:① `src/core/i18n/**` —— 那里出现的是
//     i18n 键名(`settings.aiCleanup`),是文案字典不是设置消费;②
//     `src/core/settings/settings-defaults.ts` —— 它声明形状与默认值,按定义就是这批
//     键的声明单源,不是「枚举点」。两项都不是「放过」,是归类:枚举点 = 把设置映射成
//     行为的那个地方,声明与文案都不是。
//   - 不扫 `src/main/persist/` 与 `src/renderer/`:持久化校验/迁移与设置界面回显本来
//     就要逐键处理这批设置(另见 docs/adr/adr-024),把它们算进枚举点会让计数失去意义。
//   - 匹配是**大小写敏感的词边界**纯文本扫描,刻意不剔除注释:判的是「这个文件知不知道
//     这批变换键」,在注释里提一句同样说明作者认为该层该关心它。方向上宁可误报(改个
//     措辞即可)不可漏报(漏了就是下一个 mapper 悄悄长出来)。
//   - 枚举点按**文件**计数而非出现次数:新增一个变换键组时分派函数加在同一个模块里,
//     文件数不变;按次数计会被无意义的重复引用顶红。
//
// 防空过(与本仓其余门禁同一纪律):三处扫描面任一为空(目录改名 / 谓词写坏 / 文件数
// 掉到下限以下)即判红,绝不允许以「零命中」报绿。

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, parseArgs } from '../../shared/cli.mjs';
import { ROOT } from '../../shared/paths.js';

const projectRoot = ROOT;
const USAGE = '用法: node gates/repo/check-transform-dispatch.mjs [--src <dir>] [--help]';

/** 渲染前变换类设置的键组名(本门禁的判定词表;新增变换键组时在此登记) */
export const TRANSFORM_KEYS = Object.freeze(['aiCleanup', 'obsidian']);

/** 枚举点必须落在的目录(仓库相对 POSIX 前缀) */
export const ENUMERATION_HOME = 'core/markdown/';

/** 枚举点计数必须恰为的处数(分派 1 + 档位映射 1;漂移即红) */
export const EXPECTED_ENUMERATION_POINTS = 2;

/**
 * 枚举点计数扫描的排除项(仓库相对 POSIX 路径;按内容归类,不是「放过」)。
 * @type {readonly {path: string, why: string}[]}
 */
export const ENUMERATION_EXCLUSIONS = Object.freeze([
  { path: 'core/i18n', why: 'i18n 键名字典(settings.aiCleanup 之类),不是设置消费' },
  { path: 'core/settings/settings-defaults.ts', why: '设置形状与默认值的声明单源,按定义就是这批键的家' },
  { path: 'core/settings/schema.ts', why: '持久化 schema 表(逐键声明取值域与校验档位),与上一条同类:声明不是枚举(adr-028 决定要点三)' },
  { path: 'core/settings/merge-patch.ts', why: '设置补丁的形状单源(DeepMergedBlock 逐块列举 + SettingsMergePatch 派生),按定义就是这批键的第二个家;此处无分派也无档位映射,与前两条同类' },
]);

/**
 * 一处扫描面:若干目录 + 若干单文件入口。
 * @typedef {object} ScanScope
 * @property {string} id 扫描面 id(诊断文案用)
 * @property {string[]} dirs 仓库相对目录
 * @property {string[]} files 仓库相对单文件入口
 * @property {number} minFiles 读到的文件数下限(低于即判红:扫描面失效,「零命中」是假通过)
 * @property {boolean} [isEnumerationFace] true = 该扫描面供规则 3 计数(须先剔排除项)
 */

/** @type {readonly ScanScope[]} 三处扫描面(规则 1 / 2 / 3 各一处) */
export const SCOPES = Object.freeze([
  {
    id: '渲染层',
    dirs: ['core/docx', 'core/pdf'],
    files: ['core/convert.ts'],
    minFiles: 20,
  },
  {
    id: 'main 转换层薄壳',
    dirs: ['main/converter'],
    files: [],
    minFiles: 4,
  },
  {
    id: '枚举点计数面',
    dirs: ['core'],
    files: [],
    minFiles: 40,
    isEnumerationFace: true,
  },
]);

/** 源码扩展名(与 check-import-boundary 的 src 形态同口径) */
const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.cts']);

/**
 * 词表 → 匹配正则(大小写敏感 + 词边界,单源见 TRANSFORM_KEYS)。
 * 词边界让 `aiCleanupOptions` 这类**同前缀的其它标识符**不误命中:那不是变换键的枚举,
 * 只是恰好同名的函数。刻意不做前缀匹配 —— `aiCleanupEnabled` 这类变体在代码里出现
 * 本身就是「有人在这里重新认这批键」,应当被看见。
 * @type {readonly RegExp[]}
 */
const KEY_PATTERNS = Object.freeze(TRANSFORM_KEYS.map((key) => new RegExp(`\\b${key}\\b`)));

/**
 * 递归列出目录下参与扫描的源文件(仓库相对 POSIX 路径,已排序,保证诊断顺序幂等)。
 * @param {string} absRoot 绝对目录
 * @param {string} relRoot 仓库相对前缀(用于拼仓库相对路径)
 * @returns {string[]} 仓库相对 POSIX 路径,已排序
 */
function listSourceFiles(absRoot, relRoot) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(childRel);
    }
  };
  walk(absRoot, relRoot);
  return out.sort((a, b) => a.localeCompare(b));
}

/**
 * 该文件是否落在枚举点的排除项里(目录前缀或单文件精确匹配,均按仓库相对路径)。
 * @param {string} rel 仓库相对 POSIX 路径
 * @returns {{path: string, why: string}|null} 命中的排除项,未命中返回 null
 */
export function matchEnumerationExclusion(rel) {
  for (const exclusion of ENUMERATION_EXCLUSIONS) {
    if (rel === exclusion.path || rel.startsWith(`${exclusion.path}/`)) return exclusion;
  }
  return null;
}

/**
 * 扫描一个扫描面,返回逐行命中的标识符事实与扫描面规模。
 * @param {string} srcRoot 源码树绝对路径
 * @param {ScanScope} scope 扫描面
 * @returns {{scope: ScanScope, fileCount: number, hits: {file: string, line: number, key: string}[]}} 扫描结果
 */
export function scanScope(srcRoot, scope) {
  /** @type {string[]} */
  const targets = [];
  for (const dir of scope.dirs) targets.push(...listSourceFiles(path.join(srcRoot, ...dir.split('/')), dir));
  targets.push(...scope.files);
  /** @type {{file: string, line: number, key: string}[]} */
  const hits = [];
  let fileCount = 0;
  for (const rel of [...new Set(targets)].sort((a, b) => a.localeCompare(b))) {
    let text;
    try {
      text = readFileSync(path.join(srcRoot, ...rel.split('/')), 'utf8');
    } catch {
      continue; // 单文件入口缺失不静默放过:文件数下限兜住扫描面失效(见 analyze)
    }
    fileCount += 1;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      for (const [keyIndex, pattern] of KEY_PATTERNS.entries()) {
        const key = TRANSFORM_KEYS[keyIndex];
        if (key === undefined || !pattern.test(line)) continue;
        hits.push({ file: rel, line: index + 1, key });
      }
    }
  }
  return { scope, fileCount, hits };
}

/**
 * 三条不变量的判定(纯判定层:扫描结果 → problems/info,便于守护段逐条覆盖)。
 * @param {ReturnType<typeof scanScope>[]} results 各扫描面的结果
 * @returns {{problems: string[], info: string[], enumerationPoints: string[]}} 判定结果
 */
export function analyze(results) {
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const info = [];
  const byId = new Map(results.map((result) => [result.scope.id, result]));

  for (const result of results) {
    if (result.fileCount < result.scope.minFiles) {
      problems.push(
        `[transform-dispatch:fail] ${result.scope.id}只扫到 ${result.fileCount} 个文件(下限 ${result.scope.minFiles}):`
          + '扫描面或谓词失效,此时「零命中」是假通过,须先修扫描面',
      );
    }
  }

  // 规则 1 / 2:渲染层与 main 薄壳都不得枚举变换类设置(逐行列出,便于定位)
  for (const id of ['渲染层', 'main 转换层薄壳']) {
    const result = byId.get(id);
    if (result === undefined) continue;
    for (const hit of result.hits) {
      problems.push(
        `[transform-dispatch:fail] ${id}出现变换类设置「${hit.key}」(${hit.file}:${hit.line}):`
          + '渲染前变换的枚举点只允许落在 core/markdown/(分派 + 档位映射);'
          + '渲染层或薄壳一旦出现它,阶段契约就退化成「声明但不消费」',
      );
    }
  }

  // 规则 3:枚举点恰为 2 处且都在 core/markdown/(先剔排除项:声明单源与 i18n 字典不是枚举点)
  const enumeration = byId.get('枚举点计数面');
  if (enumeration === undefined) return { problems, info, enumerationPoints: [] };
  const points = [...new Set(enumeration.hits.map((hit) => hit.file))]
    .filter((file) => matchEnumerationExclusion(file) === null)
    .sort((a, b) => a.localeCompare(b));
  if (points.length !== EXPECTED_ENUMERATION_POINTS) {
    problems.push(
      `[transform-dispatch:fail] 变换类设置的枚举点应为 ${EXPECTED_ENUMERATION_POINTS} 处`
        + `(core 的变换分派 + core 的档位映射),实际 ${points.length} 处:${points.join('、') || '零'};`
        + '多一处即多一个 mapper,少一处即某道门控被搬没了',
    );
  }
  for (const file of points) {
    if (file.startsWith(ENUMERATION_HOME)) continue;
    problems.push(
      `[transform-dispatch:fail] 枚举点 ${file} 不在 ${ENUMERATION_HOME} 下:`
        + '变换阶段的分派与档位映射都归 core/markdown,落在别处说明有人重新造了一条通路',
    );
  }
  for (const exclusion of ENUMERATION_EXCLUSIONS) {
    info.push(`枚举点计数已排除 ${exclusion.path}(${exclusion.why})`);
  }
  return { problems, info, enumerationPoints: points };
}

/**
 * CLI 主体:扫描 → 判定 → 输出 → 退出码。
 * @param {string[]} [argv] 参数数组
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, { booleans: ['help'], values: ['src'] });
  } catch (error) {
    console.error(`[transform-dispatch:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const srcRoot = path.resolve(projectRoot, options.src ?? 'src');
  let results;
  try {
    results = SCOPES.map((scope) => scanScope(srcRoot, scope));
  } catch (error) {
    console.error(`[transform-dispatch:fail] 扫描失败:${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const result = analyze(results);
  for (const line of result.info) console.log(`[info] transform-dispatch:${line}`);
  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(problem);
    console.error(`[transform-dispatch:fail] 渲染前变换层分派点自检失败,共 ${result.problems.length} 项`);
    return 1;
  }
  const scanned = results.map((item) => `${item.scope.id} ${item.fileCount} 文件`).join(' · ');
  console.log(
    `[ok] 渲染前变换层分派点自检通过(${scanned}):`
      + '渲染层与 main 转换层薄壳均未枚举变换类设置;'
      + `枚举点恰 ${result.enumerationPoints.length} 处且都在 ${ENUMERATION_HOME}(${result.enumerationPoints.join('、')})`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
