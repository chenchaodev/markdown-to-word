#!/usr/bin/env node

/**
 * 生成目录与覆盖率 dump 目录清理(clean:dist / clean:release,以及 --coverage-temp),
 * 校验通过才删除,exit 0/1。
 *
 * 用途:发布物必须从干净的 dist 与干净的 release 打出。tsc 与 electron-builder 都只
 * 增量写入 —— 源文件改名/删除后旧产物会留在 dist/ 并被打进 app.asar;release/ 更是
 * 累积目录,历史版本安装包与本次产物并存。dist 清单与 SHA-256 核对只能证明「一致」,
 * 证不了「没多带」,所以清理必须发生在构建之前,而不是核对失败之后再补救。
 *
 * 删除不可逆,因此安全边界写死在本脚本内,不依赖调用方自觉:
 *   - 目标只有 dist / release 两个关键字(可用 all 一次清两者),不接受任意路径参数;
 *     覆盖率 dump 是**独立选项** --coverage-temp(布尔,不带取值),它的目标同样取自冻结
 *     常量表 COVERAGE_TEMP_DIRS,不来自调用方(见「为什么不是第四个 --target 关键字」);
 *   - 目标目录写死在此,并与 package.json 的打包配置对账(build.files 是否覆盖 dist、
 *     build.directories.output 是否为 release);配置迁移后不一致即拒绝,防止拿着
 *     过期常量删错树;
 *   - --coverage-temp 的目标另与 package.json scripts.test:coverage 的 --temp-directory
 *     取值对账(见 assertMatchesCoverageConfig);
 *   - 目标必须是项目根内的相对子目录,任一路径段命中保护区(保护区从实际顶层派生,见
 *     protectedPathSegments)或含 `..` 即拒绝(例如 main 被误改成 src/ 时不会删到源码);
 *   - 目标不存在 → 幂等跳过;目标是符号链接/联接点、非目录,或 realpath 越出项目根
 *     → 拒绝删除并说明原因;
 *   - 删除失败(Windows 常见 EBUSY/EPERM:应用或预览窗口未退出、IDE 索引、杀毒扫描)
 *     不吞错,给出可操作提示并非零退出。
 *
 * 覆盖率 dump(.c8-tmp/):c8 的 V8 dump 中间态,单次实测 200+ 文件约 134M,由
 * test:coverage 的 --temp-directory 声明。**默认清不掉,须显式 --coverage-temp**,
 * 理由见「默认行为」小节。它必须留在 output/ 保护区之外(ADR-048 决定二:dump 边跑边写,
 * 落进 output/ 会与门禁探针的「工作树零注入」指纹窗口重叠),故只能显式清理、不能随
 * 构建链自动带出。
 *
 * dist 目标连带删除根目录的 tsc 增量构建信息(*.tsbuildinfo):tsconfig 的 incremental
 * 缓存写在项目根而非 outDir,只删 dist/ 会留下「产物已删、缓存仍在」的状态,tsc 随即
 * 判定全部最新而一个文件都不发出(实测 clean 后 build 只剩 8 个复制资源),空 dist 还会
 * 被清单当作合法基线。该文件是 tsc 生成的构建信息,按名字模式限定、不递归。
 *
 * 为什么住在 gates/artifacts/(ADR-049):本脚本断言仓库状态(与 package.json 打包配置对账、
 * 有专属守护段、在 verify:release 链内),按 ADR-038「层按断言对象分」属门禁树。原先住在
 * build/(不产生断言的产物生产树,ADR-050 已与 dev/ 合并为 tools/),那一层定位对它不成立。
 *
 * 「默认行为」(新增 --coverage-temp 时必须想清楚并写明):**`npm run clean:dist` 不会顺手
 * 清掉 .c8-tmp/,`--target all` 也只清 dist + release 两个。** 三条理由:
 *   ① 二者语义不同。dist/release 是「打进安装包的产物」,清理的理由是「发布物必须从干净的
 *      树打出」(见文件头用途段);.c8-tmp 是**测试运行器的中间态**,不进包、不参与任何核对,
 *      清理它的理由只是磁盘占用。把后者挂到前者的清理动作上,是让一个日常动作顺带删掉
 *      134M 与本次任务无关的数据 —— 删除不可逆,收益与动作不匹配时不该搭车。
 *   ② 搭车会让 `all` 的含义漂移。`all` 是「两个打包产物都清」,verify:release 的 dist 链
 *      语义依赖它;悄悄扩成三个目标后,同一个关键字在打包语境与测试语境下含义不同。
 *   ③ dump 的生命周期绑 test:coverage,不绑 build。跑一次 build 不产生 dump,清它是空转;
 *      跑一次 test:coverage 才产生,而那之后人往往正想留着它排查覆盖率数据。
 * 故取「显式、独立、可组合」:--coverage-temp 单独可用(只清 dump),也可与 --target 并用
 * 一次清掉两类。本仓的清理一律是显式调用(无钩子、无定时任务),这条也不例外。
 *
 * 「为什么不是第四个 --target 关键字」(如 `--target c8-tmp`):--target 的取值域是
 * **打包产物**这一族语义,而它的对账锚(build.files / build.directories.output)也只覆盖
 * 这一族;把 dump 塞进去会让「--target 取值 = 打包配置声明的产物」这条不变式失效。更硬的
 * 约束是验收段 clean-artifacts-gate 逐字节钉住了这三条文本:常量行
 * `TARGET_DIRS = Object.freeze({ dist: 'dist', release: 'release' })`(多一个键即判红)、
 * 用法首行的 `--target <dist|release|all>`、以及两条诊断里的 `只接受 dist/release/all`。
 * 改取值域就得改这些文本,而改文本去迁就实现是本末倒置。拆成独立布尔选项后,--target 的
 * 取值域与全部既有文案**一个字节都不动**,新增能力是纯增量。
 *
 * 用法: node gates/artifacts/clean-artifacts.mjs --target <dist|release|all> [--dry-run]
 *       node gates/artifacts/clean-artifacts.mjs --coverage-temp [--dry-run]
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../../shared/paths.js';
import { topLevel } from '../repo/repo-manifest.mjs';

const PROJECT_ROOT = ROOT;

/**
 * 清理目标常量(删除目标的单一来源)。与 package.json 打包配置的一致性由
 * assertMatchesBuildConfig 断言,配置迁移时不会拿着过期常量删错树。
 * dist 连带 *.tsbuildinfo:增量构建信息在项目根,留着会让 tsc 跳过 emit(见文件头注)。
 */
