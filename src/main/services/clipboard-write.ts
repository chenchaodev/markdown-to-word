/**
 * 富文本剪贴板写入的唯一写入点(main 侧单源,被 converter/clipboard.ts 的
 * clipboard:copy 装配层使用)。
 *
 * 为什么收在单文件:Electron 44 起 `clipboard.writeHTML` 被移除,富文本写入
 * 改走 `ClipboardItem`(异步、可带多种 MIME)。届时迁移只触本文件,handler、
 * preload 与 renderer 的调用形状都不必跟着改 —— 分散写则每处都要重审。
 *
 * 不手写 CF_HTML 头:Windows 上 Chromium 经 `HtmlToCFHtml` 自动包
 * `Version:0.9` / `StartFragment` 头与偏移量。手写头等于替 Chromium 维护一份
 * 字节偏移计算,片段一改就可能整体失效,故只传 HTML 片段本身。
 */
import { clipboard } from "electron";

/** 写入点的载荷形状(内部契约):仅本文件与装配层构造时使用,不经 IPC 传输 */
interface ClipboardWritePayload {
  html: string;
  text: string;
}

/** 写入结果:reason 供装配层区分「超限」与「写入失败」,不跨进程 */
type ClipboardWriteResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "too-large" | "failed" };

/**
 * HTML 片段字节上限(64 MiB,与图片预算的单文档上限同量级)。
 * 刻意非用户可配:这是防失控输入的硬边界 —— 片段内联了图片 data URI,
 * 单份文档即可携带任意大的载荷,写入前必须先有上界。
 */
export const MAX_CLIPBOARD_HTML_BYTES = 64 * 1024 * 1024;

/**
 * 运行时形状校验:写入点是 HTML 的唯一出口,即便调用方在主进程也逐字段收窄
 * (片段来自解析产物,字段形状不受 TS 约束),非对象 / 非字符串 / 空 html 一律拒。
 */
function isClipboardWritePayload(value: unknown): value is ClipboardWritePayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.html === "string" &&
    payload.html.length > 0 &&
    typeof payload.text === "string"
  );
}

/**
 * 写富文本剪贴板:html 为主格式,text 为不支持 HTML 的应用的纯文本回退。
 * @param payload 装配层传入的未知值(运行期校验,不假定形状)
 * @returns 成功 `{ ok:true }`;校验失败 / 超限 / 写入抛错按 reason 区分
 */
export function writeClipboardHtml(payload: unknown): ClipboardWriteResult {
  if (!isClipboardWritePayload(payload)) return { ok: false, reason: "invalid" };
  // 按 UTF-8 字节计:中文等非 ASCII 字符一字多字节,用 length 会低估真实载荷
  if (Buffer.byteLength(payload.html, "utf8") > MAX_CLIPBOARD_HTML_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  try {
    clipboard.write({ text: payload.text, html: payload.html });
    return { ok: true };
  } catch {
    // 系统剪贴板被其他进程占用 / 平台写入失败:由调用方决定是否提示,不在本层抛
    return { ok: false, reason: "failed" };
  }
}
