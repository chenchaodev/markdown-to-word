/**
 * docx 模板导入的「未映射字段类别」标识单源(**零依赖**模块)。
 *
 * 职责:把「没吃下的东西」按**性质**分成两类,类型与常量都收在本文件:
 * - 恒不映射六类(`AlwaysUnmappedTemplateField`):**本仓的能力边界**(字体颜色/主题配色/
 *   模板编号定义/兼容选项/字符样式/潜在样式)——与本次模板无关,恒定;
 * - 事实性七类(`FactualUnmappedTemplateField`):**本次模板的具体事实**(越界/判不出档位),
 *   按条件产出。
 *
 * 为什么单独成文件且必须**零依赖**:界面层(renderer)要 import 本模块的**常量**渲染那句
 * 固定说明;若经 `template-import.ts` 取 ⇒ jszip 被拖进 renderer 产物(浏览器侧加载不了
 * node 包)。故本模块**不 import 任何模块**(连 core 内部模块也不),只出类型与字面量。
 *
 * 不变量:
 * ① 标识同时是 i18n 键 `template.unmapped.<标识>` 的末段 ⇒ 只能用 ASCII 标识符。
 * ② 两类不得混列:恒不映射六类是**本仓取舍**(能力边界),**不进 IPC 契约面** ——
 *    界面直接取本模块的常量渲染;事实性七类才是「本次导入的诊断」,经 IPC 送到界面。
 * ③ 清单**有序**:界面按本文件给出的顺序渲染那句固定说明(顺序即文案顺序)。
 */

/** 恒不映射的六类(本仓的能力边界;与本次模板无关,恒在) */
export type AlwaysUnmappedTemplateField =
  /** 字体颜色(w:color):设置模型无颜色项(ADR-086 决定五) */
  | "color"
  /** 主题配色槽:不进设置模型 */
  | "themeColor"
  /** 模板编号定义(numbering.xml):本仓章节/题注编号自产,不接管 */
  | "numbering"
  /** settings.xml 兼容选项:不进设置模型 */
  | "settingsCompat"
  /** 字符样式:设置模型只有段落级排版项 */
  | "characterStyle"
  /** w:latentStyles:不进设置模型 */
  | "latentStyles";

/** 事实性未映射类别(本次模板判不出的项;按条件产出) */
export type FactualUnmappedTemplateField =
  /** 正文字号越界(不在 BODY_SIZE_MIN..BODY_SIZE_MAX 内) */
  | "bodySizeOutOfRange"
  /** 行距规则非 auto(exact / atLeast):倍数语义对不上 */
  | "lineSpacingRule"
  /** 行距倍数越界(不在 LINE_SPACING_MIN..LINE_SPACING_MAX 内) */
  | "lineSpacingOutOfRange"
  /** 对齐值无对应档位(right / end / center) */
  | "alignUnsupported"
  /** 标题字号档位判不出(缺标题样式,或三档差异小于阈值) */
  | "headingScaleUndetermined"
  /** 标题段前段后档位判不出 */
  | "headingSpacingUndetermined"
  /** 纸张尺寸与任何标准纸都不符(容差 3mm 内无命中) */
  | "paperUnrecognized";

/** 未映射类别的**全量**联合(恒不映射六类 ∪ 事实性七类) */
export type UnmappedTemplateField = AlwaysUnmappedTemplateField | FactualUnmappedTemplateField;

/**
 * 恒不映射六类的有序清单(能力边界声明;界面按此顺序渲染那句固定说明)。
 *
 * 为什么恒在而不是「模板里有才报」:这六类是**本仓的取舍**(ADR-086 决定五:不接颜色、
 * 不接管模板编号),不是模板的缺陷 —— 若按内容条件报,用户会以为「这次模板里没有颜色
 * 所以没报」,反而误解。与之相对,「越界/判不出档位」那几条是**本次导入的具体事实**,
 * 故按条件产出。
 */
export const ALWAYS_UNMAPPED_TEMPLATE_FIELDS = [
  "color",
  "themeColor",
  "numbering",
  "settingsCompat",
  "characterStyle",
  "latentStyles",
] as const satisfies readonly AlwaysUnmappedTemplateField[];

/**
 * 事实性未映射类别的全集(界面标签表的键集;实际产出时按本次模板的条件取子集)。
 *
 * 全集在此登记而非散落:标签表要按它锁键(新增成员而界面漏登记 ⇒ tsc 判红)。
 */
export const FACTUAL_UNMAPPED_TEMPLATE_FIELDS = [
  "bodySizeOutOfRange",
  "lineSpacingRule",
  "lineSpacingOutOfRange",
  "alignUnsupported",
  "headingScaleUndetermined",
  "headingSpacingUndetermined",
  "paperUnrecognized",
] as const satisfies readonly FactualUnmappedTemplateField[];

/**
 * 判某个未映射标识是否属于**事实性**类别(本次模板判不出的项)。
 *
 * 用途:契约面只承载事实性类别(恒不映射六类是能力边界,界面直接取本模块的常量渲染,
 * 不经 IPC)⇒ 边界层据此把映射层的全量清单收窄成契约形状。
 *
 * @param field 未映射标识
 * @returns 是事实性类别 ⇒ true
 */
export function isFactualUnmappedTemplateField(
  field: UnmappedTemplateField,
): field is FactualUnmappedTemplateField {
  return !(ALWAYS_UNMAPPED_TEMPLATE_FIELDS as readonly string[]).includes(field);
}
