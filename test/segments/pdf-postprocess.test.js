/**
 * PDF 渲染后处理直测(G2 补齐,批次 14):
 * embedExternalImages / checkLocalImages 纯函数直测(零 Electron 依赖,直接 import dist):
 * - embedExternalImages:worker 抛错 / 空结果 → 保留原 URL + 统一警告(图片加载失败: <src>);
 *   URL 替换循环精确匹配(src="..." 包裹 + escapeRegExp),互为子串的 URL 不误替换;
 *   同 URL 去重(resolver 只调一次,替换仍覆盖全部出现)。
 * - checkLocalImages:resolver 抛错(catch 路径)与返回 null → 统一警告;src 去重;
 *   成功不警告;无 resolver 直接返回。
 * - B5:embedExternalImages cursor 单遍遍历(多图乱序/相邻/中间失败,产物逐字断言);
 *   checkLocalImages exists 轻量通道(true/false/抛错细分,不回调完整 resolver)。
 * 断言依据 src/core/pdf/postprocess.ts(降级行为:失败保留原 URL/追加警告,不抛错)。
 */
import { checkLocalImages, embedExternalImages } from "../../dist/core/pdf/postprocess.js";
import { formatWarning } from "../../dist/core/i18n.js";

// 1x1 PNG 魔数头(mimeFromBuffer → image/png;data URL 前缀 data:image/png;base64,)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PDF 渲染后处理直测(G2) */
export async function run() {
  // ---- 1. embedExternalImages:worker 抛错 + 空结果 → 保留原 URL + 统一警告 ----
  {
    const html = '<img src="https://a.example/x.png"><img src="https://b.example/y.png">';
    const warnings = [];
    const resolver = async (url) => {
      if (url === "https://a.example/x.png") throw new Error("boom"); // worker catch 路径
      return Buffer.alloc(0); // 空结果(data.length === 0 → 降级)
    };
    const out = await embedExternalImages(html, resolver, warnings);
    // 无成功结果 → 原样返回(引用不变)
    if (out !== html) {
      throw new Error("postprocess 断言失败:worker 抛错/空结果时应原样保留 HTML(引用不变)");
    }
    if (
      !warnings.some((w) => formatWarning(w) === "图片加载失败: https://a.example/x.png") ||
      !warnings.some((w) => formatWarning(w) === "图片加载失败: https://b.example/y.png")
    ) {
      throw new Error(`postprocess 断言失败:缺少统一降级警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:embedExternalImages worker 抛错/空结果保留原 URL + 统一警告");
  }

  // ---- 2. embedExternalImages:URL 替换循环(互为子串精确替换 + 同 URL 去重) ----
  {
    // URL1 是 URL2 的前缀:若替换不精确(裸 replace(url)),URL2 会被 URL1 的 data URL 污染
    const html =
      '<img src="https://example.com/a"><img src="https://example.com/a/b">' +
      '<img src="https://example.com/a">'; // 与 URL1 重复(去重:resolver 只调一次,替换覆盖 2 处)
    const warnings = [];
    const calls = [];
    const resolver = async (url) => {
      calls.push(url);
      return Buffer.concat([PNG_MAGIC, Buffer.from(url === "https://example.com/a" ? "A" : "B")]);
    };
    const out = await embedExternalImages(html, resolver, warnings);
    const dataA = `data:image/png;base64,${Buffer.concat([PNG_MAGIC, Buffer.from("A")]).toString("base64")}`;
    const dataB = `data:image/png;base64,${Buffer.concat([PNG_MAGIC, Buffer.from("B")]).toString("base64")}`;
    if (!out.includes(`src="${dataA}"`) || !out.includes(`src="${dataB}"`)) {
      throw new Error("postprocess 断言失败:互为子串 URL 未精确替换(src=\"...\" 包裹)");
    }
    if (out.includes('src="https://')) {
      throw new Error("postprocess 断言失败:替换后残留原 URL(子串误替换)");
    }
    // 去重:两个不同 URL 各调一次(重复的 https://example.com/a 不二次调用)
    if (calls.length !== 2) {
      throw new Error(`postprocess 断言失败:resolver 调用次数异常(期望 2 去重),calls=${JSON.stringify(calls)}`);
    }
    // 替换循环 replace(..., "g"):重复 URL 的两处出现都被替换
    if ((out.match(new RegExp(`src="${dataA}"`, "g")) || []).length !== 2) {
      throw new Error("postprocess 断言失败:去重后替换应覆盖全部出现(重复 URL 2 处)");
    }
    if (warnings.length !== 0) {
      throw new Error(`postprocess 断言失败:成功路径不应有警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:embedExternalImages URL 替换循环(互为子串精确替换 + 去重)");
  }

  // ---- 3. checkLocalImages:catch 路径(抛错)与 null 均追加统一警告;成功/无 resolver 不警告 ----
  {
    const warnings = [];
    const srcs = ["a.png", "b.png", "a.png"]; // 含重复(Set 去重)
    const resolver = async (src) => {
      if (src === "a.png") throw new Error("boom"); // catch 路径(68-69 行)
      return null; // 缺失
    };
    await checkLocalImages(srcs, resolver, warnings);
    if (
      warnings.length !== 2 ||
      !warnings.some((w) => formatWarning(w) === "图片加载失败: a.png") ||
      !warnings.some((w) => formatWarning(w) === "图片加载失败: b.png")
    ) {
      throw new Error(`postprocess 断言失败:checkLocalImages 警告异常(期望去重后 2 条),warnings=${JSON.stringify(warnings)}`);
    }
    // 成功路径:resolver 返回 Buffer → 不警告
    const okWarnings = [];
    await checkLocalImages(["ok.png"], async () => PNG_MAGIC, okWarnings);
    if (okWarnings.length !== 0) {
      throw new Error(`postprocess 断言失败:成功不应警告,okWarnings=${JSON.stringify(okWarnings)}`);
    }
    // 无 resolver:直接返回,不调用、不警告
    const noResolverWarnings = [];
    await checkLocalImages(["x.png"], undefined, noResolverWarnings);
    if (noResolverWarnings.length !== 0) {
      throw new Error("postprocess 断言失败:无 resolver 应直接返回(不警告)");
    }
    console.log("[ok] postprocess:checkLocalImages catch(抛错)/null 统一警告 + 成功/无 resolver 不警告");
  }

  // ---- 4. B4:checkLocalImages 失败原因细分(ENOENT/EACCES → 独立文案,其他 → 兜底) ----
  // 依据(src/core/image/image-warning.ts imageLoadFailureWarning):fs 错误码分类——
  // ENOENT → 「图片文件不存在」/ EACCES|EPERM → 「图片文件无访问权限」/ 其他 → 统一兜底;
  // 与 docx 侧 imageToDocx 同一构造器,行为对齐。
  {
    const warnings = [];
    const resolver = async (src) => {
      if (src === "gone.png") throw Object.assign(new Error("enoent"), { code: "ENOENT" });
      if (src === "locked.png") throw Object.assign(new Error("eacces"), { code: "EACCES" });
      throw new Error("boom"); // 无错误码 → 统一「图片加载失败」兜底
    };
    await checkLocalImages(["gone.png", "locked.png", "other.png"], resolver, warnings);
    const texts = warnings.map((w) => formatWarning(w));
    for (const expected of [
      "图片文件不存在: gone.png",
      "图片文件无访问权限: locked.png",
      "图片加载失败: other.png",
    ]) {
      if (!texts.includes(expected)) {
        throw new Error(`postprocess 断言失败:checkLocalImages 缺少细分警告「${expected}」,warnings=${JSON.stringify(warnings)}`);
      }
    }
    console.log("[ok] postprocess:B4 checkLocalImages 失败原因细分(ENOENT/EACCES/兜底)断言通过");
  }

  // ---- 5. B5:embedExternalImages cursor 单遍遍历——多图乱序 + 相邻 + 中间失败 ----
  // 单遍按出现顺序处理全部外链 img:成功替换、失败原样保留(cursor 不动),
  // 相邻标签无遗漏、首尾分段拼接完整。
  {
    const html =
      '<img src="https://x.example/1.png"><img src="https://x.example/bad.png">' +
      '<p>正文</p><img src="https://x.example/1.png"><img src="https://x.example/3.png">';
    const warnings = [];
    const calls = [];
    const resolver = async (url) => {
      calls.push(url);
      if (url.includes("bad")) throw new Error("boom");
      return Buffer.concat([PNG_MAGIC, Buffer.from(url)]);
    };
    const out = await embedExternalImages(html, resolver, warnings);
    const dataOf = (url) => `data:image/png;base64,${Buffer.concat([PNG_MAGIC, Buffer.from(url)]).toString("base64")}`;
    const expected =
      `<img src="${dataOf("https://x.example/1.png")}"><img src="https://x.example/bad.png">` +
      `<p>正文</p><img src="${dataOf("https://x.example/1.png")}"><img src="${dataOf("https://x.example/3.png")}">`;
    if (out !== expected) {
      throw new Error(`postprocess 断言失败:B5 多图乱序/相邻场景产物不符,out=${out}`);
    }
    // 去重:URL1 两处出现只下载一次
    if (calls.filter((c) => c === "https://x.example/1.png").length !== 1) {
      throw new Error(`postprocess 断言失败:同 URL 应只下载一次,calls=${JSON.stringify(calls)}`);
    }
    if (warnings.length !== 1 || formatWarning(warnings[0]) !== "图片加载失败: https://x.example/bad.png") {
      throw new Error(`postprocess 断言失败:失败 URL 应恰一条统一警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:B5 embedExternalImages cursor 单遍遍历(多图乱序/相邻/中间失败)断言通过");
  }

  // ---- 6. B5:checkLocalImages 轻量存在性通道(exists)----
  // resolver 附带 exists 时优先走它(免整读):true/false 分支 + 抛错保留错误码细分;
  // 全程不回调完整 resolver。
  {
    const calls = [];
    let resolveCalls = 0;
    const resolver = () => {
      resolveCalls += 1;
      return Promise.resolve(null);
    };
    resolver.exists = async (src) => {
      calls.push(src);
      if (src === "ok.png") return true;
      if (src === "gone.png") return false;
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    const warnings = [];
    await checkLocalImages(["ok.png", "gone.png", "locked.png"], resolver, warnings);
    if (resolveCalls !== 0) {
      throw new Error(`postprocess 断言失败:exists 通道存在时不应回调完整 resolver,实际 ${resolveCalls} 次`);
    }
    const texts = warnings.map((w) => formatWarning(w)).sort();
    if (
      texts.length !== 2 ||
      texts[0] !== "图片文件不存在: gone.png" ||
      texts[1] !== "图片文件无访问权限: locked.png"
    ) {
      throw new Error(`postprocess 断言失败:exists 通道警告异常,texts=${JSON.stringify(texts)}`);
    }
    console.log("[ok] postprocess:B5 checkLocalImages exists 轻量通道(true/false/抛错细分)断言通过");
  }
}