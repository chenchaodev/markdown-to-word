/**
 * core 取消与资源预算契约(test/segments = src/core 渲染层主题段,经 dist 断言):
 * - ConvertContext 预取消/过期 deadline 使用独立错误码,且不启动 resolver;
 * - 正向 deadline(未到期)不误伤:转换正常完成;
 * - docx 渲染中的 resolver 取消可中断等待,完成后 convert 仍以取消失败退出;
 * - pdf 阶段取消:parse 阶段上报后取消,不进入图片/公式阶段;
 * - mermaid resolver 不配合取消时仍能退出(隐藏窗口服务场景);
 * - KaTeX 双管线共享 maxExpand/maxSize/trust 上限,不可信/宏展开失控公式有界降级。
 * 取消错误码单源 core/cancel.ts(ERR_CONVERSION_CANCELLED),main 层同码,
 * 故此处只断言 code 不做跨进程区分。
 */
import { convert } from "../../dist/core/convert.js";
import { texToDocxMath } from "../../dist/core/docx/handlers/math.js";
import {
  DEFAULT_IMAGE_RESOURCE_BUDGET,
  DEFAULT_KATEX_RESOURCE_LIMITS,
  ImageBudgetLedger,
  resolveImageBudget,
} from "../../dist/core/resource-limits.js";
import { replaceMermaidPlaceholders } from "../../dist/core/pdf/mermaid.js";
import { createCancellationGuard } from "../../dist/core/cancel.js";
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

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

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

  // ---- 2b. 正向 deadline(尚未到期):转换正常完成,不误判取消 ----
  {
    const stages = [];
    const artifact = await convert("# 标题\n\n正文\n", "pdf", {
      baseDir: ".",
      deadline: Date.now() + 60_000,
      onStage: (stage) => stages.push(stage),
    });
    if (artifact.kind !== "pdf" || !artifact.html.includes("标题")) {
      throw new Error("core-resources 断言失败:未到期 deadline 下 PDF 应正常产出");
    }
    for (const stage of ["parse", "inline", "mermaid", "katex"]) {
      if (!stages.includes(stage)) {
        throw new Error(`core-resources 断言失败:未到期 deadline 下阶段 ${stage} 应照常上报,stages=${JSON.stringify(stages)}`);
      }
    }
    // docx 侧同样:未到期 deadline 不影响渲染
    const docx = await convert("# 标题\n\n正文\n", "docx", { baseDir: ".", deadline: Date.now() + 60_000 });
    if (docx.kind !== "docx" || docx.buffer.length === 0) {
      throw new Error("core-resources 断言失败:未到期 deadline 下 DOCX 应正常产出");
    }
    console.log("[ok] core-resources:正向 deadline(未到期)双管线均正常完成");
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

  // ---- 3b. 取消不被图片 warning 吞掉:docx 取消后不产出任何「图片加载失败」警告 ----
  {
    const controller = new AbortController();
    const warnings = [];
    const pending = convert("![图](x.png)\n\n![图2](y.png)", "docx", {
      baseDir: ".",
      signal: controller.signal,
      warnings,
      imageResolver: (_src, request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        }),
    });
    setTimeout(() => controller.abort(new Error("cancelled-with-warning-check")), 5);
    await assertCancelled(pending, "core-resources:docx 取消不降级");
    if (warnings.some((w) => typeof w === "string" ? w.includes("图片") : w.key.startsWith("warn.image"))) {
      throw new Error(`core-resources 断言失败:取消不应写入图片失败警告,warnings=${JSON.stringify(warnings)}`);
    }
    console.log("[ok] core-resources:取消不被图片 warning 吞掉(docx 侧)");
  }

  // ---- 4. pdf 阶段内取消:parse 之后取消,不进入 inline/mermaid/katex 阶段 ----
  {
    const controller = new AbortController();
    const stages = [];
    const pending = convert("![图](x.png)\n\n正文\n", "pdf", {
      baseDir: ".",
      signal: controller.signal,
      onStage: (stage) => {
        stages.push(stage);
        if (stage === "parse") controller.abort(new Error("cancelled-after-parse"));
      },
      imageResolver: () => new Promise(() => {}), // 永不结算:验证取消不等回调
    });
    await assertCancelled(pending, "core-resources:pdf 阶段取消");
    if (stages.includes("inline") || stages.includes("mermaid") || stages.includes("katex")) {
      throw new Error(`core-resources 断言失败:parse 后取消不应进入后续阶段,stages=${JSON.stringify(stages)}`);
    }
    console.log("[ok] core-resources:pdf 阶段边界取消(parse 后不进入图片/公式阶段)");
  }

  // ---- 5. mermaid 占位替换:resolver 永不结算 + 取消 → 上抛取消,不降级为渲染失败 ----
  {
    const controller = new AbortController();
    const warnings = [];
    const guard = createCancellationGuard({ signal: controller.signal });
    const pending = replaceMermaidPlaceholders(
      '<div class="mermaid">flowchart TD;</div>',
      () => new Promise(() => {}),
      warnings,
      guard,
    );
    setTimeout(() => controller.abort(new Error("cancelled-mermaid")), 5);
    await assertCancelled(pending, "core-resources:mermaid 取消");
    if (warnings.length !== 0) {
      throw new Error(`core-resources 断言失败:mermaid 取消不应写渲染失败警告,warnings=${JSON.stringify(warnings)}`);
    }
    guard.dispose();
    console.log("[ok] core-resources:mermaid 回调不配合取消时仍退出且不写警告");
  }

  // ---- 6. KaTeX 资源上限单源且 docx/PDF 均对恶意 TeX 有界降级 ----
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

  // ---- 6b. 超大 TeX(宏展开深度大但未触发错误)仍走既有渲染路径,不抛错中断转换 ----
  {
    // 200 项求和:公式很大但合法,maxSize 只约束显式尺寸不约束公式宽度 → 正常渲染
    const bigTex = Array.from({ length: 200 }, (_, i) => `x_{${i}}`).join("+");
    const docx = await convert(`$$\n${bigTex}\n$$`, "docx", { baseDir: ".", warnings: [] });
    if (docx.kind !== "docx" || docx.buffer.length === 0) {
      throw new Error("core-resources 断言失败:超大但合法的 TeX 应正常产出 docx");
    }
    // 超大显式尺寸(\rule{500em})被 maxSize 压到上限,不报错也不丢内容
    const capped = texToDocxMath("\\rule{500em}{1em}");
    if (!capped.ok && capped.text !== "\\rule{500em}{1em}") {
      throw new Error("core-resources 断言失败:降级时必须保持原 TeX 源码");
    }
    console.log("[ok] core-resources:超大 TeX(大公式/超尺寸)有界处理不中断转换");
  }

  // ---- 7. 图片预算单源:默认值合理 + 台账两道闸门 + 覆盖合并 ----
  {
    const budget = DEFAULT_IMAGE_RESOURCE_BUDGET;
    if (budget.concurrency !== 3 || budget.maxImages < 8 || budget.maxDocumentBytes <= budget.maxImageBytes) {
      throw new Error(`core-resources 断言失败:图片预算默认值异常,budget=${JSON.stringify(budget)}`);
    }
    if (resolveImageBudget({ maxImages: 2, requestTimeoutMs: undefined }).maxImages !== 2) {
      throw new Error("core-resources 断言失败:预算覆盖未生效");
    }
    if (resolveImageBudget({ requestTimeoutMs: undefined }).requestTimeoutMs !== budget.requestTimeoutMs) {
      throw new Error("core-resources 断言失败:undefined 覆盖不应击穿默认值");
    }
    const ledger = new ImageBudgetLedger({ ...budget, maxImages: 2, maxDocumentBytes: 10 });
    if (!ledger.tryBegin() || !ledger.tryBegin() || ledger.tryBegin()) {
      throw new Error("core-resources 断言失败:数量闸门应在上限处拒绝");
    }
    if (!ledger.tryCharge(6) || ledger.tryCharge(6)) {
      throw new Error("core-resources 断言失败:字节闸门应在上限处拒绝");
    }
    if (ledger.usedImages !== 2 || ledger.usedBytes !== 6) {
      throw new Error(`core-resources 断言失败:台账累计异常 images=${ledger.usedImages} bytes=${ledger.usedBytes}`);
    }
    console.log("[ok] core-resources:图片预算单源(默认值/覆盖合并/数量与字节闸门)");
  }
}
