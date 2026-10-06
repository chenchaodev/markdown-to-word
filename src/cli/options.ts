/**
 * CLI 参数 → 设置契约(argv → AppSettings + 运行选项)。
 *
 * 为什么单独成文件:argv 解析是**纯函数**(无 IO、无 electron),必须能在纯 node 下直测;
 * 入口 index.ts 只留编排(取文件、跑转换、出结果、映射退出码)。两者混在一起时,
 * 参数表的每个分支都要起一次真转换才能验证,退出码表尤其验不动。
 *
 * 依赖方向(单向):本模块 → core(设置契约与预设目录) + convert/paths(扩展名判定)。
 * **零 electron**(门禁 `faces-no-host` 判据:见 ADR-060 —— cli/mcp 是同层的两个进程外交付面)。
 *
 * 设置来源与 GUI 的关系(勿自建 flag → 参数表):CLI 的设置**从 DEFAULT_SETTINGS 起**
 * 再套 `--template` 指名的内置预设,走的是 core/settings/presets.ts 的
 * presetSettingsPatch —— 与 renderer 的 applyTemplatePreset 同一个函数。
 * CLI **不读**用户 settings.json(GUI 的 loadSettings 经 app.getPath,需 Electron 宿主;
 * CLI 面刻意不引入这条依赖,故它的设置完全由 flag 决定,跨会话可复现)。
 */
import { TEMPLATE_PRESETS } from "../core/settings/presets.js";
import type { AppSettings, ConvertFormat } from "../core/settings/settings-defaults.js";
import { resolveDeliverySettings } from "../convert/delivery-settings.js";

/** 退出码表(单一来源;index.ts 与 --help 文案共用,避免两处漂移)。
 *  语义:0 成功 / 1 用法错 / 2 输入读不到 / 3 转换失败 / 4 输出写不了。
 *  「只清洗不改内容」仍算 0(内容未变即成功,与 GUI 的成败口径一致)。 */
export const EXIT = Object.freeze({
  ok: 0,
  usage: 1,
  inputUnreadable: 2,
  convertFailed: 3,
  outputUnwritable: 4,
} as const);

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** --format 取值域:`both` = 一条命令出两个格式(PLAN 步序 2 的「一条命令两个格式」)。 */
export type CliFormat = ConvertFormat | "both";

/** 解析成功的参数(未通过校验的走 CliUsageError,不返回半成品)。 */
export interface CliOptions {
  /** 输入 markdown 路径(≥1);目录会被 collectMarkdownPaths 展开 */
  inputs: string[];
  format: CliFormat;
  /** --output:显式指定产物路径;给定即启用 pinOutputPath(禁自动避让,见 run.ts) */
  outputPath?: string;
  /** --template:内置预设 id;缺省 = 不套预设(纯默认设置) */
  templateId?: string;
  /** --json:stdout 出结构化结果数组(诊断仍走 stderr) */
  json: boolean;
  /**
   * --help:早退出口。**独立于其余字段** —— 它与「参数是否合法」无关
   * (CLI 允许只打 `--help` 而不带输入路径),故不能塞进上面那张「参数齐全才成立」的表,
   * 否则每次读都要先问「help 时这张表有意义吗」。
   */
  help: boolean;
}

/** 用法错误(退出码 1)。与「输入读不到」(2)分开:前者是命令本身写错了。 */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const HELP = `用法: m2w <输入路径...> [选项]

选项:
  --format <docx|pdf|both>   输出格式(默认 docx;both = 一条命令出两个格式)
  -o, --output <路径>        指定产物路径(禁重名自动避让;已存在即失败;不能配 --format both)
  --template <预设 id>       套用内置模板预设(见下方清单;缺省 = 默认设置)
  --json                     stdout 出结构化结果数组,人读诊断仍走 stderr
  --help                     显示本用法

退出码: 0 成功 / 1 用法错 / 2 输入读不到 / 3 转换失败 / 4 输出写不了

内置模板预设:
${TEMPLATE_PRESETS.map((p) => `  ${p.id.padEnd(12)}${p.name}`).join("\n")}`;

