/**
 * MCP 的 tool 目录与转换调用。
 *
 * 四条契约(ADR-060「入口能力矩阵」的 MCP 列,逐条对应实现):
 * 1. **docx 与 pdf 都提供,但仍跑纯 node**。pdf 是**能力**不是进程形态:装配层缺
 *    `printPdf` 即报错不降级,而该能力由宿主注入 —— 本面复用 CLI 已建成的机制
 *    (`convert/pdf-host-launch.ts`:写任务文件 → spawn 宿主 → 读结果文件),
 *    协议通道不必碰 Electron(两笔账都不必付:stdio 不经 Electron 子进程、
 *    客户端配置里不必写 electron 路径)。
 * 2. **不注入 mermaidResolver**。因此含 mermaid 围栏的文档会降级为普通代码块(core 既有
 *    契约,静默不产警告)—— 但**降级必须对 agent 可见**:返回值带 `degraded`,否则这台工具
 *    就是「同样输入、偶尔产出不同」的那一类(agent 拿到的产物有图无图全看运气)。
 *    「有没有 mermaid」由 core 在转换时判定并随产物带出(`DocxArtifact.mermaidDegraded`),
 *    与渲染器共用同一个 `MERMAID_LANG` 常量,不会声明了降级其实渲了图;本面只做透传。
 *    ⚠ **该事实只在 docx 路径上有**:core 的 pdf 分支不做 remark 解析、也不产该字段
 *    (见 `core/convert.ts` 的 `DocxArtifact.mermaidDegraded` ②,该 JSDoc 明写
 *    「不要顺手扩到 pdf 分支」),故 pdf 产物的 `degraded` 恒为空。这是**已知缺口**:
 *    工具描述里据实写明,不要让 agent 撞一次才发现;补齐它要在 core 的 pdf 分支新增
 *    一次 AST 构建(结构裁决)。
 * 3. **每次 call 一个新 ctx + 强制 deadline**。新 ctx 是因为 `ConvertContext` 承载
 *    取消标志,复用会让上一次超时/取消污染下一次(历史 bug fd40480 的同类);
 *    deadline 是因为 CLI 那种「等多久是人的决定」的出口在 MCP 里不存在 ——
 *    agent 不点关窗,没有自然的中止时机。pdf 路径的 deadline 落在**宿主子进程**上
 *    (`spawnSync` 计时强杀),因为渲染与打印都在那个进程里,父侧的 ctx 掐不到它;
 *    两条路径的 deadline 取值**不同**(docx 120s / pdf 360s),理由与实测比值见
 *    `PDF_DEADLINE_MS` 的注释 —— 相同输入在两条路径上必须同样可达。
 * 4. **业务失败一律 `isError`**(见文件头「错误形态」)。
 *
 * 错误形态:业务失败(路径不存在、模板未知、格式非法、转换失败、pdf 宿主不可用)**返回
 * `isError: true` 的 tool 结果**,不走 JSON-RPC error。理由是 MCP 客户端把 tool 错误
 * 呈现给模型,模型可以据此改参数重试;JSON-RPC error 则通常终止整轮对话。
 */
