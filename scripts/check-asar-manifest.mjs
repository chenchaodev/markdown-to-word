// app.asar 内容与结构核对(exit 0/1)。
//
// 用途:安装包里的 app.asar 是唯一「实际交付给用户」的代码形态,源码树与 dist
// 通过并不代表交付物正确——files 配错、node_modules 未随包、打包用了旧 dist、
// 入口文件被改名都会只在这里暴露。本脚本按四层锁定交付物:
//   1. 归档本身可用:存在、非空、可被 @electron/asar 解析;
//   2. 结构:顶层只允许 dist / node_modules / package.json(挡住误打包的脚本、
//      夹具、密钥等本不该进包的文件);
//   3. 入口与资源:package.json(版本须等于仓库版本)、主进程入口、renderer 入口、
//      core 入口、KaTeX(pdf 公式字体/css)与 Mermaid(IIFE 产物)资源必须在包内;
//   4. 内容:与 clean build 的 dist 清单逐项核对(路径 + 大小 + SHA-256),
//      证明「打进去的 dist 就是刚构建的那份 clean dist」。
//
// 依赖:复用 electron-builder 已带的 @electron/asar(不新增依赖),只走其公开 API
// (getRawHeader 取归档清单、extractFile 取条目内容),不自行解析 asar 二进制格式:
// 头信息本身是该库解析好的 JSON 树,遍历它不等于自研格式解析。
//
// 用法:
//   node scripts/check-asar-manifest.mjs [--asar <file>] [--pkg <file>] [--manifest <file>] [--skip-manifest]

import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashBuffer, isMainModule, parseArgs, parseManifest, toPosix } from './check-dist-manifest.mjs';

const require = createRequire(import.meta.url);

/** 默认检查对象:win-unpacked 里的未签名安装镜像(与 release/*.exe 同一份 dist 打出) */
export const DEFAULT_ASAR_PATH = path.join('release', 'win-unpacked', 'resources', 'app.asar');
export const DEFAULT_PKG_PATH = 'package.json';

/** 归档顶层只允许这三项(package.json build.files 只收 dist/** 与 node_modules) */
export const EXPECTED_TOP_LEVEL = ['dist', 'node_modules', 'package.json'];

/**
 * 必须存在于包内的条目(分组名只用于错误文案)。
 * 动态项(pkg.main)不在此表,由主进程入口的仓库 package.json 推得。
 */
export const REQUIRED_ENTRIES = [
  { group: '主进程', path: 'dist/main/preload.cjs' },
  { group: 'renderer', path: 'dist/renderer/index.html' },
  { group: 'renderer', path: 'dist/renderer/renderer.js' },
  { group: 'renderer', path: 'dist/renderer/about.html' },
  { group: 'renderer', path: 'dist/renderer/about-preload.cjs' },
  { group: 'renderer', path: 'dist/renderer/lang-bootstrap.js' },
  { group: 'core', path: 'dist/core/convert.js' },
  { group: 'core', path: 'dist/core/pipeline/parse.js' },
  // 公式:pdf 管线按 katex.min.css + woff2 字体 file:// 加载(见 src/main/services/resource-dirs.ts)
  { group: 'KaTeX 资源', path: 'node_modules/katex/dist/katex.min.css' },
  { group: 'KaTeX 资源', path: 'node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2' },
  // 图表:隐藏渲染窗口以 file:// 直引 mermaid.min.js(IIFE 产物,见 resource-dirs.ts 头注)
  { group: 'Mermaid 资源', path: 'node_modules/mermaid/dist/mermaid.min.js' },
];

/** 前缀类要求:atLeast 1 个匹配文件(样式表按目录分文件,锁文件名会误报) */
export const REQUIRED_PREFIXES = [{ group: 'renderer 样式', prefix: 'dist/renderer/style/', suffix: '.css', atLeast: 1 }];

/**
 * 载入 @electron/asar(electron-builder 的传递依赖,随 node_modules 就位)。
 * 缺失时给可读文案:这属于依赖安装不完整,不是 asar 内容问题。
 */
export function loadAsar() {
  try {
    return require('@electron/asar');
  } catch (error) {
    throw new Error(`无法载入 @electron/asar(依赖未安装?):${error.message}`);
  }
}