/** --help 文本(导出供入口与测试共用,勿在两处各写一份) */
export function usageText(): string {
  return HELP;
}

const FLAG_VALUE_OPTIONS = new Set(["format", "output", "template"]);
const FLAG_SWITCHES = new Set(["json", "help"]);
/** 短选项 → 长选项名(目前只有 -o;留这张表而不是散在 if 里,便于日后加 -f/-t 而不重复解析分支) */
const SHORT_FLAGS: Readonly<Record<string, string>> = Object.freeze({ o: "output" });

/**
 * 解析 argv(不含 node 与脚本路径)。
 *
 * 刻意**不复用** shared/cli.mjs 的 parseArgs:那套是门禁脚本的机制层,
 * 语义是「未知选项一律抛错 + 无位置参数」,而 CLI 需要位置参数(输入路径)、
 * 需要把「未知 flag」与「缺取值」分成两种可读文案、且要区分 `--help` 这种
 * 不算错的早退出口。复用它反而要在机制层塞 CLI 专用分支(违 shared 的分层纪律)。
 *
 * @param argv 进程参数(已切掉 node 与脚本路径)
 * @returns 解析结果;`help` 为真时其余字段无意义(调用方直接打印用法)
 * @throws {CliUsageError} 未知选项 / 缺取值 / 取值非法 / 无输入路径
 */
export function parseCliArgs(argv: readonly string[]): CliOptions {
  const inputs: string[] = [];
  const values = new Map<string, string>();
  let json = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (!token.startsWith("-")) {
      inputs.push(token);
      continue;
    }
    // 短选项归一到长选项名后走同一套解析:`-o out.docx` 与 `--output out.docx` 等价。
    // 非 `--` 开头且不在短选项表里的 token **判用法错**,不当成输入路径 ——
    // 否则 `-o` / `--formt` 这类手误会变成「一个叫 -o 的输入文件」,静默少转一个文件
    // 还不报错,是脚本面最难查的一类坑(用户看到的是「少了一个产物」,不是「选项写错了」)。
    let longToken = token;
    if (!token.startsWith("--")) {
      const short = token.slice(1);
      const mapped = SHORT_FLAGS[short];
      if (mapped === undefined) throw new CliUsageError(`未知选项:${token}(短选项仅支持 ${Object.keys(SHORT_FLAGS).map((s) => `-${s}`).join("/")})`);
      longToken = `--${mapped}`;
    }
    const eq = longToken.indexOf("=");
    const name = eq === -1 ? longToken.slice(2) : longToken.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : longToken.slice(eq + 1);
    if (FLAG_SWITCHES.has(name)) {
      if (inlineValue !== undefined) throw new CliUsageError(`--${name} 是开关,不接受取值`);
      if (name === "json") json = true;
      else help = true;
      continue;
    }
    if (!FLAG_VALUE_OPTIONS.has(name)) throw new CliUsageError(`未知选项:--${name}`);
    if (inlineValue === undefined) {
      const next = argv[i + 1];
      // 「下一个 token 也是 flag」= 缺取值(否则 --format --json 会被当成
      // format 的值 "--json",错误延后到格式校验才暴露,诊断指向错误的字段)
      if (next === undefined || next.startsWith("--")) throw new CliUsageError(`选项 --${name} 缺少取值`);
      values.set(name, next);
      i += 1;
    } else {
      values.set(name, inlineValue);
    }
  }

  if (help) return { inputs, format: "docx", json, help: true };
  if (inputs.length === 0) throw new CliUsageError("至少需要一个输入 markdown 路径");

  const format = parseFormat(values.get("format"));
  const templateId = values.get("template");
  if (templateId !== undefined && !TEMPLATE_PRESETS.some((p) => p.id === templateId)) {
    throw new CliUsageError(
      `未知预设:${templateId}(可用:${TEMPLATE_PRESETS.map((p) => p.id).join("/")})`,
    );
  }
  const outputPath = values.get("output");
  // -o 只对单输入有意义:多输入时「产物路径」无处安放(拼到哪个源旁边都是猜)。
  if (outputPath !== undefined && inputs.length > 1) {
    throw new CliUsageError(`--output 只能配单个输入路径(当前 ${inputs.length} 个)`);
  }
  // -o 也只能配单格式:`--format both` 下同一个路径会被 docx 与 pdf 各提交一次,
  // 后到的那次必然撞上前一次已占用的路径(表现为「魔数不符」这种看不懂的错)。
  // 替调用方猜一个后缀(pin.docx/pin.pdf)等于替他改主意,故直接判用法错。
  if (outputPath !== undefined && format === "both") {
    throw new CliUsageError("--output 不能配 --format both(两个格式无法共用一个路径);请分开跑两次");
  }
  return { inputs, format, outputPath, templateId, json, help: false };
}

