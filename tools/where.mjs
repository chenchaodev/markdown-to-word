// `where` —— 按段名或段路径,查出段文件在仓内的相对路径与它的「镜像源(src)」路径。
//
// 为什么要这个:段路径 = 身份(镜像一棵被断言的树),但「一个主题的段具体在哪个文件、它的
// 被测源按镜像规则落在哪」此前只能靠人翻 test/ 与 src/ 两棵树。本工具把这两步收成一个查询:
// 定位段文件 → 按 `shared/mirror-path.mjs` 的纯路径变换给出镜像源,存在性与否当场标注。
//
// 纪律(照 tools/req-edit.mjs):
//   - 根路径只从 `shared/paths.js` 的 ROOT 取,不自算(no-self-computed-root);
//   - `parseArgs` / `isMainModule` 走 `shared/cli.mjs`;
//   - 失败统一 `[where:fail]` 前缀 + 非零退出;
//   - 段目录集合经 `shared/test-common-surface.js` 的 `listScanFiles`(它单源自 `SEGMENT_DIRS`)
//     取,不复写一份枚举;镜像变换经下沉后的 `shared/mirror-path.mjs` 取,不再有第二份实现。
//
// ---- 三条语义边界(实测过才写死,与 covers 的真相一致)----
// ① **同模块多段**:裸段名可命中多个段(主题后缀约定:<名>.test.js 与 <名>-<主题>.test.js),
//    本工具把它们**并列报出**,不替人选(如 `atomic-json` → `atomic-json` + `atomic-json-durability`)。
// ② **无唯一答案**:`test/behavior/` 与 `test/harness/` 两棵段目录(跨层 / 自指)不镜像任何
//    被断言的树,其主体只经 `covers` 或 `fs.readFileSync` 的字符串路径到达 —— 这种段**没有**
//    唯一的路径镜像答案。本工具明说「无唯一答案」,**不扫 import 反推**(实测:扫 import 猜会
//    大面积误伤,方向见 gates/repo/check-test-layout.mjs 头注「covers 是什么、不是什么」)。
// ③ **镜像源缺失**:镜像规则能把段变换到一个期望的 `src/**` 路径,但磁盘上没有那个文件 ——
//    明说缺失,并给出期望路径(这是「路径约定」的答案,不等于磁盘事实)。

import { existsSync } from "node:fs";
import path from "node:path";
import { isMainModule, parseArgs } from "../shared/cli.mjs";
import { SOURCE_ARTIFACT_EXTS, TEST_REL, mirroredSourceOf } from "../shared/mirror-path.mjs";
import { ROOT } from "../shared/paths.js";
import { SEGMENT_DIRS, listScanFiles } from "../shared/test-common-surface.js";

const USAGE = [
  "用法: node tools/where.mjs <段名 | 段路径>",
  "",
  "  <段路径>   形如 core/merge.test.js(或带 test/ 前缀);须以 .test.js 结尾,POSIX 斜杠",
  "  <段名>     形如 merge / atomic-json;无斜杠、无扩展名,匹配同名段与 <段名>-<主题> 的同模块多段",
  "",
  "输出:段文件的仓内相对路径 + 镜像源(src)路径(经 shared/mirror-path 的纯路径变换);",
  "      镜像源是否在磁盘上当场标注;同模块多段并列报出;跨层 / 自指段明说「无唯一答案」。",
].join("\n");

/** 失败一律带此前缀,与本仓其它门禁 / 工具的 `[<id>:fail]` 形态一致 */
const FAIL_PREFIX = "[where:fail]";

/** 带用户可操作提示的失败(不是崩溃);`main` 统一捕获并落非零退出码 */
class ToolError extends Error {}

const SEGMENT_EXT = ".test.js";
const SRC_TREE = "src/";

/**
 * 非镜像段目录名(跨层 / 自指):与 `shared/test-common-surface.js` 的 `NON_MIRROR_SEGMENT_DIRS`
 * (**模块内私有、无 export**)同义。本地持有它遵守 req-edit.mjs「上游私有则本地重写」的纪律
 * (那边是 Set、这里只取其名字集合做判据);上游增删这两个名字时,这里须同批改。
 * @type {ReadonlySet<string>}
 */
const NON_MIRROR_DIRS = Object.freeze(new Set(["behavior", "harness"]));

/** 仓相对 POSIX 路径的存在性判据(判据经 `ROOT` 落盘,单源自 paths.js) */
const existsOnDisk = (relative) => existsSync(path.join(ROOT, ...relative.split("/")));

/** 段基名主题(去扩展名;段文件名即身份,基名就是它的「段名」) */
const stemOf = (segment) => path.posix.basename(segment).slice(0, -SEGMENT_EXT.length);

/**
 * 仓内全部段文件(仓相对 POSIX,按 scanner 单源 `listScanFiles` 取,只切 `.test.js`)。
 * 不另写目录枚举:`listScanFiles` 的扫描面单源自 `SEGMENT_DIRS`,再抄一份会与它漂移。
 * @returns {string[]}
 */
function listSegments() {
  return listScanFiles(ROOT).filter((file) => file.endsWith(SEGMENT_EXT));
}

/**
 * 把查询解析成段文件集合(两种输入形态,判据是「有没有斜杠 / 有没有 .test.js 结尾」)。
 *
 * 形态判据写死在这里,为的是把「路径变体」挡在门外而不是猜:反斜杠、或含斜杠却缺 `.test.js`,
 * 一律拒绝并点名(负向⑤)。裸段名(无斜杠、无扩展名)是**另一种**受支持的输入,不是残缺路径。
 * @param {string} query 原始查询
 * @param {string[]} segments 仓内段文件全集
 * @returns {{ mode: "path" | "name", matches: string[] }}
 */
