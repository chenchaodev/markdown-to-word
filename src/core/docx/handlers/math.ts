/**
 * TeX 公式 → docx Math 组件(Office MathML)。
 * 链路:KaTeX(output:"mathml") → MathML 字符串 → 最小标签扫描器解析为树 →
 * walker 映射为 docx Math 组件(MathRun / MathFraction / MathRadical / 脚本 / 求和等)。
 *
 * 降级语义(简化):任何一步失败或遇到未覆盖节点 → 整式降级为 TeX 源码文本
 * (返回 { ok: false, text: tex },由调用方渲染为等宽灰字),不混排。
 *
 * d.ts 实证(docx 9.7.1):
 * - Math 容器:constructor({ children: MathComponent[] }),序列化 <m:oMath>;
 *   Math 属 ParagraphChild,可与 TextRun 同段混排(render.ts 依赖此契约)。
 * - MathRun:constructor(text: string) → <m:r><m:t>;文本经 xml 包 escapeForXML
 *   转义(& < > " '),解码回原文后的特殊字符不会破坏 XML。
 * - MathFraction({ numerator, denominator }) → <m:f>;MathRadical({ children, degree? })
 *   → <m:rad>;MathSubScript({ children, subScript }) → <m:sSub>;
 *   MathSuperScript({ children, superScript }) → <m:sSup>;
 *   MathSubSuperScript({ children, subScript, superScript }) → <m:sSubSup>;
 *   MathSum({ children, subScript?, superScript? }) → <m:nary>(naryPr 内置 ∑,
 *   children 即被加数 → <m:e>,**必填**:传空数组得 <m:e/> 空基,渲染器显示方框);
 *   MathLimitUpper({ children, limit }) → <m:limUpp>;MathLimitLower({ children, limit })
 *   → <m:limLow>。
 * - MathIntegral 实证不可用:accent 传空串 → naryPr 不产出 m:chr,运算符符号缺失,
 *   故积分式回落 MathSubSuperScript(∫ 以 MathRun 文本进 base)。
 *
 * KaTeX 实证(katex 0.18.1):
 * - output:"mathml" 产物为 <span class="katex"><math ...><semantics><mrow>…
 *   <annotation encoding="application/x-tex">源</annotation></semantics></math></span>;
 *   display 模式仅 math 加 display="block" 属性,不额外包 mstyle。
 * - displayMode 改变大运算符的上下限排布位置(结构性差异,非样式差异):
 *   display 下 \sum_{i=1}^{n} 为 <munderover>(→ MathSum/<m:nary>)、\lim_{x\to 0}
 *   为 <munder>(→ MathLimitLower/<m:limLow>);行内下同一 TeX 为 <msubsup>/<m:sub>。
 *   故 displayMode 必须按公式所在位置传入,见 texToDocxMath 的入参契约。
 * - 解析失败(throwOnError:false)产物为 <span class="katex-error" …>。
 * - 资源边界(maxExpand/maxSize/trust)取自 core/resource-limits.ts 单源,
 *   与 pdf 管线(@mdit/plugin-katex 转发同一份取值)一致:宏展开失控与外部
 *   引用指令在 KaTeX 侧被拒 → 整式降级为 TeX 源码,不拖垮转换。
 * - 文本转义仅 5 个字符(& < > " '),空格/运算符用原始 Unicode;
 *   mstyle 仅 \color / \small 等特殊构造产出。
 */
import katex from "katex";
import { decodeEntities } from "../../util/utils.js";
// 资源边界单源:公式来自用户 markdown(不可信输入),宏展开与信任指令的边界
// 取值与 pdf 管线(@mdit/plugin-katex 转发同一份 DEFAULT_KATEX_RESOURCE_LIMITS)一致
import { DEFAULT_KATEX_RESOURCE_LIMITS, hasUntrustedTexCommand } from "../../resource-limits.js";
import {
  MathFraction,
  MathLimitLower,
  MathLimitUpper,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSubSuperScript,
  MathSum,
  MathSuperScript,
} from "docx";
import type { MathComponent } from "docx";

export type TexToDocxMathResult =
  | { ok: true; children: MathComponent[] }
  | { ok: false; text: string };

/** 解析后的 MathML 节点:children 中 string 为文本段,MathMlNode 为子元素 */
interface MathMlNode {
  name: string;
  /** 原始属性串(trim 后为空 = 无属性;mtext 带属性 → 降级) */
  attrs: string;
  children: (MathMlNode | string)[];
}

