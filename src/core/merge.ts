/**
 * 多文件合并(main 侧 convert:merge 的纯逻辑层;无 IO,可单测)。
 * 规则(设计评审定稿,勿改):
 * - 首文件的 frontmatter 保留原样;后续文件的 frontmatter 剥离(仅取 body,metadata 丢弃)
 * - 每文件图片相对路径 → 绝对路径(基于各自 baseDir);http(s):/data:/绝对路径原样保留
 * - 文件间以 `\n\n<!-- page-break -->\n\n` 拼接(渲染层已支持,勿改语法)
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

/**
 * markdown 图片语法:![alt](src "title") / ![alt](src 'title') / ![alt](src)。
 * 组 1=alt,组 2=src,组 3=可选 title(含前导空白,替换时原样保留)。
 */
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+["'][^"']*["'])?\)/g;

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
  return parts.join(PAGE_BREAK);
}

/** 相对路径图片 src → 绝对路径;URL / data: / 绝对路径原样保留(替换时保留 title 部分) */
function absolutizeImages(md: string, baseDir: string): string {
  return md.replace(IMAGE_RE, (match, alt: string, src: string, title: string | undefined) => {
    if (/^(https?:|data:)/i.test(src) || path.isAbsolute(src)) return match;
    return `![${alt}](${path.resolve(baseDir, src)}${title ?? ""})`;
  });
}
