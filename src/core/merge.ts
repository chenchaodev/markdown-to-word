/**
 * 多文件合并(main 侧 convert:merge 的纯逻辑层;无 IO,可单测)。
 * 规则(设计评审定稿):
 * - 首文件的 frontmatter 保留原样;后续文件的 frontmatter 剥离(仅取 body,metadata 丢弃)
 * - 每文件图片相对路径 → 绝对路径(基于各自 baseDir;B3:围栏/行内代码块内不改写);
 *   http(s):/data:/绝对路径原样保留
 * - 文件间以 `\n\n<!-- page-break -->\n\n` 拼接(B3:上一文件尾部已有显式分页符时
 *   改用普通空行拼接,防相邻两个分页符产生空白页)
 * - 空文件(trim 后)跳过,不产生空段
 */
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface MergeInput {
  content: string;
  baseDir: string;
}

/** 文件间分隔:显式分页符(渲染层已支持,勿改语法) */
const PAGE_BREAK = "\n\n<!-- page-break -->\n\n";

/** 文本是否以显式分页符结尾(B3 防叠加判断) */
function endsWithPageBreak(text: string): boolean {
  return /<!--\s*page-break\s*-->\s*$/.test(text);
}

/**
 * markdown 图片语法:![alt](src "title") / ![alt](src 'title') / ![alt](src)。
 * src 支持括号配对 URL(括号内无嵌套,如 https://example.com/a(b).png)。
 * 组 1=alt,组 2=src,组 3=可选 title(含前导空白,替换时原样保留)。
 * 已知限制:引用式图片 ![alt][ref] 语法不在本正则范围内(不匹配,原样保留,不处理)。
 */
// src 组用非捕获内组 (?:...) 包住量词,避免重复捕获组只留最后一次迭代(组 2 须为完整 src)
const IMAGE_RE = /!\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))+)(\s+["'][^"']*["'])?\)/g;

export function mergeMarkdowns(files: MergeInput[]): string {
  const parts: string[] = [];
  files.forEach((file, index) => {
    let text = file.content;
    if (index > 0) {
      // 后续文件剥离 frontmatter(拼接文本层面移除,metadata 丢弃)
      text = parseFrontmatter(text).body;
    }
    text = absolutizeImages(text, file.baseDir);
    text = text.trim();
    if (!text) return; // 空文件跳过,不产生空段
    parts.push(text);
  });
  // B3:上一段尾部已有显式分页符 → 普通空行拼接(相邻两个分页符会产生空白页:
  // docx 每个 breakBefore 独立成页;pdf CSS 仅覆盖 `.page-break + h1` 相邻场景)
  let merged = "";
  for (const part of parts) {
    if (!merged) {
      merged = part;
    } else {
      merged += endsWithPageBreak(merged) ? `\n\n${part}` : `${PAGE_BREAK}${part}`;
    }
  }
  return merged;
}

/** 相对路径图片 src → 绝对路径;URL / data: / 绝对路径原样保留(替换时保留 title 部分)。
 *  修复(P0):win32 的 path.resolve 输出反斜杠绝对路径,markdown-it 链接规范化会把
 *  反斜杠 URL 编码(%5C)且盘符丢失,导致后续 file:// 解析失败图片不显示(单文件链路
 *  不走本函数故不受影响)——统一转正斜杠,跨平台安全。
 *  B3:围栏代码块与行内代码内的示例图片语法不改写(此前全文替换污染展示内容)。
 *  实现:先以占位符摘除代码区(围栏含未闭合至文末、行内成对反引号),替换后还原。 */
function absolutizeImages(md: string, baseDir: string): string {
  const vault: string[] = [];
  const stash = (s: string): string => `\u0000${vault.push(s) - 1}\u0000`;
  let work = md.replace(
    /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2(?=[\s]*(\n|$))|$)/g,
    (m) => stash(m),
  );
  work = work.replace(/`[^`\n]+`/g, (m) => stash(m));
  work = work.replace(IMAGE_RE, (match, alt: string, src: string, title: string | undefined) => {
    if (/^(https?:|data:)/i.test(src) || path.isAbsolute(src)) return match;
    const abs = path.resolve(baseDir, src).replace(/\\/g, "/");
    return `![${alt}](${abs}${title ?? ""})`;
  });
  return work.replace(/\u0000(\d+)\u0000/g, (_, i: string) => vault[Number(i)] ?? "");
}