/**
 * 归档内路径用宿主平台分隔符传给 @electron/asar:其内部按 path.dirname/basename
 * 逐级查表(POSIX 路径在 Windows 上会整段当成一个文件名而查不到)。
 * 清单与比较一律用 POSIX,只在调用 asar API 的那一刻转换。
 */
export function toArchivePath(posixPath) {
  return posixPath.split('/').join(path.sep);
}

/**
 * 归档清单:调 getRawHeader 一次解析头信息并遍历(头信息是 JSON 树,目录节点带 files,
 * 叶子节点带 size)。不用 listPackage 的原因:它不区分目录与文件,且每次调用都要重读
 * 整份头(1 万+ 条目时重复解析)。返回
 * { files: Map<POSIX 相对路径, 字节数>, dirs: Set<POSIX 相对路径> }。
 */
export function listArchiveEntries(asarApi, archivePath) {
  const { header } = asarApi.getRawHeader(archivePath);
  const files = new Map();
  const dirs = new Set();
  const walk = (node, prefix) => {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const entryPath = prefix === '' ? name : `${prefix}/${name}`;
      if (child.files !== undefined) {
        dirs.add(entryPath);
        walk(child, entryPath);
      } else {
        files.set(entryPath, child.size);
      }
    }
  };
  walk(header, '');
  return { files, dirs };
}

/** 读取包内 package.json(归档损坏时抛出可读错误由调用方归一化) */
export function readArchivePackageJson(asarApi, archivePath) {
  const text = asarApi.extractFile(archivePath, toArchivePath('package.json')).toString('utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`包内 package.json 不是合法 JSON:${error.message}`);
  }
}

