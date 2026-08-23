import { BookmarkEnd, BookmarkStart } from "docx";
import type { ParagraphChild } from "docx";

/**
 * 书签包裹共享 helper(B7 自 docx/render.ts bookmarkChildren 与 docx/captions.ts
 * 内联同构逻辑收敛;放独立模块避免 captions→render 运行时依赖环——captions.ts
 * 对 render.ts 仅 type-only 依赖):
 * name → BookmarkStart/End 首尾包裹 children(输出
 * <w:bookmarkStart w:name="…" w:id="N"/>…<w:bookmarkEnd w:id="N"/>,
 * 内部锚点 InternalHyperlink 按 name 跳转,不受 id 影响)。
 * 不用 docx Bookmark 组件:其实例每枚独立 linkId 计数(恒为 1)→ 文档内
 * 标题书签与公式书签全部 w:id="1" 冲突(Word 要求文档内唯一,实测 WPS 显示异常);
 * 改用导出组件 + nextId 自增保证文档内唯一(nextId 由调用方传入,通常为
 * ctx.bookmarkNextId,生命周期 = 单次渲染闭包)。
 * `as unknown` 断言依据(d.ts 实证):BookmarkStart/End 不在 ParagraphChild
 * 联合类型内,但运行时可作为 Paragraph children 合法输出——全库该断言收敛于本函数一处。
 */
export function wrapBookmark(
  nextId: { value: number },
  name: string,
  children: readonly ParagraphChild[],
): ParagraphChild[] {
  const linkId = nextId.value++;
  return [new BookmarkStart(name, linkId), ...children, new BookmarkEnd(linkId)] as unknown as ParagraphChild[];
}
