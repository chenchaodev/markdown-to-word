/**
 * docx 代码块语法高亮:hljs 高亮 HTML → TextRun 序列(GitHub Light 色板)。
 * 与 pdf 侧共用 highlight.js/lib/common 单例;色板与 src/core/pdf/template.ts
 * 的 .hljs-* CSS 一致(docx 颜色大写无 #)。
 * 语言不可用 / hljs 抛错 / 解析异常(含文本完整性校验失败)→ 返回 null,
 * 调用方降级为原等宽文本代码块(行为不变,内容不丢失)。
 */
import hljs from "highlight.js/lib/common";
import { TextRun } from "docx";
import { CODE_FONT, CODE_SIZE } from "../theme.js";
// 实体解码单源(B7):统一用 core/utils.ts decodeEntities,删除本模块私有实现。
// 语义差异核实结论:hljs 输出实体域仅为 &lt;/&gt;/&quot;/&#x27;/&amp;(转义 & < > " '),
// utils 版对该域逐形态与原实现结果逐一等价(含 "&amp;lt;" 等二次解码防护场景:
// utils 命名实体先于 &amp; 解码 + 单遍语义一致);utils 版额外覆盖任意数值实体与
// &nbsp;,为覆盖广者,完整性校验(解码拼接 === 原文)行为不变。
import { decodeEntities } from "../../util/utils.js";

/** GitHub Light 色板(docx 颜色大写无 #;与 pdf template.ts .hljs-* 一致) */
const PALETTE: Record<string, { color?: string; italics?: boolean; bold?: boolean }> = {
  keyword: { color: "CF222E" },
  "selector-tag": { color: "CF222E" },
  literal: { color: "CF222E" },
  string: { color: "0A3069" },
  regexp: { color: "0A3069" },
  number: { color: "0550AE" },
  comment: { color: "6E7781", italics: true },
  title: { color: "8250DF" },
  function: { color: "8250DF" },
  attr: { color: "953800" },
  attribute: { color: "953800" },
  variable: { color: "953800" },
  "template-variable": { color: "953800" },
  built_in: { color: "0550AE" },
  meta: { color: "57606A" },
  symbol: { color: "0550AE" },
  bullet: { color: "0550AE" },
  type: { color: "116329" },
  "selector-class": { color: "116329" },
  name: { color: "116329" },
  tag: { color: "116329" },
  property: { color: "0550AE" },
  operator: { color: "CF222E" },
  link: { color: "0A3069" },
  quote: { color: "6E7781" },
  doctag: { color: "6E7781" },
  section: { color: "8250DF" },
  deletion: { color: "CF222E" },
  addition: { color: "116329" },
  emphasis: { italics: true },
  strong: { bold: true },
};

/**
 * 扫描 hljs 高亮 HTML:span 开 / span 闭 / 文本 三态,类栈处理嵌套
 * (hljs 输出基本扁平,但存在 hljs-params 包 hljs-attr/built_in 等嵌套,
 * 取最内层类着色;类名取首个 token,如 "title function_" → title)。
 */
const SPAN_RE = /<span class="hljs-([a-z0-9_ -]+)">|<\/span>|([^<]+)/g;

function makeRun(text: string, cls: string | undefined): TextRun {
  const style = cls ? PALETTE[cls.split(/\s+/)[0]!] : undefined; // split 恒返回至少一个元素,[0] 必存在
  return new TextRun({
    text,
    font: CODE_FONT,
    size: CODE_SIZE,
    ...(style?.color ? { color: style.color } : {}),
    ...(style?.italics ? { italics: true } : {}),
    ...(style?.bold ? { bold: true } : {}),
  });
}

/**
 * 将代码块渲染为带语法高亮的 TextRun 序列;不可高亮时返回 null。
 * 换行 \n 拆行:每行一个 TextRun,行间 TextRun({ text: "", break: 1 }),
 * 与 renderCode 原等宽文本路径的换行结构一致。
 * B4:onFallback 为可选回调,仅在「语言已知但高亮失败」(hljs.highlight 抛错 /
 * 解析异常 / 完整性校验失败)时以语言名调用——无语言/未知语言的正常降级不回调;
 * 调用方(renderCode)经此上报 warn.highlightFallback 警告。纯模块不持有 warnings。
 */
export function highlightCodeRuns(
  code: string,
  lang: string | undefined,
  onFallback?: (lang: string) => void,
): TextRun[] | null {
  if (!lang || !hljs.getLanguage(lang)) return null;
  let html: string;
  try {
    html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    onFallback?.(lang);
    return null;
  }
  try {
    const stack: string[] = [];
    const segments: { text: string; cls: string | undefined }[] = [];
    SPAN_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SPAN_RE.exec(html)) !== null) {
      if (m[1] !== undefined) {
        stack.push(m[1]);
      } else if (m[0] === "</span>") {
        stack.pop();
      } else {
        segments.push({ text: m[2]!, cls: stack.length > 0 ? stack[stack.length - 1] : undefined }); // 文本分支由第三替代([^<]+)命中,组 2 必存在
      }
    }
    // 完整性校验:解码后拼接文本必须等于原文(hljs 保留文本内容),否则降级
    if (segments.map((s) => decodeEntities(s.text)).join("") !== code) {
      onFallback?.(lang);
      return null;
    }
    // 按 \n 拆行:每行一个或多个(文本,类)片段;行间 TextRun({ text: "", break: 1 }),
    // 与 renderCode 原等宽文本路径的换行结构一致(空行保留空 run 占位)
    const linePieces: { text: string; cls: string | undefined }[][] = [[]];
    for (const seg of segments) {
      const parts = decodeEntities(seg.text).split("\n");
      for (const [i, part] of parts.entries()) {
        if (i > 0) linePieces.push([]);
        // 末元素:初始 [[]] 或上一步刚 push 保证存在
        if (part !== "") linePieces[linePieces.length - 1]!.push({ text: part, cls: seg.cls });
      }
    }
    const runs: TextRun[] = [];
    linePieces.forEach((pieces, i) => {
      if (i > 0) runs.push(new TextRun({ text: "", break: 1 }));
      if (pieces.length === 0) {
        runs.push(makeRun("", undefined));
      } else {
        for (const p of pieces) runs.push(makeRun(p.text, p.cls));
      }
    });
    return runs;
  } catch {
    onFallback?.(lang);
    return null;
  }
}