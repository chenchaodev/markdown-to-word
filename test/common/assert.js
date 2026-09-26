// @ts-check
/**
 * 公共断言集(测试树共享的单一来源):把各段各自复制的 `assert` / `assertEq` 收敛成一处,
 * 统一「段名前缀 + 失败必含实际值与期望值 + 可读差异定位」的口径。
 *
 * 为何值得抽(盘点结论见本文件末「重复面」):
 * 1) 真值断言的复制面最大(本轮盘点 65 份局部副本:segments 29 / main 27 / renderer 9,
 *    外加 test/common/case.js 的无前缀导出版):实现逐字相同,只有前缀里的段名不同 ——
 *    差异只在「谁写的」,不在「判什么」,属纯噪声,漂移方向还相反(有人写成模板串版本,
 *    读起来像两套机制);
 * 2) 相等断言有三份逐字相同的副本(headings / image-type / presets),而它们与本文件
 *    的差异只是**少了首个差异位置**这一信息(见 assertEq),即现有实现信息量更少、不是更多;
 * 3) 数量/逐字节比对散落成裸表达式(`calls.filter(...).length !== 1`、
 *    `bufA.equals(bufB)`),失败时只得到 "false",看不出差在第几个字节、哪一项。
 *    本文件把它们收成 assertCount / assertOccurrences / assertBytes。
 *
 * **强度下限(不得降级,新增能力时守住这条)**:每条失败消息都必须能指到「实际是什么、
 * 期望是什么、差在哪」;逐字节比对只能是 assertBytes(严格 `Buffer.equals`),任何场景
 * 不得用「包含即过」代替「逐项/逐字节相等」。assertEq 只做标量严格相等(Buffer/对象按
 * 引用比,写 `assertEq(bufA, bufB)` 想比字节必然失败——这是响的假阴,不是静默放过)。
 *
 * 用法(段内):
 *   const { assert, assertEq, assertBytes } = createAsserter("theme-fonts");
 *   assertEq(actual, expected, "标题层级数");
 *
 * 依赖方向单向:本文件零 import(只用 node 内置 Buffer/global),可被任意段与
 * test/tools 下的工具直接引用,不会把 dist / 产物解析链拖进轻量场景。
 */

/** 失败消息里单个值的最大预览长度(超长截断并附总长,防把整份 document.xml 灌进日志) */
const MAX_PREVIEW = 120;

/** Buffer 预览里展示的字节数(再多对定位无益) */
const MAX_HEX_BYTES = 8;

/** 命中位置上下文的单侧长度(证明「命中在哪一段上下文」用) */
const CONTEXT_RADIUS = 40;

/* ---------- 值预览(失败消息的唯一渲染口径) ---------- */

/**
 * Buffer 的十六进制预览(前 MAX_HEX_BYTES 字节)。
 * @param {Buffer} buf 目标字节
 * @returns {string}
 */
function hexPreview(buf) {
  const head = buf.subarray(0, MAX_HEX_BYTES);
  const hex = [...head].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return buf.length > MAX_HEX_BYTES ? `${hex} …` : hex;
}

/**
 * 按总长截断一段文本(不截断时原样返回)。
 * @param {string} text 文本
 * @returns {string}
 */
function clip(text) {
  return text.length > MAX_PREVIEW ? `${text.slice(0, MAX_PREVIEW)}…(共 ${text.length} 字符)` : text;
}

/**
 * 值的可读形态:字符串带引号、Buffer 带字节数与十六进制、Error 带名与消息、
 * 循环引用对象降级为 String(不得因预览失败而丢掉断言本身的可读性)。
 * @param {unknown} value 待渲染值
 * @returns {string}
 */