const TARGET_DIRS = Object.freeze({ dist: 'dist', release: 'release' });

/**
 * 覆盖率 dump 临时目录(删除目标的单一来源)。与 package.json scripts.test:coverage 的
 * --temp-directory 取值的一致性由 assertMatchesCoverageConfig 断言。
 *
 * **单列一张表而不并入 TARGET_DIRS**:后者是「打包配置声明为产物」那一族(dist/release),
 * 它的对账锚是 build.files / build.directories.output;dump 目录不进包、不参与打包核对,
 * 混进去会让那张表的语义从「打包产物」退化成「所有可删目录」。另有一层硬理由:验收段
 * clean-artifacts-gate 把 TARGET_DIRS 那行逐字节钉死为 `{ dist, release }` 两键。
 *
 * 为什么键名不来自调用方:--coverage-temp 是**布尔**开关,不带取值。调用方能表达的最多是
 * 「清 dump」这一个意图,不能是「清哪个目录」—— 与 --target 拒绝任意路径是同一条设计。
 */
const COVERAGE_TEMP_DIRS = Object.freeze({ c8: '.c8-tmp' });

/**
 * --coverage-temp 的目标键。**写死**而非从 argv 取:argv 里根本没有这个位置,写出来是为了
 * 让「键 → 路径」这一步仍走冻结表(单一来源),而不是在调用处内联一个字符串字面量。
 */
const COVERAGE_TEMP_KEY = 'c8';

/**
 * c8 dump 落点的声明形态:ADR-048 决定二 锁死**等号形态**。这里刻意只认等号形态 ——
 * 空格分隔(`--temp-directory .c8-tmp`)会让本判据判红,而它同时也会让 coverage-gate 的
 * 参数向量收集在第二个 token 处中断(那一侧的 requireFlags/阈值判据随之判红)。两处同时红,
 * 不会静默漂移;只认一种形态也让「本判据依赖等号形态」这件事写在代码里而不是留在记忆里。
 */
