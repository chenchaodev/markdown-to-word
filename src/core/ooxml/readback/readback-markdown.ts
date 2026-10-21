/**
 * mdast → Markdown 序列化:回读产物落到 .md 的最后一步。
 *
 * 为什么用 remark-stringify 而不是自研受限序列化器(ADR-086 决定 7):回读产物还要被本仓
 * 自己再转回去,序列化器必须与解析侧同代(unified 11 / remark-stringify 11),混搭
 * mdast-util-to-markdown 的各版本会让往返行为随依赖树漂移。
 *
 * 表格走 GFM:`remark-gfm` 的插件体把 `gfmToMarkdown()` 挂进 `toMarkdownExtensions`
 * (remark-stringify 读这个槽),故 mdast 的 table 节点会序列化成 GFM 管道表格。
 * ⚠ remark-gfm **不导出**字符串化扩展本身(它的出口只有默认插件),要单独拿扩展得引
 * `mdast-util-gfm` —— 本文件不需要单独拿(插件已经挂了),故不引。
 *
 * 公式:本层不产 LaTeX(自家稿的 OMML → LaTeX 要真解析器,本步不做),公式以**纯文本**
 * 出现在段落里(见 readback-math.ts),因此这里不需要数学扩展。
 *
 * 不变量:
 * ① 图片 URL 由调用方给(落地目录名要等装配层定下最终文件名才知道),本层只做**映射**,
 *    不猜路径;
 * ② 映射**不改原树**:产出一份新树(图片 url 已替换),调用方的树仍可复用。
 */
import { unified } from "unified";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import type { Content, Root } from "mdast";

/** 序列化选项 */
export interface ReadbackMarkdownOptions {
  /**
   * 图片 URL 映射:入参是落地用的可读文件名(如 image1.png),返回 md 里写的相对路径
   * (如 `报告_media/image1.png`)。不传则原样用文件名(仅适合单文件场景)。
   */
  mediaUrl?: (fileName: string) => string;
}

/** 按映射复制一棵树(只改图片节点的 url) */
function withMediaUrls(root: Root, map: (fileName: string) => string): Root {
  const walk = (node: Content): Content => {
    if (node.type === "image") {
      return { ...node, url: map(node.url) };
    }
    if ("children" in node && Array.isArray(node.children)) {
      const children = node.children.map((child) => walk(child as Content));
      return { ...node, children } as Content;
    }
    return node;
  };
  return { type: "root", children: root.children.map((child) => walk(child)) };
}

/**
 * 把 mdast 序列化成 Markdown 文本。
 *
 * @param root mdast 根
 * @param options 图片 URL 映射(可选)
 * @returns Markdown 文本
 */
export async function renderReadbackMarkdown(
  root: Root,
  options: ReadbackMarkdownOptions = {},
): Promise<string> {
  const map = options.mediaUrl ?? ((fileName: string) => fileName);
  const tree = withMediaUrls(root, map);
  const processor = unified().use(remarkStringify).use(remarkGfm);
  /**
   * ⚠ 这里的窄化转换是**类型定义的历史分歧**,不是本仓的树有问题:
   * mdast 的 `Root.data`(`RootData`)没有索引签名,而 unist 的 `Data` 要求索引签名
   * ⇒ mdast 的 Root 不可直接赋给 unified 的 `Compatible`。
   * 两套类型都是第三方(@types/mdast 与 unist),改不动,故在唯一入口处转换一次。
   */
  type ProcessorNode = Parameters<typeof processor.stringify>[0];
  // 用 stringify 而不是 process:unified 的 process 要求配 parser(本层只编译、不解析)
  const file = processor.stringify(tree as unknown as ProcessorNode);
  return String(file);
}
