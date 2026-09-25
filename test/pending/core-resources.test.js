/**
 * core 资源与取消契约:
 * - ConvertContext 预取消/过期 deadline 使用独立错误码,且不启动 resolver;
 * - docx 渲染中的 resolver 取消可中断等待,完成后 convert 仍以取消失败退出;
 * - KaTeX 双管线共享 maxExpand/maxSize/trust 上限,不可信/宏展开失控公式有界降级。
 */
import { convert } from "../../dist/core/convert.js";
import { texToDocxMath } from "../../dist/core/docx/handlers/math.js";
import { DEFAULT_KATEX_RESOURCE_LIMITS } from "../../dist/core/resource-limits.js";
import { unzipPart } from "../common/docx-utils.js";

async function assertCancelled(promise, label) {
  let error;
  try {
    await promise;
  } catch (err) {
    error = err;
  }
  if (!error || error.code !== "ERR_CONVERSION_CANCELLED") {
    throw new Error(`${label} 断言失败:应使用独立取消错误码,error=${error?.stack ?? error}`);
  }
}

export async function run() {
  // ---- 1. 预取消在 frontmatter/渲染前终止,不触发图片 resolver ----
  {
    const controller = new AbortController();
    controller.abort(new Error("cancelled-before-convert"));
    let resolverCalls = 0;
    await assertCancelled(
      convert("![图](x.png)", "docx", {
        baseDir: ".",
        signal: controller.signal,
        imageResolver: async () => {
          resolverCalls += 1;
          return null;
        },
      }),
      "core-resources:预取消",
    );
    if (resolverCalls !== 0) {
      throw new Error("core-resources 断言失败:预取消不应启动 resolver");
    }
    console.log("[ok] core-resources:预取消独立错误码 + 渲染前短路");
  }

  // ---- 2. 过期 deadline 在 PDF parse 阶段前终止 ----
  {
    const stages = [];
    await assertCancelled(
      convert("# 标题", "pdf", {
        baseDir: ".",
        deadline: Date.now() - 1,
        onStage: (stage) => stages.push(stage),
      }),
      "core-resources:过期 deadline",
    );
    if (stages.includes("parse")) {
      throw new Error(`core-resources 断言失败:过期 deadline 不应进入 parse,stages=${JSON.stringify(stages)}`);
    }
    console.log("[ok] core-resources:过期 deadline 在 PDF 阶段前终止");
  }

  // ---- 3. docx resolver 忽略取消时,core 包装层仍中断等待并阻止成功返回 ----
  {
    const controller = new AbortController();
    let requestSignal;
    const pending = convert("![图](x.png)", "docx", {
      baseDir: ".",
      signal: controller.signal,
      imageResolver: (_src, request) => {
        requestSignal = request?.signal;
        // 故意忽略 signal 并永不结算,验证 core 的注入式取消检查不依赖 resolver 配合。
        return new Promise(() => {});
      },
    });
    setTimeout(() => controller.abort(new Error("cancelled-during-docx")), 5);
    await assertCancelled(pending, "core-resources:docx 渲染中取消");
    if (requestSignal?.aborted !== true) {
      throw new Error("core-resources 断言失败:docx resolver 未收到已取消的 request.signal");
    }
    console.log("[ok] core-resources:docx 渲染中取消可中断 resolver 等待");
  }

  // ---- 4. KaTeX 资源上限单源且 docx/PDF 均对恶意 TeX 有界降级 ----
  {
    if (
      DEFAULT_KATEX_RESOURCE_LIMITS.maxExpand !== 1000 ||
      DEFAULT_KATEX_RESOURCE_LIMITS.maxSize !== 10 ||
      DEFAULT_KATEX_RESOURCE_LIMITS.trust !== false
    ) {
      throw new Error(
        `core-resources 断言失败:KaTeX 资源上限漂移,limits=${JSON.stringify(DEFAULT_KATEX_RESOURCE_LIMITS)}`,
      );
    }
    const untrusted = "\\includegraphics{https://example.com/x.png}{x}";
    const expansionBomb = "\\def\\loop{\\loop}\\loop";
    for (const tex of [untrusted, expansionBomb]) {
      const result = texToDocxMath(tex);
      if (result.ok) {
        throw new Error(`core-resources 断言失败:恶意 TeX 未降级,tex=${tex}`);
      }
      if (result.text !== tex) {
        throw new Error(`core-resources 断言失败:恶意 TeX 降级文本应保持原源,tex=${tex}`);
      }
    }
    const warnings = [];
    const docx = await convert(`$$\n${untrusted}\n$$`, "docx", { baseDir: ".", warnings });
    const xml = await unzipPart(docx.buffer, "word/document.xml");
    if (xml.includes("<m:oMath") || !xml.includes("includegraphics")) {
      throw new Error("core-resources 断言失败:docx 恶意 TeX 应降级为源码且不产出 oMath");
    }
    const pdf = await convert(`$$\n${untrusted}\n$$`, "pdf", { baseDir: ".", warnings: [] });
    if (!pdf.html.includes("katex-error")) {
      throw new Error("core-resources 断言失败:PDF 不可信 TeX 未产生 katex-error 降级");
    }
    console.log("[ok] core-resources:KaTeX maxExpand/maxSize/trust 上限 + docx/PDF 有界降级");
  }
}