import path from "node:path";
import type { ToolResult, ToolSpec } from "./jsonrpc.js";
import { collectMarkdownPaths } from "../convert/paths.js";
import { prepareMarkdown } from "../convert/preprocess.js";
import { createConvertContext } from "../convert/context.js";
import { emitConvertedArtifact } from "../convert/run.js";
import { resolveDeliverySettings, templatePresetIds } from "../convert/delivery-settings.js";
// readback 形态(docx → Markdown):回读层在 core(零 IO),落盘在装配层(唯一写文件处)。
// 与 CLI 共用**同一份实现** —— ADR-060 定了 cli 与 mcp 零依赖,共同依赖只能落在两层之下。
import { readbackDocx } from "../core/ooxml/readback/readback.js";
import { writeReadbackOutput } from "../convert/docx-readback/writer.js";
import { readDocxSource } from "../convert/docx-readback/source.js";
// pdf 的拉起判定 + 传话机制与 CLI 共用一份(ADR-060:cli 与 mcp 零依赖 ⇒ 共同依赖落在 convert)
import { isElectronProvidedNode, runPdfHostJob } from "../convert/pdf-host-launch.js";
import type { CliPdfJob } from "../convert/cli-pdf-job.js";
import type { ConvertFormat } from "../core/settings/settings-defaults.js";
import type { ConvertWarning } from "../core/i18n/index.js";
import { errorMessage } from "../core/text/error-message.js";
import type {
  ReadbackCounts,
  ReadbackDroppedField,
  ReadbackNotManagedField,
  ReadbackPreservedField,
} from "../core/ooxml/readback/readback-fields.js";

/** Tool 名(对 agent 可见的契约,改名会打断已配置的客户端)。 */
export const TOOL_NAME = "convert_markdown";

/**
 * 回读 tool 的名(第二个 tool;**不改** TOOL_NAME —— 改名会打断已配置客户端)。
 *
 * 与既有 tool **平级**而非子命令:agent 面对的是「把 Markdown 变成文档」与「把自家文档
 * 变回 Markdown」两件独立的事,合成一个带参数的 tool 会让 agent 在参数上做无谓的选择。
 */
export const READBACK_TOOL_NAME = "readback_docx";

/** `format` 的取值域(MCP 面只这两种;「一条命令两个格式」是 CLI 独有的形态)。 */
const FORMATS: readonly ConvertFormat[] = ["docx", "pdf"];

/**
 * 回读 tool 的**耗时边界**:回读不经 core 的转换管线(没有 ctx、没有渲染),
 * 故它**没有** deadline 机制可挂 —— 这里的边界是**体积闸门**:
 * `readDocxSource` 复用 markdown 源文件那道 32MB 上限(单文件超限即拒绝)。
 *
 * 为什么不再加一个 deadline 常量:挂不上去的 deadline 是**假闸门** —— 读文件与解析
 * 都不检查它,却让读者以为有闸。回读是纯内存解析 + 落盘,耗时随文档规模线性增长,
 * 32MB 闸门已经把它框在可接受的量级内。真要再加时限,得先给回读链路一个**能中断**
 * 的检查点(在解析循环里判超时),那是独立一步。
 */

/**
 * 回读 tool 的规格(进 `tools/list`)。
 *
 * description 是 agent 判断「该不该用这个 tool」的唯一依据 ⇒ 必须**据实写清能力与
 * 边界**:只读**本仓导出的** docx(不是通用 Word 解析器)、公式以纯文本保留、
 * 批注/脚注正文/修订不还原、哪些内容不进 Markdown。
 */
export const READBACK_TOOL_SPEC: ToolSpec = {
  name: READBACK_TOOL_NAME,
  description:
    "把本应用导出的 .docx 文档回读成 Markdown(逆向操作):产出同名 .md 与同名 _media/ 图片目录," +
    "并返回「完整还原了什么 / 本次丢了什么 / 本应用不还原什么」三类清单。\n" +
    "适用范围**仅限本应用导出的 .docx**(标题层级、列表、表格、图片、链接、段落与行内样式能完整还原);" +
    "任意 Word 文档不保证 —— 批注正文、脚注正文、修订记录不还原,公式以纯文本保留(不是 LaTeX)," +
    "段落级排版(缩进/对齐/行距)与字符级外观(字号/字体/颜色)不进 Markdown。\n" +
    "产物固定落在源文件同目录(同名已被占用时自动递增,不覆盖既有文件);输入路径需为绝对路径。",
  inputSchema: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "本应用导出的 .docx 文件的绝对路径。",
      },
    },
    required: ["input"],
  },
};

