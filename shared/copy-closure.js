// @ts-check
/**
 * 纯文本词法层(测试树与门禁树共享,零 node: 依赖):
 * 把「一段源码文本」变成可断言的词法事实 —— 剥注释,并标出「哪些下标在字符串字面量内部」。
 *
 * 依赖方向单向:守护段 → 本文件。**本文件不 import 上层**,也不 import 任何 node: 内建模块
 * (零 I/O:不读文件、不遍历目录,只吃字符串)。目录遍历与读文件留在守护段。
 *
 * ⚠ 这里曾有一整套「沙盒副本闭包」判定(抽 specifier / 分类 / 相对解析 / 复制源表达式求值,
 *   连同 test/common/copy-closure-audit.js 的扫描审计层),已整删 —— 那套判据方向是 fail-open 的
 *   (全局并集 / per-via 只查一个文件 / 解析不出只登记 / writeFileSync 造副本不可见),
 *   取代它的是 gates/repo/check-copy-sites.mjs 的白名单式复制点门禁。
 *   本文件因此只剩「剥注释」这一件事,以及两个被门禁直接复用的符号。
 */

/** 只把「会被当模块解析的源文件」纳入扫描面(图片/清单等资源不在范围);遍历侧复用它 */
export const JS_SOURCE_RE = /\.(?:js|mjs|cjs)$/;

/**
 * @typedef {object} LexResult 词法扫描结果
 * @property {string} code 抹掉注释之后的文本(与入参等长,行号列号不变)
 * @property {Uint8Array} inString 与入参等长的掩码:下标 i 为 1 表示「i 处于某个字符串
 *   字面量的内部」(不含两侧的引号本身 —— 引号是词法记号,不是字面量内容)
 */

/**
 * 词法扫描:抹掉注释,并标出「哪些下标在字符串字面量内部」;字符串内容**原样保留**
 * (真实 import 的 specifier 本身就是字符串)。
 *
 * 为何要状态机而不是正则:正则分不清 `//` 是注释还是字符串里的 `https://`,抹错一处就会
 * 让后面的引号配对错位,凭空造出「看起来像 import」的假阳性。本实现覆盖行注释 / 块注释 /
 * 三种字符串;模板按整串跳过(不递归扫 `${}` 内的表达式)—— 对「找 import specifier」这个
 * 用途足够,边界写在这里备查。
 *
 * 为何要同时产出 inString:真 import 的 specifier 引号是**词法记号**,而文档串里
 * `require("fs")` 的那对引号在**字符串内部** —— 两者在「抹注释、留字符串」的文本上
 * 完全同形,只靠正则不出来。状态机本来就知道每个下标是否在字符串内,故一并产出。
 *
 * ⚠ inString **不能删**:唯一的消费者 gates/repo/check-import-boundary.mjs 有两处活判据
 *   用它(`findTextLayerViolations` 的 insideString 过滤 + `collectOrigins` 的声明过滤),
 *   且该门禁的 selfCheckTextLayerRules 把「去掉字符串遮罩」钉成一条会翻脸的反向锚点
 *   ⇒ 删它等于删判据,门禁自己会先红。「闭包判定退役」只退役**消费方**,不退役这份事实。
 *
 * ⚠ 掩码最大的失效形态是「恒为 1」(什么都抹 → 门禁恒绿)。故标记只覆盖**严格内部**,
 *   两侧引号恒不算内部:真 import 的引号是词法记号,能被抽到;文档串里的 `require("x")`
 *   那对引号在字符串内部,被排除。
 *
 * @param {string} text 源文本
 * @returns {LexResult} code 与 inString
 */
export function lexSource(text) {
  // 按 UTF-16 码元切分(不是码点):后面的跳过逻辑都按 text 的下标走,两者必须同坐标系,
  // 否则源码里一个 emoji 就会让「抹注释」错位
  const out = text.split("");
  const inString = new Uint8Array(text.length);
  let prev = ""; // 上一个有意义的代码字符(用于区分正则字面量与除号)
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipQuoted(text, i);
      // 只标严格内部(排除两侧引号):引号是记号,判 0 才能让真 import 被抽到
      for (let k = i + 1; k < end - 1; k += 1) inString[k] = 1;
      i = end;
      prev = ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        out[i] = " ";
        i += 1;
      }
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      while (i < stop) {
        if (text[i] !== "\n") out[i] = " ";
        i += 1;
      }
      continue;
    }
    // 正则字面量:仅在「除号不可能出现」的位置按正则处理;标识符/右括号之后一律当除号
    // (那种位置上的正则若含未转义 `//` 本就不是合法字面量,残留字符不会造出 import 假阳性)
    if (ch === "/" && (prev === "" || /[({[,;:=!&|?+\-*%~^<>]/.test(prev))) {
      i = skipRegex(text, i);
      prev = "/";
      continue;
    }
    if (!/\s/.test(ch)) prev = ch;
    i += 1;
  }
  return { code: out.join(""), inString };
}

/**
 * ⚠ 这里曾有一个 `blankComments(text) -> string` 的窄视图(现 lexSource 的 code 字段),
 *   以及 `collectSpecifiers(code, inString)`(掩码必填、用来区分「文档串里的 import 形状」
 *   与真 import),二者已**随闭包判定一起删除**。
 *   留下同义窄视图 = 留恒绿退化的入口:调用方若图省事改用它,就会绕过 ADR-041 的判据。
 *   需要「只要代码文本」的地方写 `lexSource(text).code`。
 */

/**
 * 跳过一段引号字符串/模板(处理转义;模板不递归扫 `${}`)。
 * 词法层最底层的原语,门禁的实参解析也复用它 —— 故 export,避免两份定义漂移。
 * @param {string} text 源文本
 * @param {number} start 引号所在下标
 * @returns {number} 结束引号之后的下标
 */
export function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    if (quote !== "`" && ch === "\n") return i; // 未闭合的字符串:不吞掉换行,免得后面全被抹掉
    i += 1;
  }
  return i;
}

/**
 * 跳过一个正则字面量(含字符类与转义)。
 * @param {string} text 源文本
 * @param {number} start 斜杠所在下标
 * @returns {number} 字面量之后的下标
 */
function skipRegex(text, start) {
  let i = start + 1;
  let inClass = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return i; // 未闭合:停在本行末
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i += 1;
      while (i < text.length && /[a-z]/.test(text[i] ?? "")) i += 1;
      return i;
    }
    i += 1;
  }
  return i;
}