/** 剪贴板读取结果:文本写临时 md 返回路径,或返回文件路径,或 empty。 */
export type ClipboardReadResult =
  | { type: "text"; mdPath: string }
  | { type: "files"; paths: string[] }
  | { type: "empty" };