const TEMP_DIRECTORY_RE = /(?:^|\s)--temp-directory=(\S+)/;

const BUILD_INFO_RE = /^[A-Za-z0-9._-]+\.tsbuildinfo$/;

/** 空豁免集:resolveTarget 的默认值(= 不豁免任何路径段),冻结以免每次调用新建 */
const EMPTY_SEGMENTS = Object.freeze(new Set());

/**
 * 受保护路径段:**从实际顶层派生**(gates/repo/repo-manifest.mjs 的
 * manifest.cleanProtectedSegments,ADR-037),此前是手写枚举。
 *
 * 派生口径:顶层条目里「被声明指向的树 / 有代码 / 有文档 / 顶层声明文件 / 隐藏项」全量入保护集,
 * 减去「打包配置声明为产物的那几个目录」。于是新增一个源码树 / 门禁树 / 文档树时保护集
 * 自动跟进,不必靠人记得往这张表里加一行。
 *
 * 边界(必须说清,否则会把它当唯一的删除防线):派生集**不含**「既无代码也无文档、无声明指向」的
 * 裸目录(素材目录、临时壳)。这是有意的 —— 门禁段 clean-artifacts-gate 的守卫可达性夹具要
 * 造一个普通顶层目录并证明它「可删」,若裸目录一律进保护集,那条正向锚点会被自己的派生判死。
 * 派生集**也不区分隐藏项的用途**:点目录一律判 VCS(为的是护住 .git / .github),于是 gitignored
 * 的点目录(如 .c8-tmp)也一并进保护集 —— 那一条由 COVERAGE_TEMP_EXEMPT 单点豁免,见其头注。
 *
 * 真正保证「删不掉」的是本文件另外两道**封闭**闸门:`--target` 只接受 dist/release/all 三个
 * 关键字,且目标取自冻结的 TARGET_DIRS、不来自调用方;再由 assertMatchesBuildConfig 把它钉死在
 * package.json 上。覆盖率 dump 走同构的第三条(布尔开关 --coverage-temp + 冻结表
 * COVERAGE_TEMP_DIRS + assertMatchesCoverageConfig 钉在 scripts.test:coverage 上)。三者正交,
 * 改派生口径前先读这几处。
 */
let protectedSegments = null;

/** 派生一次并缓存(删除路径守卫每次调用都要问,不该每次重扫顶层) */
function protectedPathSegments() {
  protectedSegments ??= new Set(topLevel(PROJECT_ROOT).cleanProtectedSegments);
  return protectedSegments;
}

const USAGE = `用法: node gates/artifacts/clean-artifacts.mjs --target <dist|release|all> [--dry-run]
  --target dist     清理 dist/(tsc 输出目录,package.json build.files 收的就是它)
  --target release  清理 release/(package.json build.directories.output)
  --target all      两者都清理
  --coverage-temp   清理 c8 的 V8 dump 临时目录 .c8-tmp/(package.json test:coverage
                    的 --temp-directory 落点;可单独用,也可与 --target 并用)。
                    默认不清理:见文件头「默认行为」
  --dry-run         只打印将要删除的路径,不执行
  --help            显示本用法`;

/**
 * 极简参数解析(不复用 shared/cli.mjs 的 parseArgs:那处的错误文案会带出本脚本
 * 无关的用法说明)。未知选项/缺取值都显式失败 —— 清理脚本的参数写错时必须报错,
 * 不能被静默忽略后按默认目标删东西。
 */
function parseArgs(argv) {
  const options = { target: '', 'dry-run': false, help: false, 'coverage-temp': false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--target') {
      const value = argv[(i += 1)];
      if (value === undefined) throw new Error('--target 缺少取值');
      options.target = value;
    } else if (token.startsWith('--target=')) {
      options.target = token.slice('--target='.length);
    } else if (token === '--dry-run') {
      options['dry-run'] = true;
    } else if (token === '--coverage-temp') {
      // 刻意**不**接受 `--coverage-temp=<路径>` 形态:它是布尔开关,目标是冻结表里的一项。
      // 写成带取值形态会落到下面的未知参数分支被拒(`--coverage-temp=x` 不等于本 token),
      // 报错直指「无法识别的参数」—— 不给「这个开关能收路径」留任何暗示。
      options['coverage-temp'] = true;
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else {
      throw new Error(`无法识别的参数:${token}`);
    }
  }
  return options;
}

