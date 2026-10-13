#!/usr/bin/env node
// @ts-check
/**
 * 测试段 **fixture 契约**门禁(纯 Node、无产物、幂等,exit 0/1):每个段必须**显式声明**自己的
 * 验收样例契约,缺声明一律判红。
 *
 * ---- 它守什么 ----
 * 逐个动态 import 段模块后读它的显式导出(`不预筛源码、不解析注释`),三档:
 *   - 导出 `fixtures`(场景名 → md 字符串映射)+ `meta.description` → 合规,交给产物面;
 *   - 导出 `fixtures = null` → **合法终态**(本段无验收样例),不判红、不产出样例;
 *   - 两样都没导出(`absent`) → **判红**(契约缺失不许静默跳过),并点名该段。
 * 已声明档内部另判四族:fixtures 不是映射对象(数组/字符串)、空对象、键名含非法字符、
 * 场景值非 md 字符串、缺 `meta.description`。
 *
 * ---- 为什么它必须独立成一道门禁 ----
 * 「哪些段没样例」这件事原先只存在于 `gates/fixtures/gen-fixtures.mjs` 的契约校验函数体里,
 * 而那段代码是**产物生成器**的一部分:生成器一旦被裁撤或删除,这条规则就跟着消失 ⇒
 * 全仓那批 `fixtures = null` 字面量会**从一条规则退化成裸字面量**(没有规则说「不导出就是缺陷」,
 * 也没有规则说「= null 是合法终态」)。取值:`git grep -l "export const fixtures = null" -- test | wc -l`。
 * 判据与它的消费面解绑后,任一侧消失都不会带走它。
 *
 * ⚠ **为什么它不搬走段 import,只搬判定规则**:段 import 与 electron mock 注册是**产物面**的
 * 共同前置(生成器要读 `fixtures` 内容才能落盘),拆成两个进程等于重复付出 import 全部段的成本,
 * 而判定规则本身是纯函数、可零成本复用。故本模块**import 段**(它自己就是一次完整判定),
 * 生成器则 import 本模块拿判定结果 —— **拆文件不拆进程**,两个进程各跑一次段 import 是有意的:
 * 两条判据(契约齐备 / 产物新鲜)要能**分别归因**。
 *
 * ---- 与同目录另两道门禁的分工(三条判据,同批都要过)----
 *   - 本模块:`gates/fixtures/check-segment-contracts.mjs` —— **契约面**:段有没有显式声明、声明合不合法。
 *   - `gates/fixtures/check-image-digests.mjs` —— **字节面**:图片夹具 sha256 基线;且持有
 *     「`fixtures = null` 是合法终态」的三档判定层(`classifyFixturesDeclaration`)。
 *     本模块的 `validateSegmentContract` **import 那个判定层**而不自己实现(单一来源)。
 *   - `gates/fixtures/gen-fixtures.mjs` —— **产物面**:把声明出来的样例落盘成 `samples/docs/*.md`
 *     并比对。它**调用**本模块的判定,不自己实现(理由同上一条)。
 *
 * ---- 已知不覆盖(登记,不隐藏)----
 *   ① **产物文件名撞车**(跨目录同名段 + 同键互相覆盖)归**产物面**:那判的是「落盘会不会少样例」,
 *      本模块不判(本模块不落盘)。
 *   ② **样例内容是否指向真实源/产物**:本模块只看声明形态,不看 md 内容(那是生成器落盘面与
 *      `shared/geometry/geometry-spec.mjs` 硬编码产物名那一面的事)。
 *
 * 用法:
 *   node gates/fixtures/check-segment-contracts.mjs        # 判定(exit 0/1)
 *   node gates/fixtures/check-segment-contracts.mjs --help
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../../shared/cli.mjs";
import { ROOT } from "../../shared/paths.js";
import { SEGMENT_DIRS } from "../../shared/test-common-surface.js";
// 「空声明是合法终态」的三档判定层的所在地是 check-image-digests.mjs(与图片字节基线同居);
// 本模块是**消费方**:判定层在此 import,不在此实现 —— 两份实现必然漂移,而漂移的后果是
// 「哪些段合法」这个问题在两个文件里给出相反答案。
import { classifyFixturesDeclaration } from "./check-image-digests.mjs";

const USAGE = "用法: node gates/fixtures/check-segment-contracts.mjs [--help]";

/**
 * 候选测试段目录(= test/acceptance.mjs 交给 runAll 的同一份数组,单一来源在
 * shared/test-common-surface.js 的 SEGMENT_DIRS)。
 * 恒等由「同一对象」保证,不再需要两处各写一份 + 文本比对;真正的守门断言在
 * test/gates/fixture-contract.test.js(它守的是「acceptance 确实拿这份数组喂 runner」)。
 */
