// @ts-check
/**
 * 仓库顶层自描述(派生单源):一次 `readdir` + 每个条目的内容/声明剖面 → 顶层类别。
 *
 * 为什么需要这个模块(ADR-037):此前 6 处各自手写「顶层有什么」—— 门禁探针的沙盒镜像清单与
 * 工作树指纹集、清理脚本的删除保护区、契约自检夹具的占位文件清单、打包白名单的核对。
 * 手写清单的失效形态是**恒绿**:新增一个顶层目录时,漏改的那份门禁不报错,只是扫不到。
 * 本模块把这几处改为从实际内容派生,新增顶层目录时零处需要手改。
 *
 * 三条设计约束(改本文件前先读):
 *
 * 1. **分类判据不含任何具体目录名。** `classifyProfile()` 只吃「内容剖面」(有没有代码 / 有没有
 *    Markdown / 是不是安装树 …),条目名根本不作为参数进入判定 —— 这是结构性保证,不是约定:
 *    把某个顶层目录改名,分类结果不变。名称只在两处出现:① 读**声明**(忽略声明 / 编译配置 /
 *    包清单)时按名匹配;② 报告与诊断里显示。改名不改类别的实证由契约自检的负向锚点给出
 *    (它造一棵**全部用任意名**的顶层目录,断言类别仍落在同一档)。
 * 2. **派生逻辑本身是新的单点。** 分类规则写错会让全部下游一起错,所以每个消费面都配了正反
 *    两个方向的锚点:真实仓库上跑既有门禁 = 正向;任意名样例 + 新增顶层目录 = 反向。
 * 3. **未知条目归 `other`,不保护也不镜像。** 进保护集的只有「被声明指向的树 / 有代码 / 有文档 /
 *    顶层声明文件」。「删不掉」的保证不来自这个集合,而来自清理脚本那边**封闭的删除目标白名单**
 *    (见 gates/artifacts/clean-artifacts.mjs 的 TARGET_DIRS 与 assertMatchesBuildConfig)—— 两者正交,
 *    不要把「保护集」当成唯一的删除防线。
 *
 * 类别词表与 ADR-037 写的 7 类对应关系(实现多出 3 类,理由见各项注释):
 *   source / verify / shared / doc / config / vcs —— 同名;
 *   `build`(编译输出树:下游的**输入**,故与终端产物分开)· `deps`(安装树,须整棵跳过)·
 *   `other`(未归类)—— 新增,用于把「终端产物」与「说不清是什么」两件事分开表达。
 *
 * 本模块只做「读 + 归类」,不做判定:红不红、报什么文案由各消费门禁自己负责(单源出事实,
 * 门禁出结论)。IO 全部经入参注入(根目录),不读全局环境,故可对任意目录(含临时夹具)求值。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ARTIFACTS_DIR, ROOT, SMOKE_DIR } from "../../shared/paths.js";

/* ---------- 类别词表(封闭枚举;判据里出现的仓库内名字一个都没有) ---------- */

/** 顶层类别 */
export const CATEGORY = Object.freeze({
  /** 编译源码根(发出产物的编译配置的 rootDir / include) */
  SOURCE: "source",
  /** 编译输出树(发出产物的编译配置的 outDir):下游的输入而非终端产物,故与 artifact 分开 */
  BUILD: "build",
  /** 验收与门禁树(不发出产物的编译配置所含的树,或被 npm script 以文件路径直接驱动的脚本树) */
  VERIFY: "verify",
  /** 机制树:有代码,但既非编译源码根、也非脚本直接驱动的树(跨树复用的纯机制) */
  SHARED: "shared",
  /** 文档树(直接子项以 Markdown 为多数) */
  DOC: "doc",
  /** 顶层声明文件:编译器配置 / 包清单 / 锁文件,以及顶层散落的脚本 */
  CONFIG: "config",
  /** 安装的依赖树:整棵跳过(既不镜像也不当源码树) */
  DEPS: "deps",
  /** 可再生的终端产物(打包输出、覆盖率报告、被忽略声明标为生成物的树) */
  ARTIFACT: "artifact",
  /** 点目录 / 点文件:版本控制、CI 与编辑器状态 */
  VCS: "vcs",
  /** 未归类(素材目录、单文件生成物等) */
  OTHER: "other",
});

/** 进沙盒镜像集的树类别。编译输出树也在内:它的下游是验收段(测试 import 产物),须整树带过去 */
/** @type {Set<string>} */
const MIRROR_TREE_CATEGORIES = new Set([CATEGORY.SOURCE, CATEGORY.VERIFY, CATEGORY.SHARED, CATEGORY.BUILD]);

