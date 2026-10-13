#!/usr/bin/env node
// @ts-check
/**
 * 验收 md 样例生成器(纯 Node,无 Electron 依赖):
 * 扫描 test/core、test/main、test/renderer、test/gates 下的 *.test.js(目录集合的单一来源是
 * shared/test-common-surface.js 的 SEGMENT_DIRS,与 test/acceptance.mjs 交给 runner
 * 的段目录是**同一数组对象**,恒等断言见 test/gates/fixture-contract.test.js),
 * **逐个动态 import 后读显式契约**——不预筛源码、不解析注释:
 * - `fixtures`:key=场景名,value=md 字符串;不产出样例的段显式写 `fixtures = null`;
 * - `meta.description`:README 索引文案(显式字段,取代「取文件头 JSDoc 首行」)。
 * 落盘 samples/docs/<段基名>[-<场景>].md,复制 md 中引用的本地图片
 * (引用路径不改写,GUI 按 md 所在目录解析),最后生成 README.md 索引。
 * 幂等:同一输入重复生成结果逐字节一致。
 *
 * 图片夹具另有**字节基线**判据(与「复制」正交,两条都要过):
 * - 「复制」只覆盖**被生成样例引用到**的图片(源 ↔ docs/ 副本),回答的是
 *   「生成产物是否新鲜」;
 * - 「基线」覆盖 samples 下**全部**图片夹具(磁盘派生),回答的是「夹具本身有没有漂移」。
 *   两者的失效面互补:未被任何样例引用的夹具(manual/images/、input/ 下的图)从前者眼里
 *   根本不存在,而**源与副本同时被改**(如批量截断、重新导出)时后者恒绿 —— 曾发生的真实
 *   误判正是后者:全部图片夹具各少一字节时 `--check` 判绿,而 image-size / basic-render
 *   两段判红,排查一度指向代码回归。
 *
 * ⚠ **基线那一面已独立成门禁**(判定体与 `--print-image-baseline` 都在
 * `gates/fixtures/check-image-digests.mjs`):本文件不再持有基线表与字节审计。
 * 原因是它的存续不能系于本生成器的去留 —— 那批图没有第二个判据在看它们(见该模块文件头)。
 * 「契约缺失一律判红」这条不变,故 `--check` 仍会跑一遍基线审计(生成器侧仍 import 判定体),
 * 两道门禁由此对同一批字节给出两个可分别归因的结论。
 *
 * 契约缺失一律判红(不静默跳过):段 import 失败、未显式导出 fixtures、fixtures 无可用
 * 场景/值非字符串/键名非法、缺 meta.description、产物文件名撞车,或白名单里的豁免
 * 已失效 → 打印全部问题并 exit 1。确因纯 Node 环境无法 import 的段才可登记进
 * SEGMENT_EXEMPTIONS(须写理由,理由为空或段已不存在同样判红)。
 *
 * 用法:
 *   node gates/fixtures/gen-fixtures.mjs                      # 生成(需先 npm run build)
 *   node gates/fixtures/gen-fixtures.mjs --check              # 内存重生成比对,有差异 exit 1
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, FIXTURES_DIR } from "../../shared/paths.js";
import { SEGMENT_DIRS } from "../../shared/test-common-surface.js";
// 基线那一面(字节表 / 盘点 / 审计 / 空声明合法终态判定层)的所在地已独立成门禁;
// 本文件是**消费方**:判定体在此 import,不在此实现(理由见文件头与该模块文件头)。
import {
  IMAGE_DIGEST_BASELINE,
  auditImageDigests,
  classifyFixturesDeclaration,
  listImageFixtures,
} from "./check-image-digests.mjs";

const GENERATED_DOCS_DIR = path.join(FIXTURES_DIR, "docs");
const CHECK = process.argv.includes("--check");

/**
 * 候选测试段目录(= test/acceptance.mjs 交给 runAll 的同一份数组,单一来源在
 * test/harness/test-common-surface.js 的 SEGMENT_DIRS)。
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

/* ---------- md 图片引用解析(「复制」那一面:产物新鲜度) ---------- */

/** md 中图片引用:![...](path) 与 src="path" */
const IMG_MD_RE = /!\[[^\]]*\]\(([^)]+)\)/g;
const IMG_SRC_RE = /src="([^"]+)"/g;

/** fixtures 键名:直接作产物文件名后缀,故只允许文件名字符(不做静默替换) */
const FIXTURE_KEY_RE = /^[A-Za-z0-9_-]+$/;