/**
 * docx 路径的强制截止时间(进 core 的 ctx)。
 *
 * 取 120s 的理由:CLI 侧的同类上限由源文件 32MB 闸门兜着,渲染本身是 CPU _bound,
 * 超大文档在本机实测远低于此;而 MCP 是长驻进程,一次卡死的转换会把 server 拖住
 * (stdio 传输把请求串行化,一次卡死 = 后续所有 tool 都排队),后续所有 tool 都超时。
 * 宁可截断一次大转换,也不要拖垮整个 server。
 *
 * ⚠ 这个「实测远低于此」**只对 docx 成立** —— pdf 路径另有一个值,见下。
 */
const CONVERT_DEADLINE_MS = 120_000;

/**
 * pdf 路径的强制截止时间(作宿主子进程的 `spawnSync` 上限)。
 *
 * **它是 docx 那条的 3 倍,而 3 是实测比值不是拍的**(2026-10-12,本机,同一份
 * 合成文档,含公式与表格,经 MCP 真跑):
 *
 * | 源文件 | docx | pdf  | pdf/docx |
 * |--------|------|------|----------|
 * |  89 KB |  —   | 7.4s |    —     |
 * | 179 KB | 6.3s |19.3s |   3.1×   |
 * | 363 KB |28.4s |82.9s |   2.9×   |
 * | 546 KB |  ~67s(外推) | **>120s(实测被掐)** | — |
 *
 * (两条路径耗时都随篇幅超线性增长 —— docx 侧是文档树累积, pdf 侧另加
 * Chromium 布局与逐页绘制。故上表是**当前机器当前文档形状**的实测,不是性能指标。)
 *
 * **为什么必须是 3 倍而不是沿用 120s**:沿用会在 546 KB 上下造出一道
 * 「同一份输入,docx 过、pdf 挂」的格式相关悬崖 —— 实测该文档 pdf 侧被 deadline
 * 掐掉并回 `isError`,而 agent 无法从报错里区分「这份文档太大」与「转换卡死」。
 * 3 倍让两条路径的**可达篇幅对齐**(都落在 ~730 KB 上下),也就是「换格式不该缩小
 * 能处理的文档」这条口径。
 *
 * **代价(如实记下)**:一次 pdf 调用最长可阻塞 server 约 6 分钟。这仍是「有界的
 * 阻塞」而非「无界的挂死」—— deadline 这条闸防的是后者。若将来要收窄,判据是
 * 「agent 实际请求的篇幅分布」而不是本段的比例;直接调回 120s 会退回上面那道悬崖。
 */
const PDF_DEADLINE_MS = CONVERT_DEADLINE_MS * 3;

/** 工具描述:这段文字**直接进 agent 的上下文**,是它选择与调用本工具的依据。
 *  故把能力边界与降级形态写在明面上,而不是让 agent 撞一次才发现。 */
export const TOOL_SPEC: ToolSpec = {
  name: TOOL_NAME,
  description:
    "把一个 Markdown 文件(或一个目录下的全部 .md/.markdown)转换为 .docx 或 .pdf。\n" +
    `两种格式都可用,由 format 参数选择(省略 = ${FORMATS[0]});pdf 经一个打印宿主子进程执行,` +
    "单次耗时明显高于 docx(docx 毫秒级,pdf 秒级 —— 超长文档可达数十秒)," +
    "宿主缺失时该次调用会失败并在错误里说明。\n" +
    "Mermaid 图表在**两种格式下都**会被渲染成等宽代码块(本工具无图表渲染宿主)。" +
    "docx 产物会在 `degraded` 字段里点名 mermaid;" +
    "**pdf 产物的 `degraded` 恒为空**(渲染层不在 pdf 面上报告这一事实)," +
    "故用 pdf 时请自行按「mermaid 一律是代码块」处理。\n" +
    "输入路径需为绝对路径。",
  inputSchema: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "Markdown 文件的绝对路径,或包含 .md/.markdown 的目录绝对路径。",
      },
      format: {
        type: "string",
        enum: [...FORMATS],
        description:
          `产物格式:docx(默认)/ pdf。pdf 走打印宿主子进程,耗时以秒计;` +
          "同一目录含多个 md 时,每个文件各出一个产物。",
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
  /** 本项发生的降级(目前只有 mermaid);无则空数组 */
  degraded: string[];
  /**
   * 本项产物的实际格式。**对 agent 而言这是唯一的格式事实** —— `outputPath` 可被
   * `outputPath` 参数钉到任意扩展名,从路径反推格式会得出错答案。
   */
  format: ConvertFormat;
}