/** 这两类不进删除保护区:前者本就是产物,后者不是任何声明指向的树 */
/** @type {Set<string>} */
const NON_PROTECTED_CATEGORIES = new Set([CATEGORY.ARTIFACT, CATEGORY.OTHER]);

/* ---------- 探针常量(内容剖面的取值域,不含任何仓库内名字) ---------- */

/** 代码扩展名(判据:树里有没有「会被编译/被解释器加载」的源文件) */
const CODE_EXTENSIONS = new Set([".ts", ".cts", ".mts", ".tsx", ".js", ".cjs", ".mjs", ".jsx"]);
/** 文档扩展名(判据:树是不是以文档为主体) */
const DOC_EXTENSIONS = new Set([".md", ".mdx"]);
/** JSON 声明的识别键:编译器配置 / 锁文件 / 包清单各有一个独有的键,故新增声明文件时零登记 */
const TSCONFIG_MARKER = "compilerOptions";
const LOCKFILE_MARKER = "lockfileVersion";
/** 内容探针的条目预算:单个顶层目录最多访问多少个条目(安装树与素材目录可能很大) */
const PROBE_ENTRY_BUDGET = 400;
/** 内容探针的最大深度 */
const PROBE_MAX_DEPTH = 3;
/**
 * 「什么都没探到」的剖面(缺目录 / 不可读 / 不探针三种情形的共同出口)。
 *
 * 冻结是因为它会被 `scanTopLevel` 直接交给 `classifyProfile`:那份纯函数不写它,
 * 一旦某个调用点就地造一个字面量,「探针没跑」与「探针跑了但三项皆 false」就再也分不开,
 * 而那正是本条要保留的可区分性。
 * @type {Readonly<{ hasCode: boolean, docMajority: boolean, hasLockfileMarker: boolean }>}
 */
const NO_PROFILE = Object.freeze({ hasCode: false, docMajority: false, hasLockfileMarker: false });

/* ---------- 纯函数:内容剖面 → 类别(判据单源,不含条目名) ---------- */

/**
 * 条目的**内容剖面**。刻意不含 `name`:分类结果不得依赖条目叫什么(见文件头约束 1)。
 * @typedef {object} EntryProfile
 * @property {boolean} isDirectory 条目是否为目录
 * @property {boolean} hidden 名字是否以点开头(点目录 / 点文件)
 * @property {boolean} hasCode 树内是否存在代码文件(文件只看自身)
 * @property {boolean} docMajority 目录的直接子项是否以 Markdown 为多数
 * @property {boolean} hasLockfileMarker 目录内是否存在带锁文件标记的 JSON(安装树指纹)
 * @property {boolean} gitignored 是否被版本控制忽略声明命中
 * @property {boolean} isBuildOutput 是否为发出产物的编译配置的 outDir
 * @property {boolean} isPackOutput 是否为打包配置的输出目录
 * @property {boolean} isSourceRoot 是否为发出产物的编译配置的 rootDir / include
 * @property {boolean} isCheckTree 是否为不发出产物的编译配置的 include
 * @property {boolean} isScriptTree 是否被 npm script 以文件路径直接驱动
 * @property {string | null} configRole 文件形态的声明角色:tsconfig / manifest / lockfile / null
 * @property {boolean} hasDoc 文件是否文档扩展名
 */

/**
 * 类别判定。顺序即优先级(先命中先定),每条都能说出「凭什么」。
 *
 * 顺序按「便宜的、无歧义的判据在前」排,好让安装树在递归探查之前就被 `deps` 拦下。
 * @param {EntryProfile} p 条目剖面
 * @returns {{ category: string, reason: string }} 类别 + 判定依据(报告与诊断用)
 */