/**
 * TeX 公式 → docx Math 组件数组。
 *
 * displayMode 决定 KaTeX 的排版模式,是本函数入参层面的唯一判定点(调用方只按
 * 「公式位于何处」传值,不各自推断 TeX 语义):真值来源是 mdast 节点类型——
 * `math`(块级,$$..$$)→ true,`inlineMath`(行内,$..$)→ false。
 * 它会改变产出结构(见文件头 KaTeX 实证),故不可给默认值,必须由调用方显式传。
 *
 * ok:false 时 text 为原 TeX 源码(整式降级,调用方渲染为等宽灰字并追加警告)。
 */
export function texToDocxMath(tex: string, displayMode: boolean): TexToDocxMathResult {
  // 信任闸门:外部引用/HTML 扩展指令在不可信输入下整式降级(KaTeX trust=false
  // 只把这类命令渲染为红色文本,不报错,故在此显式拦截以与 pdf 管线同口径)
  if (hasUntrustedTexCommand(tex)) return { ok: false, text: tex };
  // 资源边界与错误模式取自单源(见 resource-limits.ts):throwOnError=false 时
  // 解析失败不抛异常,产物含 class="katex-error";maxExpand/maxSize 挡住宏展开
  // 失控与超大显式尺寸;trust=false 拒绝 \includegraphics/\href 等外部引用指令。
  const html = katex.renderToString(tex, {
    output: "mathml",
    displayMode,
    ...DEFAULT_KATEX_RESOURCE_LIMITS,
  });
  if (html.includes('class="katex-error"')) return { ok: false, text: tex };
  // 结构异常(未闭合/子元素数量非预期等)一律整式降级,不抛错中断转换
  try {
    const root = parseMathMl(html);
    if (!root) return { ok: false, text: tex };
    const components = walk(root);
    // 空公式($ $ 等)或未覆盖节点 → 整式降级(避免空 m:oMath / 内容静默丢失)
    if (components === null || components.length === 0) return { ok: false, text: tex };
    return { ok: true, children: components };
  } catch {
    return { ok: false, text: tex };
  }
}

// ---------- MathML 解析(零依赖最小标签扫描器) ----------

/**
 * 从 KaTeX 产物中提取 <math> 子树并解析为树。
 * MathML 是规整 XML:文本内容不含裸 <(特殊字符均为实体,KaTeX 仅转义
 * & < > " ' 五个),故逐字符扫描 <tag …> / </tag> / <tag/> 即可可靠建树。
 * 结构异常(未闭合等)返回 null,由上层整式降级兜底。
 */
function parseMathMl(xml: string): MathMlNode | null {
  const open = xml.indexOf("<math");
  if (open === -1) return null;
  const openEnd = xml.indexOf(">", open);
  if (openEnd === -1) return null;
  const close = xml.lastIndexOf("</math>");
  if (close === -1 || close <= openEnd) return null;
  const root: MathMlNode = {
    name: "math",
    attrs: xml.slice(open + 5, openEnd).trim(),
    children: [],
  };
  const stack: MathMlNode[] = [root];
  let i = openEnd + 1;
  while (i < close) {
    const lt = xml.indexOf("<", i);
    if (lt === -1 || lt >= close) {
      pushText(stack, xml.slice(i, close));
      break;
    }
    pushText(stack, xml.slice(i, lt));
    const gt = xml.indexOf(">", lt + 1);
    if (gt === -1 || gt >= close) return null; // 未闭合:防御降级
    const tag = xml.slice(lt + 1, gt);
    if (tag.startsWith("/")) {
      // 闭标签:弹出栈顶(与开标签一一配对,规整 XML 下必然匹配)
      if (stack.length > 1) stack.pop();
    } else if (tag.endsWith("/")) {
      // 自闭合(mspace 等):不入栈、不产生节点(无文本贡献)
    } else {
      const nameEnd = tag.search(/[\s>]/);
      const name = (nameEnd === -1 ? tag : tag.slice(0, nameEnd)).toLowerCase();
      if (!/^[a-z][a-z0-9]*$/.test(name)) return null; // 非法标签名:防御降级
      const node: MathMlNode = {
        name,
        attrs: tag.slice(nameEnd === -1 ? tag.length : nameEnd).trim(),
        children: [],
      };
      stack[stack.length - 1]!.children.push(node); // 栈底 root 恒在(出栈受 length>1 守卫),末元素必存在
      stack.push(node);
    }
    i = gt + 1;
  }
  return root;
}