function readPackageJson() {
  const target = path.join(PROJECT_ROOT, 'package.json');
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch (error) {
    throw new Error(`package.json 不可读:${error.message}`);
  }
}

/**
 * 清理目标与打包配置对账:只允许清理「打包配置确实当作产物」的目录。
 * 不一致说明产物目录已迁移而本脚本常量未跟进,此时继续删就是在赌运气。
 */
function assertMatchesBuildConfig(pkg) {
  const files = Array.isArray(pkg.build?.files) ? pkg.build.files : [];
  const coversDist = files.some(
    (pattern) => typeof pattern === 'string' && (pattern === 'dist/**' || pattern.startsWith('dist/')),
  );
  if (!coversDist) {
    throw new Error(
      `package.json build.files 未覆盖 ${TARGET_DIRS.dist}/(实际 ${JSON.stringify(files)});` +
        `若产物目录已迁移,请先同步本脚本的 TARGET_DIRS`,
    );
  }
  const output = pkg.build?.directories?.output;
  if (output !== TARGET_DIRS.release) {
    throw new Error(
      `package.json build.directories.output(${String(output)})与清理目标 ${TARGET_DIRS.release} 不一致;` +
        `若发布目录已迁移,请先同步本脚本的 TARGET_DIRS`,
    );
  }
}

/**
 * 覆盖率 dump 落点与 package.json 对账:只允许清理「test:coverage 确实声明为 dump 目录」的
 * 那一处。不一致说明 dump 落点已迁移而本脚本常量未跟进,此时继续删就是在赌运气。
 *
 * **钉在 scripts.test:coverage 的 --temp-directory 上,而不是 build.files /
 * build.directories.output**:dump 目录既不进包也不参与打包核对,build.* 里根本没有它的
 * 位置 —— 那是「打包产物」那一族的登记处。而 `--temp-directory` 是全仓**唯一**声明 dump
 * 落点的地方(package.json 旁与 parseCoverageScript 的注释各点一次名,ADR-048 决定二),
 * 拿它当锚才能在「落点被改」时立刻判红,而不是删一个没人再写的旧目录。
 *
 * 为什么不在 main 里无条件调用(而 assertMatchesBuildConfig 是无条件的):dump 落点只影响
 * 「--coverage-temp 这一次删除」,dist/release 的可清理性与它无关。让 dist/release 的清理
 * 也依赖 coverage 脚本的写法,等于把两个正交的配置面耦在一起 —— 谁改 test:coverage 的
 * 参数向量,就会连带把 clean:dist 弄红,而那条报错完全不提 c8。验收段 clean-artifacts-gate
 * 的沙盒 package.json 也只带 build.* 不带 scripts.test:coverage,无条件调用会让它每一格都红。
 */
function assertMatchesCoverageConfig(pkg) {
  const script = pkg.scripts?.['test:coverage'];
  if (typeof script !== 'string') {
    throw new Error(
      `package.json scripts.test:coverage 不存在或不是字符串,无法确认 dump 落点;` +
        `若覆盖率脚本已迁移或改名,请先同步本脚本的 COVERAGE_TEMP_DIRS`,
    );
  }
  const matched = TEMP_DIRECTORY_RE.exec(script);
  if (matched === null) {
    throw new Error(
      `package.json scripts.test:coverage 未声明 --temp-directory=<目录>(c8 会退回默认落点);` +
        `若 dump 落点已迁移,请先同步本脚本的 COVERAGE_TEMP_DIRS`,
    );
  }
  const declared = matched[1];
  if (declared !== COVERAGE_TEMP_DIRS[COVERAGE_TEMP_KEY]) {
    throw new Error(
      `package.json scripts.test:coverage 的 --temp-directory=${declared} 与清理目标 ` +
        `${COVERAGE_TEMP_DIRS[COVERAGE_TEMP_KEY]} 不一致;若 dump 落点已迁移,请先同步本脚本的 COVERAGE_TEMP_DIRS`,
    );
  }
}

