// @ts-check
/**
 * 承重共享库段(位于 test/gates/supply/supply/ = 镜像 gates/supply/supply/supply-common.mjs,
 * 纯 Node 逻辑,不经 dist 编译产物):**供应链五个门禁本体压在同一份判定口径上** ——
 * check-supply-chain / gen-sbom / gen-licenses / sca-audit / collect-license-fulltext 都从这里
 * 取「什么是组件、什么是生产依赖、哪些许可证要人工复核、产物放哪」。口径一旦各脚本复制一份,
 * 就会出现「SBOM 说 N 个生产组件、许可证清单说 N-1 个」这种无法从产物反查的漂移。
 *
 * 本段按**用途**归组(不是按导出逐个列存在性 —— 存在性清单在改名时才红,且永远发现不了死导出):
 *   1. 许可证分类口径:把上游 license 表达式收敛成 6 个分组,决定 NOTICE 分段与是否需人工复核
 *   2. 随包许可证文件识别:lockfile 无字段时的第二级回落,记下证据文件名与「认不出」结局
 *   3. 多许可文件形态识别:诊断层如实列出文件里全部候选并给「声明是否在其中」对照(只增信息不放宽)
 *   4. 多选一分支决策:人的拍板落成可审计清单,对不上上游现状一律不生效
 *   5. semver 与严重度换算:让 OSV 与 npm audit 的严重度可同口径比较
 *   6. npm 镜像口径:门禁结论只由仓库内配置决定,本机差异不得让 CI 与本地分叉
 *   7. lockfile 组件模型:SBOM / 许可证清单 / SCA 共用同一份「谁是组件、属于哪棵树」
 *   8. 产物序列化与 CLI/平台约定:同输入逐字节一致的落盘口径 + 跨平台 npm 调用
 *   9. 导出面自述:门禁消费面与本段覆盖面必须对齐,死导出清单必须显式登记
 *
 * 断言方式:纯函数直测 + 临时目录沙盒(lockfile / 包目录 / .npmrc),断言**具体取值与判定分支**
 * (分组、原因码、证据文件名、版本是否落入范围),只看「没抛错」会让判据形同虚设。
 * 沙盒纪律:不读用户真实文件系统状态、不触网、不跑真实装卸。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// 仓根取单源,不按本文件位置自算 —— 门禁 gates/repo/check-import-boundary.mjs 的
// no-self-computed-root 对 `test/harness/paths.js` 单点豁免,其余任何自算写法即判红。
// 自算的代价是「深度耦合」:目录一挪,全仓这类行会一起错,而每处都「看起来对」。
import { ROOT } from "../../../harness/paths.js";
import { createCaseSuite } from "../../../harness/case.js";
import { removeTree } from "../../../harness/temp-resource.js";
import { hashBuffer as fsxHashBuffer, toPosix as fsxToPosix, writeFileAtomic as fsxWriteFileAtomic } from "../../../../shared/fsx.mjs";
import { isMainModule as cliIsMainModule } from "../../../../shared/cli.mjs";
import { runCommand as probeRunCommand } from "../../../../gates/repo/print-env-fingerprint.mjs";
import {
  BLOCKING_SEVERITIES,
  DECISION_STATUS,
  LICENSE_DECISIONS_FILE,
  LICENSE_DECISIONS_SCHEMA,
  LICENSE_FILE_EXTENSIONS,
  LICENSE_FILE_STATUS,
  LICENSE_FILE_STEMS,
  LICENSE_GROUPS,
  LICENSE_GROUP_TITLES,
  LICENSE_SHAPE,
  LICENSE_SOURCE_LOCKFILE,
  LICENSE_SOURCE_NONE,
  LICENSE_SOURCE_PACKAGE_FILE,
  LICENSE_TEXT_MARKERS,
  NOASSERTION,
  SCOPE_DEVELOPMENT,
  SCOPE_PRODUCTION,
  SEVERITY_ORDER,
  SUPPLY_OUTPUT_DIR,
  classifyLicense,
  compareSemver,
  componentEdges,
  createDecisionIndex,
  cvss3BaseScore,
  detectLicenseFromText,
  detectLicensesInText,
  detectPackageLicense,
  errorMessage,
  expressionIncludesBranch,
  listLicenseFiles,
  loadLicenseDecisions,
  lockComponents,
  normalizeSeverity,
  npmInvocation,
  parseSupplyArgs,
  parseVersionRange,
  readJson,
  readLockfile,
  resolveDepPath,
  resolveLicenseDecision,
  resolveObligationSummary,
  resolveRegistry,
  serializeJson,
  severityFromScore,
  versionSatisfies,
  writeJson,
  hashBuffer,
  isMainModule,
  runCommand,
  toPosix,
  writeFileAtomic,
} from "../../../../gates/supply/supply/supply-common.mjs";

const suite = createCaseSuite();

/**
 * 断言辅助(局部版:case 级用 test/harness/case.js 的 assert,这里用于非 case 上下文)。
 * 声明为断言函数,让 `assert(x !== undefined)` 之后 TS 真正收窄类型。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`supply-common 断言失败:${msg}`);
}

/**
 * 临时目录 + 兜底清理(测试对象是夹具,finally 保证不留残留)。
 * 清理走 removeTree(带 EBUSY/EPERM 退避重试与删后复查);删不掉仍即抛。
 * @param {(dir: string) => unknown} fn 在临时目录上执行的夹具逻辑
 * @returns {Promise<unknown>} fn 的返回值(透传)
 */
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-supply-common-"));
  try {
    return await fn(dir);
  } finally {
    const outcome = removeTree(dir);
    if (!outcome.ok) throw new Error(`临时目录清理失败:${dir}:${outcome.error?.message ?? "删除后目录仍存在"}`);
  }
}

/**
 * 断言「抛错」并交回错误消息:错误文案本身是契约的一部分(错在哪一步要能反查),
 * 只断言「抛了」会让「因为别的原因炸掉」蒙混过关。
 * @param {() => unknown} fn 待测调用
 * @param {RegExp} expected 期望匹配的错误文案
 * @returns {string} 错误消息
 */
function assertThrows(fn, expected) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(expected.test(message), `错误文案应匹配 ${expected},实际「${message}」`);
    return message;
  }
  throw new Error(`supply-common 断言失败:期望抛错(${expected})但调用正常返回`);
}

/** 沙盒 lockfile 的固定形状:生产 / 仅 dev / dev+optional / 嵌套同名 / 缺声明 五类形态各一 */
const SANDBOX_PACKAGES = {
  "": {
    name: "sandbox-app",
    version: "1.0.0",
    license: "MIT",
    dependencies: { "prod-lib": "^1.0.0", "outer-lib": "^1.0.0", "no-license": "^0.1.0" },
    devDependencies: { "dev-tool": "^2.0.0" },
    optionalDependencies: { "opt-lib": "^1.0.0" },
  },
  "node_modules/prod-lib": {
    version: "1.0.2",
    license: "MIT",
    dependencies: { "shared-lib": "^2.0.0", "both-lib": "^1.0.0" },
    optionalDependencies: { "both-lib": "^1.0.0" },
  },
  "node_modules/prod-lib/node_modules/shared-lib": { version: "2.5.0", license: "ISC" },
  "node_modules/shared-lib": { version: "9.9.9", license: "ISC" },
  "node_modules/both-lib": { version: "1.0.0", license: "MIT" },
  "node_modules/outer-lib": { version: "1.0.0", license: "MIT", peerDependencies: { "absent-peer": "^1.0.0" } },
  "node_modules/other-lib": { version: "1.0.0", license: "MIT", dependencies: { "missing-dep": "^9.0.0" } },
  "node_modules/opt-lib": { version: "1.0.0", devOptional: true, license: "MIT" },
  "node_modules/dev-tool": { version: "2.0.0", dev: true },
  "node_modules/no-license": { version: "0.1.0" },
  "node_modules/outer-lib/node_modules/mid-lib": { version: "1.0.0", license: "MIT" },
  "node_modules/outer-lib/node_modules/mid-lib/node_modules/leaf-lib": { version: "1.0.0", license: "MIT" },
};

/**
 * 造一份沙盒 lockfile 并返回其解析结果(不落盘时用纯对象;落盘时给 readLockfile 用)。
 * @param {string} dir 沙盒目录
 * @param {string} [name] 文件名
 * @returns {{ path: string; lock: any }} lockfile 绝对路径与解析结果
 */
function makeSandboxLock(dir, name = "package-lock.json") {
  const lock = { name: "sandbox-app", version: "1.0.0", lockfileVersion: 3, requires: true, packages: structuredClone(SANDBOX_PACKAGES) };
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  return { path: filePath, lock };
}

/** 门禁本体的仓内绝对目录(第 9 组读源码算覆盖面用) —— 由仓根单源派生,不按本文件位置自算 */
const SUPPLY_GATE_DIR = path.join(ROOT, "gates", "supply", "supply");

/** 五个门禁本体的文件名(它们是 supply-common 的全部生产消费方) */
const GATE_BODIES = ["check-supply-chain.mjs", "gen-sbom.mjs", "gen-licenses.mjs", "sca-audit.mjs", "collect-license-fulltext.mjs"];

/**
 * 从源码文本里取出 `export` 的**具名**清单(不含 default;本模块没有 default 导出)。
 * 两种形态都要收:`export const/function X` 与 `export { a, b }` 的转出。
 * @param {string} source 模块源码
 * @returns {string[]} 导出名(升序)
 */
function readExportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/^export\s+(?:const|function)\s+([A-Za-z0-9_$]+)/gm)) {
    if (match[1] !== undefined) names.add(match[1]);
  }
  for (const match of source.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = raw.trim();
      if (name !== "") names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * 从门禁源码里取出它从 supply-common 具名 import 的那一组。
 * @param {string} source 门禁源码
 * @returns {string[]} import 到的名字
 */
function readImportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/supply-common\.mjs'/g)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = raw.trim();
      if (name !== "") names.add(name);
    }
  }
  return [...names];
}

