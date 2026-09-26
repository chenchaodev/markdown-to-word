// 进程层:定位可执行文件、预检「能不能真的跑起来」、以 --smoke 启动并等它自行退出、清理一次性
// userData。跑不了就如实返回未执行原因,**绝不**在这里编造一份「看起来通过」的报告。
//
// 依赖方向:contract.mjs(默认落点常量)+ smoke-proc.mjs(进程原语单一来源:runSmokeProcess /
// createUserData / disposeUserData / 硬超时与进程树硬杀都在那边);不 import 报告层或 CLI 层。
//
// 「已接受例外」:repoRelative 与 readProductName 是本门禁自带的 8 行小工具(相对路径化与
// productName 读取);它们与 pack-size 门禁里的同名小工具刻意各持一份 —— 两个独立门禁互不
// 依赖,跨门禁共用工具反而会把耦合引进发布链;真正需要单源的转义/路径归一仍走
// check-dist-manifest.mjs 的 toPosix。

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { listExeNames } from '../smoke-proc.mjs';
import { toPosix } from '../check-dist-manifest.mjs';
import { projectRoot } from './contract.mjs';

/**
 * electron 可执行文件定位(不 require('electron'):那个包在纯 node 下导出的是
 * 路径字符串,走 createRequire 会把「可执行文件路径」耦合到 CJS 互操作细节上;
 * 直接读包内 path.txt 更直白,沙盒也能用同样的布局夹具)。
 * @param {string} root 仓库根
 * @returns {string | null} 可执行文件绝对路径;定位不到返回 null
 */
export function resolveElectronBinary(root) {
  const pkgDir = path.join(root, 'node_modules', 'electron');
  const pathFile = path.join(pkgDir, 'path.txt');
  if (existsSync(pathFile)) {
    const rel = readFileSync(pathFile, 'utf8').trim();
    if (rel !== '') {
      const candidate = path.join(pkgDir, 'dist', rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const name of ['electron.exe', 'electron']) {
    const candidate = path.join(pkgDir, 'dist', name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 应用可执行文件名(取自 package.json build.productName,与解包目录内 exe 命名同源;
 * 读不到就当空串,预检会退化为「候选不唯一时报错要 --exe」)。
 * @returns {string} productName
 */
export function readProductName() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return typeof pkg.build?.productName === 'string' ? pkg.build.productName : '';
  } catch {
    return '';
  }
}

/**
 * 相对化(报告与摘要里只允许出现仓库相对路径)。
 * @param {string} target 绝对路径
 * @returns {string} 仓库相对 POSIX 路径(目标在仓库外时给 basename)
 */
export function repoRelative(target) {
  const relative = path.relative(projectRoot, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(target);
  }
  return toPosix(relative);
}

/**
 * 预检:能否真的跑起来。返回 null = 可跑;返回字符串 = 未执行原因(相对路径形态)。
 * @param {object} spec 入参
 * @param {string} spec.source 来源
 * @param {string} spec.unpackedDir 解包目录
 * @param {string | undefined} spec.exeOption --exe
 * @param {string} spec.productName 应用可执行文件名(productName)
 * @returns {string | null} 未执行原因
 */
export function preflight({ source, unpackedDir, exeOption, productName }) {
  if (source === 'dev') {
    const electron = resolveElectronBinary(projectRoot);
    if (electron === null) {
      return (
        'dev 侧冒烟需 electron 可执行文件,未找到 node_modules/electron/dist/electron.*' +
        '(请先 npm install;不得因本机缺 Electron 就产出一份「通过」报告)'
      );
    }
    const smokeEntry = path.join(projectRoot, 'dist', 'main', 'smoke.js');
    if (!existsSync(smokeEntry)) {
      return `dev 侧冒烟入口未构建:${repoRelative(smokeEntry)}(请先 npm run build;该入口必须先编译才能被主进程动态 import)`;
    }
    return null;
  }
  if (!existsSync(unpackedDir) || !statSync(unpackedDir).isDirectory()) {
    return (
      `解包目录不存在:${repoRelative(unpackedDir)}` +
      '(请先运行 npm run dist,或用 --unpacked 指向已有解包目录)'
    );
  }
  const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
  if (!existsSync(asarPath)) {
    return `应用归档缺失:${repoRelative(asarPath)}(解包目录不完整,打包可能中断;请重跑 npm run dist)`;
  }
  const exePath = exeOption ?? findAppExe(unpackedDir, productName);
  if (exePath === null) {
    const candidates = listExeNames(unpackedDir);
    return (
      `解包目录内无法确定应用可执行文件:${repoRelative(unpackedDir)}` +
      `(.exe 候选:${candidates.length === 0 ? '(无)' : candidates.join(', ')};` +
      `期望与 productName 同名的 ${productName}.exe,可用 --exe 显式指定)`
    );
  }
  return null;
}

/**
 * 解包目录里的应用可执行文件:与 build.productName 同名者优先;候选不唯一且无法
 * 按名命中时返回 null(交由调用方报「指名 --exe」,不在多个候选里猜一个)。
 * @param {string} unpackedDir 解包目录
 * @param {string} productName package.json build.productName(可能为空)
 * @returns {string | null} 绝对路径;无法确定返回 null
 */
export function findAppExe(unpackedDir, productName) {
  const names = listExeNames(unpackedDir);
  if (productName !== '') {
    const named = names.find((name) => name.toLowerCase() === `${productName}.exe`.toLowerCase());
    if (named !== undefined) return path.join(unpackedDir, named);
  }
  if (names.length === 1 && names[0] !== undefined) return path.join(unpackedDir, names[0]);
  return null;
}

/**
 * 清一次性 userData 的父目录(EBUSY 重试;失败仅告警 —— 残留只是 output/ 下的空壳,
 * 不该把清理噪声变成冒烟失败)。
 * @param {string} scratchRoot 临时根
 * @returns {void}
 */
export function removeScratch(scratchRoot) {
  try {
    rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(
      `[warn] smoke-report: 临时目录清理失败(可手工删除 ${repoRelative(scratchRoot)}):` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