const README_HEADER = [
  "# 验收样例",
  "",
  "由 `gates/fixtures/gen-fixtures.mjs` 从测试段命名导出自动生成(勿手改),",
  "供 GUI 人工实测直接拖入。重新生成:`npm run gen:fixtures`;校验:`npm run check:fixtures`。",
  "",
  "| 文件 | 功能/场景 | 对应测试段 |",
  "| --- | --- | --- |",
];

/** 值类型的可读标签(错误信息用)
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
 * 分别面向异步/同步 API,口径由 fixture-contract.test.js 的对读断言强制同形)。
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
        // discoverSegments 逐字一致(判据见 test/gates/fixture-contract.test.js 第 2 组),
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
 * 纯函数(只读传入的模块命名空间),便于守护段用合成模块逐条覆盖失败模式。
 * @param {string} name 段名(错误定位用)
 * @param {Record<string, unknown>} mod 段模块命名空间
 * @returns {string[]}
 */
export function validateSegmentContract(name, mod) {
  /** @type {string[]} */
  const problems = [];
  // 三档判定(缺声明 / 空声明 / 已声明)在 gates/fixtures/check-image-digests.mjs:
  // 「= null 是合法终态」是那 100 多处空声明的唯一合法性来源,判定体不随本生成器的去留消失。
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

/**
 * 段 + fixtures → 产物清单(键名排序保证幂等;键 main 落 <段基名>.md,其余加后缀)。
 * 非法键在此剔除(validateSegmentContract 已就该情况判红,这里只是不再产出坏文件名)。
 * @param {{baseName: string}} seg
 * @param {Record<string, string>} fixtures
 * @returns {{name: string, content: string, key: string}[]}
 */
export function planFixtureOutputs(seg, fixtures) {
  return Object.keys(fixtures)
    .filter((key) => typeof fixtures[key] === "string" && FIXTURE_KEY_RE.test(key))
    .sort()
    .map((key) => ({
      name: key === "main" ? `${seg.baseName}.md` : `${seg.baseName}-${key}.md`,
      // 上方 filter 已断言值为字符串(非字符串键不进产物)
      content: /** @type {string} */ (fixtures[key]),
      key,
    }));
}

/**
 * 产物文件名全局查重:跨目录同名段 + 同键会互相覆盖(静默丢样例,最难察觉)。
 * @param {{relDir: string, baseName: string, outputs: {name: string, key: string}[]}[]} entries
 * @returns {string[]}
 */
export function findOutputNameCollisions(entries) {
  const owner = new Map();
  const problems = [];
  for (const e of entries) {
    for (const o of e.outputs) {
      const first = owner.get(o.name);
      if (first === undefined) {
        owner.set(o.name, e);
        continue;
      }
      problems.push(
        `${o.name}:${first.relDir}/${first.baseName}.test.js 与 ${e.relDir}/${e.baseName}.test.js 的场景产物重名(会互相覆盖)`,
      );
    }
  }
  return problems;
}

/**
 * README 索引正文(描述取自 meta.description 显式字段)。
 * 多场景段共用一条描述,追加 fixtures 键名(即文件名后缀)消歧;单场景段保持原描述。
 * @param {{relDir: string, baseName: string, description: string, outputs: {name: string, key: string}[]}[]} entries
 * @returns {string}
 */
export function buildReadme(entries) {
  const lines = [...README_HEADER];
  for (const e of entries) {
    for (const o of e.outputs) {
      const multi = e.outputs.length > 1;
      const desc = ((multi ? `${e.description}(场景:${o.key})` : e.description) || "-").replace(/\|/g, "\\|");
      lines.push(`| ${o.name} | ${desc} | test/${e.relDir}/${e.baseName}.test.js |`);
    }
  }
  return `${lines.join("\n")}\n`;
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
  // gates/probe/gate-probes/judge.mjs 失败(它当时确实缺一个导出),却被报成「electron-mock 缺
  // finalizeGate」,排查方向被整体带偏到无关文件。
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

/** 收集 md 中的本地图片引用(排除外链/锚点/data URI,剥离 title 与尖括号)
 * @param {string} md md 文本
 * @returns {string[]} 引用路径(去重)
 */
function collectImageRefs(md) {
  const refs = new Set();
  for (const re of [IMG_MD_RE, IMG_SRC_RE]) {
    for (const m of md.matchAll(re)) {
      // 两个模式的捕获组均为必选,?? "" 只是满足定长元组索引的取值域
      let p = (m[1] ?? "").trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
      if (!p || /^https?:\/\//i.test(p) || /^#/.test(p) || /^data:/i.test(p)) continue;
      refs.add(p);
    }
  }
  return [...refs];
}

/** 首处差异行号(1 起;一致返回 -1)
 * @param {string} a 现有文本
 * @param {string} b 应生成文本
 * @returns {number}
 */
function firstDiffLine(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) return i + 1;
  }
  return -1;
}

// --check 比对前做 EOL 归一化(CRLF→LF):生成器落盘 LF,但 Windows autocrlf 下
// checkout 会把工作区文本产物转成 CRLF。.gitattributes 已固定
// fixtures 的 eol=lf,此处归一化是双保险——即使属性未生效/旧 checkout 也不误报。
const normalizeEol = (/** @type {string} */ s) => s.replace(/\r\n/g, "\n");

async function collectContracts() {
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

  const entries = [];
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
      console.warn(`[gen-fixtures] 按白名单豁免跳过 ${seg.name}:${reason}`);
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
    if (mod.fixtures === null) continue;
    const outputs = planFixtureOutputs(seg, /** @type {Record<string, string>} */ (mod.fixtures));
    entries.push({
      relDir: seg.relDir,
      baseName: seg.baseName,
      // validateSegmentContract 已判定 description 为非空字符串
      description: /** @type {{ description: string }} */ (mod.meta).description,
      outputs,
    });
  }

  problems.push(...findOutputNameCollisions(entries));
  // 排序保证幂等(README 行序与写盘顺序一致);同名段以目录名定序,避免跨目录抖动
  entries.sort((a, b) => a.baseName.localeCompare(b.baseName) || a.relDir.localeCompare(b.relDir));
  return { segments, entries, problems, exemptSkipped };
}

