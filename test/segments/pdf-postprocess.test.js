// @ts-check
/**
 * PDF 渲染后处理直测(test/segments = src/core 渲染层主题段,经 dist 断言,
 * 零 Electron 依赖——被测纯函数不经 printToPDF):
 * - embedExternalImages / checkLocalImages 纯函数直测(零 Electron 依赖,直接 import dist):
 *   worker 抛错 / 空结果 → 保留原 URL + 统一警告(图片加载失败: <src>);
 *   URL 替换循环精确匹配(src="..." 包裹 + escapeRegExp),互为子串的 URL 不误替换;
 *   同 URL 去重(resolver 只调一次,替换仍覆盖全部出现)。
 * - checkLocalImages:resolver 抛错(catch 路径)与返回 null → 统一警告;src 去重;
 *   成功不警告;无 resolver 直接返回。
 * - embedExternalImages cursor 单遍遍历(多图乱序/相邻/中间失败,产物逐字断言);
 *   checkLocalImages exists 轻量通道(true/false/抛错细分,不回调完整 resolver)。
 * - 目录结构化数据(渐进替换):renderPdfDocument 同一次管线产出的 headings
 *   (h1 层级正确 / h4-h6 有 id 不进目录 / 重复 id 去重 / 文本剥标签与实体解码
 *   与旧 HTML 反解析口径一致),buildTocHtml 由结构化标题生成目录项。
 * 资源预算与取消(本段重点):有界并发 + request 契约注入(signal/maxBytes/timeoutMs)、
 * 数量/单图/文档总字节预算、单请求超时降级、外部取消上抛且不写图片失败警告、
 * warning 按文档顺序稳定(不随异步完成顺序抖动)。
 * 断言依据 src/core/pdf/postprocess.ts(降级行为:失败保留原 URL/追加警告,不抛错)。
 */
import { buildTocHtml, checkLocalImages, embedExternalImages, extractHeadings } from "../../dist/core/pdf/postprocess.js";
import { renderPdfDocument } from "../../dist/core/pdf/render.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { FIXTURES_DIR } from "../common/paths.js";

/**
 * 契约类型的只读引用(编译期擦除,不产生运行期依赖——本段断言仍打 dist 产物):
 * dist 是 tsc 产物、无类型标注,故警告条目与图片请求约束从 src 单源引用而非内联复制。
 */
/** @typedef {import("../../src/core/i18n.js").ConvertWarning} Warning */
/** @typedef {import("../../src/core/image/image-resolver.js").ImageResolverRequest} ImageRequest */

