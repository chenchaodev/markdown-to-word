// 镜像路径单源:段路径 ⇔ 镜像源文件 / 同名编译产物的**纯字符串变换**。
//
// 为什么下沉:mirroredSourceOf 与它依赖的五个镜像常量(段根、段扩展名、源→产物扩展名
// 映射、源树 / 产物树前缀)此前私有在 `gates/repo/check-test-layout.mjs`。但那不是门禁
// 私有知识 —— `tools/where.mjs`(按段名 / 段路径查镜像源)需要同一套变换,而 `tools/` 与
// `gates/` **零跨树出边、不得互引**;收口到 shared/ 后「一个段的路径镜像谁」只有一处定义,
// 门禁与工具各引同一份,不再有第二份可漂移的副本。
//
// **仍是纯字符串变换**:本模块零磁盘 IO,存在性经 `fileExists` 注入(缺省走真实磁盘,
// 根单源取 `shared/paths.js` 的 ROOT,不自算 —— 见 check-import-boundary 的 no-self-computed-root)。
//
// 反向映射(产物 → 可能的源,`ARTIFACT_SOURCE_EXTS`)刻意**留**在
// `gates/repo/check-test-layout.mjs`:镜像单源只承载「源 → 产物」这**一个**方向,不为另一
// 方向的判据分叉负责;两份方向不同、用途不同(见该处注释的「两份必须同批改」)。

import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.js";

/**
 * 被测定的子树根名 —— 段路径第一段恒为它(扫描面只此一处登记)。
 * @type {string}
 */
export const TEST_REL = "test";

/**
 * 段的扩展名(发现机制与 `test/harness/runner.js` 的 readdir 过滤逐字一致)。
 * @type {string}
 */
export const SEGMENT_EXT = ".test.js";

/**
 * `src/**` 源文件扩展名 → 它编译出的 `dist/**` 产物扩展名(mirroredSourceOf 算「同名产物」用)。
 *
 * 与 `gates/repo/check-test-layout.mjs` 的 `ARTIFACT_SOURCE_EXTS`(那份「产物 → 哪些源可能
 * 产出它」)是**互逆关系**。两份方向不同、用途不同,故各写一份;⚠ 若 tsc 的 emit 规则变了
 * (新增后缀配对),**两份必须同批改** —— 任一份单独漂移的后果是同一族的两档给出互相矛盾的
 * 结论(一份说「产物无源」、另一份说「段没落在同名产物上」)。mirror 单源刻意不 @link 反向
 * 那一份:shared 零跨树出边,不能为一条 JSDoc 链接反向依赖门禁树。
 *
 * `.ts` / `.tsx` → `.js`、`.mts` → `.mjs`、`.cts` → `.cjs`、`.js` → `.js`。
 * @type {Readonly<Record<string, string>>}
 */
export const SOURCE_ARTIFACT_EXTS = Object.freeze({
  ".ts": ".js",
  ".tsx": ".js",
  ".mts": ".mjs",
  ".cts": ".cjs",
  ".js": ".js",
});

/**
 * 编译产物树与源树的仓相对前缀(两份字面量各改一半 ⇒ 判据静默恒红 / 恒绿,故集中此处)。
 * @type {string}
 */
export const DIST_TREE = "dist/";
/** @type {string} */
export const SRC_TREE = "src/";

/**
 * 一个段的路径镜像了哪个真实存在的 `src/**` 源文件(C1 档二的判据对象)。
 *
 * 形态是 `test/<X>/<rest>.test.js` ⇔ `src/<X>/<rest>.<srcExt>` —— **相对路径逐段对应**,
 * 不是 basename 匹配。后者会把 `test/core/preprocess.test.js` 认成镜像
 * `src/convert/preprocess.ts`(实测仓内确有 `test/convert/preprocess.test.js` 与
 * `src/convert/preprocess.ts`,但它们不在同一层目录下),那是**跨层的巧合同名**。
 *
 * 段深度**不限**:S5-0 的递归化之后段名是完整相对路径(如
 * `gates/supply/supply/gen-sbom.test.js`),逐段对应天然覆盖嵌套形态。
 * @param {string} segment 段路径(仓相对 POSIX,以 `.test.js` 结尾)
 * @param {(relative: string) => boolean} [fileExists] **仓相对**路径的存在性判据
 *   (缺省走真实磁盘 —— 合成根上的自检必须注入 `ctx.fileExists`,见 `makeTestLayoutCtx`)
 * @returns {{ source: string, artifact: string } | null} 镜像到的源文件与它的同名产物;未镜像时 null
 */
export function mirroredSourceOf(segment, fileExists = (relative) => existsSync(path.join(ROOT, ...relative.split("/")))) {
  if (!segment.startsWith(`${TEST_REL}/`) || !segment.endsWith(SEGMENT_EXT)) return null;
  const stem = segment.slice(`${TEST_REL}/`.length, -SEGMENT_EXT.length);
  for (const [sourceExt, artifactExt] of Object.entries(SOURCE_ARTIFACT_EXTS)) {
    const source = `${SRC_TREE}${stem}${sourceExt}`;
    if (!fileExists(source)) continue;
    return { source, artifact: `${DIST_TREE}${stem}${artifactExt}` };
  }
  return null;
}
