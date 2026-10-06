/**
 * MCP 的 tool 目录与转换调用。
 *
 * 三条契约(ADR-060「入口能力矩阵」的 MCP 列,逐条对应实现):
 * 1. **只暴露 docx**。pdf 需要 Electron 宿主(打印是宿主能力,装配层不自带);
 *    MCP 进程跑纯 node,故不提供。将来要加时复用 CLI 已建成的机制(纯 node 侧写任务
 *    文件 → spawn `dist/main/cli-pdf-host.js` → 读结果文件),协议通道不必碰 Electron。
 * 2. **不注入 mermaidResolver**。因此 mermaid 围栏按普通代码块渲染(core 既有契约,
 *    静默不产警告)—— 但**降级必须对 agent 可见**:返回值带 `degraded`,否则这台工具
 *    就是「同样输入、偶尔产出不同」的那一类(agent 拿到的 docx 有图无图全看运气)。
 *    「有没有 mermaid」由 core 的 `containsMermaidCode` 判定,与渲染器共用同一个
 *    `MERMAID_LANG` 常量,不会声明了降级其实渲了图。
 * 3. **每次 call 一个新 ctx + 强制 deadline**。新 ctx 是因为 `ConvertContext` 承载
 *    取消标志,复用会让上一次超时/取消污染下一次(历史 bug fd40480 的同类);
 *    deadline 是因为 CLI 那种「等多久是人的决定」的出口在 MCP 里不存在 ——
 *    agent 不点关窗,没有自然的中止时机。
 *
 * 错误形态:业务失败(路径不存在、模板未知、转换失败)**返回 `isError: true` 的 tool
 * 结果**,不走 JSON-RPC error。理由是 MCP 客户端把 tool 错误呈现给模型,模型可以据此
 * 改参数重试;JSON-RPC error 则通常终止整轮对话。
 */
import path from "node:path";
import type { ToolResult, ToolSpec } from "./jsonrpc.js";
import { collectMarkdownPaths } from "../convert/paths.js";
import { prepareMarkdown } from "../convert/preprocess.js";
import { createConvertContext } from "../convert/context.js";
import { emitConvertedArtifact } from "../convert/run.js";
import { resolveDeliverySettings, templatePresetIds } from "../convert/delivery-settings.js";
import type { ConvertWarning, WarningKey } from "../core/i18n/index.js";

/** Tool 名(对 agent 可见的契约,改名会打断已配置的客户端)。 */
export const TOOL_NAME = "convert_markdown";

/**
 * 单次转换的强制截止时间。
 *
 * 取 120s 的理由:CLI 侧的同类上限由源文件 32MB 闸门兜着,渲染本身是 CPU _bound,
 * 超大文档在本机实测远低于此;而 MCP 是长驻进程,一次卡死的转换会把 server 拖住,
 * 后续所有 tool 都超时。宁可截断一次大转换,也不要拖垮整个 server。
 */
const CONVERT_DEADLINE_MS = 120_000;

/** 工具描述:这段文字**直接进 agent 的上下文**,是它选择与调用本工具的依据。
 *  故把能力边界与降级形态写在明面上,而不是让 agent 撞一次才发现。 */
export const TOOL_SPEC: ToolSpec = {
  name: TOOL_NAME,
  description:
    "把一个 Markdown 文件(或一个目录下的全部 .md/.markdown)转换为 .docx。\n" +
    "只支持 docx;PDF 需要桌面宿主,本工具不提供。\n" +
    "Mermaid 图表会被渲染成等宽代码块(本工具无图表渲染宿主)。受影响的结果会在 " +
    "`degraded` 字段里点名 mermaid,请据此决定是否需要人工补图。\n" +
    "输入路径需为绝对路径。",
  inputSchema: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Markdown 文件的绝对路径,或包含 .md/.markdown 的目录绝对路径。",
      },
      outputPath: {
        type: "string",
        description:
          "产物绝对路径。仅当输入解析出**恰好一个**文件时可给;给了就逐字写到这个路径," +
          "路径已存在时直接失败(不会改名成「名 (2).docx」)。",
      },
      template: {
        type: "string",
        description: `内置排版预设 id。可用:${templatePresetIds().join(" / ")}。省略 = 默认设置。`,
      },
    },
    required: ["input"],
  },
};

/** 单个产物的结果项(进 structuredContent;字段名是对 agent 的契约,勿改)。 */
export interface McpArtifactResult {
  /** 输入绝对路径 */
  input: string;
  /** 产物绝对路径 */
  outputPath: string;
  /** 警告 key 列表 */
  warnings: string[];
  /** 本项发生的降级;无则空数组 */
  degraded: WarningKey[];
}

/** 结构化结果(进 structuredContent)。 */
export interface McpConvertResult {
  artifacts: McpArtifactResult[];
  /** 全部产物的降级并集(给 agent 一眼可判的汇总) */
  degraded: WarningKey[];
  /** 总耗时(ms) */
  elapsedMs: number;
}

