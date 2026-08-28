/**
 * AI 清理：转换前对 Markdown 做保守规整，修复 AI 生成文本常见格式问题。
 * 纯函数、零 IO、可 Node 直测；保留 frontmatter 原样；跳过围栏代码块内部。
 *
 * 设计原则：只做「几乎必然符合用户意图」的归一，绝不改变语义。
 * - 智能引号/破折号归一（代码块内跳过，避免破坏代码）
 * - 列表标记后补空格（-item → - item；-3 等负数字面量不误判）
 * - 去行尾空白 + 折叠 3+ 连续空行为 1 个空行（代码块内跳过）
 */
export interface AiCleanupOptions {
  /** 归一智能引号(''"" → ''"") 与 en dash(– → —)，默认开 */
  normalizeQuotes?: boolean;
  /** 列表标记后补空格，默认开 */
  fixListMarkers?: boolean;
  /** 去行尾空白 + 折叠多余空行，默认开 */
  trimBlankLines?: boolean;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?\n)---\n?/;

export function cleanupMarkdown(md: string, options: AiCleanupOptions = {}): string {
  const opts: Required<AiCleanupOptions> = {
    normalizeQuotes: true,
    fixListMarkers: true,
    trimBlankLines: true,
    ...options,
  };
  let frontmatter = "";
  let body = md;
  const fm = md.match(FRONTMATTER_RE);
  if (fm) {
    frontmatter = fm[0];
    body = md.slice(fm[0].length);
  }
  return frontmatter + cleanupBody(body, opts);
}

function cleanupBody(body: string, opts: Required<AiCleanupOptions>): string {
  // 统一换行
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  let fenceChar = "";
  const out: string[] = [];
  for (const rawLine of lines) {
    const fence = rawLine.match(/^(\s*)(`{3,}|~{3,})[ \t]*.*$/);
    if (fence) {
      const ch = fence[2]!.charAt(0);
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      out.push(rawLine);
      continue;
    }
    if (inFence) {
      out.push(rawLine);
      continue;
    }
    let line = rawLine;
    if (opts.normalizeQuotes) {
      // 用 split/join + \u 转义(字符串字面量,非正则),避免 tsc 将 \u 内联为字面字符后
      // 在正则字符类中形成 [‘-’] 范围导致解析失败
      line = line
        .split("\u2018").join("'")
        .split("\u2019").join("'")
        .split("\u201C").join('"')
        .split("\u201D").join('"')
        .split("\u2013").join("\u2014");
    }
    if (opts.fixListMarkers) {
      const li = line.match(/^(\s*)([-*+](?!\d)|\d+\.)(\S)/);
      if (li) line = line.replace(/^(\s*)([-*+](?!\d)|\d+\.)(\S)/, "$1$2 $3");
    }
    if (opts.trimBlankLines) {
      line = line.replace(/\s+$/, "");
    }
    out.push(line);
  }
  let result = out.join("\n");
  if (opts.trimBlankLines) {
    result = result.replace(/\n{3,}/g, "\n\n");
  }
  return result;
}
