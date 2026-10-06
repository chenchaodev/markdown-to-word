// @ts-check
/**
 * 图片 resolver ↔ core convert 的**接缝**段(位于 test/behavior/ = 横跨多层的段目录):
 * 被测主体是「convert 层的 resolver 返回 null → core 层的 convert() 产出统一警告」这条
 * 接缝本身,两侧都参与断言,故归 behavior/ 而非任一单层(ADR-062)。
 *
 * 为什么从 test/convert/image-downloader.test.js 拆出来:那段的主体是
 * src/convert/image-downloader.ts 的**单层**行为(本地读取 / 缓存 / SSRF / 超时 / exists),
 * 而下面这条断言的断言对象是 core convert 的**警告接线** —— 它跑的是 core 的 convert(),
 * 断言的是它产出的 warnings。留在单层段里会让 L5 判它跨层,而豁免它等于把这条接缝
 * 藏进豁免表(那正是 L5 豁免表要防的事)。
 *
 * 断言体逐字搬自原段(断言 10),未改判据力:缺失图片 → 「图片加载失败: <src>」;
 * 存在的本地图片 → 零警告。依赖的夹具(harness 的 prepareForConvert / FIXTURES_DIR /
 * 真实样例 PNG)一并带走。
 */
import { formatWarning } from "../../dist/core/i18n/index.js";
import { createImageResolver } from "../../dist/convert/image-downloader.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { prepareForConvert } from "../harness/convert-helpers.js";

/** 本段横跨的层(ADR-062 L6 判据要求 behavior 段显式声明):元素是仓库相对 POSIX 路径。 */
export const covers = [
  "src/core/convert.ts",
  "src/convert/image-downloader.ts",
];

/** 无验收样例:断言的是「resolver 返回 null → 统一警告文案」这条接缝,不对应可入库的
 * 输入文档(它的输入是一张**故意缺失**的图片,入样例就失去意义)。仓内 111 个段同形态,
 * 且 ADR-062:118 计划把「每段显式声明」整条删掉、改为「导出即有样例」—— 本条届时随
 * 那次契约退役一并消失,不留在代码里当长例。*/
export const fixtures = null;

export async function run() {
  // ---- 缺失检查并入 resolver 失败路径(单次 IO),统一警告文案 ----
  // convert 层 stat 预扫已移除:docx 侧经 imageToDocx 失败路径、pdf 侧经
  // checkLocalImages,均走本 resolver 返回 null → 警告统一为「图片加载失败: <src>」。
  const { convert } = await import("../../dist/core/convert.js");
  const wMissing = /** @type {import("../../dist/core/i18n/warning.js").KeyedWarning[]} */ ([]);
  await convert(prepareForConvert("![缺图](missing-xxx.png)"), "docx", {
    baseDir: FIXTURES_DIR,
    imageResolver: createImageResolver(FIXTURES_DIR),
    warnings: wMissing,
  });
  if (!wMissing.some((w) => formatWarning(w).includes("图片加载失败:") && formatWarning(w).includes("missing-xxx.png"))) {
    throw new Error("image-downloader 断言失败:缺失本地图片应产生统一「图片加载失败:」警告");
  }
  const wOk = /** @type {import("../../dist/core/i18n/warning.js").KeyedWarning[]} */ ([]);
  await convert(prepareForConvert("![有图](./input/g1-tiny.png)"), "docx", {
    baseDir: FIXTURES_DIR,
    imageResolver: createImageResolver(FIXTURES_DIR),
    warnings: wOk,
  });
  if (wOk.length !== 0) {
    throw new Error(`image-downloader 断言失败:存在的本地图片不应产生警告,实际 ${wOk.join(";")}`);
  }
  console.log("[ok] image-seam:resolver 返回 null → core convert 产出统一「图片加载失败:」/ 存在图片零警告 断言通过");
}
