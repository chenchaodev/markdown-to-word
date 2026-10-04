// @ts-check
/**
 * 转换预检核心逻辑断言:本地图片可信边界/缺失 / 悬空交叉引用 / 未标注语言代码块;
 * 「AI 静默丢内容」四类(不被支持的公式定界符 / 白名单外 HTML 标签 / `$` 不配对 /
 * 形似表格却未解析成表);文案三语言齐备。
 * 注入 exists 与 realpathSync 模拟文件系统及链接越界,不依赖真实磁盘与 Electron。
 * 单源:dist/core/pipeline/precheck.js(precheckMarkdown)。
 */
import path from "node:path";
import { precheckMarkdown } from "../../dist/core/pipeline/precheck.js";
import { DICT } from "../../dist/core/i18n/index.js";
import { formatWarning, setLanguage } from "../../dist/core/i18n/index.js";

const existsAll = () => true;
const existsNone = () => false;
const realpathIdentity = (/** @type {string} */ candidate) => candidate;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // 1) 干净输入返回空数组
  const clean = precheckMarkdown(
    "# 标题\n\n正文,见图 ![x](./ok.png)。\n\n```js\ncode\n```\n\n章节 {#sec:a}\n\n见 [章节](#sec:a)。",
    "/tmp",
    { exists: existsAll, realpathSync: realpathIdentity },
  );
  if (clean.length !== 0) {
    throw new Error(`precheck 干净输入应返回 [],实际:${JSON.stringify(clean)}`);
  }
  console.log("[ok] precheck:干净输入返回空数组");

  // 2) 缺失本地图片 → imageNotFoundWarning
  const img = precheckMarkdown("![图](./missing.png)", "/tmp", {
    exists: existsNone,
    realpathSync: realpathIdentity,
  });
  if (!img.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("应检测缺失本地图片");
  }
  console.log("[ok] precheck:缺失本地图片被检出");

  // 3) 远程图片不报缺失
  const remote = precheckMarkdown("![图](https://example.com/a.png)", "/tmp", {
    exists: existsNone,
    realpathSync: realpathIdentity,
  });
  if (remote.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("远程图片不应报缺失");
  }
  console.log("[ok] precheck:远程图片跳过检查");

  // 3b) 原始 src 边界先于文件存在性检查:绝对路径与 UNC 不得因 exists=true 放行
  const boundaryRoot = path.resolve(path.sep, "docs", "source");
  const absoluteOutside = path.resolve(path.sep, "outside", "secret.png").replaceAll("\\", "/");
  let boundaryExistsCalls = 0;
  const boundaryDeps = {
    exists: () => {
      boundaryExistsCalls += 1;
      return true;
    },
    realpathSync: realpathIdentity,
  };
  const absoluteWarning = precheckMarkdown(`![图](${absoluteOutside})`, boundaryRoot, boundaryDeps);
  const uncWarning = precheckMarkdown("![图](//server/share/image.png)", boundaryRoot, boundaryDeps);
  if (!absoluteWarning.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("绝对本地图片路径应被拒绝");
  }
  if (!uncWarning.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("UNC 本地图片路径应被拒绝");
  }
  if (boundaryExistsCalls !== 0) {
    throw new Error(`原始 src 越界时不应执行文件存在性检查,实际 ${boundaryExistsCalls} 次`);
  }

  // 3c) .. 仅在解析后仍位于显式可信根内时允许
  const trustedRoot = path.resolve(path.sep, "docs", "trusted-assets");
  const untrustedTraversal = precheckMarkdown("![图](../trusted-assets/pic.png)", boundaryRoot, {
    exists: existsAll,
    realpathSync: realpathIdentity,
  });
  if (!untrustedTraversal.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("未显式授予可信根时,父目录越界路径应拒绝");
  }
  const trustedTraversal = precheckMarkdown("![图](../trusted-assets/pic.png)", boundaryRoot, {
    exists: existsAll,
    trustedRoots: [trustedRoot],
    realpathSync: realpathIdentity,
  });
  if (trustedTraversal.some((w) => w.key === "warn.imageNotFound")) {
    throw new Error("显式可信根内的父目录相对路径应允许");
  }

  // 3d) 词法路径在根内,但 realpath 模拟 symlink/junction 指向根外 → 拒绝
  const linkedCandidate = path.join(boundaryRoot, "assets", "pic.png");
  const canonicalOutside = path.resolve(path.sep, "outside", "linked.png");
  let linkedExistsCalled = false;
  const linkedWarning = precheckMarkdown("![图](./assets/pic.png)", boundaryRoot, {
    exists: () => {
      linkedExistsCalled = true;
      return true;
    },
    realpathSync: (/** @type {string} */ candidate) => (candidate === linkedCandidate ? canonicalOutside : candidate),
  });
  if (!linkedWarning.some((w) => w.key === "warn.imageNotFound") || linkedExistsCalled) {
    throw new Error("realpath 后的 symlink/junction 越界路径应在 exists 前拒绝");
  }
  console.log("[ok] precheck:本地图片绝对/UNC/越界/可信根/链接规范路径边界断言通过");

  // 4) 悬空交叉引用(链接节点)#sec / #eq → crossRefNotFoundWarning
  const dangling = precheckMarkdown("见 [章节](#sec:ghost) 与 [公式](#eq:x)。", "/tmp", {
    exists: existsAll,
  });
  if (!dangling.some((w) => w.key === "warn.crossRefNotFound")) {
    throw new Error("应检测悬空交叉引用");
  }
  console.log("[ok] precheck:悬空交叉引用被检出");

  // 5) 已定义标签不报悬空
  const defined = precheckMarkdown("章节 {#sec:a}\n\n见 [章节](#sec:a)。", "/tmp", {
    exists: existsAll,
  });
  if (defined.some((w) => w.key === "warn.crossRefNotFound")) {
    throw new Error("已定义标签不应报悬空");
  }
  console.log("[ok] precheck:已定义标签不报悬空");

  // 6) 未标注语言代码块 → unlabeledCodeBlockWarning
  const code = precheckMarkdown("```\nplain\n```", "/tmp", { exists: existsAll });
  if (!code.some((w) => w.key === "warn.unlabeledCodeBlock")) {
    throw new Error("应检测未标注语言代码块");
  }
  console.log("[ok] precheck:未标注语言代码块被检出");

  // 7) 标注语言代码块不报
  const coded = precheckMarkdown("```js\nx\n```", "/tmp", { exists: existsAll });
  if (coded.some((w) => w.key === "warn.unlabeledCodeBlock")) {
    throw new Error("已标注语言不应报");
  }
  console.log("[ok] precheck:已标注语言代码块不报");

  /* ================= AI 静默丢内容四类 =================
   * 零误报优先于覆盖率:每类都成对断言(正向必报 / 反向必不报),
   * 反向清单覆盖 i18n 与 PLAN 点名的全部「不得触发」写法。 */

  /** 四类新检查的 key(既有三类不在内):断言只筛这四个,便于定位 */
  const SILENT_LOSS_KEYS = new Set([
    "warn.unsupportedMathDelimiter",
    "warn.htmlTagNotAllowed",
    "warn.unpairedMathDelimiter",
    "warn.unclosedCodeFence",
    "warn.tableLikeNotParsed",
  ]);
  /**
   * 预检一段 markdown,只取四类新检查的告警 key(保持出现顺序)。
   * @param {string} md markdown 源码
   * @returns {any[]} 命中的 keyed 告警
   */
  const silentLoss = (md) =>
    precheckMarkdown(md, "/tmp", { exists: existsAll, realpathSync: realpathIdentity }).filter(
      (w) => typeof w === "object" && SILENT_LOSS_KEYS.has(w.key),
    );
  /**
   * 断言一段 markdown 的四类新检查告警恰为 expected(逐条比对;反向用例传 [])。
   * @param {string} label 用例名(进失败消息)
   * @param {string} md markdown 源码
   * @param {string[]} expected 期望的告警 key 序列
   */
  const expectSilentLoss = (label, md, expected) => {
    const actual = silentLoss(md).map((w) => w.key);
    if (actual.length !== expected.length || expected.some((key, i) => actual[i] !== key)) {
      throw new Error(`${label}:期望 [${expected.join(",")}],实际 [${actual.join(",")}]`);
    }
    console.log(`[ok] precheck:${label}`);
  };

  // 8) ① 不被支持的公式定界符 \( \) \[ \](本工具只认 $…$ / $$…$$)
  expectSilentLoss("①正向:行内 \\(x\\)", "行内 \\(x\\) 公式", ["warn.unsupportedMathDelimiter"]);
  expectSilentLoss("①正向:独立 \\[ y \\]", "独立 \\[ y \\] 公式", ["warn.unsupportedMathDelimiter"]);
  expectSilentLoss("①反向:已转义 \\\\(x\\\\)", "已转义 \\\\(x\\\\) 写法", []);
  expectSilentLoss("①反向:行内代码内", "`\\(x\\)` 与 `\\[y\\]`", []);
  expectSilentLoss("①反向:围栏内", "```\n\\(x\\) 与 \\[y\\]\n```", []);
  expectSilentLoss("①反向:正常公式", "正常 $x^2$ 与 $$a+b$$", []);
  expectSilentLoss("①反向:公式节点内反斜杠", "$\\left(x\\right)$ 与 $f\\left(y\\right)$", []);
  expectSilentLoss("①反向:孤立闭侧(Windows 路径形态)", "路径 C:\\Users\\doc\\) 结尾", []);
  expectSilentLoss("①反向:中文括注形态", "见 \\(草稿\\) 目录", []);
  expectSilentLoss("①反向:跨行不成对", "\\(x\ny\\)", []);

  // 9) ② 白名单外的块级/行内 HTML 标签(报出标签名本身)
  expectSilentLoss("②正向:块级 table", "<table><tr><td>x</td></tr></table>\n\n段落", [
    "warn.htmlTagNotAllowed",
    "warn.htmlTagNotAllowed",
    "warn.htmlTagNotAllowed",
  ]);
  expectSilentLoss("②正向:段落内 div", "段落里的 <div>块</div> 标签", ["warn.htmlTagNotAllowed"]);
  const tagWarning = silentLoss("<table><tr><td>x</td></tr></table>")[0];
  if (tagWarning.params.tag !== "table") {
    throw new Error(`②应报出具体标签名,实际 ${JSON.stringify(tagWarning.params)}`);
  }
  // 白名单内 14 个行内标签逐个不报
  expectSilentLoss(
    "②反向:白名单 14 个行内标签",
    "a <strong>b</strong> <em>c</em> <i>d</i> <u>e</u> <s>f</s> <del>g</del> <code>h</code>"
      + " <kbd>i</kbd> <sub>j</sub> <sup>k</sup> <mark>l</mark> <br> <span>m</span> <b>n</b>",
    [],
  );
  expectSilentLoss("②反向:白名单标签带属性", '这是 <strong class="x">粗</strong> 与 <span style="c">红</span>', []);
  expectSilentLoss("②反向:HTML 注释", "<!-- page-break -->\n\n段落", []);
  expectSilentLoss("②反向:围栏内", "```html\n<table><tr><td>x</td></tr></table>\n```", []);
  expectSilentLoss("②反向:行内代码内", "`<table>` 与 `<div>` 不报", []);

  // 10) ③ `$` 不配对
  expectSilentLoss("③正向:行内未闭合", "公式 $x^2 未闭合", ["warn.unpairedMathDelimiter"]);
  expectSilentLoss("③正向:独立未闭合", "公式 $$x+1 未闭合", ["warn.unpairedMathDelimiter"]);
  expectSilentLoss("③正向:两段各一处", "甲 $x^2 未闭合\n\n乙 $y_1 未闭合", [
    "warn.unpairedMathDelimiter",
    "warn.unpairedMathDelimiter",
  ]);
  expectSilentLoss("③反向:正常行内与独立公式", "正常 $x^2$ 与 $$a+b$$", []);
  expectSilentLoss("③反向:价格 $5 与 50$", "价格 $5 与 50$", []);
  expectSilentLoss("③反向:单个货币 $5", "花 $5 美元", []);
  expectSilentLoss("③反向:两个货币金额", "预算 $100 与 $200", []);
  expectSilentLoss("③反向:已转义货币", "价格 \\$5 与 \\$50", []);
  expectSilentLoss("③反向:行内代码内", "命令 `$HOME` 与 `$x`", []);
  expectSilentLoss("③反向:围栏内", "```bash\necho $FOO $BAR\n```", []);
  expectSilentLoss("③反向:散文货币(无 TeX 信号)", "单价$USD 起,预算$EUR", []);
  expectSilentLoss("③反向:同段两个候选配成对", "见 $A 与 $B", []);
  expectSilentLoss("③反向:裸 $ 符号", "价格 $ 与符号 $ 单独", []);

  // 10b) ③ 的另一半:代码围栏未闭合(CommonMark 配对规则的行级扫描)
  /**
   * 断言一段 markdown 的 ③ 围栏告警起始行号恰为 expected(空数组 = 不报)。
   * @param {string} label 用例名(进失败消息)
   * @param {string} md markdown 源码
   * @param {number[]} expected 期望的起始行号(1-based)
   */
  const expectFenceLines = (label, md, expected) => {
    const actual = silentLoss(md)
      .filter((w) => w.key === "warn.unclosedCodeFence")
      .map((w) => w.params.lineNo);
    if (actual.length !== expected.length || expected.some((lineNo, i) => actual[i] !== lineNo)) {
      throw new Error(`${label}:期望行号 [${expected.join(",")}],实际 [${actual.join(",")}]`);
    }
    console.log(`[ok] precheck:${label}`);
  };
  // 正向:未闭合围栏(remark 会把后文吞成代码块,是最伤的一类)
  expectFenceLines("③围栏正向:缺陷原样(带 info 串)", "正常段落\n\n```js\nconst a = 1;\n", [3]);
  expectSilentLoss(
    "③围栏正向:缺陷原样只出围栏一条",
    "正常段落\n\n```js\nconst a = 1;\n",
    ["warn.unclosedCodeFence"],
  );
  expectFenceLines("③围栏正向:不带 info 串", "```\nplain\n", [1]);
  expectFenceLines("③围栏正向:~~~ 未闭合", "~~~python\ncode\n", [1]);
  expectFenceLines("③围栏正向:长围栏 4 反引号", "````js\ncode\n", [1]);
  expectFenceLines("③围栏正向:第二个未闭合只报第二个", "```js\na\n```\n\n```py\nb\n", [5]);
  expectFenceLines("③围栏正向:引用块内未闭合", "> 引用\n> ```js\n> code\n", [2]);
  // 反向:配对规则
  expectFenceLines("③围栏反向:成对反引号围栏", "```js\ncode\n```\n", []);
  expectFenceLines("③围栏反向:成对波浪号围栏", "~~~python\ncode\n~~~\n", []);
  expectFenceLines("③围栏反向:成对围栏带尾随空白", "```js\ncode\n```   \n", []);
  expectFenceLines("③围栏反向:引用块内成对围栏", "> ```js\n> code\n> ```\n", []);
  expectFenceLines("③围栏反向:长度不足的闭合行(仍报)", "```js\ncode\n``\n", [1]);
  expectFenceLines("③围栏反向:不同字符互闭合(仍报)", "```js\ncode\n~~~\n", [1]);
  expectFenceLines("③围栏反向:反向不同字符(仍报)", "~~~\ncode\n```\n", [1]);
  expectFenceLines("③围栏反向:缩进 4 空格的缩进代码块", "正文\n\n    ```\n    code\n    ```\n", []);
  expectFenceLines("③围栏反向:info string 含反引号", "正文\n\n```js `code`\n更多\n\n更多\n", []);
  expectFenceLines("③围栏反向:围栏内的 ``` 不开新围栏", "````\n```\ncode\n````\n", []);
  expectFenceLines("③围栏反向:HTML 块内的 ```(块内容非围栏)", "<div>\n```js\ncode\n</div>\n", []);
  // 围栏内的 |、<table>、$、\( 仍被掩码,不进其它三类
  expectSilentLoss(
    "③围栏反向:围栏内素材不进其它三类",
    "```js\na | b | c\n<table><tr><td>x</td></tr></table>\necho $FOO\n\\(x\\)\n",
    ["warn.unclosedCodeFence"],
  );
  expectSilentLoss(
    "③围栏反向:闭合围栏后正常表格照报",
    "```js\ncode\n```\n\n| 列1 | 列2 |\n| 数据1 | 数据2 |\n",
    ["warn.tableLikeNotParsed"],
  );
  // 已知放过:围栏未闭合但所在块(引用/列表项)先于文末结束 —— 后文照常排版,不算整段消失
  expectFenceLines("③围栏已知放过:引用块先结束", "> 引用\n> ```js\n> code\n\n正常段落\n", []);
  expectFenceLines("③围栏已知放过:列表项先结束", "- 项目\n  ```js\n  code\n\n正常段落\n", []);

  // 11) ④ 形似表格却未解析成表(连续候选行 + 行首/行尾紧邻 | + 段内竖线数齐)
  expectSilentLoss("④正向:缺分隔行的两列表", "| 列1 | 列2 |\n| 数据1 | 数据2 |", [
    "warn.tableLikeNotParsed",
  ]);
  expectSilentLoss("④正向:真表格后跟伪表格", "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n| x | y |\n| 3 | 4 |", [
    "warn.tableLikeNotParsed",
  ]);
  const tableWarning = silentLoss("| 列1 | 列2 |\n| 数据1 | 数据2 |")[0];
  if (tableWarning.params.lineText !== "| 列1 | 列2 |") {
    throw new Error(`④应回显首行内容(params.lineText),实际 ${JSON.stringify(tableWarning.params)}`);
  }
  expectSilentLoss("④反向:正常 gfm 表格", "| a | b |\n| --- | --- |\n| 1 | 2 |", []);
  expectSilentLoss("④反向:无首尾竖线的真表格", "a | b\n--- | ---\n1 | 2", []);
  expectSilentLoss("④反向:引用块内真表格", "> | a | b |\n> | --- | --- |\n> | 1 | 2 |", []);
  expectSilentLoss("④反向:围栏内", "```\n| a | b |\n| --- | --- |\n```", []);
  expectSilentLoss("④反向:行内代码内", "`| a | b |` 与 `| x | y |`", []);
  expectSilentLoss("④反向:单行裸 |", "这是 a | b 的普通句子", []);
  expectSilentLoss("④反向:每行一个 | 的散文", "注意 a | b\n以及 c | d", []);
  expectSilentLoss("④反向:单行三个 |", "排序键 a | b | c", []);

  // 11b) ④ 的两条收紧(缺陷复算:散文并列比较句被当伪表格,修复后不再命中):
  //   边框紧邻(行首或行尾挨 |)+ 段内竖线数齐。逐条用回显行断言(不只断条数)。
  /**
   * 断言一段 markdown 的 ④ 告警回显行内容恰为 expectedLines(空数组 = 不报)。
   * @param {string} label 用例名(进失败消息)
   * @param {string} md markdown 源码
   * @param {string[]} expectedLines 期望回显的首行内容序列(params.lineText)
   */
  const expectTableLikeLines = (label, md, expectedLines) => {
    const actual = silentLoss(md)
      .filter((w) => w.key === "warn.tableLikeNotParsed")
      .map((w) => w.params.lineText);
    if (actual.length !== expectedLines.length || expectedLines.some((line, i) => actual[i] !== line)) {
      throw new Error(`${label}:期望回显 [${expectedLines.join(" / ")}],实际 [${actual.join(" / ")}]`);
    }
    console.log(`[ok] precheck:${label}`);
  };
  // 收紧后必须仍然命中的正向用例
  expectTableLikeLines("④收紧后正向:只有行尾带竖线的两行", "列1 | 列2 |\n数据1 | 数据2 |", ["列1 | 列2 |"]);
  expectTableLikeLines(
    "④收紧后正向:部分缺分隔行的混排",
    "| 列1 | 列2 |\n| --- |\n| 数据1 |",
    ["| 列1 | 列2 |"],
  );
  // 收紧针对的散文误报:两端都不挨竖线 / 列数不齐
  expectTableLikeLines(
    "④收紧后反向:散文并列比较句(缺陷原样)",
    "本章讨论 A | B | C 三者\n以及 D | E | F 三者",
    [],
  );
  expectTableLikeLines("④收紧后反向:两端都不挨竖线", "A | B | C 三者\nD | E | F 三者", []);
  expectTableLikeLines("④收紧后反向:列数不齐", "A | B | C 三者\nD | E", []);
  // 散文段与真伪表格混排:只报真伪表格那一段,回显行是伪表格首行
  expectTableLikeLines(
    "④收紧后反向:散文与伪表格混排(比较句)",
    "本章讨论 A | B | C 三者\n以及 D | E | F 三者\n\n| 列1 | 列2 |\n| 数据1 | 数据2 |",
    ["| 列1 | 列2 |"],
  );
  expectTableLikeLines(
    "④收紧后反向:散文与伪表格混排(两端不挨)",
    "A | B | C 三者\nD | E | F 三者\n\n| x | y |\n| 3 | 4 |",
    ["| x | y |"],
  );
  expectTableLikeLines(
    "④收紧后反向:散文与伪表格混排(列数不齐)",
    "A | B | C 三者\nD | E\n\n| x | y |\n| 3 | 4 |",
    ["| x | y |"],
  );
  // 已知漏报(收紧的代价,登记在此防无声漂移):两端无竖线的两列伪表格 / 缺格的参差表
  expectTableLikeLines("④收紧后已知漏报:两端无竖线的两列表", "列1 | 列2\n数据1 | 数据2", []);
  expectTableLikeLines("④收紧后已知漏报:缺格的参差表", "| 列1 | 列2 |\n| 数据1 |\n| 数据2 | 数据2 |", []);

  // 12) 四类共存:告警顺序即 ①②③④,且不吞掉既有三类检查
  const combined = precheckMarkdown(
    "![缺图](./missing.png)\n\n行内 \\(x\\) 与 <table><tr><td>c</td></tr></table>\n\n"
      + "公式 $x^2 未闭合\n\n| 列1 | 列2 |\n| 数据1 | 数据2 |",
    "/tmp",
    { exists: existsNone, realpathSync: realpathIdentity },
  );
  const combinedKeys = combined.map((w) => w.key);
  const expectedCombined = [
    "warn.imageNotFound",
    "warn.unsupportedMathDelimiter",
    "warn.htmlTagNotAllowed",
    "warn.htmlTagNotAllowed",
    "warn.htmlTagNotAllowed",
    "warn.unpairedMathDelimiter",
    "warn.tableLikeNotParsed",
  ];
  if (
    combinedKeys.length !== expectedCombined.length
    || expectedCombined.some((key, i) => combinedKeys[i] !== key)
  ) {
    throw new Error(`四类共存顺序断言失败:期望 [${expectedCombined.join(",")}],实际 [${combinedKeys.join(",")}]`);
  }
  console.log("[ok] precheck:四类共存顺序 ①②③④ 且不吞既有检查");

  // 13) 四类文案三语言齐备,且 en/ja 不是中文原文(回退链不得静默吞掉译文)
  // 字典按语言码动态索引(键是字面量联合),故先取 Record 视图
  const DICT_VIEW = /** @type {Record<string, Record<string, string>>} */ (/** @type {unknown} */ (DICT));
  const ZH_DICT = /** @type {Record<string, string>} */ (DICT_VIEW.zh);
  for (const key of SILENT_LOSS_KEYS) {
    for (const code of ["zh", "en", "ja"]) {
      const text = DICT_VIEW[code]?.[key];
      if (typeof text !== "string" || text.trim() === "") {
        throw new Error(`${code}.${key} 缺文案`);
      }
      if (code !== "zh" && text === ZH_DICT[key]) {
        throw new Error(`${code}.${key} 沿用了中文原文`);
      }
    }
  }
  const rendered = formatWarning({
    key: "warn.htmlTagNotAllowed",
    params: { tag: "table" },
    fallback: "兜底",
  });
  if (!rendered.includes("<table>")) {
    throw new Error(`标签名未插值进文案: ${rendered}`);
  }
  console.log("[ok] precheck:四类文案三语言齐备 + 标签名插值上屏");

  /* ================= 合并阻断信号 blocksMerge(用户 2026-09-27 定) ================= */
  const runPrecheck = (/** @type {string} */ md) =>
    precheckMarkdown(md, "/tmp", { exists: existsAll, realpathSync: realpathIdentity });

  // 14) 只有未闭合围栏带 blocksMerge === true(合并时它会跨越文件边界吞掉后续文件)
  const fenceSignal = silentLoss("正常段落\n\n```js\nconst a = 1;\n")[0];
  if (fenceSignal === undefined || fenceSignal.blocksMerge !== true) {
    throw new Error(`未闭合围栏告警应带 blocksMerge === true,实际 ${JSON.stringify(fenceSignal)}`);
  }
  // 其余四类 + 既有三类一律不带:用 `in` 判存在性(只断 undefined 会漏掉 blocksMerge:false)
  /** @type {Array<[string, string]>} */
  const noSignalCases = [
    ["①反斜杠定界符", "行内 \\(x\\) 公式"],
    ["②白名单外 HTML", "段落里的 <div>块</div> 标签"],
    ["③$ 不配对", "公式 $x^2 未闭合"],
    ["④伪表格", "| 列1 | 列2 |\n| 数据1 | 数据2 |"],
    ["既有三类", "![图](./missing.png)\n\n```\nplain\n```\n\n见 [章节](#sec:ghost)。"],
  ];
  for (const [label, md] of noSignalCases) {
    const warnings = runPrecheck(md);
    if (warnings.length === 0) {
      throw new Error(`${label} 用例本身没有产出告警,断言失去意义`);
    }
    for (const w of warnings) {
      if (typeof w === "object" && "blocksMerge" in w) {
        throw new Error(`${label} 告警不应带 blocksMerge:${JSON.stringify(w)}`);
      }
    }
  }
  console.log("[ok] precheck:blocksMerge 只在未闭合围栏上为 true,其余七类均无该键");

  // 15) 合并阻断文案键三语言齐备 + 占位符集合一致(file/lineNo)+ 后果说清「代码块」
  const BLOCK_KEY = "convert.merge.blockedUnclosedFence";
  const placeholders = (/** @type {unknown} */ s) =>
    [...String(s).matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const expectPh = "file,lineNo";
  for (const code of ["zh", "en", "ja"]) {
    const text = DICT_VIEW[code]?.[BLOCK_KEY];
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(`${code}.${BLOCK_KEY} 缺文案`);
    }
    if (placeholders(text) !== expectPh) {
      throw new Error(`${code}.${BLOCK_KEY} 占位符应为 [${expectPh}],实际 [${placeholders(text)}]`);
    }
    if (code !== "zh" && text === ZH_DICT[BLOCK_KEY]) {
      throw new Error(`${code}.${BLOCK_KEY} 沿用了中文原文`);
    }
  }
  // 三语言都要点出「会变成一个代码块」这个后果(逐语言各自的说法,不做跨语言同词断言)
  /** @type {Array<[string, string]>} */
  const BLOCK_FACT = [["zh", "代码块"], ["en", "code block"], ["ja", "コードブロック"]];
  for (const [code, mustMention] of BLOCK_FACT) {
    if (!(DICT_VIEW[code]?.[BLOCK_KEY] ?? "").includes(mustMention)) {
      throw new Error(`${code}.${BLOCK_KEY} 未点出「变成代码块」的后果`);
    }
  }
  console.log("[ok] precheck:合并阻断文案键三语言齐备 + 占位符 [file,lineNo] 一致 + 后果说清");

  // 16) 未闭合围栏文案:插值正确,且不得再出现「内容不显示」这类与事实相反的说法
  //     (旧文案写的是「不显示」,用户按那句理解成「该消失却还在」——GUI 实测反馈)
  const fenceWarning = runPrecheck("正常段落\n\n```js\nconst a = 1;\n").find(
    (w) => typeof w === "object" && w.key === "warn.unclosedCodeFence",
  );
  /** @type {Array<[string, string]>} */
  const fenceTexts = [];
  // 各语言「行号 + 3」的说法(验证 3 被插值在行号位上,而非文中随便出现个数字)
  /** @type {Array<[string, string]>} */
  const LINE_NO_ANCHOR = [["zh", "第 3 行"], ["en", "line 3"], ["ja", "3 行目"]];
  for (const [code] of LINE_NO_ANCHOR) {
    setLanguage(/** @type {"zh" | "en" | "ja"} */ (code));
    fenceTexts.push([code, formatWarning(fenceWarning)]);
  }
  setLanguage("zh"); // 段内共享语言状态,先复位再断言,避免失败时污染后续段
  // 逐语言「与事实相反」的说法:内容照样显示,只是变成代码块
  /** @type {Array<[string, string]>} */
  const BANNED = [["zh", "不显示"], ["en", "will not appear"], ["ja", "表示されません"]];
  for (const [code, banned] of BANNED) {
    const text = fenceTexts.find(([c]) => c === code)?.[1] ?? "";
    if (text.includes(banned)) {
      throw new Error(`${code} 围栏文案仍含与事实相反的说法「${banned}」:${text}`);
    }
  }
  for (const [code, text] of fenceTexts) {
    if (text.includes("${")) {
      throw new Error(`${code} 围栏文案未完成插值:${text}`);
    }
    // 行号须落在「行号该在的位置」上,而不只是文中出现个 3(逐语言各自的行号说法)
    const anchor = LINE_NO_ANCHOR.find(([c]) => c === code)?.[1] ?? "";
    if (!text.includes(anchor)) {
      throw new Error(`${code} 围栏文案未把 3 插值成行号(${anchor}):${text}`);
    }
  }
  console.log("[ok] precheck:围栏文案三语言插值正确 + 无「不显示」类反事实措辞");
}
