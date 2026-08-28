/**
 * Obsidian 兼容：将 Obsidian 特有语法转为标准 Markdown，便于本产品转换。
 * 纯函数、零 IO、可 Node 直测。
 *
 * 转换规则：
 * - 双链 [[目标]] → [目标](目标.md)
 * - 双链别名 [[目标|别名]] → [别名](目标.md)
 * - 双链锚点 [[目标#章节]] → [目标](目标.md#章节)
 * - 嵌入图片 ![[图.png]] → ![图](<附件文件夹>/图.png)
 * - 嵌入笔记 ![[笔记]] → [笔记](笔记.md)
 *
 * 附件文件夹(attachmentFolder)用于给图片嵌入链接加前缀，匹配 Obsidian 的
 * 附件存放位置；为空串时不加前缀。图片路径解析依赖转换时的 baseDir，
 * 若附件不在 markdown 同目录，请通过 attachmentFolder 指到正确相对路径。
 */
export interface ObsidianOptions {
  /** 附件子文件夹名（Obsidian 配置），用于解析 ![[图片]] 路径前缀；空串=不重写路径 */
  attachmentFolder?: string;
  /** 笔记链接默认扩展名（默认 ".md"） */
  noteExtension?: string;
}

const WIKILINK_RE = /(!?)\[\[([^\]]+)\]\]/g;

export function normalizeObsidian(md: string, options: ObsidianOptions = {}): string {
  const attachmentFolder = options.attachmentFolder ?? "Attachments";
  const noteExt = options.noteExtension ?? ".md";
  return md.replace(WIKILINK_RE, (_whole, bang, inner) => {
    let target = inner;
    let alias = "";
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx >= 0) {
      alias = inner.slice(pipeIdx + 1).trim();
      target = inner.slice(0, pipeIdx).trim();
    }
    let heading = "";
    const hashIdx = target.indexOf("#");
    if (hashIdx >= 0) {
      heading = target.slice(hashIdx);
      target = target.slice(0, hashIdx).trim();
    }
    const isEmbed = bang === "!";
    const hasExt = /\.[a-zA-Z0-9]+$/.test(target);
    if (isEmbed) {
      if (hasExt) {
        // 图片/文件嵌入：附件文件夹前缀（图片不加锚点）；alt 去扩展名更整洁
        const alt = alias || target.replace(/\.[a-zA-Z0-9]+$/, "");
        const imgPath = attachmentFolder ? `${attachmentFolder}/${target}` : target;
        return `![${alt}](${imgPath})`;
      }
      // 笔记嵌入当作链接处理
      const text = alias || target;
      return `[${text}](${target}${noteExt}${heading})`;
    }
    const text = alias || target;
    return `[${text}](${target}${noteExt}${heading})`;
  });
}