// 1x1 PNG 魔数头(mimeFromBuffer → image/png;data URL 前缀 data:image/png;base64,)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** PDF 渲染后处理直测 */
export async function run() {
  // ---- 1. embedExternalImages:worker 抛错 + 空结果 → 保留原 URL + 统一警告 ----
  {
    const html = '<img src="https://a.example/x.png"><img src="https://b.example/y.png">';
    /** @type {Warning[]} */
    const warnings = [];
    const resolver = async (/** @type {string} */ url) => {
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
    /** @type {Warning[]} */
    const warnings = [];
    /** @type {string[]} */
    const calls = [];
    const resolver = async (/** @type {string} */ url) => {
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
    /** @type {Warning[]} */
    const warnings = [];
    const srcs = ["a.png", "b.png", "a.png"]; // 含重复(Set 去重)
    const resolver = async (/** @type {string} */ src) => {
      if (src === "a.png") throw new Error("boom"); // catch 路径
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
    /** @type {Warning[]} */
    const okWarnings = [];
    await checkLocalImages(["ok.png"], async () => PNG_MAGIC, okWarnings);
    if (okWarnings.length !== 0) {
      throw new Error(`postprocess 断言失败:成功不应警告,okWarnings=${JSON.stringify(okWarnings)}`);
    }
    // 无 resolver:直接返回,不调用、不警告
    /** @type {Warning[]} */
    const noResolverWarnings = [];
    await checkLocalImages(["x.png"], undefined, noResolverWarnings);
    if (noResolverWarnings.length !== 0) {
      throw new Error(`postprocess 断言失败:无 resolver 应直接返回(不警告)`);
    }
    console.log("[ok] postprocess:checkLocalImages catch(抛错)/null 统一警告 + 成功/无 resolver 不警告");
  }

  // ---- 4. checkLocalImages 失败原因细分(ENOENT/EACCES → 独立文案,其他 → 兜底) ----
  // 依据(src/core/image/image-warning.ts imageLoadFailureWarning):fs 错误码分类——
  // ENOENT → 「图片文件不存在」/ EACCES|EPERM → 「图片文件无访问权限」/ 其他 → 统一兜底;
  // 与 docx 侧 imageToDocx 同一构造器,行为对齐。
  {
    /** @type {Warning[]} */
    const warnings = [];
    const resolver = async (/** @type {string} */ src) => {
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

  // ---- 5. embedExternalImages cursor 单遍遍历——多图乱序 + 相邻 + 中间失败 ----
  // 单遍按出现顺序处理全部外链 img:成功替换、失败原样保留(cursor 不动),
  // 相邻标签无遗漏、首尾分段拼接完整。
  {
    const html =
      '<img src="https://x.example/1.png"><img src="https://x.example/bad.png">' +
      '<p>正文</p><img src="https://x.example/1.png"><img src="https://x.example/3.png">';
    /** @type {Warning[]} */
    const warnings = [];
    /** @type {string[]} */
    const calls = [];
    const resolver = async (/** @type {string} */ url) => {
      calls.push(url);
      if (url.includes("bad")) throw new Error("boom");
      return Buffer.concat([PNG_MAGIC, Buffer.from(url)]);
    };
    const out = await embedExternalImages(html, resolver, warnings);
    /** @param {string} url 外链 URL */
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

  // ---- 6. checkLocalImages 轻量存在性通道(exists)----
  // resolver 附带 exists 时优先走它(免整读):true/false 分支 + 抛错保留错误码细分;
  // 全程不回调完整 resolver。
  {
    /** @type {string[]} */
    const calls = [];
    let resolveCalls = 0;
    const resolver = () => {
      resolveCalls += 1;
      return Promise.resolve(null);
    };
    resolver.exists = async (/** @type {string} */ src) => {
      calls.push(src);
      if (src === "ok.png") return true;
      if (src === "gone.png") return false;
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    };
    /** @type {Warning[]} */
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

  // ---- 7. checkLocalImages 有界并发 + warning 按文档顺序稳定 ----
  {
    const srcs = Array.from({ length: 8 }, (_, i) => `${i}.png`);
    let active = 0;
    let maxActive = 0;
    /** @type {Warning[]} */
    const warnings = [];
    const resolver = async (/** @type {string} */ src, /** @type {ImageRequest} */ request) => {
      if (!request || request.signal === undefined || request.maxBytes <= 0 || request.timeoutMs <= 0) {
        throw new Error("resolver request 契约未注入");
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, Number.parseInt(src, 10) % 3));
      active -= 1;
      return src.startsWith("7") ? null : PNG_MAGIC;
    };
    await checkLocalImages(srcs, resolver, warnings);
    if (maxActive > 3) {
      throw new Error(`postprocess 断言失败:本地图片检查应使用有界并发(<=3),实际 ${maxActive}`);
    }
    if (warnings.length !== 1 || formatWarning(warnings[0]) !== "图片加载失败: 7.png") {
      throw new Error(`postprocess 断言失败:本地图片 warning 应按文档顺序稳定,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:本地图片有界并发 + request 契约 + warning 顺序稳定");
  }

  // ---- 8. 外链图片失败 warning 按 URL 文档顺序稳定(完成顺序故意逆序) ----
  {
    const html = [
      '<img src="https://x.example/1.png">',
      '<img src="https://x.example/2.png">',
      '<img src="https://x.example/3.png">',
    ].join("");
    /** @type {Warning[]} */
    const warnings = [];
    const resolver = async (/** @type {string} */ url) => {
      const index = Number.parseInt(url.slice(-5, -4), 10);
      await new Promise((resolve) => setTimeout(resolve, (4 - index) * 3));
      throw new Error("boom");
    };
    await embedExternalImages(html, resolver, warnings, {
      requestTimeoutMs: 100,
      maxImageBytes: 32,
      maxDocumentBytes: 128,
      maxImages: 10,
      concurrency: 3,
    });
    const texts = warnings.map((w) => formatWarning(w));
    const expected = [1, 2, 3].map((i) => `图片加载失败: https://x.example/${i}.png`);
    if (JSON.stringify(texts) !== JSON.stringify(expected)) {
      throw new Error(`postprocess 断言失败:外链图片 warning 应按文档顺序稳定,texts=${JSON.stringify(texts)}`);
    }
    console.log("[ok] postprocess:外链图片 warning 顺序不受异步完成顺序影响");
  }

  // ---- 9. 外链图片数量/单图/文档总字节预算 + resolver maxBytes 契约 ----
  {
    const html = [1, 2, 3].map((i) => `<img src="https://x.example/${i}.png">`).join("");
    /** @type {Warning[]} */
    const warnings = [];
    /** @type {{url: string, request: ImageRequest}[]} */
    const calls = [];
    const resolver = async (/** @type {string} */ url, /** @type {ImageRequest} */ request) => {
      calls.push({ url, request });
      return Buffer.concat([PNG_MAGIC, Buffer.from(url.slice(-5, -4))]);
    };
    const out = await embedExternalImages(html, resolver, warnings, {
      requestTimeoutMs: 100,
      maxImageBytes: 9,
      maxDocumentBytes: 18,
      maxImages: 2,
      concurrency: 2,
    });
    if (calls.length !== 2 || !calls.every(({ request }) => request.maxBytes === 9 && request.timeoutMs === 100)) {
      throw new Error(`postprocess 断言失败:数量预算应阻止第三个 resolver 调用且注入单图预算,calls=${JSON.stringify(calls)}`);
    }
    const first = `data:image/png;base64,${Buffer.concat([PNG_MAGIC, Buffer.from("1")]).toString("base64")}`;
    if (!out.includes(first) || (out.match(/data:image\/png/g) || []).length !== 1) {
      throw new Error(`postprocess 断言失败:前 2 张各 9 bytes 应在总预算 18 内仅首图成功,out=${out}`);
    }
    const texts = warnings.map((w) => formatWarning(w));
    const expected = [
      "图片加载失败: https://x.example/2.png",
      "图片加载失败: https://x.example/3.png",
    ];
    if (JSON.stringify(texts) !== JSON.stringify(expected)) {
      throw new Error(`postprocess 断言失败:预算超限 warning 应稳定按文档顺序,texts=${JSON.stringify(texts)}`);
    }
    console.log("[ok] postprocess:外链图片数量/单图/总字节预算 + maxBytes 注入 + 稳定降级");
  }

  // ---- 10. 永不 resolve 的 resolver 受单请求超时约束,返回普通失败 warning ----
  {
    const html = '<img src="https://x.example/hang.png">';
    /** @type {Warning[]} */
    const warnings = [];
    const startedAt = Date.now();
    const out = await embedExternalImages(html, () => new Promise(() => {}), warnings, {
      requestTimeoutMs: 15,
      maxImageBytes: 32,
      maxDocumentBytes: 64,
      maxImages: 2,
      concurrency: 1,
    });
    if (out !== html || Date.now() - startedAt >= 1000) {
      throw new Error("postprocess 断言失败:单请求超时应快速降级并保留原 URL");
    }
    if (warnings.length !== 1 || formatWarning(warnings[0]) !== "图片加载失败: https://x.example/hang.png") {
      throw new Error(`postprocess 断言失败:超时 warning 应稳定,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:永不 resolve 的外链 resolver 在单请求超时内降级");
  }

  // ---- 10b. 本地图片检查同样受单请求超时约束(不写警告前先快速退出) ----
  {
    /** @type {Warning[]} */
    const warnings = [];
    const startedAt = Date.now();
    await checkLocalImages(["hang.png"], () => new Promise(() => {}), warnings, {
      requestTimeoutMs: 15,
      concurrency: 2,
    });
    if (Date.now() - startedAt >= 1000) {
      throw new Error("postprocess 断言失败:本地图片检查的单请求超时应生效");
    }
    if (warnings.length !== 1 || formatWarning(warnings[0]) !== "图片加载失败: hang.png") {
      throw new Error(`postprocess 断言失败:本地图片超时 warning 应稳定,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:本地图片检查的单请求超时降级");
  }

  // ---- 11. 外部取消向 resolver signal 传播,取消不伪装为普通图片失败 ----
  {
    const html = '<img src="https://x.example/cancel.png">';
    /** @type {Warning[]} */
    const warnings = [];
    const controller = new AbortController();
    /** @type {AbortSignal | undefined} */
    let requestSignal;
    const resolver = (/** @type {string} */ _url, /** @type {ImageRequest} */ request) => {
      requestSignal = request.signal;
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    };
    const pending = embedExternalImages(html, resolver, warnings, {
      signal: controller.signal,
      requestTimeoutMs: 1000,
      maxImageBytes: 32,
      maxDocumentBytes: 64,
      maxImages: 2,
      concurrency: 1,
    });
    setTimeout(() => controller.abort(new Error("cancelled-by-test")), 5);
    /** @type {{ code?: string, stack?: string } | undefined} */
    let error;
    try {
      await pending;
    } catch (err) {
      // 放宽理由:catch 变量为 unknown;取消错误按 core 契约为带 code 的 Error 实例
      error = /** @type {{ code?: string, stack?: string }} */ (err);
    }
    if (!error || error.code !== "ERR_CONVERSION_CANCELLED") {
      throw new Error(`postprocess 断言失败:外部取消应使用独立错误码,error=${error?.stack ?? error}`);
    }
    if (requestSignal?.aborted !== true) {
      throw new Error("postprocess 断言失败:resolver 未收到已取消的 request.signal");
    }
    if (warnings.length !== 0) {
      throw new Error(`postprocess 断言失败:取消不应写入普通图片失败 warning,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] postprocess:外部取消传播至 resolver request.signal 且使用独立错误码");
  }

  // ---- 11b. 本地图片检查的外部取消同样上抛,不写图片失败 warning ----
  {
    /** @type {Warning[]} */
    const warnings = [];
    const controller = new AbortController();
    const pending = checkLocalImages(
      ["a.png"],
      (/** @type {string} */ _src, /** @type {ImageRequest} */ request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        }),
      warnings,
      { signal: controller.signal, requestTimeoutMs: 1000 },
    );
    setTimeout(() => controller.abort(new Error("cancelled-local")), 5);
    /** @type {{ code?: string, stack?: string } | undefined} */
    let error;
    try {
      await pending;
    } catch (err) {
      // 放宽理由:catch 变量为 unknown;取消错误按 core 契约为带 code 的 Error 实例
      error = /** @type {{ code?: string, stack?: string }} */ (err);
    }
    if (!error || error.code !== "ERR_CONVERSION_CANCELLED" || warnings.length !== 0) {
      throw new Error(
        `postprocess 断言失败:本地图片检查的取消应上抛且不写警告,error=${error?.stack ?? error},warnings=${JSON.stringify(warnings)}`,
      );
    }
    console.log("[ok] postprocess:本地图片检查取消上抛且不写图片失败警告");
  }

  // ---- 12. 大量图片(数百张)在默认预算内完成,超出数量预算的尾部稳定降级 ----
  {
    const count = 300;
    const html = Array.from({ length: count }, (_, i) => `<img src="https://x.example/${i}.png">`).join("");
    /** @type {Warning[]} */
    const warnings = [];
    const startedAt = Date.now();
    const out = await embedExternalImages(html, async () => Buffer.concat([PNG_MAGIC, Buffer.from("1")]), warnings, {
      requestTimeoutMs: 1000,
      concurrency: 8,
    });
    const embedded = (out.match(/data:image\/png/g) || []).length;
    if (embedded !== count || warnings.length !== 0) {
      throw new Error(
        `postprocess 断言失败:默认预算(512 张)内 ${count} 张应全部内嵌且无警告,embedded=${embedded} warnings=${warnings.length}`,
      );
    }
    // 数量预算收紧到 10:第 11 张起不再发起请求,按文档顺序稳定降级
    /** @type {Warning[]} */
    const cappedWarnings = [];
    let calls = 0;
    await embedExternalImages(html, async () => {
      calls += 1;
      return Buffer.concat([PNG_MAGIC, Buffer.from("1")]);
    }, cappedWarnings, { maxImages: 10, concurrency: 4 });
    if (calls !== 10 || cappedWarnings.length !== count - 10) {
      throw new Error(
        `postprocess 断言失败:数量预算 10 时应只请求 10 次并对其余 ${count - 10} 张稳定告警,calls=${calls} warnings=${cappedWarnings.length}`,
      );
    }
    if (formatWarning(cappedWarnings[0]) !== "图片加载失败: https://x.example/10.png") {
      throw new Error(
        `postprocess 断言失败:超预算 warning 应从第 11 张起按文档顺序入列,首个=${formatWarning(cappedWarnings[0])}`,
      );
    }
    console.log(
      `[ok] postprocess:大量图片 ${count} 张在预算内完成(默认全内嵌 / maxImages=10 时仅请求 10 次),耗时 ${Date.now() - startedAt}ms`,
    );
  }

  // ---- 13. 目录结构化数据(渐进替换):同一次管线产出的 headings + 目录生成 ----
  // 依据(src/core/pdf/render.ts renderPdfDocument / rules/heading-id.ts):标题在渲染期
  // 结构化产出(level/id/text),目录 HTML 由此生成,不再从渲染后 HTML 反解析。
  {
    const md = [
      "# 章一",
      "",
      "## 1.1 **小节** 与 `代码`",
      "",
      "### 1.1.1 A & B",
      "",
      "#### 第四节(有 id 不进目录)",
      "",
      "##### 第五节",
      "",
      "###### 第六节",
      "",
      "# 章一",
      "",
      "## 尾随 <b>行内 HTML</b>",
      "",
    ].join("\n");
    const { html, headings } = await renderPdfDocument(md, { baseDir: FIXTURES_DIR, title: "结构化标题", toc: true });
    // h1 层级正确 + 文本剥行内标签、实体解码(与旧 HTML 反解析口径逐字一致)
    const first = headings[0];
    if (!first || first.level !== 1 || first.text !== "章一" || first.id !== "章一") {
      throw new Error(`postprocess 断言失败:h1 结构化标题异常,first=${JSON.stringify(first)}`);
    }
    const texts = headings.map((h) => h.text);
    if (JSON.stringify(texts) !== JSON.stringify(["章一", "1.1 小节 与 代码", "1.1.1 A & B", "章一", "尾随 行内 HTML"])) {
      throw new Error(`postprocess 断言失败:结构化标题文本/层级序列异常,texts=${JSON.stringify(texts)}`);
    }
    const levels = headings.map((h) => h.level);
    if (JSON.stringify(levels) !== JSON.stringify([1, 2, 3, 1, 2])) {
      throw new Error(`postprocess 断言失败:标题层级序列异常(期望 h1/h2/h3/h1/h2),levels=${JSON.stringify(levels)}`);
    }
    // 重复标题 id 去重(uniqueSlug 单源),且 id 文档内唯一
    const ids = headings.map((h) => h.id);
    if (ids[0] !== "章一" || ids[3] !== "章一-2" || new Set(ids).size !== ids.length) {
      throw new Error(`postprocess 断言失败:重复标题 id 未去重或出现重复,ids=${JSON.stringify(ids)}`);
    }
    // h4-h6 确有 id(排除"标题没渲染"的假绿),但不进目录/结构化标题
    if (!/<h4 id="[^"]+"/.test(html) || !/<h5 id="[^"]+"/.test(html) || !/<h6 id="[^"]+"/.test(html)) {
      throw new Error("postprocess 断言失败:h4-h6 应带 id 渲染(不进目录≠不渲染)");
    }
    const tocRegion = /<ul[^>]*data-toc[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    if (tocRegion === "") throw new Error("postprocess 断言失败:目录区(data-toc)未生成");
    if (tocRegion.includes("第四节") || tocRegion.includes("第五节") || tocRegion.includes("第六节")) {
      throw new Error(`postprocess 断言失败:h4-h6 不应进目录,toc=${tocRegion}`);
    }
    for (const id of ids) {
      if (!tocRegion.includes(`<a href="#${id}">`)) {
        throw new Error(`postprocess 断言失败:目录项缺失锚点 #${id},toc=${tocRegion}`);
      }
    }
    // 结构化数据与旧兼容层(HTML 反解析)逐字一致——渐进替换不改行为
    if (JSON.stringify(extractHeadings(html)) !== JSON.stringify(headings)) {
      throw new Error(
        `postprocess 断言失败:结构化标题与兼容层提取不一致,regex=${JSON.stringify(extractHeadings(html))}`,
      );
    }
    console.log("[ok] postprocess:结构化标题(h1 层级/h4-h6 不进目录/重复 id 去重/与兼容层一致)");
  }

  // ---- 14. buildTocHtml 直测:消费结构化标题 + 层级上限防御 + 空输入 ----
  {
    const toc = buildTocHtml([
      { level: 1, id: "a", text: "第一章" },
      { level: 2, id: "b", text: "1.1 <b>小节</b>" }, // 文本按 HTML 转义,原样入目录
      { level: 4, id: "d", text: "第四节" }, // 层级上限外的防御过滤
    ]);
    if (!toc.includes('<ul data-toc>') || !toc.includes('<li class="toc-l1"><a href="#a">第一章</a></li>')) {
      throw new Error(`postprocess 断言失败:buildTocHtml 未按结构化标题生成目录项,toc=${toc}`);
    }
    if (!toc.includes("<a href=\"#b\">1.1 &lt;b&gt;小节&lt;/b&gt;</a>")) {
      throw new Error(`postprocess 断言失败:buildTocHtml 未转义标题文本,toc=${toc}`);
    }
    if (toc.includes("#d") || toc.includes("第四节")) {
      throw new Error(`postprocess 断言失败:buildTocHtml 不应收录 h4(层级上限 3),toc=${toc}`);
    }
    if (buildTocHtml([]) !== "") throw new Error("postprocess 断言失败:无标题时 buildTocHtml 应返回空串(不生成目录)");
    console.log("[ok] postprocess:buildTocHtml 结构化入参 + 层级上限防御 + 空输入空串");
  }
}