export const FIXTURE_SEGMENT_DIRS = SEGMENT_DIRS;

/**
 * import 豁免白名单:仅登记「纯 Node 下确实无法 import」的段。当前为空——全部段在
 * 纯 Node + electron-mock 下均可 import(mock 覆盖由 test/core/electron-mock-coverage.test.js
 * 静态守护)。确需豁免时按 { segment, reason } 登记并写明理由:理由为空、段名已不存在
 * (改名/删除后残留)、或该段已能正常 import(豁免失效)均判红,防白名单沦为永久盲区。
 * @type {{segment: string, reason: string}[]}
 */
export const SEGMENT_EXEMPTIONS = [];

/**
 * fixtures 键名:直接作产物文件名后缀,故只允许文件名字符(不做静默替换)。
 * **单一来源**:契约校验判红(非法键)与产物面剔除非法键(不再产出坏文件名)读同一份。
 * @type {RegExp}
 */
export const FIXTURE_KEY_RE = /^[A-Za-z0-9_-]+$/;

/**
 * 扫描面(候选测试段)数下限:防空门禁。
 *
 * 段目录表被搬走 / `SEGMENT_DIRS` 拼错 / 段整体迁到别的树,都会让本门禁在**零扫描面**下
 * 「全绿」—— 而恒绿是这类门禁最坏的失效形态(没人会去看一个总是 exit 0 的脚本)。
 * 取值刻意远低于实测段数:它只负责挡「塌缩到几乎没扫到东西」,不随日常增删段抖动。
 * 取当前实测值跑 `node gates/fixtures/check-segment-contracts.mjs`(结论行里的「扫描 N 个测试段」)。
 * @type {number}
 */
export const MIN_SEGMENTS = 20;

/**
 * 值类型的可读标签(错误信息用)
 * @param {unknown} v 待描述的值
 * @returns {string}
 */
function describeValue(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "数组";
  return typeof v;
}

/**
 * 递归列出目录下的段文件(相对该目录的 posix 路径;同层按文件名码位序,同层文件先于其子目录)。
 * 递归而非单层:段路径镜像被测主体路径(ADR-062「位置即身份」),故段会放进二级目录
 * (如 test/gates/repo/)—— 单层扫描会漏掉它们,而漏掉的段恰好走「无 fixtures → 跳过」分支,
 * 产物不完整也没人知道。与 runner.js 的 listSegmentFiles 同口径(两处各自实现是因为它们
 * 分别面向同步/异步 API,口径由 fixture-contract.test.js 的对读断言强制同形)。
 * @param {string} dir 目录绝对路径
 * @param {string} relPrefix 递归内部用的相对前缀
 * @returns {string[]} 相对 dir 的 posix 路径(发现顺序)
 */