export async function main() {
  await registerElectronMock();
  const { segments, entries, problems, exemptSkipped } = await collectContracts();

  if (problems.length > 0) {
    console.error(`[gen-fixtures] 显式契约校验失败(${problems.length} 项;不静默跳过,请逐条修):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  // 图片复制清单(去重;源不存在 → 跳过,该样例本就是演示缺失警告)
  /** @type {{ src: string, dest: string }[]} */
  const imageCopies = [];
  for (const e of entries) {
    for (const o of e.outputs) {
      for (const ref of collectImageRefs(o.content)) {
        const src = path.resolve(FIXTURES_DIR, ref);
        if (!src.startsWith(FIXTURES_DIR + path.sep)) continue; // 防跳出 fixtures
        if (!fs.existsSync(src) || !fs.statSync(src).isFile()) continue;
        const dest = path.join(GENERATED_DOCS_DIR, ref);
        if (!imageCopies.some((c) => c.dest === dest)) imageCopies.push({ src, dest });
      }
    }
  }

  const readme = buildReadme(entries);
  const outputCount = entries.reduce((n, e) => n + e.outputs.length, 0);

  // ---- --check:内存重生成比对,不落盘 ----
  if (CHECK) {
    let ok = true;
    /**
     * 记一条差异(逐条列全,退出码统一在末尾给)
     * @param {string} name 产物文件名
     * @param {string} detail 差异描述
     */
    const report = (name, detail) => {
      ok = false;
      console.error(`[check] ${name}:${detail}`);
    };
    for (const e of entries) {
      for (const o of e.outputs) {
        const file = path.join(GENERATED_DOCS_DIR, o.name);
        if (!fs.existsSync(file)) {
          report(o.name, " 缺失(应生成)");
          continue;
        }
        const existing = normalizeEol(fs.readFileSync(file, "utf8"));
        if (existing !== o.content) {
          const line = firstDiffLine(existing, o.content);
          const ex = existing.split("\n")[line - 1] ?? "<无此行>";
          const want = o.content.split("\n")[line - 1] ?? "<无此行>";
          report(o.name, ` 内容不一致(首处差异第 ${line} 行)\n    现有: ${ex}\n    应生成: ${want}`);
        }
      }
    }
    const readmeFile = path.join(GENERATED_DOCS_DIR, "README.md");
    if (!fs.existsSync(readmeFile)) {
      report("README.md", " 缺失(应生成)");
    } else {
      const existing = normalizeEol(fs.readFileSync(readmeFile, "utf8"));
      if (existing !== readme) {
        report("README.md", ` 内容不一致(首处差异第 ${readme === "" ? "-" : firstDiffLine(existing, readme)} 行)`);
      }
    }
    for (const c of imageCopies) {
      if (!fs.existsSync(c.dest)) {
        report(path.relative(GENERATED_DOCS_DIR, c.dest), " 图片缺失(应复制)");
        continue;
      }
      if (!fs.readFileSync(c.src).equals(fs.readFileSync(c.dest))) {
        report(path.relative(GENERATED_DOCS_DIR, c.dest), " 图片与源文件字节不一致");
      }
    }
    // 全部图片夹具的字节基线(覆盖面大于上面的复制清单,两者互补;判红逐条点名文件)
    const imageProblems = auditImageDigests(listImageFixtures(), IMAGE_DIGEST_BASELINE);
    for (const p of imageProblems) report("图片夹具", ` ${p}`);
    if (!ok) {
      console.error("[gen-fixtures] --check 失败:docs/ 与生成内容存在差异,或图片夹具字节漂移");
      process.exit(1);
    }
    const exemptNote = exemptSkipped > 0 ? ` + ${exemptSkipped} 段按白名单豁免` : "";
    console.log(
      `[gen-fixtures] --check 通过:${entries.length} 段 ${outputCount} 个 md + README.md + ${imageCopies.length} 个图片复制 + 全部 ${listImageFixtures().length} 个图片夹具字节与基线一致(扫描 ${segments.length} 段${exemptNote})`,
    );
    process.exit(0);
  }

  // ---- 落盘 ----
  fs.mkdirSync(GENERATED_DOCS_DIR, { recursive: true });
  for (const e of entries) {
    for (const o of e.outputs) {
      // 守卫(2026-08-24 CI 踩坑):fixture 含本机绝对路径 → 其他检出路径重新生成必漂移
      //(merge.md 曾把 C:/Users/... 写入入库内容,CI 上 --check 全量误报)。宁可本地
      // 生成期响亮失败,也不让机器相关路径进库;测试段应导出相对引用或脱敏内容。
      if (o.content.includes(ROOT)) {
        console.error(`[gen-fixtures] 拒绝落盘:${o.name} 含仓库绝对路径(${ROOT})——请在测试段导出前还原为相对引用`);
        process.exit(1);
      }
      fs.writeFileSync(path.join(GENERATED_DOCS_DIR, o.name), o.content, "utf8");
    }
  }
  for (const c of imageCopies) {
    fs.mkdirSync(path.dirname(c.dest), { recursive: true });
    fs.copyFileSync(c.src, c.dest);
  }
  fs.writeFileSync(path.join(GENERATED_DOCS_DIR, "README.md"), readme, "utf8");

  const exemptNote = exemptSkipped > 0 ? `,${exemptSkipped} 段按白名单豁免` : "";
  console.log(`[gen-fixtures] 扫描 ${segments.length} 个测试段(契约齐备),${entries.length} 段含 fixtures 导出${exemptNote}`);
  for (const e of entries) {
    for (const o of e.outputs) {
      console.log(`  + ${o.name} (${o.content.length} 字符,${e.description || "-"})`);
    }
  }
  for (const c of imageCopies) {
    console.log(`  + 图片 ${path.relative(GENERATED_DOCS_DIR, c.dest)} (${fs.statSync(c.src).size} 字节)`);
  }
  console.log(`  + README.md (${entries.length} 行索引)`);
  console.log(`[gen-fixtures] 完成:${path.relative(ROOT, GENERATED_DOCS_DIR)}/`);
}

// 仅 CLI 直跑时执行;被测试段 import 复用纯函数时不得触发任何副作用
// (尤其不能 register electron mock loader——那会污染宿主进程的 electron 解析)
const isCli =
  process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCli) {
  // 旧旗标 `--print-image-baseline` 已随字节基线搬到 check-image-digests.mjs。这里**显式拒绝**
  // 而不是静默忽略:静默忽略会让「照旧文档跑登记」的人**重新生成一批样例**却以为登记了基线,
  // 而生成是幂等的、不报任何错 ⇒ 那是一次无人察觉的空操作。
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    console.error(
      `[gen-fixtures] 无法识别的参数:${unknown.join(" ")}(本脚本只接受 --check;`
        + "图片字节基线的登记命令是 node gates/fixtures/check-image-digests.mjs --print-image-baseline)",
    );
    process.exit(1);
  }
  // ⚠ 基线审计本身仍在本脚本的 `--check` 里跑一遍(判定体自 check-image-digests.mjs import):
  // 两道门禁对同一批字节给出两个可分别归因的结论,而不是二选一。
  main().catch((err) => {
    console.error(`[gen-fixtures] 失败:${err?.stack ?? err}`);
    process.exit(1);
  });
}