export function classifyProfile(p) {
  // 点目录 / 点文件先判:隐藏项(版本控制、CI、编辑器状态、本地配置)无需再看内容。
  if (p.hidden) return { category: CATEGORY.VCS, reason: "点开头的隐藏项(版本控制/CI/编辑器/本地配置)" };
  if (!p.isDirectory) {
    if (p.configRole !== null) return { category: CATEGORY.CONFIG, reason: `顶层声明文件(${p.configRole})` };
    if (p.hasCode) return { category: CATEGORY.CONFIG, reason: "顶层脚本(工具入口)" };
    if (p.hasDoc) return { category: CATEGORY.DOC, reason: "顶层文档文件" };
    return { category: CATEGORY.OTHER, reason: "无扩展名或非代码/文档的单文件" };
  }
  if (p.isBuildOutput) return { category: CATEGORY.BUILD, reason: "编译配置的输出目录(下游的输入)" };
  if (p.isPackOutput) return { category: CATEGORY.ARTIFACT, reason: "打包配置的输出目录(终端产物)" };
  if (p.hasLockfileMarker) return { category: CATEGORY.DEPS, reason: "内部带锁文件标记的安装树" };
  if (p.gitignored) return { category: CATEGORY.ARTIFACT, reason: "版本控制忽略声明把它标为生成物" };
  if (p.docMajority) return { category: CATEGORY.DOC, reason: "直接子项以 Markdown 为多数(文档树)" };
  if (p.isSourceRoot) return { category: CATEGORY.SOURCE, reason: "发出产物的编译配置把它列为源码根" };
  if (p.isCheckTree) return { category: CATEGORY.VERIFY, reason: "不发出产物的编译配置把它列为检查面" };
  if (p.isScriptTree) return { category: CATEGORY.VERIFY, reason: "被 npm script 以文件路径直接驱动" };
  if (p.hasCode) return { category: CATEGORY.SHARED, reason: "有代码但无声明指向(机制树,按默认档保护)" };
  return { category: CATEGORY.OTHER, reason: "既无代码也无文档、无声明指向(素材/生成目录)" };
}

/* ---------- IO:读声明与内容剖面 ---------- */

/**
 * 顶层条目。
 * @typedef {object} TopEntry
 * @property {string} name 条目名(顶层,无分隔符)
 * @property {boolean} isDirectory
 * @property {string} category 派生类别
 * @property {string} reason 判定依据
 * @property {string | null} configRole 声明文件角色(非声明文件为 null)
 */

/**
 * 顶层派生结果。
 * @typedef {object} Manifest
 * @property {string} root 求值的仓库根
 * @property {TopEntry[]} entries 全部顶层条目(按名排序)
 * @property {string[]} names 全部顶层条目名(按名排序)
 * @property {string[]} mirrorPaths 沙盒镜像集(树整树、声明文件整文件)
 * @property {string[]} protectedTreePaths 「真实工作树零注入」指纹集
 * @property {string[]} cleanProtectedSegments 删除目标保护区(顶层条目名,已剔除声明可清理的产物树)
 * @property {string[]} buildOutputNames 编译输出树(发出产物的编译配置的 outDir)
 * @property {string[]} packOutputNames 打包输出目录
 * @property {string[]} artifactRootNames 验收产物根(由路径单源 shared/paths.js 的常量反推)
 * @property {string | null} manifestName 包清单文件名
 * @property {string | null} lockfileName 锁文件名
 * @property {string[]} declaringJsonNames 顶层声明类 JSON(编译器配置 / 包清单 / 锁文件)
 */

/**
 * 抹掉 JSONC 的注释(只抹字符串之外的真注释,故字符串里的 `//`(URL 等)不会被截断)。
 *
 * 为什么需要:编译器配置是 JSONC(带注释),直接 `JSON.parse` 会失败 —— 而它正是「哪些树是源码根」
 * 与「哪个目录是输出目录」两条判据的来源,解析失败会让这两条判据整条失效(静默退化成按内容猜)。
 * 口径与 TypeScript 的 JSONC 一致:`//` 行注释与块注释。
 * @param {string} text 原文
 * @returns {string} 无注释的文本
 */
function stripJsonComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 读一个 JSON(C)声明;不可读或不是对象时返回 null。
 *
 * 缺失是**合法输入**而不是错误:夹具与沙盒本就不一定带齐声明,派生必须在缺声明时退化成
 * 「按内容判」,而不是抛错(抛错会让沙盒里跑的门禁因「理由不对的原因」失败)。
 * @param {string} abs 绝对路径
 * @returns {Record<string, unknown> | null}
 */
function readJsonObject(abs) {
  try {
    const parsed = JSON.parse(stripJsonComments(readFileSync(abs, "utf8")));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? /** @type {Record<string, unknown>} */ (parsed)
      : null;
  } catch {
    return null;
  }
}

/**
 * 取路径首段(打包白名单模式、编译配置 include、outDir、忽略声明一律走它)——
 * 故「顶层」这个概念在本模块只由这一处定义。
 * @param {unknown} value 路径或模式(声明里的取值类型本就是 unknown,收窄在这一处做)
 * @returns {string | null} 首段(空则 null)
 */