/**
 * 派生保护区的**唯一**豁免项:.c8-tmp(仅 --coverage-temp 路径可用)。
 *
 * 为什么它落在派生保护集里:gates/repo/repo-manifest.mjs 的 classifyProfile 对「点开头的
 * 隐藏项」一律判 VCS(护住 .git / .github / 编辑器状态),而 VCS 不在「不进保护集」那两类里
 * ⇒ 任何 gitignored 的点目录都会进保护集。那条判据本意是「点目录多为版本控制状态,别动」,
 * 而 .c8-tmp 是 gitignored 的**可再生 dump**,判错的正是「隐藏」这一维。
 *
 * 为什么豁免是封闭的:豁免集由 COVERAGE_TEMP_DIRS 的**值**派生(frozen 常量表,单一来源),
 * **不来自调用方** —— argv 无论写什么都只能表达「清 dump」这一个意图。且它只对
 * --coverage-temp 那一条代码路径生效:cleanOne 走 resolveTarget 时按调用点显式传入,
 * dist/release 不传 ⇒ 那两个目标受保护集的约束**一字未松**(验收段「目标=src 受保护」
 * 等负例仍由 dist 路径触达,不受本豁免影响)。
 *
 * 其余守卫一道不减:相对路径、无 `..`、无空段、越出项目根、符号链接/联接点、非目录、
 * realpath 越界 —— 全部照旧对 .c8-tmp 生效。豁免的只是「派生保护集这一个集合的命中」,
 * 不是「跳过删除前校验」。而 dump 目录本身也已在 test:coverage 上钉死落点
 * (assertMatchesCoverageConfig),配置漂移即拒绝执行。
 */
const COVERAGE_TEMP_EXEMPT = Object.freeze(
  new Set(Object.values(COVERAGE_TEMP_DIRS).map((dir) => dir.split('/')[0])),
);

/** 相对路径 → 项目内绝对路径,并逐段做安全校验。
 *  exemptSegments:调用点显式传入的派生保护区豁免集(默认空集 = 不豁免任何段)。 */
function resolveTarget(label, relative, exemptSegments = EMPTY_SEGMENTS) {
  const posix = relative.replaceAll('\\', '/');
  if (posix.startsWith('/') || /^[a-zA-Z]:/.test(posix)) {
    throw new Error(`${label} 目标必须是相对路径,拒绝:${relative}`);
  }
  for (const segment of posix.split('/')) {
    if (segment === '' || segment === '.') throw new Error(`${label} 目标含空路径段:${relative}`);
    if (segment === '..') throw new Error(`${label} 目标含上跳段(..),拒绝:${relative}`);
    if (!exemptSegments.has(segment) && protectedPathSegments().has(segment)) {
      throw new Error(`${label} 目标落在受保护目录(源码/测试/文档/依赖),拒绝删除:${relative}`);
    }
  }
  const target = path.resolve(PROJECT_ROOT, relative);
  const inside = path.relative(PROJECT_ROOT, target);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`${label} 目标越出项目根,拒绝:${relative}`);
  }
  return target;
}

/**
 * 删除前的存在性与性质校验。返回 false 表示「无需清理」(目标不存在,幂等跳过)。
 * 符号链接/联接点与非目录都拒绝:递归删除跟随链接会波及项目外的真实目录。
 */
function inspectTarget(target, label) {
  if (!existsSync(target)) return false;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink()) {
    throw new Error(`${label} 目标是符号链接/联接点,拒绝递归删除(实际指向可能在本项目之外):${target}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} 目标不是目录,拒绝删除:${target}`);
  }
  const realRoot = realpathSync(PROJECT_ROOT);
  const realTarget = realpathSync(target);
  const inside = path.relative(realRoot, realTarget);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error(`${label} 目标 realpath 越出项目根,拒绝删除:${realTarget}`);
  }
  return true;
}

function displayPath(target) {
  const relative = path.relative(PROJECT_ROOT, target);
  return relative === '' ? target : relative.split(path.sep).join('/');
}

/** 递归删除单个目录;失败信息带可操作提示,由调用方直接抛出 */
function removeDirectory(target, label) {
  try {
    // maxRetries/retryDelay 吸收 Windows 上短暂的 EBUSY/EPERM(索引器、杀软扫描);
    // 仍失败则走 catch 输出可操作提示,不静默吞错。
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'UNKNOWN';
    throw new Error(
      `删除 ${displayPath(target)} 失败(${code} ${error instanceof Error ? error.message : String(error)});` +
        `Windows 上多为文件占用:退出正在运行的 MarkdownToWord/预览窗口与 Electron 进程、` +
        `暂停 IDE 索引或杀毒扫描后重试`,
    );
  }
  console.log(`[ok] clean:${label} 已删除:${displayPath(target)}`);
}