/** 业务失败:转成 `isError: true` 的 tool 结果(见文件头「错误形态」)。 */
class ToolFailure extends Error {}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ToolFailure("参数必须是一个对象");
  }
  return value as Record<string, unknown>;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ToolFailure(`${key} 必须是字符串`);
  if (value === "") throw new ToolFailure(`${key} 不能为空字符串`);
  return value;
}

/** 警告的 key(ConvertWarning 是 string | KeyedWarning 联合)。 */
function warningKey(warning: ConvertWarning): string {
  if (typeof warning === "string") return warning;
  const key = (warning as { key?: unknown }).key;
  return typeof key === "string" ? key : "warning";
}

/**
 * 执行一次转换。**入参形状**已由 jsonrpc 层校验过是对象,字段形状在这里逐个判。
 *
 * @param rawArgs tool 入参
 * @returns tool 结果(成功与业务失败都从这里出去)
 */
export async function callConvertMarkdown(rawArgs: unknown): Promise<ToolResult> {
  const started = Date.now();
  try {
    const result = await convert(rawArgs, started);
    return { content: [{ type: "text", text: renderSummary(result) }], structuredContent: result };
  } catch (error) {
    if (error instanceof ToolFailure) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `转换失败:${message}` }], isError: true };
  }
}

async function convert(rawArgs: unknown, started: number): Promise<McpConvertResult> {
  const args = asRecord(rawArgs);
  const input = optionalString(args, "input");
  if (input === undefined) throw new ToolFailure("缺参数:input");
  const outputPath = optionalString(args, "outputPath");
  const template = optionalString(args, "template");
  if (!path.isAbsolute(input)) throw new ToolFailure(`input 必须是绝对路径:${input}`);

  // 模板未知在这里转成 ToolFailure:共用基线 resolveDeliverySettings 抛的是普通 Error,
  // 直接冒出去会被归成「转换失败」,对 agent 是误导(它以为文件坏了)。
  if (template !== undefined && !templatePresetIds().includes(template)) {
    throw new ToolFailure(`未知预设:${template}(可用:${templatePresetIds().join(" / ")})`);
  }
  const settings = resolveDeliverySettings({ templateId: template });

  const scanWarnings: ConvertWarning[] = [];
  const { files } = await collectMarkdownPaths([input], scanWarnings);
  if (files.length === 0) {
    throw new ToolFailure(`没有可转换的 markdown 文件(路径不存在、不可读,或都不是 .md/.markdown):${input}`);
  }
  if (outputPath !== undefined && files.length > 1) {
    throw new ToolFailure(`outputPath 只能配单个输入文件(该路径解析出 ${files.length} 个)`);
  }

  const artifacts: McpArtifactResult[] = [];
  // pinOutputPath 只在解析出唯一文件时透传(多输入时前面已判过 outputPath 不合法);
  // 调用方给的是一个完整产物路径,不存在「派生出输出目录」的中间形态。
  for (const file of files) {
    artifacts.push(await convertOne(file, settings, files.length === 1 ? outputPath : undefined));
  }
  const degraded = [...new Set(artifacts.flatMap((artifact) => artifact.degraded))].sort();
  return { artifacts, degraded, elapsedMs: Date.now() - started };
}

async function convertOne(
  file: string,
  settings: ReturnType<typeof resolveDeliverySettings>,
  pinOutputPath: string | undefined,
): Promise<McpArtifactResult> {
  const warnings: ConvertWarning[] = [];
  const prepared = await prepareMarkdown(file, settings, warnings, "warn.gbkEncoding");

  const result = await emitConvertedArtifact(
    {
      markdown: { body: prepared.body, metadata: prepared.metadata },
      sourcePath: file,
      baseDir: path.dirname(file),
      ...(pinOutputPath !== undefined ? { pinOutputPath } : {}),
    },
    {
      format: "docx",
      settings,
      // 每次 call 新 ctx + 强制 deadline(见文件头第 3 条)
      ctx: createConvertContext({ deadline: Date.now() + CONVERT_DEADLINE_MS }),
      warnings,
      // mermaidResolver 刻意不注入 ⇒ 降级;已在装配层由 warnings 派生 degraded
    },
  );
  return {
    input: file,
    outputPath: result.outputPath,
    warnings: result.warnings.map(warningKey),
    degraded: result.degradations ?? [],
  };
}

/** 给人/给模型看的汇总文案(structuredContent 已含全部字段,这里是可读摘要)。 */
function renderSummary(result: McpConvertResult): string {
  const lines = result.artifacts.map((artifact) => {
    const parts = [artifact.outputPath];
    if (artifact.degraded.length > 0) parts.push(`已降级:${artifact.degraded.join(",")}`);
    if (artifact.warnings.length > 0) parts.push(`警告:${artifact.warnings.join(",")}`);
    return parts.join("  ");
  });
  if (result.degraded.length > 0) {
    lines.push(
      `注意:本次共 ${result.artifacts.length} 个产物,其中 mermaid 图表按代码块渲染` +
        `(本工具无图表渲染宿主)。如需图形,请改用桌面应用转换。`,
    );
  }
  lines.push(`耗时 ${result.elapsedMs}ms`);
  return lines.join("\n");
}