function firstSegment(value) {
  if (typeof value !== "string") return null;
  const head = value.replaceAll("\\", "/").split("/")[0];
  return head === undefined || head === "" ? null : head;
}

/**
 * 版本控制忽略声明里「整棵忽略某个顶层」的名字。
 *
 * 刻意保守:只认形如 `<名字>/` 的整棵声明(去掉锚定斜杠后首段不含通配符);`*.log` 这类跨顶层
 * 的文件模式、带锚定的深层模式与取反模式一律不参与判定 —— 把一棵源码树误判成「生成物」的
 * 代价(它就不受保护了)远大于漏判一个生成目录。
 * @param {string} root 仓库根
 * @returns {Set<string>} 顶层名字集合
 */
function readIgnoredTopLevelNames(root) {
  /** @type {Set<string>} */
  const names = new Set();
  let text;
  try {
    text = readFileSync(path.join(root, ".gitignore"), "utf8");
  } catch {
    return names; // 无忽略声明 = 什么都不按生成物处理(保守方向)
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("!")) continue;
    const pattern = line.replace(/^\/+/, "").replace(/\/+$/, "");
    if (pattern === "" || pattern.includes("/") || /[*?[\]]/.test(pattern)) continue;
    names.add(pattern);
  }
  return names;
}

/**
 * npm script 里以**文件路径**形式出现的顶层树:形如 `<名字>/…/x.mjs` 的记为脚本驱动树。
 *
 * 只认带代码扩展名的文件引用,不把 `eslint src/ test/ gates/` 这类**参数**算进来:参数回答的
 * 是「lint 覆盖哪些树」,与「谁驱动这棵树」不是同一件事(后者才是沙盒要不要带它的依据)。
 * @param {Record<string, unknown> | null} manifest 包清单
 * @returns {Set<string>} 顶层名字集合
 */
function readScriptDrivenNames(manifest) {
  /** @type {Set<string>} */
  const names = new Set();
  const scripts = manifest === null ? {} : manifest.scripts;
  if (typeof scripts !== "object" || scripts === null) return names;
  const tokenRe = /[\w./\\@-]+\.(?:ts|cts|mts|tsx|js|cjs|mjs|jsx)\b/g;
  for (const body of Object.values(/** @type {Record<string, unknown>} */ (scripts))) {
    if (typeof body !== "string") continue;
    for (const m of body.matchAll(tokenRe)) {
      const head = firstSegment(m[0]);
      if (head !== null) names.add(head);
    }
  }
  return names;
}

/**
 * 顶层声明面:编译器配置(哪些发出产物、哪些只做检查)、包清单 / 锁文件 / 打包配置、忽略声明。
 * @param {string} root 仓库根
 * @param {{ name: string, isDirectory: boolean }[]} entries 顶层条目
 * @returns 声明集合
 */
function readDeclarations(root, entries) {
  /** @type {Record<string, unknown>[]} */
  const tsconfigs = [];
  /** @type {Map<string, string>} */
  const roles = new Map();
  /** @type {Record<string, unknown> | null} */
  let manifest = null;
  for (const entry of entries) {
    if (entry.isDirectory || path.extname(entry.name) !== ".json") continue;
    const json = readJsonObject(path.join(root, entry.name));
    if (json === null) continue;
    if (Object.hasOwn(json, TSCONFIG_MARKER) || Object.hasOwn(json, "extends")) {
      tsconfigs.push(json);
      roles.set(entry.name, "tsconfig");
    } else if (Object.hasOwn(json, LOCKFILE_MARKER)) {
      roles.set(entry.name, "lockfile");
    } else if (Object.hasOwn(json, "name") && Object.hasOwn(json, "scripts")) {
      manifest = json;
      roles.set(entry.name, "manifest");
    }
  }
  // 「发出产物」的编译配置 = 声明了 outDir 且未声明 noEmit。不按文件名挑主配置 ——
  // 主/检查两份配置的差别本就在这两个键上。
  const emitting = tsconfigs.find((cfg) => hasOutDir(cfg) && getOptions(cfg)?.noEmit !== true) ?? null;
  const build = manifest === null ? null : asObject(manifest.build);
  return {
    roles,
    emitting,
    sourceRoots: new Set(configIncludeSegments(emitting)),
    checkRoots: new Set(tsconfigs.filter((cfg) => cfg !== emitting).flatMap((cfg) => configIncludeSegments(cfg))),
    buildOutput: firstSegment(outDirOf(emitting)),
    packOutput: firstSegment(readPackOutput(build)),
    packTopLevel: packWhitelistSegments(build),
    ignored: readIgnoredTopLevelNames(root),
    scriptDriven: readScriptDrivenNames(manifest),
  };
}