function pushText(stack: MathMlNode[], text: string): void {
  if (text === "") return;
  stack[stack.length - 1]!.children.push(text); // 栈底 root 恒在,末元素必存在
}

// ---------- walker:MathML 树 → docx Math 组件 ----------

/**
 * 子树 → MathComponent[];返回 null = 该子树未覆盖 → 整式降级。
 * 覆盖清单:
 * - 容器透传:math / mrow / semantics(KaTeX 必有包装)
 * - 文本叶:mo / mi / mn / mtext(带属性降级)/ mspace(空)/ annotation(跳过,TeX 源注解)
 * - 结构:mfrac → MathFraction;msqrt → MathRadical;mroot → MathRadical(degree)
 * - 脚本:msub / msup / msubsup → MathSubScript / MathSuperScript / MathSubSuperScript
 * - 上下限:munderover(首子 mo 为 ∑)→ MathSum(被加数由 operand 传入,见
 *   walkChildren);mover → MathLimitUpper;munder → MathLimitLower
 * - 未覆盖(mtable / mglyph / mstyle / menclose / 未知)→ null
 *
 * operand:仅 munderover(∑)用得上——KaTeX 把被加数放在 <munderover> 的**下一个
 * 兄弟节点**(`∑_{i=1}^{n} i` → `<mrow><munderover>…</munderover><mi>i</mi></mrow>`),
 * 而 OOXML 的 m:e 正是被加数槽(docx 的 MathSum.children 即 m:e,见文件头)。
 * 只有 walkChildren 有兄弟上下文,由它取下一兄弟传进来;其余节点忽略此参。
 */
function walk(node: MathMlNode, operand?: MathComponent[]): MathComponent[] | null {
  switch (node.name) {
    case "math":
    case "mrow":
    case "semantics":
      return walkChildren(node);
    case "mo":
    case "mi":
    case "mn":
      return textToRuns(node);
    case "mtext":
      // mtext 带属性(mathvariant 等)→ 降级(实证:KaTeX \text 输出为无属性 mtext)
      if (node.attrs !== "") return null;
      return textToRuns(node);
    case "mspace":
      return []; // 空白占位:无文本贡献,直接跳过
    case "annotation":
      return []; // TeX 源注解(semantics 内必有):元数据,跳过而非降级
    case "mfrac":
      return structured(node, (parts) => new MathFraction({ numerator: parts[0]!, denominator: parts[1]! })); // mfrac 恒两子(见 structured 注)
    case "msqrt":
      return structured(node, (parts) => new MathRadical({ children: parts[0]! })); // msqrt 恒一子
    case "mroot":
      return structured(node, (parts) => new MathRadical({ children: parts[0]!, degree: parts[1]! })); // mroot 恒两子
    case "msub":
      return structured(node, (parts) => new MathSubScript({ children: parts[0]!, subScript: parts[1]! })); // msub 恒两子
    case "msup":
      return structured(node, (parts) => new MathSuperScript({ children: parts[0]!, superScript: parts[1]! })); // msup 恒两子
    case "msubsup":
      return structured(node, (parts) =>
        new MathSubSuperScript({ children: parts[0]!, subScript: parts[1]!, superScript: parts[2]! }), // msubsup 恒三子
      );
    case "munderover":
      return munderoverToNary(node, operand ?? null);
    case "mover":
      return structured(node, (parts) => new MathLimitUpper({ children: parts[0]!, limit: parts[1]! })); // mover 恒两子
    case "munder":
      return structured(node, (parts) => new MathLimitLower({ children: parts[0]!, limit: parts[1]! })); // munder 恒两子
    default:
      // mtable / mglyph / mstyle / menclose / 未知元素 → 整式降级
      return null;
  }
}