export function preview(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  // 长串先截断再补引号:否则「共 N 字符」报的是加引号后的长度,与同一消息里的真实字符数对不上
  if (typeof value === "string") {
    return value.length > MAX_PREVIEW ? `"${clip(value)}"` : JSON.stringify(value);
  }
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : String(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "boolean") return String(value);
  if (typeof value === "function") return `[Function ${value.name || "(匿名)"}]`;
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} 字节 ${hexPreview(value)}>`;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof RegExp) return String(value);
  try {
    return clip(JSON.stringify(value) ?? String(value));
  } catch {
    // 循环引用 / 抛错的 toJSON:预览失败不得掩盖断言信息
    return clip(String(value));
  }
}

/**
 * 命中子串在文本中的第几处(0 基;未命中返回 -1)。用 indexOf 而非正则,避免 needle
 * 里的元字符被当模式(测试里的 needle 常是 XML 片段,含 < " $ 等)。
 * @param {string} haystack 被检文本
 * @param {string} needle 子串
 * @returns {number}
 */
export function indexOfOccurrence(haystack, needle) {
  if (needle === "") return haystack === "" ? 0 : -1;
  return haystack.indexOf(needle);
}

/**
 * 命中位置附近的上下文片段(证明「命中在哪一段上下文」,而不只是「命中了」)。
 * @param {string} haystack 被检文本
 * @param {string} needle 子串
 * @param {number} index 命中下标
 * @returns {string}
 */
function contextAround(haystack, needle, index) {
  const from = Math.max(0, index - CONTEXT_RADIUS);
  const to = Math.min(haystack.length, index + needle.length + CONTEXT_RADIUS);
  return `${from > 0 ? "…" : ""}${clip(haystack.slice(from, to))}${to < haystack.length ? "…" : ""}`;
}

/**
 * 两个字符串的首个差异下标(相同返回 -1)。逐码元比较:断言面向的是文本事实,
 * 不做大小写折叠/归一化(归一化会掩盖真实差异)。
 * @param {string} actual 实际值
 * @param {string} expected 期望值
 * @returns {number}
 */
export function firstStringDiff(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  for (let i = 0; i < limit; i += 1) {
    if (actual[i] !== expected[i]) return i;
  }
  return actual.length === expected.length ? -1 : limit;
}

/* ---------- 逐项相等的判定与差异定位 ---------- */

/**
 * 单项是否相等:先按引用/标量比,再退到 JSON 形态比(支持数组项为对象的场景)。
 * @param {unknown} a 实际项
 * @param {unknown} b 期望项
 * @returns {boolean}
 */
function sameValue(a, b) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    // 不可序列化对象(循环引用等):只认引用相等,不猜
    return false;
  }
}

/**
 * 两个数组逐项相等(长度相同 + 每项 sameValue)。顺序敏感:目录条目/题注这类
 * 「顺序本身就是被断言的事实」的场景,顺序变了必须判红。
 * @param {readonly unknown[]} actual 实际数组
 * @param {readonly unknown[]} expected 期望数组
 * @returns {boolean}
 */
export function sameItems(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  return actual.every((item, i) => sameValue(item, expected[i]));
}

/**
 * 首个不相等的项下标(全等返回 -1;长度不等时返回较短长度的下标,即「多出来/少掉了」那一项)。
 * @param {readonly unknown[]} actual 实际数组
 * @param {readonly unknown[]} expected 期望数组
 * @returns {number}
 */
export function firstItemDiff(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  for (let i = 0; i < limit; i += 1) {
    if (!sameValue(actual[i], expected[i])) return i;
  }
  return actual.length === expected.length ? -1 : limit;
}

/**
 * 两个 Buffer 首个不同字节的偏移(相同返回 -1;长度不同且公共前缀相同时返回较短长度,
 * 即「多出/少了字节」的那一位)。
 *
 * 不用 `Buffer.compare`:它返回的是 memcmp 的大小关系(-1/0/1),不是差异下标 —— 把它当偏移用
 * 会让「差异偏移」这一信息在消息里静默消失(自测段 test-common-helpers 抓到的真实 bug)。
 * @param {Buffer} actual 实际字节
 * @param {Buffer} expected 期望字节
 * @returns {number}
 */
export function firstByteDiff(actual, expected) {
  const limit = Math.min(actual.length, expected.length);
  for (let i = 0; i < limit; i += 1) {
    if (actual[i] !== expected[i]) return i;
  }
  return actual.length === expected.length ? -1 : limit;
}

/* ---------- 公共断言集 ---------- */

/**
 * 断言集形状。
 *
 * `assert` 刻意**不**声明为 `asserts cond`(窄化断言函数):TS 禁止从解构模式里调用断言函数
 * (TS2775「call target 必须有显式类型标注」对 `const { assert } = createAsserter(...)` 不成立),
 * 而段内惯用法正是解构取用。少数段需要「判红同时收窄类型」时(见 supply-chain 段),在段内
 * 包一层带 `@returns {asserts cond}` 的本地函数调用本 helper 即可,不必把窄化塞进公共件。
 *
 * @typedef {object} Asserter 带段名前缀的断言集
 * @property {(cond: unknown, msg: string) => void} assert 真值断言(JS 真值口径,与既有各段一致)
 * @property {(actual: unknown, expected: unknown, what: string) => void} assertEq 标量严格相等(带首个差异位置)
 * @property {(actual: Buffer, expected: Buffer, what: string) => void} assertBytes 逐字节相等(严格 Buffer.equals)
 * @property {(haystack: string, needle: string, what: string) => void} assertIncludes 包含子串
 * @property {(haystack: string, needle: string, what: string) => void} assertNotIncludes 不含子串(失败时给命中上下文)
 * @property {(actual: readonly unknown[], expected: readonly unknown[], what: string) => void} assertSameItems 逐项相等(顺序敏感)
 * @property {(actual: number, expected: number, what: string) => void} assertCount 数量相等
 * @property {(items: readonly unknown[], value: unknown, expectedCount: number, what: string) => void} assertOccurrences 某值的出现次数
 */

/**
 * 建一组带段名前缀的断言:失败消息统一为 `<段名> 断言失败:<事实>`。
 *
 * 段名是**必填**:各段复制版唯一的实质差别就是这段前缀(用于在 106 段混合输出里一眼定位
 * 失败段),做成必填参数就消掉了「有人忘了带前缀」这一类漂移。
 * @param {string} label 段名(如 theme-fonts)
 * @returns {Asserter}
 */
export function createAsserter(label) {
  /**
   * 统一失败出口:只在这里拼前缀,保证各条断言的消息形状一致。
   * @param {string} body 事实描述
   * @returns {never}
   */
  const fail = (body) => {
    throw new Error(`${label} 断言失败:${body}`);
  };

  return {
    assert(cond, msg) {
      if (!cond) fail(msg);
    },

    assertEq(actual, expected, what) {
      // `===` 而非 Object.is:与既有各段 assertEq 逐字同口径(改用 Object.is 会把
      // NaN 与 ±0 的判定翻转,那是语义变更,不该在「收拢重复」时顺手夹带)
      if (actual === expected) return;
      const detail =
        typeof actual === "string" && typeof expected === "string"
          ? `;首个差异在第 ${firstStringDiff(actual, expected)} 个字符(长度 实际 ${actual.length}/期望 ${expected.length})`
          : "";
      fail(`${what} 不相等:实际 ${preview(actual)}(期望 ${preview(expected)})${detail}`);
    },

    assertBytes(actual, expected, what) {
      if (Buffer.isBuffer(actual) && Buffer.isBuffer(expected) && actual.equals(expected)) return;
      const at = Buffer.isBuffer(actual) && Buffer.isBuffer(expected) ? firstByteDiff(actual, expected) : -1;
      fail(
        `${what} 逐字节比对不一致:实际 ${preview(actual)}(期望 ${preview(expected)})${
          at >= 0
            ? `;首个不同字节在偏移 ${at}(实际 0x${actual[at]?.toString(16)} 期望 0x${expected[at]?.toString(16)})`
            : ""
        }`,
      );
    },

    assertIncludes(haystack, needle, what) {
      if (haystack.includes(needle)) return;
      fail(`${what} 未包含 ${preview(needle)};被检文本(${haystack.length} 字符)${preview(haystack)}`);
    },

    assertNotIncludes(haystack, needle, what) {
      const at = indexOfOccurrence(haystack, needle);
      if (at < 0) return;
      fail(`${what} 不得包含 ${preview(needle)},实际命中于第 ${at} 处:「${contextAround(haystack, needle, at)}」`);
    },

    assertSameItems(actual, expected, what) {
      if (!Array.isArray(actual) || !Array.isArray(expected)) {
        fail(`${what} 逐项比较要求两侧都是数组,实际 ${preview(actual)}/${preview(expected)}`);
      }
      if (sameItems(actual, expected)) return;
      const at = firstItemDiff(actual, expected);
      const item =
        at >= 0
          ? `;首个差异在第 ${at} 项:实际 ${preview(actual[at])}(期望 ${preview(expected[at])})`
          : ";各项 JSON 形态不同(键序或类型差异)";
      fail(
        `${what} 逐项不相等:长度 实际 ${actual.length}/期望 ${expected.length}${item};实际全量 ${preview(actual)};期望全量 ${preview(expected)}`,
      );
    },

    assertCount(actual, expected, what) {
      if (actual === expected) return;
      fail(`${what} 计数不符:实际 ${preview(actual)}(期望 ${preview(expected)})`);
    },

    assertOccurrences(items, value, expectedCount, what) {
      const hits = items.filter((item) => sameValue(item, value)).length;
      if (hits === expectedCount) return;
      fail(
        `${what} 出现次数不符:${preview(value)} 实际出现 ${hits} 次(期望 ${expectedCount} 次),被检 ${items.length} 项:${preview(items)}`,
      );
    },
  };
}

/**
 * @typedef {object} FailureOutcome 一次失败的事实
 * @property {boolean} threw 是否真的抛了
 * @property {string} message 失败消息(未抛则空串)
 * @property {Error | null} error 失败对象(未抛则 null)
 */

/**
 * 失败事实的「不抛」形态。
 * @returns {FailureOutcome}
 */
function noFailure() {
  return { threw: false, message: "", error: null };
}

/**
 * 失败事实的「抛了」形态(非 Error 的抛出值归一成 Error,免得断言方拿到字符串还要再判型)。
 * @param {unknown} err 抛出值
 * @returns {FailureOutcome}
 */
function toFailure(err) {
  const error = err instanceof Error ? err : new Error(typeof err === "string" ? err : String(err));
  return { threw: true, message: error.message, error };
}

/**
 * 捕获一次断言失败(供 helper 自身的负向自检用):把「断言失败」这一事实变成可断言的值,
 * 否则自检只能靠捕获异常再手写 try/catch 判文案。同步体直接返回值、异步体返回 Promise,
 * **两种都用 `await` 取**(对非 Promise 值 await 等于原值),免得调用方按形态分支。
 * @param {() => unknown} fn 待执行的断言体(应抛错)
 * @returns {FailureOutcome | Promise<FailureOutcome>} 失败事实(未抛错则 threw=false)
 */
export function captureAssertionFailure(fn) {
  try {
    const out = fn();
    if (out instanceof Promise) return out.then(noFailure, toFailure);
    return noFailure();
  } catch (err) {
    return toFailure(err);
  }
}

/* ---------- 重复面盘点(留档:本文件为何只收这 8 条,以及哪些差异是刻意的) ----------

真值断言:本轮盘点 65 份局部副本(segments 29 / main 27 / renderer 9),各写一份
  `if (!cond) throw new Error(\`<段名> 断言失败:\${msg}\`)`,外加 test/common/case.js 导出的
  无前缀版(供已接入 case 契约的段用)。逐字相同,仅前缀段名不同。
  刻意保留的差异:case.js 那份**不带前缀**(它是 case 契约的对外口,段名由报告行给出,
  再拼一次前缀会变成 "segments/utils 断言失败:… 断言失败:")。迁移时勿顺手统一。

相等断言:headings / image-type / presets 三份 `assertEq` 逐字相同(实际/期望各 JSON.stringify),
  本文件同口径并追加「首个差异字符/项下标」——信息量严格更大,故不是弱化。

数量/逐字节:散落为裸表达式(basic-render 的局部 countOf、supply-chain 与 install-smoke 的
  `bufA.equals(bufB)`、大量 `arr.filter(...).length === N`),失败信息只有 false;
  本文件收成 assertCount / assertOccurrences / assertBytes。

未收进本文件(刻意,避免增加理解成本):
  - assertFailure(result, pattern, label) 三处同名但语义各段不同(退出码/诊断/不回吐栈
    的组合不一样),属**段内契约**而非通用断言,强行统一会把差异抹平;
  - 各段的 JSON/正则/目录树断言(本身已是自带可读输出的整体比较),拆出来只会换名字;
  - 文本子串计数(countOf)已在 test/common/dual-extract.js 单源(产物结构 → 事实),
    不在本文件重复实现一份,避免两处计数口径漂移。
*/