/**
 * 打包输出目录(打包配置的 directories.output)。
 * @param {Record<string, unknown> | null} build 打包配置段
 * @returns {string | null}
 */
function readPackOutput(build) {
  const dirs = asObject(build?.directories);
  const out = dirs?.output;
  return typeof out === "string" ? out : null;
}

/** 窄化:非 null 对象 */
/**
 * @param {unknown} value 待窄化的值
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/**
 * 编译配置的 compilerOptions。
 * @param {Record<string, unknown> | null} cfg 编译配置
 * @returns {Record<string, unknown> | null}
 */
function getOptions(cfg) {
  return cfg === null ? null : asObject(cfg[TSCONFIG_MARKER]);
}

/**
 * 编译配置是否声明了输出目录。
 * @param {Record<string, unknown> | null} cfg 编译配置
 * @returns {boolean}
 */
function hasOutDir(cfg) {
  return typeof outDirOf(cfg) === "string";
}

/**
 * 编译配置的输出目录。
 * @param {Record<string, unknown> | null} cfg 编译配置
 * @returns {string | null}
 */
function outDirOf(cfg) {
  const outDir = getOptions(cfg)?.outDir;
  return typeof outDir === "string" ? outDir : null;
}

/**
 * 编译配置的源码面首段:`include` 的每项 + `rootDir`。
 * @param {Record<string, unknown> | null} cfg 编译配置
 * @returns {string[]} 顶层名字
 */
function configIncludeSegments(cfg) {
  if (cfg === null) return [];
  /** @type {string[]} */
  const out = [];
  if (Array.isArray(cfg.include)) {
    for (const item of cfg.include) {
      if (typeof item !== "string") continue;
      const head = firstSegment(item);
      if (head !== null) out.push(head);
    }
  }
  const head = firstSegment(getOptions(cfg)?.rootDir);
  if (head !== null) out.push(head);
  return out;
}

/**
 * 打包白名单引用的顶层段,按正向 / 全部(含取反)分开。
 *
 * 分开是必要的:正向段决定「哪些目录算被打包收下的产物」,取反段只是排除。两者混在一起会让
 * 一条排除规则(如排除安装树里的 sourcemap)把那个顶层**移出**删除保护区 —— 方向正好反了。
 * @param {Record<string, unknown> | null} build 打包配置段
 * @returns {{ positive: string[], all: string[] }} 顶层段名(各自去重、保持出现序)
 */
function packWhitelistSegments(build) {
  const files = build?.files;
  if (!Array.isArray(files)) return { positive: [], all: [] };
  /** @type {string[]} */
  const positive = [];
  /** @type {string[]} */
  const all = [];
  for (const pattern of files) {
    if (typeof pattern !== "string") continue;
    const head = firstSegment(pattern.startsWith("!") ? pattern.slice(1) : pattern);
    if (head === null) continue;
    if (!all.includes(head)) all.push(head);
    if (!pattern.startsWith("!") && !positive.includes(head)) positive.push(head);
  }
  return { positive, all };
}

/**
 * 目录的第一层探针(只 `readdir` 一层 + 读直接子项里的声明 JSON):有没有代码文件、
 * 直接子项是否以 Markdown 为多数、有没有安装树指纹。
 * @param {string} absDir 目录绝对路径
 * @returns {{ hasCode: boolean, docMajority: boolean, hasLockfileMarker: boolean }}
 */
function probeDirectChildren(absDir) {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(absDir);
  } catch {
    return NO_PROFILE;
  }
  let hasCode = false;
  let directDoc = 0;
  let hasLockfileMarker = false;
  for (const name of names) {
    const abs = path.join(absDir, name);
    const ext = path.extname(name);
    if (CODE_EXTENSIONS.has(ext)) {
      // 目录也可能是同扩展名(极少见),故仍要 stat 一次才敢把它算作代码文件
      if (isFile(abs)) hasCode = true;
      continue;
    }
    if (ext === ".json") {
      const json = isFile(abs) ? readJsonObject(abs) : null;
      if (json !== null && Object.hasOwn(json, LOCKFILE_MARKER)) hasLockfileMarker = true;
      continue;
    }
    if (DOC_EXTENSIONS.has(ext) && isFile(abs)) directDoc += 1;
  }
  return { hasCode, docMajority: directDoc > 0 && directDoc * 2 > names.length, hasLockfileMarker };
}