/** 结构化结果(进 structuredContent)。 */
export interface McpConvertResult {
  artifacts: McpArtifactResult[];
  /** 全部产物的降级并集(给 agent 一眼可判的汇总) */
  degraded: string[];
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

/**
 * 解析 `format`,**省略即 docx**。
 *
 * 向后兼容是这个取值的全部理由:该参数是后加的,而本工具早已发布 ——
 * 已配置的客户端一条 `format` 都不会传,故缺省必须落回原行为(docx),而不是落成
 * 「必填」或报错。
 *
 * 取值非法在这里转成 ToolFailure(与 `template` 同一处理),且**把可用取值列进报错**:
 * agent 拿到的是可自我纠正的文案,而不是一句「格式错了」。
 */
function optionalFormat(args: Record<string, unknown>): ConvertFormat {
  const value = args["format"];
  if (value === undefined || value === null) return "docx";
  if (typeof value !== "string" || !FORMATS.includes(value as ConvertFormat)) {
    throw new ToolFailure(`未知 format:${String(value)}(可用:${FORMATS.join(" / ")})`);
  }
  return value as ConvertFormat;
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
  const format = optionalFormat(args);
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
    artifacts.push(
      await convertOne(file, format, settings, files.length === 1 ? outputPath : undefined),
    );
  }
  const degraded = [...new Set(artifacts.flatMap((artifact) => artifact.degraded))].sort();
  return { artifacts, degraded, elapsedMs: Date.now() - started };
}

async function convertOne(
  file: string,
  format: ConvertFormat,
  settings: ReturnType<typeof resolveDeliverySettings>,
  pinOutputPath: string | undefined,
): Promise<McpArtifactResult> {
  return format === "pdf"
    ? convertOneViaHost(file, settings, pinOutputPath)
    : convertOneInProcess(file, settings, pinOutputPath);
}

/** docx:纯 node 同进程跑装配层(零宿主启动,毫秒级)。 */
async function convertOneInProcess(
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
      // mermaidResolver 刻意不注入 ⇒ 本面无 mermaid 能力(见文件头第 2 条)
    },
  );
  // 降级事实**从装配层返回值读**(core 解析时判定、随产物带出、装配层原样透传)。
  // 本面不自行解析:core 的判定复用它自己已构建的 ast(见 core/convert.ts docx 分支),
  // 渲染前再解析一次纯属重复 —— 那次重复解析已被本步消掉,别把它加回来。
  const degraded = result.mermaidDegraded ? ["mermaid"] : [];
  return {
    input: file,
    format: "docx",
    outputPath: result.outputPath,
    warnings: result.warnings.map(warningKey),
    degraded,
  };
}

