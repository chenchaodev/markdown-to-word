/**
 * 转换资源预算单一来源(公式与图片):
 * - KaTeX 资源边界(宏展开次数 / 用户显式尺寸 / 信任模式 / 错误模式):docx
 *   (docx/handlers/math.ts 直接调 katex)与 pdf(pdf/render.ts 经
 *   @mdit/plugin-katex 转发同一份取值)两条管线共用,任一侧不得另设一份。
 *   公式来自用户 markdown,属不可信输入:宏展开失控的 TeX 或
 *   \includegraphics/\href 等外部引用指令必须在 KaTeX 侧被有界拒绝,
 *   否则单条公式即可拖垮转换进程。
 * - 图片预算(单请求时限 / 单图字节 / 单文档图片数量 / 单文档图片总字节 /
 *   并发):docx 行内图片、pdf 本地图片存在性检查、pdf 外链图片内嵌共用同一份
 *   默认值;消费端按需覆盖(测试注入小预算验证降级路径,生产用默认值)。
 * 取值由 test/segments/core-resources.test.js 与 test/segments/pdf-postprocess.test.js 锁定。
 */

/** KaTeX 资源边界(两管线共用,勿单侧调整) */
export interface KatexResourceLimits {
  /** 单条公式宏展开次数上限(超出 → 解析失败,按既有降级路径输出 TeX 源码) */
  maxExpand: number;
  /** 用户显式尺寸上限(单位 em):约束 \rule{500em} 之类构造,不限制公式自身宽度 */
  maxSize: number;
  /** 信任模式:false = 拒绝 \includegraphics / \href 等外部引用指令(不可信 TeX 默认口径) */
  trust: boolean;
  /** 解析失败是否抛出:false = 产出 katex-error 标记,由渲染层走既有降级路径(不中断转换) */
  throwOnError: boolean;
}

/**
 * KaTeX 默认资源边界。
 * maxExpand/maxSize 为 KaTeX 自身的失控防护阈值(默认值即此,显式声明以免
 * 上游改默认后本项目静默失去边界);trust=false 拒绝外部引用指令;
 * throwOnError=false 保证不可信/畸形公式只降级不中断转换。
 */
export const DEFAULT_KATEX_RESOURCE_LIMITS: KatexResourceLimits = Object.freeze({
  maxExpand: 1000,
  maxSize: 10,
  trust: false,
  throwOnError: false,
});

/** 图片资源预算(单 URL 请求 / 单图 / 单文档数量与总字节 / 并发) */
export interface ImageResourceBudget {
  /** 单个图片请求的时限(ms):覆盖 DNS 解析、连接与读取全过程,超限按普通失败降级 */
  requestTimeoutMs: number;
  /** 单张图片字节上限(实现方据此中止读取/下载) */
  maxImageBytes: number;
  /** 单文档图片总字节上限 */
  maxDocumentBytes: number;
  /** 单文档图片数量上限 */
  maxImages: number;
  /** 图片请求并发上限 */
  concurrency: number;
}

/** 图片预算默认值:正常文档远低于此,仅用于挡住失控输入(超大响应/图片海文档) */
export const DEFAULT_IMAGE_RESOURCE_BUDGET: ImageResourceBudget = Object.freeze({
  requestTimeoutMs: 10_000,
  maxImageBytes: 20 * 1024 * 1024,
  maxDocumentBytes: 64 * 1024 * 1024,
  maxImages: 512,
  concurrency: 3,
});

/**
 * 合并预算覆盖值:显式传入的键覆盖默认,undefined 不覆盖
 * (展开默认值后再 Object.assign 会被 undefined 击穿,故逐键挑选)。
 */
export function resolveImageBudget(overrides?: Partial<ImageResourceBudget>): ImageResourceBudget {
  if (!overrides) return { ...DEFAULT_IMAGE_RESOURCE_BUDGET };
  const merged = { ...DEFAULT_IMAGE_RESOURCE_BUDGET };
  for (const key of Object.keys(merged) as (keyof ImageResourceBudget)[]) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) merged[key] = value;
  }
  return merged;
}

/**
 * 不可信 TeX 中必须拒绝的外部引用 / HTML 扩展指令。
 * KaTeX 在 trust=false 下不抛错,只把这类命令渲染为红色文本(实测:\includegraphics
 * 走 formatUnsupportedCmd),docx 侧因产物含未覆盖的 mstyle 而整式降级——两条管线的
 * 降级触发点不同,口径不统一。故渲染层在交给 KaTeX 之前统一显式拦截,
 * 使双管线对同一份不可信 TeX 产出同一降级形态(katex-error + 源码)。
 */
const UNTRUSTED_TEX_COMMAND_RE =
  /\\(?:includegraphics|href|url|htmlClass|htmlId|htmlStyle|htmlData)(?![a-zA-Z])/;

/** TeX 是否含不受信任的外部引用/HTML 扩展指令(大小写敏感,同 KaTeX 命令名) */
export function hasUntrustedTexCommand(tex: string): boolean {
  return UNTRUSTED_TEX_COMMAND_RE.test(tex);
}

/**
 * 单文档图片额度台账(数量 + 字节):生命周期 = 单次转换,由各管线按需新建。
 * 两道闸门分离:数量闸门在发起请求前(tryBegin),避免超限请求打到网络/磁盘;
 * 字节闸门在实际占用后结算(tryCharge),结算失败即本次图片按失败降级
 * (不回退已发生的 IO,只阻止其进入产物)。
 * 字节口径由调用方决定(docx 计原始字节;pdf 外链计内联 data URL 长度,
 * 即真正进入 HTML 文档的字节数,含 base64 膨胀),台账只负责累加与比较。
 */
export class ImageBudgetLedger {
  private readonly budget: ImageResourceBudget;
  private count = 0;
  private bytes = 0;

  constructor(budget: ImageResourceBudget = DEFAULT_IMAGE_RESOURCE_BUDGET) {
    this.budget = budget;
  }

  /** 数量闸门:为下一张图片占一个名额;超限返回 false(调用方按图片失败降级,不发起请求) */
  tryBegin(): boolean {
    if (this.count >= this.budget.maxImages) return false;
    this.count += 1;
    return true;
  }

  /** 字节闸门:结算本次图片实际占用;超限返回 false 且不累计 */
  tryCharge(bytes: number): boolean {
    if (this.bytes + bytes > this.budget.maxDocumentBytes) return false;
    this.bytes += bytes;
    return true;
  }

  /** 已占用的图片数量(测试与诊断用) */
  get usedImages(): number {
    return this.count;
  }

  /** 已占用的图片字节(测试与诊断用) */
  get usedBytes(): number {
    return this.bytes;
  }
}