/**
 * 目录的深层探针:在预算内找任意一层的代码文件(第一层没找到时才跑)。
 * @param {string} absDir 目录绝对路径
 * @returns {boolean} 是否存在代码文件
 */
function probeHasCodeDeep(absDir) {
  /** @type {Array<{ abs: string, depth: number }>} */
  const queue = readdirSync(absDir).map((name) => ({ abs: path.join(absDir, name), depth: 1 }));
  let visited = 0;
  while (queue.length > 0 && visited < PROBE_ENTRY_BUDGET) {
    const item = /** @type {{ abs: string, depth: number }} */ (queue.shift());
    visited += 1;
    let isDir = false;
    let isFileEntry = false;
    try {
      const stats = statSync(item.abs);
      isDir = stats.isDirectory();
      isFileEntry = stats.isFile();
    } catch {
      continue; // 探针途中消失的条目(并发清理的产物目录):跳过,不影响其余判定
    }
    if (isDir) {
      if (item.depth < PROBE_MAX_DEPTH) {
        for (const name of readdirSync(item.abs)) {
          queue.push({ abs: path.join(item.abs, name), depth: item.depth + 1 });
        }
      }
      continue;
    }
    if (isFileEntry && CODE_EXTENSIONS.has(path.extname(item.abs))) return true;
  }
  return false;
}

/**
 * 是否为普通文件(不跟随符号链接的判定交给调用方:此处只回答「是不是文件」)。
 * @param {string} abs 绝对路径
 * @returns {boolean}
 */