function listSegmentFilesRecursive(dir, relPrefix = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = [];
  const subdirs = [];
  for (const entry of entries) {
    const rel = relPrefix === "" ? entry.name : `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) subdirs.push({ name: entry.name, rel });
    else if (entry.name.endsWith(".test.js")) files.push(rel);
  }
  for (const sub of subdirs) files.push(...listSegmentFilesRecursive(path.join(dir, sub.name), sub.rel));
  return files;
}

/**
 * 列出候选测试段(目录内递归,同层文件名排序,保证幂序)。
 * 只读目录项、不读源码:「有没有 fixture」由 import 后的显式契约决定,不做文本预筛。
 * @returns {{name: string, file: string, relDir: string, baseName: string}[]}
 */
export function listCandidateSegments() {
  const segments = [];
  // 去重键 = 段文件的解析后绝对路径:段目录表出现祖先/后代对(如同时含 gates 与 gates/repo)
  // 时同一文件会被两条路径各列一次,不按该键去重就会 import 它两次(重复跑契约校验、
  // README 里多一行)。口径与 runner.js discoverSegmentsDetailed 的去重键同源。
  const seen = new Set();
  for (const relDir of FIXTURE_SEGMENT_DIRS) {
    const dir = path.join(ROOT, "test", relDir);
    for (const relFile of listSegmentFilesRecursive(dir)) {
      const file = path.join(dir, relFile);
      if (seen.has(file)) continue;
      seen.add(file);
      segments.push({
        // 段名与 relDir 都带子目录(二级段 = gates/repo/y.test.js):段名必须与 runner 的
        // discoverSegments 逐字一致(判据见 test/gates/fixture-contract.test.js 第 1/2 组),
        // relDir 则直接进 README 的 `test/<relDir>/<baseName>.test.js` 一列。
        name: `${relDir}/${relFile}`,
        file,
        relDir,
        baseName: path.basename(relFile, ".test.js"),
      });
    }
  }
  return segments;
}

/**
 * 校验单段的 fixture 显式契约,返回问题清单(空数组 = 契约完整)。
 * 纯函数(只读传入的模块命名空间),便于守护档用合成模块逐条覆盖失败模式。
 * @param {string} name 段名(错误定位用)
 * @param {Record<string, unknown>} mod 段模块命名空间
 * @returns {string[]}
 */
export function validateSegmentContract(name, mod) {
  /** @type {string[]} */
  const problems = [];
  // 三档判定(缺声明 / 空声明 / 已声明)的所在地是 check-image-digests.mjs:
  // 「= null 是合法终态」是那批空声明的唯一合法性来源,判定体不随生成器的去留消失。
  const declaration = classifyFixturesDeclaration(mod);
  if (declaration === "absent") {
    return [
      `${name}:未显式声明 fixture 契约——导出 fixtures(场景 → md 字符串映射)或 fixtures = null(本段无验收样例)`,
    ];
  }
  if (declaration === "null-terminal") return problems; // 显式声明「本段无样例」:合法终态
  // 收窄不是类型谎言:`declared` 档的定义就是「导出了 fixtures 且非 null」,只是 TS 看不穿
  // 跨函数的分类返回值(下面的 typeof/Array.isArray 两档判红因此仍照常生效)。
  const fixtures = /** @type {Record<string, unknown>} */ (mod.fixtures);
  if (typeof fixtures !== "object" || Array.isArray(fixtures)) {
    return [`${name}:fixtures 必须是场景映射对象或 null,实际 ${describeValue(fixtures)}`];
  }
  const entries = Object.entries(fixtures);
  if (entries.length === 0) {
    return [`${name}:fixtures 为空对象——本段若无样例请显式写 fixtures = null(空对象会让人以为漏填场景)`];
  }
  const badKeys = entries.map(([key]) => key).filter((key) => !FIXTURE_KEY_RE.test(key));
  if (badKeys.length > 0) {
    problems.push(`${name}:fixtures 键名只允许 [A-Za-z0-9_-](直接作产物文件名后缀),非法键:${badKeys.join(", ")}`);
  }
  const badValues = entries.filter(([, v]) => typeof v !== "string").map(([key]) => key);
  if (badValues.length > 0) {
    problems.push(`${name}:fixtures 场景值必须是 md 字符串,以下键不是:${badValues.join(", ")}`);
  }
  const description = /** @type {{ description?: unknown } | undefined} */ (mod.meta)?.description;
  if (typeof description !== "string" || description.trim() === "") {
    problems.push(`${name}:缺 meta.description(README 索引文案取自该显式字段,不再解析文件头注释)`);
  }
  return problems;
}

/** 注册 electron mock 解析器(必须早于任何段模块 import);Node 过旧 → 硬失败而非跳过 */
async function registerElectronMock() {
  const { register } = await import("node:module");
  if (typeof register !== "function") {
    throw new Error("当前 Node 不支持 module.register,无法在纯 Node 下加载段模块(需 Node >= 20.6)");
  }
  register("../../test/harness/electron-mock-loader.mjs", import.meta.url);
}

/** 段模块 import 失败的归一化诊断(段名 + 归因;区分 dist 缺失与 mock 缺命名导出)
 * @param {string} name 段名
 * @param {unknown} err import 抛出的原值
 * @returns {string}
 */
function describeImportFailure(name, err) {
  // 抛出的原值不保证是 Error,带 message 属性的对象按其 message 归因,其余按 toString
  const rawMessage = /** @type {{ message?: unknown }} */ (err)?.message ?? err;
  // String(...) 的 split 结果恒至少一段,?? "" 只是满足定长元组索引的取值域
  const msg = String(rawMessage).split("\n")[0] ?? "";
  // Node 的缺导出报错形如:The requested module 'X' does not provide an export named 'Y'
  // 该文案对**任意**模块都会抛,故必须先看 X 是谁 —— 否则任何模块缺导出都会被误报成
  // 「electron-mock 缺命名导出」,把人指向完全错误的文件。实测踩过的坑:gate-probes 段导入
  // gates/probe/gate-probes/judge.mjs 失败(它当时确实缺一个导出),却被报成「electron-mock
  // 缺 finalizeGate」,排查方向被整体带偏到无关文件。
  const missingExport = msg.match(
    /requested module ['"]([^'"]+)['"][^\n]*does not provide an export named ['"]([^'"]+)['"]/i,
  );
  if (missingExport) {
    const moduleName = missingExport[1] ?? "?";
    const exportName = missingExport[2] ?? "?";
    // 仅当出错的模块确为 electron(经 electron-mock loader 解析)时,才归因到 electron-mock
    if (/electron/i.test(moduleName)) {
      return `${name}:段模块 import 失败——electron-mock 缺命名导出「${exportName}」(补进 test/harness/electron-mock.mjs;自动断言见 test/core/electron-mock-coverage.test.js)`;
    }
    return `${name}:段模块 import 失败——模块 ${moduleName} 未导出「${exportName}」(该模块自身的导出问题,**不是** electron-mock;若它确应提供此导出请补齐,否则检查它的调用方)`;
  }
  if (/dist[\\/]/.test(msg)) {
    return `${name}:段模块 import 失败(段模块依赖 dist/ 编译产物,请先 npm run build):${msg}`;
  }
  return `${name}:段模块 import 失败:${msg}`;
}

/**
 * @typedef {object} LoadedSegment 一段「import 成功且契约齐备」的段及其模块命名空间
 * @property {{name: string, file: string, relDir: string, baseName: string}} seg 段描述
 * @property {Record<string, unknown>} mod 段模块命名空间(供产物面读 fixtures / meta)
 */

/**
 * 收集全部候选段的显式契约(段 import + 豁免白名单自检 + 逐段契约校验)。
 *
 * **产物面复用本函数**(而不是自己再写一遍 import 循环):契约判红与「该段不产出产物」是
 * **前后置**关系(判红 ⇒ 跳过该段 ⇒ 该段不产出任何产物),两处各判一次必然漂移,而漂移的后果是
 * 「契约判红却照样落了盘」或「契约合规却没产物」,两种都静默。
 * @returns {Promise<{
 *   segments: {name: string, file: string, relDir: string, baseName: string}[],
 *   loaded: LoadedSegment[],
 *   problems: string[],
 *   exemptSkipped: number,
 * }>}
 */
export async function collectSegmentContracts() {
  await registerElectronMock();
  const segments = listCandidateSegments();
  const exemptReasons = new Map(SEGMENT_EXEMPTIONS.map((e) => [e.segment, e.reason]));
  const known = new Set(segments.map((s) => s.name));
  /** @type {string[]} */
  const problems = [];

  // 白名单自检:理由缺失 / 段名已不存在(改名或删除后残留)先判红,免得豁免悄悄失效
  for (const e of SEGMENT_EXEMPTIONS) {
    if (typeof e.reason !== "string" || e.reason.trim() === "") {
      problems.push(`豁免登记「${e.segment}」未注明理由:SEGMENT_EXEMPTIONS 每条都须写清为何该段在纯 Node 下不可 import`);
    }
    if (!known.has(e.segment)) {
      problems.push(`豁免登记「${e.segment}」已不是现存测试段(段改名/删除后残留,请删除该条目)`);
    }
  }

  /** @type {LoadedSegment[]} */
  const loaded = [];
  let exemptSkipped = 0;
  for (const seg of segments) {
    /** @type {Record<string, unknown>} */
    let mod;
    try {
      mod = await import(pathToFileURL(seg.file).href);
    } catch (err) {
      const reason = exemptReasons.get(seg.name);
      if (reason === undefined) {
        problems.push(describeImportFailure(seg.name, err));
        continue;
      }
      exemptSkipped += 1;
      console.warn(`[segment-contracts] 按白名单豁免跳过 ${seg.name}:${reason}`);
      continue;
    }
    // 豁免失效:该段已能正常 import → 白名单条目是多余盲区,判红促清理
    if (exemptReasons.has(seg.name)) {
      problems.push(
        `豁免登记「${seg.name}」已失效:该段现在能正常 import,请删除 SEGMENT_EXEMPTIONS 中的对应条目(原理由:${exemptReasons.get(seg.name)})`,
      );
    }
    const segProblems = validateSegmentContract(seg.name, mod);
    if (segProblems.length > 0) {
      problems.push(...segProblems);
      continue;
    }
    loaded.push({ seg, mod });
  }

  return { segments, loaded, problems, exemptSkipped };
}

/**
 * 门禁入口。
 * @param {string[]} [argv]
 * @returns {Promise<number>} 退出码
 */
export async function main(argv = []) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  // 判定分支**不接受任何参数**:`--help` 已在上方返回,余下每一个 token 都是多余的。
  // 刻意严格而不是「放行以 `--` 开头的」:拼错的旗标静默忽略等于把「跑错了」变成
  // 「跑了一次判定」—— 那是一次看着成功的空操作。
  if (argv.length > 0) {
    console.error(`[segment-contracts:fail] 无法识别的参数:${argv.join(" ")}(${USAGE})`);
    return 1;
  }

  /** @type {Awaited<ReturnType<typeof collectSegmentContracts>>} */
  let result;
  try {
    result = await collectSegmentContracts();
  } catch (error) {
    console.error(
      `[segment-contracts:fail] 段扫描失败:${error instanceof Error ? error.message : String(error)}`,
      "(段目录读不到时会出现 —— 判红不放行:「没扫到」与「扫过且合规」在门禁上不可区分)",
    );
    return 1;
  }

  const scanned = result.segments.length;
  // 塌缩下限先于逐段判定:零扫描面时逐段判定零问题,若不先断非空,本门禁会「全绿」。
  if (scanned < MIN_SEGMENTS) {
    console.error(
      `[segment-contracts:fail] 扫描面塌缩:只扫到 ${scanned} 个测试段,低于下限 ${MIN_SEGMENTS}`
        + "(SEGMENT_DIRS 被改坏 / 段整体迁走时会出现;此时本门禁恒绿,等于不存在)",
    );
    return 1;
  }

  if (result.problems.length > 0) {
    for (const problem of result.problems) console.error(`[segment-contracts:fail] ${problem}`);
    console.error(
      `[segment-contracts:fail] 测试段 fixture 契约判定失败,共 ${result.problems.length} 项`
        + `(扫描 ${scanned} 个测试段)。契约缺失一律判红,不静默跳过 —— 每个段都必须显式声明`
        + "`fixtures`(场景 → md 字符串映射)或 `fixtures = null`(本段无验收样例),"
        + "并给出 `meta.description`。",
    );
    return 1;
  }
  const nullTerminal = result.loaded.filter((entry) => entry.mod.fixtures === null).length;
  const exemptNote = result.exemptSkipped > 0 ? `,${result.exemptSkipped} 段按白名单豁免` : "";
  console.log(
    `[ok] 测试段 fixture 契约判定通过:扫描 ${scanned} 个测试段,显式契约齐备`
      + `(其中 ${nullTerminal} 段声明 fixtures = null = 本段无验收样例)${exemptNote}`,
  );
  return 0;
}

// 仅 CLI 直跑时执行;被生成器与守护段 import 复用判定层时不得触发任何副作用。
if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`[segment-contracts:fail] 失败:${err?.stack ?? err}`);
      process.exitCode = 1;
    });
}