/**
 * pdf 图片路径改写规则(B8 拆分自 render.ts,行为零变化):
 * image 渲染包装单源——相对/绝对路径统一转 file:// URL,本地 src 收集供
 * 存在性检查。语义注释随代码搬移不精简。
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import type MarkdownIt from "markdown-it";

/** 图片规则:相对/绝对路径统一转 file:// URL,http(s) 保留原样。
 *  本地 src(保持 markdown 原文)收集到 localSrcs,供 checkLocalImages
 *  经 resolver 做存在性检查(M6:单次 IO,替代 convert 层 stat 预扫)。 */
export function overrideImageRule(md: MarkdownIt, baseDir: string, localSrcs: string[]): void {
    const defaultRule = md.renderer.rules.image;
    if (!defaultRule) return; // markdown-it 内置 image 规则,理论不可达
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx]!; // 渲染器契约:idx 必为有效下标
      const src = token.attrGet("src") ?? "";
      if (src && !/^(https?:|data:)/i.test(src)) {
        localSrcs.push(src);
        const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
        token.attrSet("src", pathToFileURL(abs).href);
      }
      return defaultRule(tokens, idx, options, env, self);
    };
}
