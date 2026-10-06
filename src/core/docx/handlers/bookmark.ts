/**
 * 文档内书签 id 唯一的**唯一收口点**,以及 captions→render 依赖环的切断点。
 *
 * 为什么独立成模块:docx/render.ts 的 bookmarkChildren 与 docx/handlers/captions.ts 曾各写
 * 一份同构的首尾包裹逻辑,而后者对前者只有 type-only 依赖 —— 合成一处会在两条路径上留下
 * 两份可各自漂移的 id 分配。抽取后 id 的来源只有 `nextId` 一个入参,调用方把
 * ctx.xref.bookmarkNextId 传进来,单次渲染闭包的生命周期由调用方掌握。
 *
 * 不变量在哪:`linkId` 必须文档内唯一(WPS 对重复 w:id 显示异常,实测过),故禁用 docx 的
 * Bookmark 组件 —— 其实例每枚自带 linkId 计数且恒为 1。下面 `as unknown` 那处断言是全库
 * 唯一一处(BookmarkStart/End 不在 ParagraphChild 联合类型内,但运行时可作 children 合法
 * 输出,d.ts 与实测相反),改这行前先看本段。
 */
import { BookmarkEnd, BookmarkStart } from "docx";
import type { ParagraphChild } from "docx";

/**
 * 书签包裹共享 helper(自 docx/render.ts bookmarkChildren 与 docx/handlers/captions.ts
 * 内联同构逻辑收敛;放独立模块避免 captions→render 运行时依赖环——captions.ts
 * 对 render.ts 仅 type-only 依赖):
 * name → BookmarkStart/End 首尾包裹 children(输出
 * <w:bookmarkStart w:name="…" w:id="N"/>…<w:bookmarkEnd w:id="N"/>,
 * 内部锚点 InternalHyperlink 按 name 跳转,不受 id 影响)。
 * 不用 docx Bookmark 组件:其实例每枚独立 linkId 计数(恒为 1)→ 文档内
 * 标题书签与公式书签全部 w:id="1" 冲突(Word 要求文档内唯一,实测 WPS 显示异常);
 * 改用导出组件 + nextId 自增保证文档内唯一(nextId 由调用方传入,通常为
 * ctx.xref.bookmarkNextId,生命周期 = 单次渲染闭包)。
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