/** 能消费 supply-common 的两棵树:门禁本体与测试段(其余树不 import 它) */
const CONSUMER_TREES = ["gates", "test"];

/** 只读这些扩展名(与仓内可执行源码的扩展名一致) */
const CODE_EXTENSIONS = /\.(?:mjs|js|cjs|ts|tsx)$/;

/**
 * 递归列出目录下的代码文件。
 * @param {string} dir 目录绝对路径
 * @returns {string[]} 文件绝对路径
 */
function listCodeFiles(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "output") continue;
      found.push(...listCodeFiles(full));
    } else if (CODE_EXTENSIONS.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * 扫两棵消费树,取出**除本模块自身以外**还有代码引用到的导出名。
 *
 * 口径是「代码引用」而非「门禁 import」:一个导出即使五个门禁都不 import,只要还有别的段在用,
 * 它就不是死的 —— 按门禁 import 判死会把 7 个仍被测试段消费的导出误报成死导出。
 * 单遍扫描(一条 alternation 正则)而不是逐名扫文件:59 个名字 × 数百个文件会拖慢整段。
 * @param {string[]} exportedNames 本模块的导出名
 * @returns {Set<string>} 外部有代码引用的导出名
 */
function readExternallyReferencedNames(exportedNames) {
  const scanner = new RegExp(`\\b(?:${exportedNames.map((name) => name.replace(/\$/g, "\\$")).join("|")})\\b`, "g");
  // 排除本模块自身**与本段自身**:本段的 import 清单与两张基线表逐个写出了全部导出名,
  // 把它算进消费方会把每个导出都变成「有引用」,死导出清单当场归零。
  const excluded = new Set([
    path.resolve(SUPPLY_GATE_DIR, "supply-common.mjs"),
    path.resolve(fileURLToPath(import.meta.url)),
  ]);
  const referenced = new Set();
  for (const tree of CONSUMER_TREES) {
    for (const file of listCodeFiles(path.join(ROOT, tree))) {
      if (excluded.has(path.resolve(file))) continue;
      for (const match of fs.readFileSync(file, "utf8").matchAll(scanner)) {
        if (match[0] !== undefined) referenced.add(match[0]);
      }
    }
  }
  return referenced;
}

/**
 * 本段逐条断言覆盖到的导出名(与门禁消费面逐名对齐的那张表)。
 * 口径:**只登记本段真有行为断言的导出**;纯转出的既有单源(第 8 组末条)也登记,
 * 因为「必须是同一个函数引用」本身就是一条断言。
 * 新增门禁消费却没在这里登记 ⇒ 第 9 组判红(这正是本段存在的意义:覆盖缺口必须看得见)。
 */
const COVERED_EXPORTS = [
  "BLOCKING_SEVERITIES",
  "DECISION_STATUS",
  "LICENSE_DECISIONS_FILE",
  "LICENSE_DECISIONS_SCHEMA",
  "LICENSE_FILE_EXTENSIONS",
  "LICENSE_FILE_STATUS",
  "LICENSE_FILE_STEMS",
  "LICENSE_GROUPS",
  "LICENSE_GROUP_TITLES",
  "LICENSE_SHAPE",
  "LICENSE_SOURCE_LOCKFILE",
  "LICENSE_SOURCE_NONE",
  "LICENSE_SOURCE_PACKAGE_FILE",
  "LICENSE_TEXT_MARKERS",
  "NOASSERTION",
  "SCOPE_DEVELOPMENT",
  "SCOPE_PRODUCTION",
  "SEVERITY_ORDER",
  "SUPPLY_OUTPUT_DIR",
  "classifyLicense",
  "compareSemver",
  "componentEdges",
  "createDecisionIndex",
  "cvss3BaseScore",
  "detectLicenseFromText",
  "detectLicensesInText",
  "detectPackageLicense",
  "errorMessage",
  "expressionIncludesBranch",
  "hashBuffer",
  "isMainModule",
  "listLicenseFiles",
  "loadLicenseDecisions",
  "lockComponents",
  "normalizeSeverity",
  "npmInvocation",
  "parseSupplyArgs",
  "parseVersionRange",
  "readJson",
  "readLockfile",
  "resolveDepPath",
  "resolveLicenseDecision",
  "resolveObligationSummary",
  "resolveRegistry",
  "runCommand",
  "serializeJson",
  "severityFromScore",
  "toPosix",
  "versionSatisfies",
  "writeFileAtomic",
  "writeJson",
];

/**
 * 已登记的**死导出**基线(全仓零代码引用:既没有门禁 import,也没有任何测试段引用)。
 *
 * 登记而不是忽略,是因为「没人调用的导出」在存在性清单里照样是绿的 —— 只有把清单写下、
 * 再用一条断言钉住,新增死导出才会立刻看得见。
 * ⚠ 这几项**内部仍被本模块消费**(因此行为仍被上面各组间接覆盖),只是没有任何外部消费方。
 * 删掉其中一项、或给它接上消费方,本组都会判红并提示同步这一行 —— 删除死导出是主会话的
 * 独立决定,不由本段代行。
 */
const DEAD_EXPORTS_BASELINE = [
  "LICENSE_FILE_HEAD_BYTES",
  "LICENSE_MATCH_SPDX_TAG",
  "LICENSE_MATCH_TEXT",
  "normalizeSpdxExpression",
  "packageNameFromLockPath",
  "parseSpdxLicenseTag",
  "quoteForCmd",
];

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  /* ---------- 1. 许可证分类口径 ---------- */
  await suite.describe("许可证分类口径", async () => {
    await suite.case("收敛到 6 个分组取值域,且只有宽松许可免人工复核", () => {
      const expectations = [
        // [表达式, 期望分组]
        ["MIT", "permissive"],
        ["Apache-2.0", "permissive"],
        ["LGPL-3.0-or-later", "weakCopyleft"],
        ["MPL-2.0", "weakCopyleft"],
        ["GPL-3.0-or-later", "strongCopyleft"],
        ["AGPL-3.0", "strongCopyleft"],
        ["MIT AND LGPL-3.0", "weakCopyleft"],
        // 多分支取最严格的一支:混了强 copyleft 就不能按宽松放行
        ["MIT AND GPL-3.0", "strongCopyleft"],
        ["LGPL-3.0 AND GPL-3.0", "strongCopyleft"],
        // 非 SPDX 写法(带引号等)归 other,同样进人工复核
        ['"MIT"', "other"],
        // OR 一律 dualChoice:含 copyleft 的与不含的都不得由自动化替人选分支
        ["MIT OR GPL-3.0", "dualChoice"],
        ["MIT OR CC0", "dualChoice"],
      ];
      for (const [raw, expectedGroup] of expectations) {
        const result = classifyLicense(raw);
        assert(LICENSE_GROUPS.includes(result.group), `${raw} 的分组 ${result.group} 应在 LICENSE_GROUPS 内`);
        assert(result.group === expectedGroup, `${raw} 应归 ${expectedGroup},实际 ${result.group}`);
        assert(
          result.needsReview === (expectedGroup !== "permissive"),
          `${raw} 的 needsReview 应为 ${String(expectedGroup !== "permissive")},实际 ${String(result.needsReview)}`,
        );
      }
      assert(classifyLicense("MIT").isCopyleft === false, "宽松许可不含 copyleft 分支");
      assert(classifyLicense("MIT AND GPL-3.0").isCopyleft === true, "AND 表达式里出现 GPL 即算含 copyleft 分支");
      assert(classifyLicense("MIT OR GPL-3.0").isDualChoice === true, "OR 表达式必须标 dualChoice");
      assert(classifyLicense("MIT AND GPL-3.0").isDualChoice === false, "AND 表达式不是多选一");
    });

    await suite.case("缺声明一律落 unknown 并需复核(不静默当成宽松许可)", () => {
      // 逐个喂非字符串:分类层的入参口径就是「不是字符串就当没声明」。
      // JSDoc 声明的形参类型是 string|null|undefined,故此处按声明类型标注后逐个喂 ——
      // 类型标注只约束编译期,运行期仍会真的把 number 喂进去(那正是要钉的行为)。
      const missingDeclarations = ["", "   ", null, undefined];
      for (const item of missingDeclarations) {
        const raw = /** @type {string | null | undefined} */ (item);
        const result = classifyLicense(raw);
        assert(result.group === "unknown", `${JSON.stringify(raw)} 应归 unknown,实际 ${result.group}`);
        assert(result.needsReview === true, `${JSON.stringify(raw)} 必须进人工复核`);
        assert(result.raw === "", `${JSON.stringify(raw)} 的 raw 应归一为空串`);
      }
      // raw 保留上游原文(去首尾空白),报告里要能反查上游到底写了什么
      assert(classifyLicense("  MIT  ").raw === "MIT", "raw 应保留去空白后的上游原文");
    });

    await suite.case("copyleft 边界不对称:左侧不含连字符,版本后缀含连字符", () => {
      // SPDX 惯例的版本后缀带连字符,必须认出;"Foo-GPL" 这类命名巧合不得误判成 GPL
      assert(classifyLicense("GPL-3.0-or-later").group === "strongCopyleft", "GPL-3.0-or-later 应认成强 copyleft");
      assert(classifyLicense("LGPL-2.1+").group === "weakCopyleft", "LGPL-2.1+ 应认成弱 copyleft");
      assert(classifyLicense("Foo-GPL").group === "permissive", "Foo-GPL 不得被误判成 GPL(左侧不含连字符)");
      assert(classifyLicense("MIT AND Foo-GPL-3.0").group === "permissive", "AND 分支里的 Foo-GPL-3.0 同样不得误判");
      assert(classifyLicense("GPLv3").group === "permissive", "GPLv3(无版本后缀、无边界)不构成 SPDX 标识,不得凭字面猜");
    });

    await suite.case("分组与 NOTICE 分段标题必须同源(缺一个标题 = 产物少一段)", () => {
      assert(
        JSON.stringify(Object.keys(LICENSE_GROUP_TITLES).sort()) === JSON.stringify([...LICENSE_GROUPS].sort()),
        `LICENSE_GROUP_TITLES 的键集应与 LICENSE_GROUPS 一致,实际 ${Object.keys(LICENSE_GROUP_TITLES).join(",")}`,
      );
      for (const key of LICENSE_GROUPS) {
        // 键集已在上行逐字比过,此处只为「每个分组都有非空标题」;Record 索引在
        // noUncheckedIndexedAccess 下是可选的,统一走 Object 取出再断言
        const title = Object.values(LICENSE_GROUP_TITLES)[LICENSE_GROUPS.indexOf(key)];
        assert(typeof title === "string" && title.trim() !== "", `分组 ${key} 缺人读标题`);
      }
      // 占位标识不是分组名:两者是两套取值域,混用会让「缺声明」被当成一个分组渲染
      assert(!LICENSE_GROUPS.includes(NOASSERTION), "NOASSERTION 不应与 LICENSE_GROUPS 取值重叠");
      assert(NOASSERTION === "NOASSERTION", "缺声明占位标识须为 SPDX NOASSERTION 口径");
    });
  });

  /* ---------- 2. 随包许可证文件识别 ---------- */
  await suite.describe("随包许可证文件识别", async () => {
    await suite.case("候选文件名单由两个单源常量决定(收该收的、拒不该收的、不跨目录)", async () => {
      await withTempDir((dir) => {
        const pkgDir = path.join(dir, "pkg");
        fs.mkdirSync(pkgDir);
        // 单源里有的主干 × 扩展名组合一律收(含无扩展名与大小写不敏感)
        for (const stem of LICENSE_FILE_STEMS) {
          for (const ext of LICENSE_FILE_EXTENSIONS) {
            fs.writeFileSync(path.join(pkgDir, `${stem.toUpperCase()}${ext}`), "x");
          }
        }
        // 单源外的写法一律拒:LICENSES(复数)、扩展名不在单源内、非许可证名
        fs.writeFileSync(path.join(pkgDir, "LICENSES"), "x");
        fs.writeFileSync(path.join(pkgDir, "LICENSE.md.bak"), "x");
        fs.writeFileSync(path.join(pkgDir, "README.md"), "x");
        fs.writeFileSync(path.join(pkgDir, "LICENSE-2.0.txt"), "x");
        // 不跨目录:子目录里的许可证文件不算本包随包文件
        fs.mkdirSync(path.join(pkgDir, "sub"));
        fs.writeFileSync(path.join(pkgDir, "sub", "LICENSE"), "x");

        const found = listLicenseFiles(pkgDir);
        for (const stem of LICENSE_FILE_STEMS) {
          for (const ext of LICENSE_FILE_EXTENSIONS) {
            assert(found.includes(`${stem.toUpperCase()}${ext}`), `候选名单应收下 ${stem}${ext},实际 ${found.join(",")}`);
          }
        }
        for (const rejected of ["LICENSES", "LICENSE.md.bak", "README.md", "LICENSE-2.0.txt"]) {
          assert(!found.includes(rejected), `候选名单不该收 ${rejected}`);
        }
        assert(!found.some((name) => name.includes("/")), "候选名单只取 basename,不跨目录");
        // 排序口径固定为「主干优先级 → 扩展名优先级 → 文件名」:同目录同内容必得同序
        const expected = LICENSE_FILE_STEMS.flatMap((stem) =>
          LICENSE_FILE_EXTENSIONS.map((ext) => `${stem.toUpperCase()}${ext}`),
        );
        assert(JSON.stringify(found) === JSON.stringify(expected), `候选名单顺序应固定,实际 ${found.join(",")}`);
        assert(JSON.stringify(listLicenseFiles(path.join(pkgDir, "不存在"))) === "[]", "目录不存在时返回空数组而不是抛错");
      });
    });

    await suite.case("四种结局可区分,识别成功必须附证据文件名", async () => {
      await withTempDir((dir) => {
        // 结局 1:包目录不存在(未安装/被剪枝)
        const absent = detectPackageLicense(path.join(dir, "没装"));
        assert(absent.status === LICENSE_FILE_STATUS.noPackageDir, `缺包目录应记 ${LICENSE_FILE_STATUS.noPackageDir},实际 ${absent.status}`);
        assert(absent.license === null && absent.evidence === null, "缺包目录不得凭空给出许可证或证据");

        // 结局 2:目录在但没有候选文件
        const emptyDir = path.join(dir, "空目录");
        fs.mkdirSync(emptyDir);
        const none = detectPackageLicense(emptyDir);
        assert(none.status === LICENSE_FILE_STATUS.noLicenseFile, `无候选文件应记 ${LICENSE_FILE_STATUS.noLicenseFile},实际 ${none.status}`);
        assert(none.files.length === 0, "无候选文件时 files 应为空");

        // 结局 3:候选文件存在但内容认不出 —— 绝不猜测,交调用方判红
        const unknownDir = path.join(dir, "认不出");
        fs.mkdirSync(unknownDir);
        fs.writeFileSync(path.join(unknownDir, "LICENSE"), "本文件不含任何可识别的许可证特征句");
        const unknown = detectPackageLicense(unknownDir);
        assert(unknown.status === LICENSE_FILE_STATUS.unrecognized, `认不出应记 ${LICENSE_FILE_STATUS.unrecognized},实际 ${unknown.status}`);
        assert(unknown.license === null && unknown.evidence === null, "认不出时不得给出猜测的许可证");

        // 结局 4:识别成功 —— 必须带证据文件名,且按候选名单顺序取第一个能认出的
        const okDir = path.join(dir, "认得出");
        fs.mkdirSync(okDir);
        fs.writeFileSync(path.join(okDir, "LICENSE"), "本文件不含任何可识别的许可证特征句");
        fs.writeFileSync(path.join(okDir, "COPYING"), "Permission is hereby granted, free of charge, to any person obtaining a copy");
        const ok = detectPackageLicense(okDir);
        assert(ok.status === LICENSE_FILE_STATUS.detected, `应识别成功,实际 ${ok.status}`);
        assert(ok.license === "MIT", `应认出 MIT,实际 ${String(ok.license)}`);
        assert(ok.evidence === "COPYING", `证据文件名应指向真正命中的那个,实际 ${String(ok.evidence)}`);
        assert(ok.match === "text", `正文特征命中的 match 值应为 text,实际 ${String(ok.match)}`);
        assert(ok.unreadable === 0, "两个文件都读得出,unreadable 应为 0");
      });
    });

    await suite.case("SPDX 标签优先于正文标记,不可信标签不采信", () => {
      // 标签优先:同一文件里既有标签又有正文特征,标签权威(标签可能与正文不同版本)
      const tagged = detectLicenseFromText("// SPDX-License-Identifier: GPL-2.0-only\nPermission is hereby granted, free of charge");
      assert(tagged.license === "GPL-2.0-only", `标签优先,应取 GPL-2.0-only,实际 ${String(tagged.license)}`);
      assert(tagged.match === "SPDX-License-Identifier", "标签命中的 match 值应为 SPDX-License-Identifier");

      // 注释尾缀必须被剥掉,否则 ' */' 会让整条表达式不可信而被丢弃
      assert(detectLicenseFromText("/* SPDX-License-Identifier: MIT */").license === "MIT", "行注释尾缀 `*/` 应被剥掉");
      assert(detectLicenseFromText("<!-- SPDX-License-Identifier: Apache-2.0 -->").license === "Apache-2.0", "HTML 注释尾缀 `-->` 应被剥掉");

      // 不可信标签一律不采信:LicenseRef- 是自定义标签,当成宽松许可放过去等于无依据放行
      assert(detectLicenseFromText("SPDX-License-Identifier: LicenseRef-mine").license === null, "LicenseRef- 自定义标签不得采信");
      assert(detectLicenseFromText("SPDX-License-Identifier: ").license === null, "空标签不得产出许可证");

      // 认不出时两个字段同时为 null(调用方据此判 unknown,不做任何推断)
      const none = detectLicenseFromText("一段与许可证无关的正文");
      assert(none.license === null && none.match === null, "认不出时 license 与 match 应同时为 null");
      // 正文特征命中时的 match 值是固定字面量(报告里按它区分「标签认的」与「正文认的」)
      assert(detectLicenseFromText("Permission is hereby granted, free of charge").match === "text", "正文命中的 match 值应为 text");
    });

    await suite.case("正文标记表:AGPL 交叉引用不得误标,BSD 免责声明两种措辞都算三条款", () => {
      // GPLv3 正文第 13 节有一句「Use with the GNU Affero General Public License」交叉引用,
      // 只认标题字样会把 GPLv3 误判成 AGPL-3.0 —— 比真实许可更强,属误导性错标
      const gplv3 = detectLicenseFromText(
        "GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007\n\n13. Use with the GNU Affero General Public License.",
      );
      assert(gplv3.license === "GPL-3.0", `GPLv3 正文不得被 AGPL 交叉引用带偏,实际 ${String(gplv3.license)}`);

      // BSD 免责声明有两种常见措辞:模板写法与把持有者名字写进条款的写法。
      // 后者曾被当成二条款,把 3-Clause 认成 2-Clause —— 少算一个免责声明义务,比认不出更危险。
      const shared = "Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:";
      assert(
        detectLicenseFromText(`${shared}\nNeither the name of the copyright holder nor the names of its contributors may be used to endorse`).license ===
          "BSD-3-Clause",
        "模板写法的免责声明须认成 BSD-3-Clause",
      );
      assert(
        detectLicenseFromText(`${shared}\nThe name Acme may not be used to endorse or promote products derived from this software`).license === "BSD-3-Clause",
        "把持有者名字写进条款的免责声明同样须认成 BSD-3-Clause",
      );
      assert(
        detectLicenseFromText(`${shared}\n1. Redistributions of source code must retain the above copyright notice`).license === "BSD-2-Clause",
        "只有再分发条款、没有免责声明条款时才是 BSD-2-Clause",
      );
      // 0BSD 与 ISC 正文几乎逐字相同,只有标题行不同:标题不认就不匹配,交调用方判 unknown
      assert(detectLicenseFromText("Permission to use, copy, modify, and/or distribute this software").license === null, "只有 ISC 授权句、没有标题行时不得靠共有段落猜 ISC");
    });

    await suite.case("只读文首固定字节:窗口之外的标题不构成证据", async () => {
      await withTempDir((dir) => {
        const pkgDir = path.join(dir, "pkg");
        fs.mkdirSync(pkgDir);
        // 刻意**不** import LICENSE_FILE_HEAD_BYTES(它是零引用的死导出,见第 9 组):
        // 把它 import 进来会让「死导出清单」当场失效。这条断言只钉行为 ——
        // 标题落在读取窗口外就认不出(判红),落窗内才认得出。
        const filler = "x".repeat(16384 * 4);
        // 标题落在读取窗口之外 → 认不出(判红),不得为了认出而把整份大文件读进内存
        fs.writeFileSync(path.join(pkgDir, "LICENSE"), `${filler}\nPermission is hereby granted, free of charge`);
        const beyond = detectPackageLicense(pkgDir);
        assert(beyond.status === LICENSE_FILE_STATUS.unrecognized, `窗口外的标题不该被采信,实际 ${beyond.status}`);
        // 标题落在窗口之内 → 认出
        fs.writeFileSync(path.join(pkgDir, "LICENSE"), `Permission is hereby granted, free of charge\n${filler}`);
        assert(detectPackageLicense(pkgDir).license === "MIT", "窗口内的标题应被采信");
      });
    });
  });

  /* ---------- 3. 多许可文件形态识别 ---------- */
  await suite.describe("多许可文件形态识别", async () => {
    // 一份合法拼接两个许可证正文的文件(ISC 段 + MIT 段)
    const CONCATENATED = [
      "ISC License",
      "",
      "Permission to use, copy, modify, and/or distribute this software for any purpose",
      "",
      "MIT License",
      "",
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
    ].join("\n");

    await suite.case("只有行首独占成段才算第二套;句中引述的授权句不算拼接", () => {
      const multi = detectLicensesInText(CONCATENATED);
      assert(multi.status === LICENSE_SHAPE.multi, `拼接文件应记 ${LICENSE_SHAPE.multi},实际 ${multi.status}`);
      assert(JSON.stringify(multi.licenses) === JSON.stringify(["ISC", "MIT"]), `应列出全部候选,实际 ${multi.licenses.join(",")}`);
      assert(multi.license === multi.licenses[0], "首个标识须与老口径的 license 字段一致");

      // 「独占成段」判据是行首:某份许可证的授权句出现在句中(引述)不得算成第二套,
      // 而同一句出现在行首才算一段
      const quoted = "Some notice\nThe following clause is quoted from another license: Permission to use, copy, modify, and/or distribute this software for any purpose\nend of quote.";
      const single = detectLicensesInText(quoted);
      assert(single.status === LICENSE_SHAPE.unrecognized, `句中引述的授权句不构成独占成段,实际 ${single.status}`);
      assert(single.licenses.length === 0, `句中引述不得被算成一套许可证,实际 ${single.licenses.join(",")}`);
      assert(
        detectLicensesInText("Permission to use, copy, modify, and/or distribute this software for any purpose").licenses.join() === "ISC",
        "同一句在行首独占成段时才算一套",
      );

      // 一套都认不出
      const none = detectLicensesInText("一段与许可证无关的正文");
      assert(none.status === LICENSE_SHAPE.unrecognized, `认不出应记 ${LICENSE_SHAPE.unrecognized},实际 ${none.status}`);
      assert(none.licenses.length === 0 && none.license === null, "认不出时不得给出候选");
      // 取值域字面量:诊断层与许可证全文收集层比的是这个值,写成 "multi" 就对不上
      assert(LICENSE_SHAPE.multi === "multi-license", "多许可状态值须为 multi-license");
      assert(LICENSE_SHAPE.single === "single" && LICENSE_SHAPE.unrecognized === "unrecognized", "形态状态取值域须完整");
    });

    await suite.case("SPDX 标签走单标识口径(标签 + 正文不误判成拼接)", () => {
      const tagged = detectLicensesInText("SPDX-License-Identifier: MIT\n\nPermission is hereby granted, free of charge\nPermission to use, copy, modify, and/or distribute this software");
      assert(tagged.status === LICENSE_SHAPE.single, "一个文件只该有一个标签,标签优先且不做多许可推断");
      assert(tagged.license === "MIT" && tagged.licenses.length === 1, `应只取标签那一个,实际 ${tagged.licenses.join(",")}`);
      assert(tagged.match === "SPDX-License-Identifier", "标签命中的 match 值应为 SPDX-License-Identifier");
    });

    await suite.case("「声明是否在检测集内」是三态,多分支声明任一命中即算覆盖", () => {
      assert(detectLicensesInText(CONCATENATED).declaredInDetected === null, "未传声明时必须是 null(不是 false)");
      assert(detectLicensesInText(CONCATENATED, { declared: "MIT" }).declaredInDetected === true, "声明命中检测集应为 true");
      assert(detectLicensesInText(CONCATENATED, { declared: "GPL-3.0" }).declaredInDetected === false, "声明不在检测集应为 false");
      // 拼接文件常见 dual-licensed 声明,只比对整串会误报成「声明不在其中」
      assert(detectLicensesInText(CONCATENATED, { declared: "GPL-3.0 OR MIT" }).declaredInDetected === true, "多分支声明任一分支命中即算已覆盖");
      // 声明原样回报(空白归一),报告里要能对照上游原文
      assert(detectLicensesInText(CONCATENATED, { declared: "  MIT  " }).declared === "MIT", "声明应原样(去空白)回报");
    });
  });

  /* ---------- 4. 多选一分支决策 ---------- */
  await suite.describe("多选一分支决策", async () => {
    const DECISION = {
      name: "jszip",
      versionRange: ">=3.0.0 <4.0.0",
      upstreamExpression: "MIT OR GPL-3.0",
      selectedBranch: "MIT",
      rationale: "用户拍板选 MIT 分支",
      decidedOn: "2026-01-01",
      decidedBy: "chenc",
    };

    await suite.case("清单校验:七字段缺一即炸、同包重名即炸、非多分支即炸、分支不在其中即炸", () => {
      const index = createDecisionIndex([DECISION]);
      assert(index.schema === LICENSE_DECISIONS_SCHEMA, `索引 schema 应为 ${LICENSE_DECISIONS_SCHEMA},实际 ${index.schema}`);
      assert(index.entries.length === 1 && index.byName.has("jszip"), "索引应同时给出去重映射与排序后的清单");
      assertThrows(() => createDecisionIndex(/** @type {any} */ ({})), /必须是数组/);
      assertThrows(() => createDecisionIndex([{ ...DECISION, rationale: "   " }]), /decisions\[0\]\.rationale 缺失或为空/);
      assertThrows(() => createDecisionIndex([{ ...DECISION, decidedBy: "" }]), /decidedBy 缺失或为空/);
      assertThrows(() => createDecisionIndex([DECISION, DECISION]), /jszip 出现多条决策/);
      assertThrows(() => createDecisionIndex([{ ...DECISION, upstreamExpression: "MIT" }]), /不含 OR 分支/);
      assertThrows(() => createDecisionIndex([{ ...DECISION, selectedBranch: "Zlib" }]), /不在 upstreamExpression/);
      // 清单是「逐条可审计」的:七个字段一个都不能少
      for (const field of ["name", "versionRange", "upstreamExpression", "selectedBranch", "rationale", "decidedOn", "decidedBy"]) {
        const broken = /** @type {Record<string, unknown>} */ ({ ...DECISION });
        delete broken[field];
        assertThrows(() => createDecisionIndex([broken]), new RegExp(`${field} 缺失或为空`));
      }
    });

    await suite.case("生效判定顺序固定:生产树 → 版本范围 → 上游声明一致,任一不满足即不生效", () => {
      const index = createDecisionIndex([DECISION]);
      const decide = (/** @type {any} */ input) => resolveLicenseDecision(input, index);
      const applied = decide({ name: "jszip", version: "3.10.1", upstreamExpression: "MIT OR GPL-3.0", isProduction: true });
      assert(applied.status === DECISION_STATUS.applied, `版本在范围内应生效,实际 ${applied.status}`);
      assert(applied.selectedBranch === "MIT", `生效时应给出选定分支,实际 ${String(applied.selectedBranch)}`);
      assert(applied.note.includes("已按决策选用"), `生效说明须人可读,实际 ${applied.note}`);

      const outOfRange = decide({ name: "jszip", version: "4.1.0", upstreamExpression: "MIT OR GPL-3.0", isProduction: true });
      assert(outOfRange.status === DECISION_STATUS.outOfRange, `版本超范围应记 ${DECISION_STATUS.outOfRange},实际 ${outOfRange.status}`);
      assert(outOfRange.selectedBranch === null, "未生效时不得给出选定分支(绝静默默认选一个)");
      assert(outOfRange.note.includes("4.1.0") && outOfRange.note.includes(">=3.0.0 <4.0.0"), "未生效说明须点出版本与范围");

      // 仅开发依赖不随包分发,没有分发义务需要人拍板 → 决策不适用
      const devOnly = decide({ name: "jszip", version: "3.10.1", upstreamExpression: "MIT OR GPL-3.0", isProduction: false });
      assert(devOnly.status === DECISION_STATUS.scopeExcluded, `仅开发树应记 ${DECISION_STATUS.scopeExcluded},实际 ${devOnly.status}`);
      assert(devOnly.selectedBranch === null, "仅开发树不得套用决策");

      // 上游表达式变了(哪怕只是书写差异之外的变化)→ 决策失效,需重新拍板
      const changed = decide({ name: "jszip", version: "3.10.1", upstreamExpression: "MIT OR GPL-3.0-only", isProduction: true });
      assert(changed.status === DECISION_STATUS.expressionMismatch, `上游声明变了应记 ${DECISION_STATUS.expressionMismatch},实际 ${changed.status}`);

      const missing = decide({ name: "别的包", version: "1.0.0", upstreamExpression: "MIT", isProduction: true });
      assert(missing.status === DECISION_STATUS.noDecision, `清单里没有该包应记 ${DECISION_STATUS.noDecision},实际 ${missing.status}`);
      assert(missing.decision === null && missing.selectedBranch === null, "未决策时不得凭空造出决策记录");
      // 没提供决策清单(idx = null)等价于「一个都没拍板」
      assert(
        resolveLicenseDecision({ name: "jszip", version: "3.10.1", upstreamExpression: "MIT OR GPL-3.0", isProduction: true }, null).status === DECISION_STATUS.noDecision,
        "未提供决策清单时应回到未决策态",
      );
      // 取值域完整:五档不生效 + applied,少一档就会有状态落到 undefined
      assert(
        JSON.stringify(Object.keys(DECISION_STATUS).sort()) ===
          JSON.stringify(["applied", "expressionMismatch", "noDecision", "notInTree", "outOfRange", "scopeExcluded"]),
        `DECISION_STATUS 取值域应完整,实际 ${Object.keys(DECISION_STATUS).join(",")}`,
      );
    });

    await suite.case("版本范围:空 = 任意,版本缺失不放行,语法不认得显式失败", () => {
      assert(JSON.stringify(parseVersionRange("")) === "[]", "空串应解析成零个子句(= 任意版本)");
      assert(JSON.stringify(parseVersionRange("  *  ")) === "[]", "通配符应解析成零个子句");
      assert(JSON.stringify(parseVersionRange(">=3.0.0 <4.0.0")) === JSON.stringify([{ op: ">=", version: "3.0.0" }, { op: "<", version: "4.0.0" }]), "空格分隔的比较子句应逐个解析");
      assert(JSON.stringify(parseVersionRange(">=3.0.0, <4.0.0")) === JSON.stringify([{ op: ">=", version: "3.0.0" }, { op: "<", version: "4.0.0" }]), "逗号分隔等价于空格分隔");
      assert(JSON.stringify(parseVersionRange("2.0.0")) === JSON.stringify([{ op: "=", version: "2.0.0" }]), "裸版本号应解析成等值判定");
      // 语法含糊不如显式失败:^ / ~ 这类范围写法不猜
      assertThrows(() => parseVersionRange("^1.0.0"), /版本范围语法不认得/);
      assertThrows(() => parseVersionRange(">=1.0.0 || <0.5.0"), /版本范围语法不认得/);

      assert(versionSatisfies("3.10.1", ">=3.0.0 <4.0.0") === true, "落在范围内应为 true");
      assert(versionSatisfies("4.0.0", ">=3.0.0 <4.0.0") === false, "上界是开区间,4.0.0 应落不进来");
      assert(versionSatisfies("1.2.3", "") === true, "空范围 = 任意版本");
      // 无法确认范围的包不该被一条「看起来匹配」的决策放行
      assert(versionSatisfies("", ">=1.0.0") === false, "版本号缺失时必须判 false 而不是放行");
      assert(versionSatisfies("   ", "*") === true, "空范围时版本缺失也不影响(任意版本)");
    });

    await suite.case("SPDX 归一只做书写差异,不改分支本身", () => {
      // 刻意**不** import normalizeSpdxExpression(它零引用,见第 9 组)。归一的效果
      // 从两个消费它的公开面观察:expressionIncludesBranch(选分支校验)与
      // createDecisionIndex(上游声明一致性)。
      assert(expressionIncludesBranch("MIT OR GPL-3.0", "GPL-3.0") === true, "整词命中应为 true");
      assert(expressionIncludesBranch("(MIT OR GPL-3.0)", "MIT") === true, "带包裹括号也应命中");
      assert(expressionIncludesBranch("((MIT OR GPL-3.0))", "MIT") === true, "冗余外层括号应被剥掉后命中");
      assert(expressionIncludesBranch("  MIT   OR   GPL-3.0  ", "GPL-3.0") === true, "多余空白应被压掉后命中");
      assert(expressionIncludesBranch("(MIT)", "MIT") === true, "单分支的包裹括号应被剥掉");
      // 分支本身不能动:改了分支就是换了分发义务
      assert(expressionIncludesBranch("MIT OR GPL-3.0", "GPL-2.0") === false, "换分支不得被当成同一个");
      // 整词比对:前缀误配会把 MIT-0.9 当成命中 MIT
      assert(expressionIncludesBranch("MIT-0.9", "MIT") === false, "前缀相近不得当成整词命中");
      assert(expressionIncludesBranch("MIT OR GPL-3.0", "") === false, "空分支不得命中任何表达式");

      // 归一后仍相等 ⇒ 决策生效;只差一个版本号 ⇒ 决策失效。两条一起钉住「只归一书写差异」。
      const index = createDecisionIndex([{ ...DECISION, upstreamExpression: "MIT OR GPL-3.0" }]);
      const sameUpstream = { name: "jszip", version: "3.10.1", upstreamExpression: "  ( ( MIT   OR   GPL-3.0 ) )  ", isProduction: true };
      assert(resolveLicenseDecision(sameUpstream, index).status === DECISION_STATUS.applied, "书写差异归一后应仍判生效");
      const changedUpstream = { ...sameUpstream, upstreamExpression: "(MIT OR GPL-2.0)" };
      assert(resolveLicenseDecision(changedUpstream, index).status === DECISION_STATUS.expressionMismatch, "换了分支必须判失效");
    });

    await suite.case("义务摘要按基名回落,未登记返回 null(不得编造义务)", () => {
      // 刻意**不** import LICENSE_OBLIGATION_SUMMARIES(它零引用,见第 9 组;import 进来
      // 就等于给它造了个假消费方)。改为断言「同族后缀必得同一份摘要」——
      // 这条不依赖表本身,也照样能抓住「回落逻辑被改坏」。
      const orLater = resolveObligationSummary("GPL-3.0-or-later");
      assert(typeof orLater === "string" && orLater.trim() !== "", "GPL-3.0-or-later 应能取到义务摘要");
      assert(resolveObligationSummary("GPL-3.0+") === orLater, "+ 后缀应回落基名,与 -or-later 同得一份摘要");
      assert(resolveObligationSummary("GPL-3.0") === orLater, "裸标识符应与带后缀的同得一份摘要");
      assert(resolveObligationSummary("GPL-2.0") !== orLater, "不同许可证的义务摘要不得相同");
      const only = resolveObligationSummary("Apache-2.0-only");
      assert(resolveObligationSummary("Apache-2.0") === only && resolveObligationSummary("Apache-2.0+") === only, "-only / + 后缀都应回落基名");
      // 认不出的标识符返回 null,由调用方显式标注「未登记」—— 编造义务比不写更危险
      assert(resolveObligationSummary("WTFPL") === null, "未登记的标识符必须返回 null");
      assert(resolveObligationSummary("") === null && resolveObligationSummary(null) === null, "空/非字符串必须返回 null");

      // 标记表认得出的每个许可证都必须登记义务摘要:否则产物里会出现「未登记」占位,
      // 而 gen-licenses 的诊断文案正是让维护者往这张表里补 —— 两表必须同步。
      const unregistered = LICENSE_TEXT_MARKERS.map((marker) => marker.spdx).filter((spdx) => resolveObligationSummary(spdx) === null);
      assert(unregistered.length === 0, `标记表里这些许可证没登记义务摘要:${unregistered.join(",")}`);
    });

    await suite.case("清单读文件:schema 不符即炸,内容指纹随内容变,来源标识由调用方给", async () => {
      await withTempDir((dir) => {
        const filePath = path.join(dir, LICENSE_DECISIONS_FILE);
        const payload = { schema: LICENSE_DECISIONS_SCHEMA, decisions: [DECISION] };
        fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

        const index = loadLicenseDecisions(filePath, "gates/supply/supply/license-decisions.json");
        assert(index.byName.has("jszip"), "读到的清单应建立索引");
        assert(index.source === "gates/supply/supply/license-decisions.json", `来源标识应记调用方给的相对路径,实际 ${String(index.source)}`);
        assert(!path.isAbsolute(String(index.source)), "产物里不得留本机绝对路径(同输入须能跨机器逐字节一致)");
        assert(typeof index.sha256 === "string" && index.sha256.length === 64, "清单内容指纹应记入报告");

        // 内容变 → 指纹必变,否则「同输入同产物」的报告看不出输入已经变了
        fs.writeFileSync(filePath, `${JSON.stringify({ ...payload, decisions: [] }, null, 2)}\n`, "utf8");
        assert(loadLicenseDecisions(filePath).sha256 !== index.sha256, "清单内容变更后指纹必须变化");

        // schema 不符 / 文件不在 → 显式失败(清单在而读不出来 = 悄悄丢掉人的决定)
        fs.writeFileSync(filePath, JSON.stringify({ schema: "别人的@1", decisions: [] }), "utf8");
        assertThrows(() => loadLicenseDecisions(filePath), /决策清单 schema 不符/);
        assertThrows(() => loadLicenseDecisions(path.join(dir, "不存在.json")), /文件不存在/);
        // 常量与真实文件名必须对得上(它就是清单文件名单源)
        assert(LICENSE_DECISIONS_FILE === "license-decisions.json", "清单文件名常量与实际文件名必须一致");
      });
    });
  });

  /* ---------- 5. semver 与严重度换算 ---------- */
  await suite.describe("semver 与严重度换算", async () => {
    await suite.case("简化 semver 比较:缺位按 0、忽略预发布后缀、畸形段不打断扫描", () => {
      assert(compareSemver("1.0.0", "1.0.0") === 0, "相同版本应为 0");
      assert(compareSemver("1.2", "1.2.0") === 0, "缺位按 0 补齐后应相等");
      assert(compareSemver("1.2.0", "1.2") === 0, "右侧缺位同样按 0 补齐后应相等");
      assert(compareSemver("1.2.3", "1.2") === 1, "1.2.3 比 1.2(=1.2.0)新");
      assert(compareSemver("1.10.0", "1.9.0") === 1, "按数值比,不是按字符串比(10 > 9)");
      assert(compareSemver("1.9.0", "1.10.0") === -1, "反向比较应给出 -1");
      assert(compareSemver("2.0.0", "1.99.99") === 1, "先比 major");
      assert(compareSemver("1.2.3-beta.1", "1.2.3") === 0, "预发布后缀在本口径下被忽略");
      assert(compareSemver("1.2.3-beta.1", "1.2.4") === -1, "后缀被忽略后应与正式版比较");
      // 一个畸形版本字符串不该把整个扫描或范围判定打断
      assert(compareSemver("1.x.3", "1.0.3") === 0, "非数字段按 0 处理");
      assert(compareSemver("1.0.0", "") === 1, "空串按 0.0.0 处理");
    });

    await suite.case("严重度归一:写法不同收敛到同一取值域,认不出的不静默当低危", () => {
      assert(normalizeSeverity("high") === "high", "已在取值域内的原样返回");
      assert(normalizeSeverity(" CRITICAL ") === "critical", "大小写与空白应被归一");
      assert(normalizeSeverity("medium") === "moderate", "medium 应归一到 moderate");
      assert(normalizeSeverity("important") === "high", "GitHub Advisory 的 important 应归一到 high");
      assert(normalizeSeverity("moderate") === "moderate", "moderate 原样");
      // 认不出的严重度一律记 moderate:静默当成低危 = 把未知当没事
      for (const raw of ["严重", "blocker", "", "   ", null, undefined]) {
        assert(normalizeSeverity(raw) === "moderate", `${JSON.stringify(raw)} 应降级为 moderate,不得当成低危`);
      }
      for (const raw of ["none", "info", "low", "moderate", "high", "critical"]) {
        assert(SEVERITY_ORDER.includes(normalizeSeverity(raw)), `${raw} 归一后必须落在 SEVERITY_ORDER 内`);
      }
      assert(SEVERITY_ORDER.join() === "none,info,low,moderate,high,critical", "严重度序是排序口径,次序不能改");
      assert(
        BLOCKING_SEVERITIES.every((item) => SEVERITY_ORDER.includes(item)) &&
          BLOCKING_SEVERITIES.join() === "high,critical" &&
          BLOCKING_SEVERITIES.every((item) => SEVERITY_ORDER.indexOf(item) >= SEVERITY_ORDER.indexOf("high")),
        "阻断下限必须是严重度序里不低于 high 的那一段",
      );
    });

    await suite.case("CVSS 向量自算基础分;指标不全或写法非法返回 null 交调用方降级", () => {
      // OSV 的部分公告只给向量不给基础分,没有基础分就无法与 npm audit 同口径比较
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H") === 9.8, "教科书向量应为 9.8");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N") === 7.5, "单项高危应为 7.5");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:N/A:N") === 3.1, "难利用的向量应为 3.1");
      // S:C 走改动过的权重与 1.08 倍系数,并且封顶 10
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H") === 10, "S:C 的满配向量应封顶 10");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H") === 9.9, "S:C 且 PR:L 应略低于 10");
      // 指标不全 / 指标值不认 / 非字符串 → null,由调用方降级到 moderate 并在报告里标注来源不完整
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L") === null, "缺指标必须返回 null 而不是猜");
      assert(cvss3BaseScore("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:Z") === null, "不认的指标取值必须返回 null");
      assert(cvss3BaseScore("") === null && cvss3BaseScore(/** @type {any} */ (null)) === null, "空/非字符串必须返回 null");
    });

    await suite.case("基础分 → 严重度带:阈值边界含等于", () => {
      assert(severityFromScore(10) === "critical" && severityFromScore(9) === "critical", "9.0 及以上为 critical");
      assert(severityFromScore(8.9) === "high", "8.9 属 high(9.0 是闭区间下界)");
      assert(severityFromScore(7) === "high" && severityFromScore(7.1) === "high", "7.0 及以上为 high");
      assert(severityFromScore(6.9) === "moderate", "6.9 属 moderate");
      assert(severityFromScore(4) === "moderate" && severityFromScore(4.1) === "moderate", "4.0 及以上为 moderate");
      assert(severityFromScore(3.9) === "low" && severityFromScore(0) === "low", "4.0 以下为 low");
      // 严重度带必须是严重度序的取值,否则下游的排序与阻断判定会对不上
      for (const score of [0, 3.9, 4, 6.9, 7, 8.9, 9, 10]) {
        assert(SEVERITY_ORDER.includes(severityFromScore(score)), `${score} 的定级 ${severityFromScore(score)} 必须在严重度序内`);
      }
    });
  });

  /* ---------- 6. npm 镜像口径 ---------- */
  await suite.describe("npm 镜像口径", async () => {
    await suite.case("三级回落:.npmrc 优先(去引号)→ 环境变量 → 官方默认,source 如实标注", async () => {
      await withTempDir((dir) => {
        const npmrc = path.join(dir, ".npmrc");
        // 项目 .npmrc 优先(本项目按硬约束走国内镜像),带引号的值要去引号
        fs.writeFileSync(npmrc, "registry=https://registry.npmmirror.com/\nfoo=bar\n");
        assert(JSON.stringify(resolveRegistry(dir, {})) === JSON.stringify({ registry: "https://registry.npmmirror.com/", source: ".npmrc" }), "项目 .npmrc 优先");
        fs.writeFileSync(npmrc, '  registry = "https://quoted.example/"  \n');
        assert(resolveRegistry(dir, { npm_config_registry: "https://env.example/" }).registry === "https://quoted.example/", "引号与多余空白应被剥掉");
        // .npmrc 里没有 registry 行 → 环境变量
        fs.writeFileSync(npmrc, "foo=bar\nstrict-peer-deps=true\n");
        assert(
          JSON.stringify(resolveRegistry(dir, { npm_config_registry: "https://env.example/" })) ===
            JSON.stringify({ registry: "https://env.example/", source: "npm_config_registry" }),
          "无 registry 行时应回落到环境变量",
        );
        // 两处都没有 → 官方默认,source 如实说明「这是默认值」
        const fallback = resolveRegistry(dir, { npm_config_registry: "   " });
        assert(fallback.registry === "https://registry.npmjs.org", `空环境变量应视为没有,实际 ${fallback.registry}`);
        assert(fallback.source.includes("默认"), `默认值来源须如实标注,实际 ${fallback.source}`);
        // 刻意不读用户级 .npmrc:门禁结果必须只由仓库内配置决定,否则本机差异会让 CI 与本地结论分叉
        assert(resolveRegistry(path.join(dir, "没有npmrc的目录"), {}).registry === "https://registry.npmjs.org", "目录里没有 .npmrc 时不得去读用户级配置");
      });
    });
  });

  /* ---------- 7. lockfile 组件模型 ---------- */
  await suite.describe("lockfile 组件模型", async () => {
    await suite.case("输入不可用时显式失败(缺文件 / 非法 JSON / 无 packages / 版本过低)", async () => {
      await withTempDir((dir) => {
        assertThrows(() => readLockfile(path.join(dir, "没有这个.json")), /lockfile 不存在/);
        fs.writeFileSync(path.join(dir, "坏.json"), "{", "utf8");
        assertThrows(() => readLockfile(path.join(dir, "坏.json")), /不是合法 JSON/);
        fs.writeFileSync(path.join(dir, "无packages.json"), JSON.stringify({ lockfileVersion: 3 }), "utf8");
        assertThrows(() => readLockfile(path.join(dir, "无packages.json")), /缺少 packages 字段/);
        // lockfileVersion < 2 分不出 dev/production 树,拿它出报告会少算一棵树
        fs.writeFileSync(path.join(dir, "v1.json"), JSON.stringify({ lockfileVersion: 1, packages: {} }), "utf8");
        assertThrows(() => readLockfile(path.join(dir, "v1.json")), /lockfileVersion 1 过低/);
        // 正常输入原样返回(不做任何改写:读到的就是判定的输入)
        const { path: okPath } = makeSandboxLock(dir);
        const lock = /** @type {any} */ (readLockfile(okPath));
        assert(lock.lockfileVersion === 3 && Object.keys(lock.packages).length === Object.keys(SANDBOX_PACKAGES).length, "合法 lockfile 应原样解析");
      });
    });

    await suite.case("组件模型:dev 判定取 lockfile 内建标记,缺声明记 null+none,按 lockPath 排序", async () => {
      await withTempDir((dir) => {
        const { lock } = makeSandboxLock(dir);
        const { components, directNames } = lockComponents(lock);
        const byName = new Map(components.map((item) => [item.name + "@" + item.lockPath, item]));
        const find = (/** @type {string} */ lockPath) => {
          const found = components.find((item) => item.lockPath === lockPath);
          assert(found !== undefined, `夹具应含 ${lockPath}`);
          return found;
        };

        // 依赖范围:判据取自依赖解析器本身(lockfile 的内建标记),不重跑一遍解析
        assert(find("node_modules/prod-lib").dependencyScope === SCOPE_PRODUCTION, "无标记 = 生产树");
        assert(find("node_modules/dev-tool").dependencyScope === SCOPE_DEVELOPMENT, "dev:true = 仅开发树");
        assert(find("node_modules/opt-lib").dependencyScope === SCOPE_DEVELOPMENT, "devOptional:true 归开发树");
        assert(find("node_modules/opt-lib").optional === true, "devOptional 同时标 optional");
        assert(find("node_modules/prod-lib").optional === false, "普通生产依赖不是 optional");
        assert(SCOPE_PRODUCTION === "production" && SCOPE_DEVELOPMENT === "development", "两棵树的取值字面量不能改(产物按它分列)");

        // 直接依赖:根包 dependencies/devDependencies/optionalDependencies 三处合起来才算
        assert(find("node_modules/prod-lib").direct === true, "根包 dependencies 里的包是直接依赖");
        assert(find("node_modules/dev-tool").direct === true, "根包 devDependencies 里的包也算直接依赖");
        assert(find("node_modules/opt-lib").direct === true, "根包 optionalDependencies 里的包也算直接依赖");
        assert(find("node_modules/shared-lib").direct === false, "被间接引入的包不是直接依赖");
        assert(byName.size === components.length, "同名不同条目各自独立(不得按包名去重)");
        assert(directNames.has("prod-lib") && directNames.has("dev-tool") && directNames.has("opt-lib"), "根直接依赖名单应含三类来源");

        // 许可证来源:字段缺失记 null + none,绝不写成占位字符串(占位是产物层的口径)
        assert(find("node_modules/prod-lib").license === "MIT" && find("node_modules/prod-lib").licenseSource === LICENSE_SOURCE_LOCKFILE, "有 license 字段应记来源 lockfile");
        const noLicense = find("node_modules/no-license");
        assert(noLicense.license === null, "缺声明必须是 null");
        assert(noLicense.licenseSource === LICENSE_SOURCE_NONE, `缺声明的来源应记 ${LICENSE_SOURCE_NONE},实际 ${noLicense.licenseSource}`);
        assert(noLicense.license !== NOASSERTION, "组件模型层不得写占位标识(那是 SBOM 产物层的口径)");
        assert(LICENSE_SOURCE_LOCKFILE === "lockfile" && LICENSE_SOURCE_PACKAGE_FILE === "package-file" && LICENSE_SOURCE_NONE === "none", "三个许可证来源取值域字面量不能改");

        // 声明的依赖名排序输出(同输入必得同序)
        assert(JSON.stringify(find("node_modules/prod-lib").declaredDependencies) === JSON.stringify(["both-lib", "shared-lib"]), "声明依赖应排序输出");
        assert(JSON.stringify(find("node_modules/outer-lib").peerDependencies) === JSON.stringify(["absent-peer"]), "peerDependencies 也要带出来");
        // 组件按 lockPath 排序:同输入必得同序,产物才能逐字节可比
        const paths = components.map((item) => item.lockPath);
        assert(JSON.stringify(paths) === JSON.stringify([...paths].sort()), "组件必须按 lockPath 升序");
        // 包名从 lock 路径反推(刻意不 import packageNameFromLockPath —— 它零引用,见第 9 组):
        // 从 lockComponents 产出的组件名反查,验的是同一件事:取最内层那一段
        assert(find("node_modules/prod-lib/node_modules/shared-lib").name === "shared-lib", "嵌套依赖应取最内层的包名");
        assert(components.filter((item) => item.name === "shared-lib").length === 2, "同名不同条目各自独立,包名都取最内层");
      });
    });

    await suite.case("依赖解析按 node_modules 就近上溯,解析不到记 null 而不是猜", async () => {
      await withTempDir((dir) => {
        const { lock } = makeSandboxLock(dir);
        // 就近优先:prod-lib 要的 shared-lib@^2 落在自己的嵌套条目,不是顶层那个 9.9.9
        assert(resolveDepPath(lock, "node_modules/prod-lib", "shared-lib") === "node_modules/prod-lib/node_modules/shared-lib", "同名嵌套依赖应就近解析");
        // 上溯兜底:prod-a 那一层没有的包,逐级上溯到顶层
        assert(resolveDepPath(lock, "node_modules/prod-lib", "both-lib") === "node_modules/both-lib", "本层没有时应上溯到顶层");
        assert(resolveDepPath(lock, "node_modules/prod-lib/node_modules/shared-lib", "both-lib") === "node_modules/both-lib", "深层条目也应逐级上溯");
        assert(resolveDepPath(lock, "", "prod-lib") === "node_modules/prod-lib", "根包直接依赖应解析到顶层");
        // 解析不到必须返回 null:静默当成「无该依赖」会让依赖图凭空少边
        assert(resolveDepPath(lock, "", "根本没装") === null, "未安装的包必须返回 null");
        assert(resolveDepPath(lock, "node_modules/prod-lib", "也没装") === null, "深层引入方找不到的包同样返回 null");

        // 中间层判别:答案必须落在「本层与顶层之间」,否则上溯是「逐级」还是「直接跳顶层」分不出来。
        //
        // 为什么必须专门造这个形状:两种实现只差在**探针序列**上 —— 逐级探
        // [本层 → 各中间层 → 顶层],跳顶层只探 [本层 → 顶层],两次探针**完全一致**。
        // 上面 6 条断言的答案全落在本层或顶层:逐级确实多探了一个候选
        // (node_modules/prod-lib/node_modules/both-lib),但那个候选不在 lock 里,
        // 于是「多探一次」不改变答案 ⇒ 把逐级压成跳顶层的变异全段仍绿。
        // 深度本身不是判别维度,**答案所在的层级**才是。
        const midLibPath = "node_modules/outer-lib/node_modules/mid-lib";
        const leafLibPath = "node_modules/outer-lib/node_modules/mid-lib/node_modules/leaf-lib";
        const midFromLeaf = resolveDepPath(lock, leafLibPath, "mid-lib");
        assert(midFromLeaf === midLibPath, `中间层命中点应被逐级上溯取到 ${midLibPath},实际 ${String(midFromLeaf)}`);
        // 负面对照:顶层确实没有同名条目。把「顶层没有」从碰巧变成被断言的事实 ——
        // 否则上面那条会同时满足两种实现,夹具本身就恒绿。
        assert(resolveDepPath(lock, "", "mid-lib") === null, "反面对照:顶层不应有同名条目,否则中间层那条会同时满足逐级与跳顶层");
        // 反向对照:顶层**也**放同名包时,就近优先仍须命中中间层 —— 证明上一条不是靠
        // 「顶层恰好没有」蒙对的。此形状下两种实现的答案恰好也分得开(中间层 vs 顶层)。
        const shadowLock = { ...lock, packages: { ...lock.packages, "node_modules/mid-lib": { version: "9.9.9", license: "MIT" } } };
        assert(resolveDepPath(shadowLock, "", "mid-lib") === "node_modules/mid-lib", "反向对照的对照:顶层同名条目确实存在");
        const shadowFromLeaf = resolveDepPath(shadowLock, leafLibPath, "mid-lib");
        assert(shadowFromLeaf === midLibPath, `顶层同名存在时就近优先仍须命中 ${midLibPath},实际 ${String(shadowFromLeaf)}`);
      });
    });

    await suite.case("依赖边:optional 覆盖同名 dependencies,未解析的依赖逐条记名", async () => {
      await withTempDir((dir) => {
        const { lock } = makeSandboxLock(dir);
        const { components } = lockComponents(lock);
        const { edges, unresolved } = componentEdges(lock, components);

        // 根边只取根包实际声明的依赖,且 devDependencies 不参与(不随包分发)
        assert(
          JSON.stringify(edges.get("")) ===
            JSON.stringify(["node_modules/no-license", "node_modules/opt-lib", "node_modules/outer-lib", "node_modules/prod-lib"]),
          `根边应覆盖 dependencies / optionalDependencies(不含 devDependencies),实际 ${JSON.stringify(edges.get(""))}`,
        );
        // optionalDependencies 覆盖同名 dependencies 条目:先去重再去解析,故 both-lib 只出现一次
        assert(
          JSON.stringify(edges.get("node_modules/prod-lib")) === JSON.stringify(["node_modules/both-lib", "node_modules/prod-lib/node_modules/shared-lib"]),
          `prod-lib 的边应去重排序,实际 ${JSON.stringify(edges.get("node_modules/prod-lib"))}`,
        );
        assert(edges.get("node_modules/prod-lib")?.length === new Set(edges.get("node_modules/prod-lib")).size, "边不得有重复目标");
        // 未解析的依赖要逐条记名(诊断与门禁判红都靠它),而不是静默丢掉
        assert(JSON.stringify(unresolved.get("node_modules/other-lib")) === JSON.stringify(["missing-dep"]), "缺失的传递依赖应被记名");
        assert(JSON.stringify(unresolved.get("node_modules/outer-lib")) === JSON.stringify(["absent-peer"]), "未安装的 peer 也应被记名");
        assert(!unresolved.has("node_modules/prod-lib"), "全部解析出来的组件不应进未解析名单");
        // 每个组件都要有一条边记录(即便边为空),否则「无依赖」与「没算过」分不开
        for (const component of components) assert(edges.has(component.lockPath), `组件 ${component.lockPath} 缺边记录`);
      });
    });
  });

  /* ---------- 8. 产物序列化与 CLI/平台约定 ---------- */
  await suite.describe("产物序列化与 CLI/平台约定", async () => {
    await suite.case("序列化确定性:2 空格缩进 + 末尾换行,落盘后逐字节相同", async () => {
      await withTempDir((dir) => {
        const value = { b: 1, a: [1, 2, { c: "x" }] };
        const text = serializeJson(value);
        assert(text === `${JSON.stringify(value, null, 2)}\n`, "序列化口径:2 空格缩进 + 末尾换行");
        assert(text.endsWith("\n"), "必须以换行结尾(否则 --check 的 diff 会带 ^M 噪声)");
        assert(text === serializeJson(value), "同输入两次序列化必须逐字节相同");

        const target = path.join(dir, "产物.json");
        writeJson(target, value);
        assert(fs.readFileSync(target, "utf8") === text, "落盘内容必须与序列化结果逐字节相同");
        // 读回来必须能解析(产物是给下游门禁与人读的)
        assert(JSON.stringify(readJson(target)) === JSON.stringify(value), "写完应能原样读回");
        // 键序由构造顺序决定:同输入同输出,漂移比对才有意义
        assert(serializeJson({ x: 1, y: 2 }).indexOf('"x"') < serializeJson({ x: 1, y: 2 }).indexOf('"y"'), "键序应随构造顺序稳定");
      });
    });

    await suite.case("读 JSON 失败转可读报错(缺文件 / 非法 JSON)", async () => {
      await withTempDir((dir) => {
        assertThrows(() => readJson(path.join(dir, "没有这个.json")), /文件不存在/);
        fs.writeFileSync(path.join(dir, "坏.json"), "{oops", "utf8");
        assertThrows(() => readJson(path.join(dir, "坏.json")), /不是合法 JSON/);
      });
    });

    await suite.case("CLI 解析:开关不带取值、未知项显式失败并带上 usage,值项两种写法等价", () => {
      const spec = { booleans: ["help"], values: ["lock", "output-dir"], usage: "用法: xxx" };
      const parsed = parseSupplyArgs(["--help", "--lock=package-lock.json", "--output-dir", "out"], spec);
      assert(parsed.help === true, "开关应置 true");
      assert(parsed.lock === "package-lock.json" && parsed["output-dir"] === "out", "--k=v 与 --k v 两种写法应等价");
      // 未出现的开关也要有确定值(缺省 false),调用方不必写 `=== undefined` 判断
      assert(parseSupplyArgs([], spec).help === false, "未出现的开关缺省为 false");
      // 开关不接受取值:否则 --help=x 会被静默当成 --help,给出错误的引导
      assertThrows(() => parseSupplyArgs(["--help=1"], spec), /--help 是开关,不接受取值/);
      // 未知选项 / 非选项参数 / 缺取值:全部显式失败,且消息里带得上 usage
      assertThrows(() => parseSupplyArgs(["--没这个"], spec), /无法识别的选项:--没这个\(用法: xxx\)/);
      assertThrows(() => parseSupplyArgs(["裸参数"], spec), /无法识别的参数:裸参数\(用法: xxx\)/);
      assertThrows(() => parseSupplyArgs(["--lock"], spec), /选项 --lock 缺少取值/);
      // 没给 usage 时消息也不该塌(不能渲染成 "()")
      assertThrows(() => parseSupplyArgs(["--没这个"], { booleans: [], values: [], usage: "" }), /无法识别的选项:--没这个$/);
    });

    await suite.case("Windows 下 npm 走 ComSpec 且含空格参数被引号包裹;cmd 引号只在必要时加", () => {
      const invoked = npmInvocation(["audit", "--json"]);
      if (process.platform === "win32") {
        // Node 对 .cmd/.bat 的直 spawn 已被加固拦截,必须经 ComSpec 承载命令串
        assert(path.win32.basename(invoked.command).toLowerCase() === "cmd.exe", `Windows 下应由 ComSpec 承载,实际 ${invoked.command}`);
        assert(JSON.stringify(invoked.args.slice(0, 3)) === JSON.stringify(["/d", "/s", "/c"]), "/d /s /c 是批处理承载的必要开关");
        assert(invoked.args[3]?.startsWith("npm.cmd "), `命令串应以 npm.cmd 起头,实际 ${String(invoked.args[3])}`);
      } else {
        assert(invoked.command === "npm" && JSON.stringify(invoked.args) === JSON.stringify(["audit", "--json"]), "非 Windows 下直接 spawn npm");
      }
      // 含空白的参数必须补引号,否则含空格的路径会被 cmd 拆成两个参数。
      // 刻意**不** import quoteForCmd(它是零引用的死导出,见第 9 组),只从 npmInvocation
      // 的可观察输出断言 —— 内部引号处理是实现细节,命令串才是门禁真正 spawn 的东西。
      const commandLineOf = (/** @type {string[]} */ args) => {
        const invocation = npmInvocation(args);
        return invocation.args[invocation.args.length - 1] ?? "";
      };
      const spaced = commandLineOf(["ci", "--prefix", "C:\\Program Files\\app"]);
      assert(spaced.includes('"C:\\Program Files\\app"'), `含空格的路径必须被引号包裹,实际 ${spaced}`);
      assert(!spaced.includes(" Program Files\\app\""), "引号必须包住整个参数,不能只包后半段");
      assert(commandLineOf(["run", "build:docx"]).includes(" run build:docx"), "不含特殊字符的参数不加引号");
      assert(commandLineOf(["run", 'say "hi"']).includes('\\"hi\\"'), "内部引号必须被转义,否则命令串会被截断");
      assert(commandLineOf(["run", "a&b"]).includes('"a&b"'), "cmd 元字符必须被引号保护");
    });

    await suite.case("错误文案归一为单行;产物目录与占位标识是跨门禁口径", () => {
      assert(errorMessage(new Error("第一行\n  第二行")) === "第一行 第二行", "多行错误必须压成单行(报告/日志一行一条)");
      assert(errorMessage("裸字符串 错误") === "裸字符串 错误", "字符串错误原样归一");
      assert(errorMessage(new Error("  前后空白  ")) === "前后空白", "首尾空白应被去掉");
      assert(errorMessage(42) === "42", "非 Error 值也要能归一成可读文本");
      // 产物目录:五个门禁本体共用同一个默认值,必须是仓库相对路径(POSIX 归一后逐字比对,
      // 因为 path.join 在 Windows 上产出反斜杠)
      assert(toPosix(SUPPLY_OUTPUT_DIR) === "output/artifacts/supply", `产物目录应为 output/artifacts/supply,实际 ${toPosix(SUPPLY_OUTPUT_DIR)}`);
      assert(!path.isAbsolute(SUPPLY_OUTPUT_DIR), "产物目录必须是仓库相对路径(绝对路径会随机器变化,破坏可复现)");
      assert(!/[A-Z]:/.test(toPosix(SUPPLY_OUTPUT_DIR)), "产物目录不得含盘符");
    });

    await suite.case("转出的既有单源必须与各自单源是同一个函数引用(不是复刻)", async () => {
      // 复用而非复制:文件哈希/原子写/主模块判定/子进程执行各有一处实现,
      // 本层再写一份就会出现「一处改了另一处没改」的静默分叉
      assert(hashBuffer === fsxHashBuffer, "hashBuffer 必须转出 shared/fsx.mjs 的同一个实现");
      assert(toPosix === fsxToPosix, "toPosix 必须转出 shared/fsx.mjs 的同一个实现");
      assert(writeFileAtomic === fsxWriteFileAtomic, "writeFileAtomic 必须转出 shared/fsx.mjs 的同一个实现");
      assert(isMainModule === cliIsMainModule, "isMainModule 必须转出 shared/cli.mjs 的同一个实现");
      assert(runCommand === probeRunCommand, "runCommand 必须转出 print-env-fingerprint.mjs 的同一个实现");
      await withTempDir((dir) => {
        // 转出物本身仍是可用实现(不是空壳):POSIX 化与原子写的字节结果都要对
        assert(toPosix("a\\b\\c") === "a/b/c", "转出的 toPosix 应把反斜杠换成正斜杠");
        const target = path.join(dir, "原子写.txt");
        writeFileAtomic(target, "内容\n");
        assert(fs.readFileSync(target, "utf8") === "内容\n", "转出的 writeFileAtomic 应逐字节写入");
        assert(hashBuffer(Buffer.from("abc")) === hashBuffer(Buffer.from("abc")), "转出的 hashBuffer 对同内容应给同一指纹");
      });
    });
  });

  /* ---------- 9. 导出面自述 ---------- */
  await suite.describe("导出面自述", async () => {
    await suite.case("门禁消费面必须被本段覆盖:新增消费却无断言即判红", () => {
      const exported = readExportedNames(fs.readFileSync(path.join(SUPPLY_GATE_DIR, "supply-common.mjs"), "utf8"));
      assert(exported.length > 0, "应从源码解析出导出清单(解析器坏了必须判红,不能静默按空集放行)");

      // @type {Map<string, string[]>}
      const consumed = new Map();
      for (const body of GATE_BODIES) {
        const names = readImportedNames(fs.readFileSync(path.join(SUPPLY_GATE_DIR, body), "utf8"));
        assert(names.length > 0, `${body} 应当从 supply-common import(解析器/路径坏了必须判红)`);
        consumed.set(body, names);
      }
      const gateConsumed = new Set([...consumed.values()].flat());

      const covered = new Set(COVERED_EXPORTS);
      const uncovered = [...gateConsumed].filter((name) => !covered.has(name)).sort();
      assert(uncovered.length === 0, `这些导出被门禁消费但本段没有断言:${uncovered.join(",")}(补断言,或说明它由哪条断言间接钉住)`);
      // 反向:登记了却已不存在于源码 ⇒ 表已陈旧,必须当场指出(否则这张表会变成免罪符)
      const stale = [...covered].filter((name) => !exported.includes(name)).sort();
      assert(stale.length === 0, `COVERED_EXPORTS 登记了源码里已不存在的导出:${stale.join(",")}`);
    });

    await suite.case("死导出清单与已登记基线一致(零引用的 export 看得见)", () => {
      const exported = readExportedNames(fs.readFileSync(path.join(SUPPLY_GATE_DIR, "supply-common.mjs"), "utf8"));
      assert(exported.length > 0, "应从源码解析出导出清单(解析器坏了必须判红,不能静默按空集放行)");

      const referenced = readExternallyReferencedNames(exported);
      // 「死」= 导出了,但除本模块自身外全仓没有任何代码引用它 ⇒ 没有任何消费路径能走到它。
      // 只报不算数:把基线钉住,新增死导出才会立刻显形(存在性清单永远发现不了这件事)。
      const dead = exported.filter((name) => !referenced.has(name)).sort();
      assert(dead.length > 0, "死导出清单为空?扫描器多半失效了,必须判红而不是报喜");
      const registered = [...DEAD_EXPORTS_BASELINE].sort();
      assert(
        JSON.stringify(dead) === JSON.stringify(registered),
        `死导出清单与基线不一致。实际:${dead.join(",") || "(无)"};基线:${registered.join(",")}。` +
          "新增死导出请登记进 DEAD_EXPORTS_BASELINE(它没人调用,存在性清单发现不了);" +
          "给任一项接上消费方或删掉它,请同步删掉基线里那一行。",
      );
      // 基线里登记的每一项都必须真的还在导出(否则基线自己漂了)
      const gone = registered.filter((name) => !exported.includes(name));
      assert(gone.length === 0, `基线登记了源码里已不存在的导出:${gone.join(",")}`);
      // 反向:被外部引用的导出绝不能被登记成死的(否则就是在说谎)
      const wronglyDead = registered.filter((name) => referenced.has(name));
      assert(wronglyDead.length === 0, `这些导出全仓有代码引用,不该登记成死导出:${wronglyDead.join(",")}`);
    });
  });

  return { cases: suite.results };
}