/**
 * pdf:经打印宿主子进程执行(机制与 CLI 同一份 `convert/pdf-host-launch.ts`)。
 *
 * **为什么不自己再拼一套**:拉起形态有两种(源码检出走 electron 脚本路径 / 已安装走
 * `--pdf-host` flag)、env 必须 `delete` 掉 `ELECTRON_RUN_AS_NODE`、任务与结果经临时
 * 文件而非 stdout —— 每一条都是「漏一行就静默失败」的位置(症状是 pdf 不产出且退出码为 0)。
 * 两面各写一份,等于把这几条静默失效面从一个文件复制成两个。
 *
 * **失败一律转 ToolFailure**(即 `isError` 结果),四种宿主态各给一句可行动的话:
 * agent 拿到「宿主不可用」与「转换失败」时下一步动作完全不同(装宿主 vs 改输入/换格式)。
 *
 * ⚠ `degraded` 恒为空:core 的 pdf 分支不做 remark 解析、也不产 `mermaidDegraded`
 * (见 `core/convert.ts` 的 `DocxArtifact.mermaidDegraded` ② 与该文件头契约 2)。
 * **本面不自行解析补上** —— 那正是 docx 路径上刻意消掉的第二次解析,且 core 的
 * JSDoc 明写该字段的语义要重新裁决、不得顺手扩到 pdf 分支。工具描述里已据实告知
 * agent「pdf 的 degraded 恒为空,mermaid 一律按代码块处理」。
 */
function convertOneViaHost(
  file: string,
  settings: ReturnType<typeof resolveDeliverySettings>,
  pinOutputPath: string | undefined,
): McpArtifactResult {
  const job: CliPdfJob = {
    input: file,
    baseDir: path.dirname(file),
    settings: settings as unknown as Record<string, unknown>,
    ...(pinOutputPath !== undefined ? { outputPath: pinOutputPath } : {}),
  };
  // deadline 落在 spawnSync 上:渲染与打印都在那个进程里,父侧的 ctx 掐不到它。
  // 取 PDF_DEADLINE_MS(不是 docx 那个)—— 理由与实测比值见该常量注释。
  const run = runPdfHostJob(job, { timeoutMs: PDF_DEADLINE_MS });
  if (run.cleanupWarning !== undefined) {
    process.stderr.write(`[mcp] ${run.cleanupWarning}\n`);
  }
  if (run.reason === "spawn-failed") {
    throw new ToolFailure(
      isElectronProvidedNode()
        ? `pdf 需要宿主应用可执行文件,未能启动:${run.message}(请确认本程序已完整安装;或改用 format=docx)`
        : `pdf 需要 Electron 打印宿主,未能启动:${run.message}(源码检出形态需先 npm install;或改用 format=docx)`,
    );
  }
  if (run.reason === "timeout") {
    throw new ToolFailure(`pdf 宿主超时未完成(上限 ${run.timeoutMs}ms),已中止本次调用`);
  }
  if (run.reason === "no-result") {
    throw new ToolFailure(
      `pdf 宿主未产出结构化结果(退出码 ${run.exitStatus ?? "null"}):${run.message}`,
    );
  }
  const result = run.result;
  if (!result.ok || typeof result.outputPath !== "string") {
    throw new ToolFailure(`pdf 转换失败:${result.error ?? "未知原因"}`);
  }
  return {
    input: file,
    format: "pdf",
    outputPath: result.outputPath,
    warnings: result.warnings,
    // 恒空,理由见本函数 JSDoc
    degraded: [],
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
  } else if (result.artifacts.some((artifact) => artifact.format === "pdf")) {
    // 降级为空有两种可能:确实没有 mermaid,或 pdf 面不报告该事实(见 convertOneViaHost)。
    // 两者对 agent 的处置不同,故 pdf 产物一律把「mermaid 是代码块」写明,
    // 而不是让「degraded 为空」被读成「没有 mermaid」。
    lines.push(
      "注意:pdf 产物不报告 mermaid 降级(degraded 恒为空)——" +
        "含 mermaid 围栏的文档在 pdf 里同样按等宽代码块渲染,请据此判断是否需要人工补图。",
    );
  }
  lines.push(`耗时 ${result.elapsedMs}ms`);
  return lines.join("\n");
}