function parseFormat(raw: string | undefined): CliFormat {
  if (raw === undefined) return "docx";
  if (raw === "docx" || raw === "pdf" || raw === "both") return raw;
  throw new CliUsageError(`--format 取值非法:${raw}(只接受 docx / pdf / both)`);
}

/**
 * 由解析结果构造本次转换的设置(默认设置 + 可选内置预设)。
 *
 * 恒定覆盖两处,理由与 GUI 一致:
 * - `outputDir: ""` —— 输出到源文件旁。CLI 的 --output 走 pinOutputPath(装配层入参),
 *   不经 outputDir;留空串才不会在多输入时把产物全堆到一个用户没指定的目录。
 * - `afterConvert: "none"` —— 导出后行为是 GUI 的副作用所有权(ADR-060:让位语义
 *   不进装配层),CLI 不注入 onAfterCommit 即不触发;写死 none 是第二道保险,
 *   免得将来有人给 CLI 塞进一份带 afterConvert 的设置。
 */
/**
 * 由解析结果构造本次转换的设置。
 *
 * 实现委托给 `convert/delivery-settings.ts` 的共用基线 —— CLI 与 MCP 是同层两个
 * adapter 且**零依赖**(ADR-060),这段逻辑只能写在两层之下。保持薄封装是为了让本文件
 * 仍是「argv → 设置契约」这一件事的声明处。
 */
export function resolveCliSettings(options: CliOptions): AppSettings {
  // parseCliArgs 已校验过 id 存在;这里的 throw 只在绕过解析器直调本函数时才会发生,
  // 故转成用法错形态保持本模块的错误语义单一。
  try {
    return resolveDeliverySettings({ templateId: options.templateId });
  } catch (error) {
    throw new CliUsageError(error instanceof Error ? error.message : String(error));
  }
}

/** --format 展开成实际要产出的格式列表(`both` → 两个;其余单元素)。 */
export function expandFormats(format: CliFormat): ConvertFormat[] {
  return format === "both" ? ["docx", "pdf"] : [format];
}

/** 结构化结果的单项(--json 模式;字段是契约,消费方按名取值,勿改名)。 */
export interface CliResultItem {
  /** 输入路径(绝对) */
  input: string;
  format: ConvertFormat;
  ok: boolean;
  /** 产物绝对路径;失败时缺席 */
  outputPath?: string;
  /** 警告 key 列表(结构化;人读文案在 stderr) */
  warnings: string[];
  /** 耗时(ms) */
  elapsedMs: number;
  /** 失败原因(人读文案);ok 为真时缺席 */
  error?: string;
  /**
   * 失败分类的**稳定错误码**(ASCII;来自抛出点的 `error.code`);ok 为真时缺席。
   *
   * 与 `error` 分开的原因:文案是给人读的、随时会改,而「这一类失败的处置」
   * (退出码)必须由一个改不动的契约决定。`index.ts` 判退出码 4 只读本字段,
   * 不读 `error` —— 故改文案不影响判定(断言见 test/cli/options.test.js)。
   *
   * 缺席 = 该失败未登记分类 ⇒ 按最一般的「转换失败」处理(保守,不当成功)。
   */
  errorCode?: string;
}