/** 删除单个构建信息文件;守卫拒绝删目录,故这里只走文件删除 */
function removeFile(target, label, name) {
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`clean:${label} 的增量构建信息不是普通文件,拒绝删除:${name}`);
  }
  unlinkSync(target);
  console.log(`[ok] clean:${label} 已删除增量构建信息:${name}`);
}

/**
 * 连带清理 tsc 增量构建信息(项目根、非递归、名字模式限定)。
 * 只在 dist 目标下处理:release 目录与增量缓存无关。
 */
function cleanBuildInfo(label, dryRun) {
  for (const entry of readdirSync(PROJECT_ROOT, { withFileTypes: true })) {
    if (!entry.isFile() || !BUILD_INFO_RE.test(entry.name)) continue;
    const target = path.join(PROJECT_ROOT, entry.name);
    if (dryRun) {
      console.log(`[dry-run] clean:${label} 将删除增量构建信息:${entry.name}`);
      continue;
    }
    removeFile(target, label, entry.name);
  }
}

/** 清理单个目标;抛错由 main 统一归一化为可读诊断与非零退出。
 *  exemptSegments 只由 --coverage-temp 那条路径传入(dist/release 一律传默认空集)。 */
function cleanOne(label, relative, dryRun, exemptSegments = EMPTY_SEGMENTS) {
  const target = resolveTarget(label, relative, exemptSegments);
  if (!inspectTarget(target, label)) {
    console.log(`[ok] clean:${label} 目标不存在,无需清理:${displayPath(target)}`);
  } else if (dryRun) {
    console.log(`[dry-run] clean:${label} 将递归删除:${displayPath(target)}`);
  } else {
    removeDirectory(target, label);
  }
  if (label === 'dist') cleanBuildInfo(label, dryRun);
}

/**
 * 清理覆盖率 dump 临时目录。目标取自 COVERAGE_TEMP_DIRS(frozen,单一来源),落点由
 * assertMatchesCoverageConfig 钉在 package.json scripts.test:coverage 上。
 * 标签用 COVERAGE_TEMP_KEY:与 npm script 名 clean:c8-tmp 对齐,便于从输出反查是谁清的。
 */
function cleanCoverageTemp(dryRun) {
  const pkg = readPackageJson();
  assertMatchesCoverageConfig(pkg);
  cleanOne(COVERAGE_TEMP_KEY, COVERAGE_TEMP_DIRS[COVERAGE_TEMP_KEY], dryRun, COVERAGE_TEMP_EXEMPT);
}

export function main(argv = []) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`[clean:fail] ${error.message}\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  // 至少要给出一个清理意图:--target 或 --coverage-temp。两者都缺时的报错与既有文案逐字
  // 相同(验收段 clean-artifacts-gate 钉住了它),故只放宽「判定条件」,不动「文案」。
  if (options.target === '' && !options['coverage-temp']) {
    console.error(`[clean:fail] 缺少 --target(只接受 dist/release/all),不做任何删除\n${USAGE}`);
    return 1;
  }
  if (options.target !== '' && !['dist', 'release', 'all'].includes(options.target)) {
    console.error(`[clean:fail] --target 只接受 dist/release/all,实际 ${options.target}(不做任何删除)`);
    return 1;
  }
  try {
    if (options.target !== '') {
      assertMatchesBuildConfig(readPackageJson());
      const labels = options.target === 'all' ? ['dist', 'release'] : [options.target];
      for (const label of labels) cleanOne(label, TARGET_DIRS[label], options['dry-run']);
    }
    // dump 目录**不**并入 --target all:理由见文件头「默认行为」。--coverage-temp 的落点对账
    // 只在这一条路径上做,不牵动 dist/release 的清理(理由见 assertMatchesCoverageConfig 头注)。
    if (options['coverage-temp']) cleanCoverageTemp(options['dry-run']);
  } catch (error) {
    console.error(`[clean:fail] ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  return 0;
}

const entry = process.argv[1];
if (entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
