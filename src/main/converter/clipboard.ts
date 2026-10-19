/**
 * 剪贴板复制装配层:源路径 → 读取/准备 → core 片段渲染 → 单点写入。
 *
 * ## 为什么在主进程渲染
 * 片段需要两个宿主能力:core 的 `renderClipboardFragment`(markdown-it 规则树 +
 * 内联样式)与图片解析器(本地图片按 baseDir 边界校验后读字节、外链下载)。
 * renderer 是 sandbox 进程,既拿不到图片解析器也拿不到 `node:fs`,片段只能在
 * 主进程生成;renderer 只交付一个源文件路径。
 *
 * ## 为什么不是「renderer 渲染好 HTML 再经 IPC 传入」
 * 片段是全内联 style 的长串(图片为 base64 data URI,轻易到 MB 级),来回过一遍
 * IPC 只是把同一份数据多复制一次、多一次结构化克隆开销,没有任何收益;而渲染
 * 所需的能力本来就在主进程,故入参收窄为路径本身。
 *
 * ## 失败分类
 * `invalid`(入参形状/扩展名不合法)、`too-large` / `failed`(写入点判定)、
 * `read-failed`(读取、解码或渲染抛错)。错误文案经 `message` 单通道到界面,
 * 不做本地化 —— 显示层无法重映射,只能就近取原始错误信息。
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import type { ClipboardCopyResult } from "../../core/ipc-contract.js";
import type { ConvertWarning } from "../../core/i18n/index.js";
import { renderClipboardFragment } from "../../core/clipboard/render-fragment.js";
import { MARKDOWN_EXT_RE } from "../../convert/paths.js";
import { getImageResolver } from "../../convert/context.js";
import { prepareMarkdown } from "../../convert/preprocess.js";
import { loadSettings } from "../persist/settings.js";
import { writeClipboardHtml } from "../services/clipboard-write.js";

/** 运行期收窄:跨进程边界上类型不存在,payload 一律按未知值校验。 */
function sourcePathOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const candidate = (payload as Record<string, unknown>).path;
  if (typeof candidate !== "string" || candidate === "") return null;
  return candidate;
}

/**
 * 复制 markdown 源文件为富文本剪贴板内容。
 *
 * 分支表:
 * 1. 入参非对象 / path 非字符串或空串、扩展名非 md → `invalid`;
 * 2. 读取/准备/渲染抛错 → `read-failed`(带原始错误文案);
 * 3. 写入点返回 `too-large` / `failed` → 原样透传;
 * 4. 其余 → `{ ok: true, warnings }`(warnings 与转换结果同源,图片缺失等降级可见)。
 */
export async function copyFileToClipboard(payload: unknown): Promise<ClipboardCopyResult> {
  const filePath = sourcePathOf(payload);
  if (filePath === null || !MARKDOWN_EXT_RE.test(filePath)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const settings = loadSettings();
    const warnings: ConvertWarning[] = [];
    const prepared = await prepareMarkdown(filePath, settings, warnings, "warn.gbkEncoding");
    const baseDir = path.dirname(filePath);
    const fragment = await renderClipboardFragment(prepared.body, {
      baseDir,
      realpathSync,
      imageResolver: getImageResolver(baseDir),
      pageSetup: settings.pageSetup,
      typography: settings.typography,
      warnings,
    });
    const written = writeClipboardHtml({ html: fragment.html, text: fragment.text });
    if (!written.ok) {
      // invalid 在本层构造的合法载荷上不可达;真发生即前置校验异常,归入 failed
      return { ok: false, reason: written.reason === "invalid" ? "failed" : written.reason };
    }
    return { ok: true, warnings };
  } catch (err) {
    return {
      ok: false,
      reason: "read-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