export async function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv, {
      booleans: ['skip-manifest', 'help'],
      values: ['asar', 'pkg', 'manifest'],
    });
  } catch (error) {
    console.error(`[asar:fail] ${error.message}`);
    return 1;
  }
  if (options.help) {
    console.log(
      '用法: node scripts/check-asar-manifest.mjs [--asar <file>] [--pkg <file>] [--manifest <file>] [--skip-manifest]',
    );
    return 0;
  }

  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const asarPath = path.resolve(projectRoot, options.asar ?? DEFAULT_ASAR_PATH);
  const pkgPath = path.resolve(projectRoot, options.pkg ?? DEFAULT_PKG_PATH);
  const problems = [];

  if (!existsSync(pkgPath)) {
    console.error(`[asar:fail] 仓库 package.json 不存在:${pkgPath}`);
    return 1;
  }
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    console.error(`[asar:fail] 仓库 package.json 不可读:${error.message}`);
    return 1;
  }

  if (!existsSync(asarPath)) {
    console.error(`[asar:fail] 找不到 app.asar:${toPosix(path.relative(projectRoot, asarPath))};请先运行打包(dist 步骤)`);
    return 1;
  }
  if (statSync(asarPath).size === 0) {
    console.error(`[asar:fail] app.asar 为空文件:${toPosix(path.relative(projectRoot, asarPath))}(打包中断?)`);
    return 1;
  }

  let asarApi;
  try {
    asarApi = loadAsar();
  } catch (error) {
    console.error(`[asar:fail] ${error.message}`);
    return 1;
  }

  let inventory;
  let archivePkg;
  try {
    inventory = listArchiveEntries(asarApi, asarPath);
    archivePkg = readArchivePackageJson(asarApi, asarPath);
  } catch (error) {
    console.error(`[asar:fail] app.asar 不可解析(打包损坏?):${error.message}`);
    return 1;
  }
  const files = inventory.files;

  // ---- 2. 顶层结构 ----
  const topLevel = new Set([...files.keys(), ...inventory.dirs].map((entry) => entry.split('/')[0]));
  for (const name of topLevel) {
    if (!EXPECTED_TOP_LEVEL.includes(name)) {
      problems.push(`包内出现预期外顶层项:${name}(build.files 只应收 dist/** 与 node_modules,请确认没有误打包)`);
    }
  }
  for (const name of EXPECTED_TOP_LEVEL) {
    if (!topLevel.has(name)) problems.push(`包内缺少顶层项:${name}`);
  }

  // ---- 3. 入口与资源 ----
  const mainEntry = typeof pkg.main === 'string' ? pkg.main : '';
  if (mainEntry === '') {
    problems.push('仓库 package.json 缺少 main 入口字段,无法定位主进程入口');
  }
  const required = [...REQUIRED_ENTRIES];
  if (mainEntry !== '') required.push({ group: '主进程入口(package.json main)', path: mainEntry });
  for (const { group, path: entryPath } of required) {
    if (!files.has(entryPath)) problems.push(`包内缺少${group}条目:${entryPath}`);
  }
  for (const { group, prefix, suffix, atLeast } of REQUIRED_PREFIXES) {
    const found = [...files.keys()].filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix)).length;
    if (found < atLeast) {
      problems.push(`包内${group}资源不足(至少 ${atLeast} 个 ${prefix}*${suffix},实际 ${found})`);
    }
  }
  if (archivePkg.version !== pkg.version) {
    problems.push(
      `包内 package.json 版本(${String(archivePkg.version)})与仓库版本(${String(pkg.version)})不一致(打的是旧 dist?)`,
    );
  }
  if (typeof archivePkg.main === 'string' && archivePkg.main !== mainEntry) {
    problems.push(`包内 package.json main(${archivePkg.main})与仓库 main(${mainEntry})不一致`);
  }

  // ---- 4. 与 clean dist 清单逐项核对 ----
  let checkedFiles = 0;
  if (options['skip-manifest']) {
    console.log('[warn] asar:已跳过 dist 清单交叉核对(--skip-manifest),无法证明包内容来自本次 clean build');
  } else {
    const manifestPath = path.resolve(projectRoot, options.manifest ?? path.join('output', 'artifacts', 'dist-manifest.json'));
    if (!existsSync(manifestPath)) {
      problems.push(
        `缺少 dist 清单:${toPosix(path.relative(projectRoot, manifestPath))};` +
          '请在 clean build 之后先生成清单(未纳入发布链时用 --skip-manifest 显式放行并承担风险)',
      );
    } else {
      let manifest;
      try {
        manifest = parseManifest(readFileSync(manifestPath, 'utf8'));
      } catch (error) {
        problems.push(`dist 清单不可用:${error.message}`);
      }
      if (manifest !== undefined) {
        const mismatched = [];
        for (const entry of manifest.files) {
          const archivePath = `dist/${entry.path}`;
          const archivedSize = files.get(archivePath);
          if (archivedSize === undefined) {
            mismatched.push(`${archivePath}(包内缺失)`);
            continue;
          }
          // 大小先比:不等即内容必不同,省掉一次解压
          if (archivedSize !== entry.size) {
            mismatched.push(`${archivePath}(大小与清单不符:包内 ${archivedSize} / 清单 ${entry.size})`);
            continue;
          }
          const content = asarApi.extractFile(asarPath, toArchivePath(archivePath));
          if (hashBuffer(content) !== entry.sha256) {
            mismatched.push(`${archivePath}(哈希与清单不符)`);
          }
        }
        const expectedInAsar = new Set(manifest.files.map((entry) => `dist/${entry.path}`));
        const extra = [...files.keys()].filter((entry) => entry.startsWith('dist/') && !expectedInAsar.has(entry));
        for (const entry of extra) mismatched.push(`${entry}(包内多余,清单未记录)`);
        for (const item of mismatched.slice(0, 10)) {
          problems.push(`包内 dist 与清单不一致:${item}`);
        }
        if (mismatched.length > 10) problems.push(`包内 dist 与清单不一致另有 ${mismatched.length - 10} 项未逐一列出`);
        checkedFiles = manifest.files.length;
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`[asar:fail] ${problem}`);
    console.error(`[asar:fail] app.asar 核对失败,共 ${problems.length} 项`);
    return 1;
  }
  console.log(
    `[ok] app.asar 核对通过(${toPosix(path.relative(projectRoot, asarPath))}:` +
      `${files.size} 个文件,顶层 ${EXPECTED_TOP_LEVEL.join('/')};包内版本 ${String(archivePkg.version)};` +
      `主进程入口 ${mainEntry};KaTeX/Mermaid 资源在位` +
      `${options['skip-manifest'] ? ';清单交叉核对已跳过' : `;已与 dist 清单核对 ${checkedFiles} 个文件`})`,
  );
  return 0;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
