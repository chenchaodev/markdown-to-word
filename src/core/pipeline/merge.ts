/**
 * 多文件合并(main 侧 convert:merge 的纯逻辑层;无 IO,可单测)。
 * 规则(设计评审定稿):
 * - 首文件的 frontmatter 保留原样;后续文件的 frontmatter 剥离(仅取 body,metadata 丢弃)
 * - 每文件图片相对路径 → 相对合并输出 baseDir 的安全引用;围栏/行内代码块内不改写;
 *   http(s):/data:/file:/UNC/用户绝对路径原样保留,交给下游安全策略判定
 * - 文件间以 `\n\n<!-- page-break -->\n\n` 拼接(上一文件尾部已有显式分页符时
 *   改用普通空行拼接,防相邻两个分页符产生空白页)
 * - 空文件(trim 后)跳过,不产生空段
 */
import path from "node:path";
import { parseFrontmatter } from "./frontmatter.js";

export interface MergeInput {
  content: string;
  baseDir: string;
}

export interface MergeOptions {
  /** 合并后文档的逻辑 baseDir;图片引用以此为基准生成相对路径。 */
  outputBaseDir?: string;
}

/** 文件间分隔:显式分页符(渲染层已支持,勿改语法) */
const PAGE_BREAK = "\n\n<!-- page-break -->\n\n";

/** 文本是否以显式分页符结尾(防叠加判断) */
function endsWithPageBreak(text: string): boolean {
  return /<!--\s*page-break\s*-->\s*$/.test(text);
}

/**
 * markdown 图片语法:![alt](src "title") / ![alt](src 'title') / ![alt](src)。
 * src 支持括号配对 URL(括号内无嵌套,如 https://example.com/a(b).png)。
 * 组 1=alt,组 2=src,组 3=可选 title(含前导空白,替换时原样保留)。
 * 已知限制:引用式图片 ![alt][ref] 语法不在本正则范围内(不匹配,原样保留,不处理)。
 */
// src 组用非捕获内组 (?:...) 包住量词,避免重复捕获组(组 2 须为完整 src)
const IMAGE_RE = /!\[([^\]]*)\]\(((?:[^()\s]|\([^)]*\))+)(\s+["'][^"']*["'])?\)/g;

export function mergeMarkdowns(files: MergeInput[], options: MergeOptions = {}): string {
  const outputBaseDir = options.outputBaseDir ?? files[0]?.baseDir;
  const parts: string[] = [];
  files.forEach((file, index) => {
    const parsed = splitFrontmatter(file.content);
    // 首文件 frontmatter 原样保护;后续文件只取 body。只 trim body,
    // 避免 frontmatter 的前导空格、换行和图片语法被 merge 改写。
    const body = rebaseImages(parsed.body, file.baseDir, outputBaseDir ?? file.baseDir).trim();
    const text = index === 0 ? parsed.frontmatter + body : body;
    if (!text) return; // 空文件跳过,不产生空段
    parts.push(text);
  });
  // 上一段尾部已有显式分页符 → 普通空行拼接(相邻两个分页符会产生空白页:
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

interface SplitFrontmatter {
  frontmatter: string;
  body: string;
}

function splitFrontmatter(md: string): SplitFrontmatter {
  const parsed = parseFrontmatter(md);
  return {
    frontmatter: md.slice(0, md.length - parsed.body.length),
    body: parsed.body,
  };
}

/**
 * 相对路径图片 src → 相对 outputBaseDir;外部/绝对路径原样保留。
 * merge 生成的是新的文档上下文,内部改写不能再制造图片信任边界(ADR-012)会拒绝的绝对路径。
 * 围栏代码块与行内代码内的示例图片语法不改写;实现先摘除代码区,替换后还原。
 */
function rebaseImages(md: string, sourceBaseDir: string, outputBaseDir: string): string {
  const vault: string[] = [];
  const stash = (s: string): string => `\u0000${vault.push(s) - 1}\u0000`;
  let work = md.replace(
    /(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2(?=[ \s]*(\n|$))|$)/g,
    (m) => stash(m),
  );
  work = work.replace(/`[^`\n]+`/g, (m) => stash(m));
  work = work.replace(IMAGE_RE, (match, alt: string, src: string, title: string | undefined) => {
    if (isExternalOrAbsoluteSource(src)) return match;
    const absolute = path.resolve(sourceBaseDir, src);
    const relativePath = path.relative(path.resolve(outputBaseDir), absolute).replace(/\\/g, "/");
    const relative = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
    return `![${alt}](${relative}${title ?? ""})`;
  });
  return work.replace(/\u0000(\d+)\u0000/g, (_, i: string) => vault[Number(i)] ?? "");
}

/** Windows drive/UNC、POSIX 根路径和带协议 URL 都不是 merge 内部可改写的相对引用。 */
function isExternalOrAbsoluteSource(src: string): boolean {
  return (
    /^[a-z][a-z\d+.-]*:/i.test(src) ||
    path.isAbsolute(src) ||
    path.posix.isAbsolute(src) ||
    path.win32.isAbsolute(src)
  );
}