function resolveSegments(query, segments) {
  const trimmed = query.trim();
  if (trimmed === "") throw new ToolError("空查询;给一个段名或段路径");
  if (trimmed.includes("\\")) {
    throw new ToolError(
      `路径含反斜杠 ${JSON.stringify(query)} —— 仓内一律 POSIX 斜杠,本工具不猜反斜杠变体;段路径请形如 core/merge.test.js`,
    );
  }
  if (trimmed.endsWith(SEGMENT_EXT)) {
    // 段路径模式:精确匹配,不做 basename 兜底(那是跨层巧合同名的来源)。
    const inner = trimmed.startsWith(`${TEST_REL}/`) ? trimmed.slice(TEST_REL.length + 1) : trimmed;
    const target = `${TEST_REL}/${inner}`;
    if (!segments.includes(target)) {
      throw new ToolError(`段路径不存在:${target}(仓内无此段文件;已登记段目录:${SEGMENT_DIRS.join(" / ")})`);
    }
    return { mode: "path", matches: [target] };
  }
  if (trimmed.includes("/")) {
    throw new ToolError(
      `形似段路径却不以 ${SEGMENT_EXT} 结尾:${trimmed} —— 缺扩展名不猜;段路径须以 ${SEGMENT_EXT} 结尾,或改用裸段名`,
    );
  }
  // 裸段名模式:精确基名,或主题后缀基名(<段名>-<主题>.test.js,DEV-GUIDE「同模块多段」约定)。
  const matches = segments.filter((segment) => {
    const stem = stemOf(segment);
    return stem === trimmed || stem.startsWith(`${trimmed}-`);
  });
  if (matches.length === 0) {
    throw new ToolError(`段名不存在:${trimmed}(仓内无同名段;已登记段目录:${SEGMENT_DIRS.join(" / ")})`);
  }
  return { mode: "name", matches };
}

/**
 * 单个段的镜像源判定(镜像变换经 `shared/mirror-path` 的 `mirroredSourceOf`,不重写变换)。
 *
 * - 跨层 / 自指段目录 → `no-unique`(无唯一答案,勿扫 import 猜);
 * - 有真实同名源 → `exists`(磁盘上确实存在);
 * - 变换得到的期望源不在磁盘上 → `missing`(给期望路径,明说缺失)。期望扩展名取 SOURCE_ARTIFACT_EXTS
 *   的首个键(`.ts`,TS 源的主扩展名),与镜像变换尝试的次序一致。
 * @param {string} segment 段路径(仓相对 POSIX)
 * @returns {{ kind: "no-unique" } | { kind: "exists"; source: string } | { kind: "missing"; expected: string }}
 */
function describeMirror(segment) {
  const head = segment.slice(TEST_REL.length + 1).split("/")[0];
  if (NON_MIRROR_DIRS.has(head)) return { kind: "no-unique" };
  const real = mirroredSourceOf(segment, existsOnDisk);
  if (real) return { kind: "exists", source: real.source };
  const stem = segment.slice(TEST_REL.length + 1, -SEGMENT_EXT.length);
  const primaryExt = Object.keys(SOURCE_ARTIFACT_EXTS)[0];
  return { kind: "missing", expected: `${SRC_TREE}${stem}${primaryExt}` };
}

/**
 * 打印查询结果。裸段名命中多个时先点名「同模块多段」,再把每个段与其镜像逐条列出。
 * @param {{ mode: "path" | "name", matches: string[] }} resolved resolveSegments 的返回
 * @returns {void}
 */
function report({ mode, matches }) {
  if (mode === "name" && matches.length > 1) {
    console.log(`该段名匹配 ${matches.length} 个段(同模块多段,请择一):`);
  }
  for (const segment of matches) {
    console.log(`段: ${segment}`);
    const mirror = describeMirror(segment);
    if (mirror.kind === "no-unique") {
      console.log("  镜像源: 无唯一答案 —— 该段属跨层 / 自指段目录,其主体只经 covers 或字符串路径到达,不按路径镜像(勿扫 import 猜)");
    } else if (mirror.kind === "exists") {
      console.log(`  镜像源: ${mirror.source}(存在)`);
    } else {
      console.log(`  镜像源(按路径约定): ${mirror.expected}(⚠ 镜像源缺失 —— 该 src 文件不在磁盘上)`);
    }
  }
}

/**
 * 入口:解析参数 → 定位段 → 报告;失败统一落 stderr 与非零退出码。
 *
 * 与 req-edit 的退出码口径一致:参数 / 结构错 → 2;查询解析失败的 ToolError → 1。
 * 「镜像源缺失 / 无唯一答案 / 多候选」是**查询成功的答案内容**,不算失败 ⇒ exit 0。
 * @param {string[]} argv 进程参数
 * @returns {number} 退出码
 */
function main(argv) {
  const positionals = [];
  const optionTokens = [];
  for (const token of argv) {
    if (token.startsWith("--")) optionTokens.push(token);
    else positionals.push(token);
  }
  let options;
  try {
    options = parseArgs(optionTokens, { booleans: ["help"], usage: "node tools/where.mjs <段名 | 段路径>" });
  } catch (error) {
    console.error(`${FAIL_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(`${FAIL_PREFIX} 需要一个段名或段路径(收到 ${positionals.length} 个位置参数)`);
    console.error(USAGE);
    return 2;
  }
  try {
    report(resolveSegments(positionals[0], listSegments()));
    return 0;
  } catch (error) {
    console.error(`${FAIL_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
