// @ts-check
/**
 * 内联格式白名单单一实现测试:
 * - isAllowedInlineHtml 判定规则直测(合法/非法矩阵);
 * - ALLOWED_INLINE_TAGS 集合完整性快照。
 * 双格式端到端一致性由 raw-html.test.js 覆盖,此段只验证共享实现本身。
 */
import {
  ALLOWED_INLINE_TAGS,
  inspectHtmlUsage,
  isAllowedInlineHtml,
  parseAllowedContainer,
  serializeAllowedContainer,
  stripUnsupportedHtml,
} from "../../dist/core/markdown/html-whitelist.js";
import { createCaseSuite } from "../harness/case.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  // 标注为元组数组(非默认的 (string)[]):把「每条必是 [用例名, 输入] 二元组」写进类型,
  // 否则 noUncheckedIndexedAccess 下解构出 `string | undefined`
  /** @type {Array<[string, string]>} */
  const valid = [
    ["纯文本", "普通文本"],
    ["空串", ""],
    ["纯空白", "   "],
    ["单标签", "<strong>粗体</strong>"],
    ["嵌套", "<strong>粗<em>斜</em></strong>"],
    ["br 空标签", "a<br>b"],
    ["br 自闭合", "a<br/>b"],
    ["br 自闭合带空格", "a<br />b"],
    ["开标签尾随空格", "<strong >粗体</strong>"],
    ["多段独立标签", "<i>a</i><b>b</b>"],
    ["大小写", "<STRONG>粗</STRONG>"],
    ["混合文本", "<code>x()</code> 与 x<sub>1</sub> 和 y<sup>2</sup>"],
  ];
  const suite = createCaseSuite();
  // 矩阵逐行一个 case:label 是失败定位用的稳定标识,直接作 case 名
  for (const [label, input] of valid) {
    await suite.case(`白名单判定:${label} 应合法`, () => {
      if (!isAllowedInlineHtml(input)) {
        throw new Error(`白名单判定失败:${label} 应合法(${JSON.stringify(input)})`);
      }
    });
  }

  /** @type {Array<[string, string]>} */
  const invalid = [
    ["带属性", '<strong class="x">a</strong>'],
    ["未闭合", "<strong>a"],
    ["无开标签闭", "</strong>"],
    ["错配嵌套", "<strong><em></strong></em>"],
    ["非白名单标签", "<div>a</div>"],
    ["脚本标签", "<script>alert(1)</script>"],
    ["文本段含 <", "a < b"],
    ["br 闭标签", "</br>"],
    ["闭标签带属性", "</strong class='x'>"],
    ["空开标签", "<>a</>"],
    ["非空标签自闭合(仍非法)", "<em/>a"],
    ["自闭合带属性伪装", '<img src="x" />'],
  ];
  for (const [label, input] of invalid) {
    await suite.case(`白名单判定:${label} 应非法`, () => {
      if (isAllowedInlineHtml(input)) {
        throw new Error(`白名单判定失败:${label} 应非法(${JSON.stringify(input)})`);
      }
    });
  }

  const expected = new Set([
    "strong", "b", "em", "i", "u", "s", "del", "code", "kbd", "sub", "sup", "mark", "br", "span",
  ]);
  // 集合完整性合成一个 case:新增标签忘了登记时,「多出来的那个」与「期望里缺的项」是同一处改动
  await suite.case("ALLOWED_INLINE_TAGS 集合完整性(数量相符且不漏任何期望标签)", () => {
    if (ALLOWED_INLINE_TAGS.size !== expected.size) {
      throw new Error(`ALLOWED_INLINE_TAGS 数量不符:${ALLOWED_INLINE_TAGS.size} != ${expected.size}`);
    }
    for (const tag of expected) {
      if (!ALLOWED_INLINE_TAGS.has(tag)) throw new Error(`ALLOWED_INLINE_TAGS 缺少 ${tag}`);
    }
  });

  console.log(`[ok] html-whitelist:判定矩阵 ${valid.length} 合法 + ${invalid.length} 非法 + 集合完整性 全部通过`);

  /* ---- 对齐容器:div/p + align ---- */

  /** @type {Array<[string, string, string | undefined]>} */
  const containers = [
    ["div 居中", '<div align="center">居中</div>', "center"],
    ["p 右对齐", '<p align="right">右</p>', "right"],
    ["无 align", "<div>无属性</div>", undefined],
    ["align 大小写不敏感", '<div align="CENTER">大写</div>', "center"],
    ["容器内含行内白名单与 br", '<div align="center"><strong>粗</strong><br>次行</div>', "center"],
  ];
  for (const [label, input, expectedAlign] of containers) {
    await suite.case(`容器解析:${label}`, () => {
      const container = parseAllowedContainer(input);
      if (container === null) throw new Error(`容器解析失败:${label}`);
      if (container.align !== expectedAlign) {
        throw new Error(`容器 align 不符:${label} 期望 ${String(expectedAlign)} 实得 ${String(container.align)}`);
      }
    });
  }

  /** @type {Array<[string, string]>} */
  const badContainers = [
    ["align 域外值", '<div align="justify">x</div>'],
    ["未知属性", '<div class="x">x</div>'],
    ["行内标签不是容器", "<span>x</span>"],
    ["嵌套容器", "<div><div>x</div></div>"],
    ["容器内行内标签带属性", '<div><strong class="x">x</strong></div>'],
    ["未闭合", "<div>x"],
    ["根外有文本", '前缀<div align="center">x</div>'],
    ["两个根", "<div>a</div><p>b</p>"],
  ];
  for (const [label, input] of badContainers) {
    await suite.case(`容器解析:${label} 应拒绝`, () => {
      if (parseAllowedContainer(input) !== null) throw new Error(`容器解析失败:${label} 应拒绝`);
    });
  }

  await suite.case("容器序列化只生成枚举 align 的 style", () => {
    const container = parseAllowedContainer('<div align="center">a<strong>b</strong></div>');
    if (container === null) throw new Error("容器解析失败");
    const html = serializeAllowedContainer(container);
    if (html !== '<div style="text-align:center">a<strong>b</strong></div>') {
      throw new Error(`序列化结果不符:${html}`);
    }
  });

  /* ---- 白名单外标签:剥壳留文本 ---- */

  /** @type {Array<[string, string, string]>} */
  const stripped = [
    ["块级未知属性剥壳", '<div class="x"><strong>正文</strong></div>', "正文"],
    ["脚本整段丢弃", "<script>alert(1)</script>后文", "后文"],
    ["注释丢弃", "<!-- 注释 -->正文", "正文"],
    ["br 保留换行", "a<br>b", "a\nb"],
    ["未知标签嵌套", "<section><em>斜</em>体</section>", "斜体"],
  ];
  for (const [label, input, expected] of stripped) {
    await suite.case(`降级剥壳:${label}`, () => {
      const actual = stripUnsupportedHtml(input);
      if (actual !== expected) {
        throw new Error(`剥壳结果不符:${label} 期望 ${JSON.stringify(expected)} 实得 ${JSON.stringify(actual)}`);
      }
    });
  }

  /* ---- 预检事实:标签 + 属性两级 ---- */

  await suite.case("预检事实:未知标签与被忽略属性分级", () => {
    const usage = inspectHtmlUsage('<div class="x" align="center">a</div><foo>b</foo>');
    if (!usage.unknownTags.has("foo")) throw new Error("未知标签 foo 未收集");
    if (usage.unknownTags.has("div")) throw new Error("div 不应记为未知标签");
    const ignored = usage.ignoredAttributes.map((item) => `${item.tag}.${item.attr}`);
    if (!ignored.includes("div.class")) throw new Error("div.class 未记为被忽略属性");
    if (ignored.includes("div.align")) throw new Error("合法 align 不应记为被忽略属性");
  });

  await suite.case("预检事实:align 域外值记为被忽略属性", () => {
    const usage = inspectHtmlUsage('<p align="justify">a</p>');
    const ignored = usage.ignoredAttributes.map((item) => `${item.tag}.${item.attr}`);
    if (!ignored.includes("p.align")) throw new Error("域外 align 未记为被忽略属性");
  });

  return { cases: suite.results };
}
