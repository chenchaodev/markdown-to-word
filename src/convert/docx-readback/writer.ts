/**
 * docx 回读产物的落盘:写 `<名>.md` + `<名>_media/`(图片)。
 *
 * 为什么落盘在装配层而不在 core:core 零 IO(见 src/core/ooxml/readback/readback.ts 的
 * 文件头),读盘与写盘都在 core 之外 —— 本模块是这条链路上**唯一**写文件的地方。
 *
 * 重名口径(**不许静默覆盖**):
 * - 首选 `<源文件名>.md`;已被占用(文件在 / 媒体目录在)⇒ 递增 `名 (2)`、`名 (3)` …,
 *   与产物提交器(artifact-writer)的重名序号语义一致(序号从 2 起)。
 * - 媒体目录与 .md **成对命名**(`报告.md` 配 `报告_media/`),避免两份产物的图各指各的。
 * - .md 用 `'wx'` 独占创建(文件已存在即失败),媒体目录用非递归 mkdir(已存在即失败);
 *   两者任一失败就换下一个候选名,并清掉本次已建的媒体目录 —— 不留半份产物。
 *
 * 依赖方向:本模块 → core(读回层的树与序列化)+ node 内建;不反向依赖 main / renderer。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { renderReadbackMarkdown } from "../../core/ooxml/readback/readback-markdown.js";
import type { ReadbackImage } from "../../core/ooxml/readback/readback-fields.js";
import { errorMessage } from "../../core/text/error-message.js";
import { OUTPUT_UNWRITABLE_CODES, outputUnwritableError } from "../artifact-writer.js";
import type { Root } from "mdast";

/** 媒体目录后缀(与 .md 成对) */
export const READBACK_MEDIA_SUFFIX = "_media";

/** 重名序号探测上限:超过视为异常环境(外部进程批量造同名文件),抛错而非无限找名 */
const MAX_NAME_ATTEMPTS = 1000;

/** 落盘入参 */
export interface ReadbackWriteOptions {
  /** 源 .docx 路径(输出目录与文件名的基准) */
  sourcePath: string;
  /** mdast 树(图片 url 为落地用的可读文件名) */
  root: Root;
  /** 图片字节与落地名(文档序) */
  images: readonly ReadbackImage[];
}

/** 落盘结果 */
export interface ReadbackWriteResult {
  /** 写出的 .md 路径 */
  markdownPath: string;
  /** 图片目录(无图片时缺省) */
  mediaDir?: string;
  /** 写出的图片数 */
  imageCount: number;
}

/** errno 判定(EEXIST = 名已被占) */
function errnoCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

/** 路径是否已存在(读不到 ⇒ 不存在) */
async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * 落盘回读产物(.md + 图片目录)。
 *
 * @param options 源路径 / mdast 树 / 图片字节
 * @returns 写出的路径
 * @throws 同一目录下的候选名全部被占(异常环境),或写盘失败(原始错误上抛)
 */
export async function writeReadbackOutput(
  options: ReadbackWriteOptions,
): Promise<ReadbackWriteResult> {
  const dir = path.dirname(options.sourcePath);
  const base = path.basename(options.sourcePath, path.extname(options.sourcePath));
  const hasImages = options.images.length > 0;
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
    const stem = attempt === 1 ? base : `${base} (${attempt})`;
    const markdownPath = path.join(dir, `${stem}.md`);
    const mediaDir = hasImages ? path.join(dir, `${stem}${READBACK_MEDIA_SUFFIX}`) : undefined;
    if (await exists(markdownPath)) continue;
    if (mediaDir !== undefined && (await exists(mediaDir))) continue;
    // 媒体目录:独占创建(已存在即失败 —— 上面已探过,这里防的是并发窗口)
    if (mediaDir !== undefined) {
      try {
        await fs.mkdir(mediaDir);
      } catch (err) {
        if (errnoCode(err) === "EEXIST") continue;
        // 建不出媒体目录 = 输出目录接不住产物(无权限 / 磁盘满 / 父目录不是目录)
        // ⇒ 归「输出写不了」(CLI 读错误码判退出码 4),不是转换失败。
        throw outputUnwritableError(
          OUTPUT_UNWRITABLE_CODES.dirUnavailable,
          `建不出图片目录:${mediaDir}(${errorMessage(err)})`,
        );
      }
    }
    // 图片:先落图片再落 .md(.md 是「这次回读完成」的标志,最后落)
    try {
      for (const image of options.images) {
        await fs.writeFile(
          path.join(mediaDir ?? dir, image.fileName),
          image.data,
          { flag: "wx" },
        );
      }
      const markdown = await renderReadbackMarkdown(options.root, {
        mediaUrl: (fileName) =>
          mediaDir === undefined ? fileName : `${stem}${READBACK_MEDIA_SUFFIX}/${fileName}`,
      });
      await fs.writeFile(markdownPath, markdown, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      // 半份产物清掉:媒体目录整个删(.md 未写出时不存在),再换下一个候选名
      if (mediaDir !== undefined) {
        await fs.rm(mediaDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (errnoCode(err) === "EEXIST") continue;
      // 写产物失败(无权限 / 磁盘满 / 只读文件系统)⇒ 归「输出写不了」,不是转换失败。
      throw outputUnwritableError(
        OUTPUT_UNWRITABLE_CODES.writeFailed,
        `写回读产物失败:${markdownPath}(${errorMessage(err)})`,
      );
    }
    const result: ReadbackWriteResult = { markdownPath, imageCount: options.images.length };
    if (mediaDir !== undefined) result.mediaDir = mediaDir;
    return result;
  }
  throw new Error(`同名产物过多(重名序号已用尽 ${MAX_NAME_ATTEMPTS} 个):${path.join(dir, `${base}.md`)}`);
}
