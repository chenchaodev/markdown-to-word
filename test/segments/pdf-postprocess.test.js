/**
 * PDF 渲染后处理直测(G2 补齐,批次 14):
 * embedExternalImages / checkLocalImages 纯函数直测(零 Electron 依赖,直接 import dist):
 * - embedExternalImages:worker 抛错 / 空结果 → 保留原 URL + 统一警告(图片加载失败: <src>);
 *   URL 替换循环精确匹配(src="..." 包裹 + escapeRegExp),互为子串的 URL 不误替换;
 *   同 URL 去重(resolver 只调一次,替换仍覆盖全部出现)。
 * - checkLocalImages:resolver 抛错(catch 路径)与返回 null → 统一警告;src 去重;
 *   成功不警告;无 resolver 直接返回。
 * 断言依据 src/core/pdf/postprocess.ts(降级行为:失败保留原 URL/追加警告,不抛错)。
 */
import { checkLocalImages, embedExternalImages } from "../../dist/core/pdf/postprocess.js";

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
      !warnings.includes("图片加载失败: https://a.example/x.png") ||
      !warnings.includes("图片加载失败: https://b.example/y.png")
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
      !warnings.includes("图片加载失败: a.png") ||
      !warnings.includes("图片加载失败: b.png")
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
}