/** 容器节点:遍历子节点,相邻文本段拼接为单个 MathRun;任一子未覆盖 → null */
function walkChildren(node: MathMlNode): MathComponent[] | null {
  const out: MathComponent[] = [];
  let pending = "";
  const flush = (): void => {
    if (pending !== "") {
      out.push(new MathRun(pending));
      pending = "";
    }
  };
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    if (typeof child === "string") {
      pending += decodeEntities(child);
      continue;
    }
    // n-ary 求和(∑):被加数是**紧邻的下一个兄弟节点**(KaTeX 的 munderover 只含
    // 运算符与上下限)。取它当 m:e 并从本层消费掉,否则它会作为兄弟 run 漏到
    // m:nary 之外,而 m:e 留空 → WPS 把整式显示成方框 □(docx MathSum.children
    // 就是 m:e,必填,不能传空数组)。只消费一个兄弟:`∑_{i=1}^{n} i + j` 的
    // `+ j` 必须仍留在本层,故不能把余下兄弟全吞。
    if (isNarySum(child)) {
      const operandNode = node.children[i + 1];
      // 无被加数(公式以 ∑ 结尾)或下一兄弟是裸文本:无法构造合法 m:e → 整式降级
      if (operandNode === undefined || typeof operandNode === "string") return null;
      const operand = walk(operandNode);
      if (operand === null) return null;
      i++; // 消费被加数节点
      const components = walk(child, operand);
      if (components === null) return null;
      flush();
      out.push(...components);
      continue;
    }
    const components = walk(child);
    if (components === null) return null;
    flush();
    out.push(...components);
  }
  flush();
  return out;
}

/** munderover 且首子 mo 为 ∑(大运算符求和,走 MathSum/m:nary) */
function isNarySum(node: MathMlNode): boolean {
  if (node.name !== "munderover") return false;
  const first = node.children[0];
  return first !== undefined && typeof first !== "string" && moText(first) === "∑";
}

/** 文本叶节点(mo/mi/mn/mtext)内的文本段 → 单个 MathRun(空文本 → 无贡献) */
function textToRuns(node: MathMlNode): MathComponent[] {
  let text = "";
  for (const child of node.children) {
    if (typeof child === "string") text += decodeEntities(child);
  }
  return text === "" ? [] : [new MathRun(text)];
}

/**
 * 结构节点(子元素位置有语义:分子/分母/底/上下标等):
 * 每个子元素独立 walk,裸文本出现视为非预期 → 降级。
 * 调用方对 parts 下标的非空断言依据:输入唯一来源为 katex.renderToString 的规整
 * MathML 产物,各标签子元素个数/位置由结构保证;断言仅类型层,缺子时运行时行为
 * 与改前完全一致(不新增守卫分支)。
 */
function structured(
  node: MathMlNode,
  build: (parts: MathComponent[][]) => MathComponent,
): MathComponent[] | null {
  const parts: MathComponent[][] = [];
  for (const child of node.children) {
    if (typeof child === "string") return null;
    const components = walk(child);
    if (components === null) return null;
    parts.push(components);
  }
  return [build(parts)];
}

/**
 * munderover(极限在运算符上下,如 \sum_{i=1}^{n}):
 * 首子为 <mo>∑</mo> → MathSum。**children 必须传被加数**(它就是 m:e,必填):
 * 传空数组会产出 `<m:e/>` 空基,WPS 把整式显示成方框 □。被加数不在本节点的子
 * 元素里(在下一个兄弟节点),由 walkChildren 取好经 operand 传入;取不到(公式
 * 以 ∑ 结尾)→ 整式降级为 TeX 源码,不产出空 m:e。
 * 其余(积分 ∫ 等)→ MathSubSuperScript 回落(实证:MathIntegral 不产出运算符符号),
 * 沿用首子作 base 并忽略 operand(该形态的被加数同样在兄弟节点,保持既有行为)。
 */
function munderoverToNary(node: MathMlNode, operand: MathComponent[] | null): MathComponent[] | null {
  const children = node.children;
  if (children.length !== 3 || typeof children[0] === "string") return null;
  const parts: (MathComponent[] | null)[] = children.map((child) =>
    typeof child === "string" ? null : walk(child),
  );
  if (parts.some((part) => part === null)) return null;
  // children.length === 3 已前置校验且 null 已过滤,三元组断言精确
  const [base, sub, sup] = parts as [MathComponent[], MathComponent[], MathComponent[]];
  if (moText(children[0] as MathMlNode) === "∑") {
    if (operand === null) return null; // 无被加数:空 m:e 会显示方框,宁降级
    return [new MathSum({ children: operand, subScript: sub, superScript: sup })];
  }
  return [new MathSubSuperScript({ children: base, subScript: sub, superScript: sup })];
}

/** 取 mo 元素的文本(如 ∑ / ∫);非 mo 或无文本 → 空串 */
function moText(node: MathMlNode): string {
  if (node.name !== "mo") return "";
  let text = "";
  for (const child of node.children) {
    if (typeof child === "string") text += decodeEntities(child);
  }
  return text;
}