/** 回读的结构化结果(进 structuredContent;字段名对 agent 是契约,勿改)。 */
export interface McpReadbackResult {
  /** 输入 .docx 绝对路径 */
  input: string;
  /** 产出的 .md 绝对路径 */
  markdownPath: string;
  /** 图片目录(无图片时缺席) */
  mediaDir?: string;
  /** 各结构的条数 */
  counts: ReadbackCounts;
  /** 完整还原的结构(稳定标识) */
  preserved: readonly ReadbackPreservedField[];
  /** 本次文档实际发生的丢失(稳定标识;空数组 = 没丢) */
  dropped: readonly ReadbackDroppedField[];
  /** 本应用恒不还原的类别(稳定标识) */
  notManaged: readonly ReadbackNotManagedField[];
  /** 总耗时(ms) */
  elapsedMs: number;
}

/**
 * 执行一次回读(docx → Markdown)。
 *
 * 与 CLI 的 readback 形态**共用同一份实现**(回读层在 core、落盘在装配层)——
 * ADR-060 定了 cli 与 mcp 零依赖,共同依赖只能落在两层之下。
 *
 * 失败一律转 `isError`(见文件头「错误形态」):路径不存在 / 不是有效 docx / 落盘失败
 * 三种都给 agent 一句可行动的话(改路径 / 换文件 / 换个能写的目录)。
 */
export async function callReadbackDocx(rawArgs: unknown): Promise<ToolResult> {
  const started = Date.now();
  try {
    const args = asRecord(rawArgs);
    const input = optionalString(args, "input");
    if (input === undefined) throw new ToolFailure("缺参数:input");
    if (!path.isAbsolute(input)) throw new ToolFailure(`input 必须是绝对路径:${input}`);
    let buf: Uint8Array;
    try {
      buf = await readDocxSource(input);
    } catch (err) {
      throw new ToolFailure(`读不到输入文件:${input}(${errorMessage(err)})`);
    }
    const result = await readbackDocx(buf);
    if (result.status === "unreadable") {
      throw new ToolFailure("回读失败:文件不是有效的 Word 文档(.docx),或已损坏");
    }
    let written: Awaited<ReturnType<typeof writeReadbackOutput>>;
    try {
      written = await writeReadbackOutput({
        sourcePath: input,
        root: result.root,
        images: result.images,
      });
    } catch (err) {
      throw new ToolFailure(`回读产物落盘失败:${errorMessage(err)}`);
    }
    const payload: McpReadbackResult = {
      input,
      markdownPath: written.markdownPath,
      ...(written.mediaDir !== undefined ? { mediaDir: written.mediaDir } : {}),
      counts: result.counts,
      preserved: result.preserved,
      dropped: result.dropped,
      notManaged: result.notManaged,
      elapsedMs: Date.now() - started,
    };
    return { content: [{ type: "text", text: renderReadbackSummary(payload) }], structuredContent: payload };
  } catch (error) {
    if (error instanceof ToolFailure) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `回读失败:${message}` }], isError: true };
  }
}

/** 回读结果的可读摘要(structuredContent 已含全部字段)。 */
function renderReadbackSummary(result: McpReadbackResult): string {
  const lines = [result.markdownPath];
  if (result.mediaDir !== undefined) lines.push(`图片目录 ${result.mediaDir}`);
  const c = result.counts;
  lines.push(
    `结构计数:标题 ${c.headings} · 段落 ${c.paragraphs} · 列表项 ${c.listItems} · ` +
      `表格 ${c.tables} · 图片 ${c.images} · 链接 ${c.links} · 公式 ${c.formulas} · ` +
      `脚注 ${c.footnotes} · 批注 ${c.comments}`,
  );
  lines.push(`完整还原:${result.preserved.join(", ")}`);
  if (result.dropped.length > 0) {
    lines.push(`本次丢失(以纯文本保留或未还原):${result.dropped.join(", ")}`);
  }
  lines.push(`本应用不还原:${result.notManaged.join(", ")}`);
  lines.push(`耗时 ${result.elapsedMs}ms`);
  return lines.join("\n");
}