function isFile(abs) {
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

/**
 * 验收产物根:从**路径单源**(shared/paths.js)的常量反推首段,而不是在这里写死目录名。
 *
 * 只对真实仓库根求值:对夹具 / 沙盒根,那些常量并不指向那个根,拿它反推会得出「该夹具的产物根
 * 是真实仓库的那个名字」这种无意义的结果。
 * @param {string} root 求值的根
 * @returns {string[]} 顶层名字
 */
function artifactRootsOf(root) {
  if (path.resolve(root) !== path.resolve(ROOT)) return [];
  return [
    ...new Set(
      [ARTIFACTS_DIR, SMOKE_DIR].map((dir) => firstSegment(path.relative(ROOT, dir))).filter((name) => name !== null),
    ),
  ];
}

/* ---------- 派生:顶层条目 + 三个消费面 ---------- */

/**
 * 求值一棵仓库根的顶层派生结果。
 * @param {string} [root] 仓库根(默认 shared/paths.js 的项目根)
 * @returns {Manifest}
 */
export function scanTopLevel(root = ROOT) {
  /** @type {{ name: string, isDirectory: boolean }[]} */
  const raw = readdirSync(root, { withFileTypes: true }).map((item) => ({
    name: item.name,
    isDirectory: item.isDirectory(),
  }));
  raw.sort((a, b) => a.name.localeCompare(b.name));

  const decl = readDeclarations(root, raw);
  const artifactRoots = artifactRootsOf(root);

  /** @type {TopEntry[]} */
  const entries = raw.map((entry) => {
    const isDir = entry.isDirectory;
    // 隐藏项**不探内容**:`classifyProfile` 首行即 `if (p.hidden) return VCS`,三项探针的结果
    // 读出来也必被丢弃 —— 而 `.c8-tmp` 这类 dump 目录有 200+ 个 json / 上百 MB,逐个
    // readFileSync + JSON.parse 是纯白付(本仓实测 topLevel() cold 4.2s → 0.1s)。
    // 判据一个字没改,只是不替它算它不要的东西:任何未来的点目录都自动免疫,不认目录名。
    const hidden = entry.name.startsWith(".");
    const probe = isDir && !hidden;
    const direct = probe ? probeDirectChildren(path.join(root, entry.name)) : NO_PROFILE;
    const hasCode = probe
      ? direct.hasCode || probeHasCodeDeep(path.join(root, entry.name))
      : CODE_EXTENSIONS.has(path.extname(entry.name));
    const classified = classifyProfile({
      isDirectory: isDir,
      hidden,
      hasCode,
      docMajority: direct.docMajority,
      hasLockfileMarker: direct.hasLockfileMarker,
      gitignored: decl.ignored.has(entry.name),
      isBuildOutput: isDir && decl.buildOutput === entry.name,
      isPackOutput: isDir && decl.packOutput === entry.name,
      isSourceRoot: isDir && decl.sourceRoots.has(entry.name),
      isCheckTree: isDir && decl.checkRoots.has(entry.name),
      isScriptTree: isDir && decl.scriptDriven.has(entry.name),
      configRole: isDir ? null : (decl.roles.get(entry.name) ?? null),
      hasDoc: DOC_EXTENSIONS.has(path.extname(entry.name)),
    });
    return { ...entry, category: classified.category, reason: classified.reason, configRole: decl.roles.get(entry.name) ?? null };
  });

  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  /**
   * 编译输出树取**声明**(tsconfig `outDir` 的首段),**不按磁盘存在性过滤**。
   *
   * 为什么不能按存在性过滤:本门禁的两个调用点 —— `ci.yml` 的 fail-fast 裸调(第 55 行,
   * 排在 `npm ci` 之前)与 `verify:ci` 的第 1 步(排在 `build` 之前)—— 那刻编译输出树
   * 定义上不存在。按存在性过滤会让「交付面」集合恒缺编译输出树,于是 `build.files` 里
   * 正当的 `dist/**` 反被判成「覆盖了非交付面」,该判据在**每一次**干净检出上恒红,
   * 与白名单写对写错无关(这正是泳道 #03 引入的回归)。
   *
   * 声明本身已是单源(tsconfig `outDir`),它过期(目录改名/迁移)时由交付面判据判红,
   * 不该按存在性把它藏起来 —— 藏起来等于把「改名后忘了跟白名单」这条防线一并关掉。
   *
   * @param {string | null} name 声明名
   * @returns {string[]} 非 null 即单元素数组
   */
  const declared = (name) => (name === null ? [] : [name]);
  const buildOutputNames = /** @type {string[]} */ (declared(decl.buildOutput));
  const packOutputNames = /** @type {string[]} */ (declared(decl.packOutput));
  const manifestName = findRole(decl.roles, "manifest");
  const lockRole = findRole(decl.roles, "lockfile");

  const mirrorPaths = [
    ...new Set([
      ...entries.filter((entry) => MIRROR_TREE_CATEGORIES.has(entry.category)).map((entry) => entry.name),
      // 声明文件按**文件粒度**进镜像:沙盒内要跑构建,就得能解析编译器配置与包清单。
      // 锁文件不带 —— 依赖是目录联接挂入的,离线构建读不到它。
      ...entries.filter((entry) => entry.configRole === "tsconfig" || entry.configRole === "manifest").map((entry) => entry.name),
      // 编译输出树按**声明**并入(ADR-042:`readdir` 告诉不了你「dist 是产物」):它是「沙盒
      // **应当**具备」的一项**义务**,不是「此刻磁盘有什么」。本门禁的两个调用点都排在
      // `build` 之前,那一刻它定义上不存在 —— 按存在性过滤会让 fixtures / dual-matrix
      // 这两个**不调 buildSandbox** 的探针 import 不到产物。
      // 只并 buildOutputNames、**不并** packOutputNames:打包输出目录是终端产物,沙盒内
      // 不跑 electron-builder,带过去纯属浪费。
      // `new Set` 是必需而非洁癖:`dist` 存在时它已由第一段(BUILD 类别)进入,再并一次就
      // 重复,而「镜像集有重复项」那条锚点会立刻红。
      ...buildOutputNames,
    ]),
  ].sort((a, b) => a.localeCompare(b));

  // 「声明为产物」的顶层:编译输出树 ∪ 打包输出目录 ∪ 打包白名单**正向**引用的顶层,再限于是目录
  // (保护集防的是删除一个目录;顶层文件本来就不可能被递归删除,留着它不影响任何判定)。
  const cleanable = new Set(
    [...buildOutputNames, ...packOutputNames, ...decl.packTopLevel.positive].filter(
      // 「已知是顶层**文件**」才剔除(如 build.files 里的 package.json);「此刻不存在」
      // (如干净检出上的 dist)按**声明**保留 —— 与上方注释声明的意图一致。
      // 原来的 `=== true` 把「是文件」与「不存在」用同一个判断合并了,那是存在性过滤
      // 冒充语义过滤,与 mirrorPaths 那处同根。
      (name) => byName.get(name)?.isDirectory !== false,
    ),
  );
  const cleanProtectedSegments = entries
    .filter((entry) => !NON_PROTECTED_CATEGORIES.has(entry.category) || artifactRoots.includes(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !cleanable.has(name))
    .sort((a, b) => a.localeCompare(b));

  return {
    root,
    entries,
    names: entries.map((entry) => entry.name),
    mirrorPaths,
    // 「真实工作树零注入」的指纹面 = 沙盒会带过去执行的面 ∪ 验收产物根 ∪ 锁文件。
    // 后两项不在镜像集里,但子进程确实可能写它们(验收段落产物、npm 改锁文件)。
    protectedTreePaths: /** @type {string[]} */ (
      [...new Set([...mirrorPaths, ...artifactRoots, ...(lockRole === null ? [] : [lockRole])])].sort((a, b) =>
        a.localeCompare(b),
      )
    ),
    cleanProtectedSegments,
    buildOutputNames,
    packOutputNames,
    artifactRootNames: artifactRoots,
    manifestName,
    lockfileName: lockRole,
    declaringJsonNames: [...decl.roles.keys()].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * 取某个声明角色对应的文件名(顶层只可能有一份包清单 / 锁文件)。
 * @param {Map<string, string>} roles 文件名 → 角色
 * @param {string} role 角色名
 * @returns {string | null}
 */
function findRole(roles, role) {
  for (const [name, value] of roles) {
    if (value === role) return name;
  }
  return null;
}

/* ---------- 打包白名单核对(事实由本模块给,判红与文案由门禁给) ---------- */

/**
 * 一条打包白名单模式引用的顶层。
 * @typedef {object} PackReference
 * @property {string} pattern 原模式(含取反前缀)
 * @property {string} segment 引用到的顶层段
 * @property {boolean} negated 是否为取反模式
 * @property {boolean} exists 该顶层实际存在
 * @property {string | null} category 该顶层的派生类别(不存在则 null)
 * @property {boolean} isDeps 是否为安装树(随构建安装,不随版本控制)
 */

/**
 * 打包白名单引用的顶层面核对。
 *
 * 补的是一条**至今缺的断言**:此前只断言了 asar 产出后的顶层三项,没断言白名单本身 ——
 * 「显式白名单」这个正确选择只做了一半。要判的几件事(事实在这里,判红在门禁):
 *   - **正向**模式引用的顶层必须存在:正向模式决定「包里有什么」,引用的顶层不存在 = 目录改名/
 *     迁移后忘了跟白名单,打进包的是漏的;
 *   - 编译输出树必须被正向模式覆盖(否则打进包的是空的);
 *   - 正向模式不得覆盖非交付面(源码树 / 验收树 / 机制树 / 文档进了包 = 误打包)。
 *   取反模式**不**要求目标存在:排除模式没有对象可排除时判红是噪声,而干净检出里安装树本来
 *   就不存在(CI 的 fail-fast 那一步甚至在依赖安装之前)—— 那条判据会变成恒红。
 * @param {Manifest} manifest 顶层派生结果
 * @param {unknown} files 打包白名单(build.files)
 * @returns {{ references: PackReference[], buildOutput: string | null, buildOutputCovered: boolean }}
 */
export function auditPackWhitelist(manifest, files) {
  const byName = new Map(manifest.entries.map((entry) => [entry.name, entry]));
  const patterns = (Array.isArray(files) ? files : []).filter((item) => typeof item === "string");
  /** @type {PackReference[]} */
  const references = [];
  const seen = new Set();
  for (const pattern of patterns) {
    const segment = firstSegment(pattern.startsWith("!") ? pattern.slice(1) : pattern);
    if (segment === null || seen.has(segment)) continue;
    seen.add(segment);
    const entry = byName.get(segment);
    references.push({
      pattern,
      segment,
      negated: pattern.startsWith("!"),
      exists: entry !== undefined,
      category: entry?.category ?? null,
      isDeps: entry?.category === CATEGORY.DEPS,
    });
  }
  const buildOutput = manifest.buildOutputNames[0] ?? null;
  return {
    references,
    buildOutput,
    buildOutputCovered: buildOutput === null || patterns.some((p) => !p.startsWith("!") && firstSegment(p) === buildOutput),
  };
}

/* ---------- 记忆化入口 ---------- */

/** @type {Map<string, Manifest>} */
const cache = new Map();

/**
 * 记忆化的顶层求值(同一根只读一次盘)。消费方直接用它,不必自己缓存。
 * @param {string} [root] 仓库根
 * @returns {Manifest}
 */
export function topLevel(root = ROOT) {
  const key = path.resolve(root);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const manifest = scanTopLevel(key);
  cache.set(key, manifest);
  return manifest;
}
