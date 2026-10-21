/**
 * OOXML 包(部件容器)访问层:在内存里解开 .docx(zip),按 OOXML 相对路径读部件,不碰磁盘。
 * 为什么零 IO:本目录属 core,core 的内建白名单只放行 5 个既有文件,引 node:fs 一定判红
 * (gates/repo/check-import-boundary.mjs 的 core 内建白名单)。读盘在 core 之外,媒体落地也在
 * core 之外 —— 本文件只负责「字节 → 部件」。
 * 不变量:
 * ① 解包失败不抛,返回 null(沿用浅导入 v1 的降级口径:调用方据此提示「不是可读的 docx」)。
 * ② 部件名用 OOXML 相对路径(word/document.xml / word/_rels/document.xml.rels / word/media/x.png)。
 * ③ 目录条目不算部件(listParts 过滤 zip 的目录项)。
 * 互指:src/core/ooxml/ 下各 part-*.ts 只经本文件取部件,不各自解包。
 */
import JSZip from "jszip";

/** 解开的 OOXML 包:按部件名读文本/二进制 */
export interface DocxPackage {
  /** 该部件是否存在(目录条目不算部件) */
  has(part: string): boolean;
  /** 读文本部件;不存在或读失败 ⇒ null */
  readText(part: string): Promise<string | null>;
  /** 读二进制部件(如 word/media/*.png);不存在或读失败 ⇒ null */
  readBinary(part: string): Promise<Uint8Array | null>;
  /** 全部部件名(升序) */
  listParts(): string[];
}

/**
 * 解开 .docx 字节 → 部件访问器;不是 zip 或已损坏 ⇒ null(不抛)。
 * @param buffer .docx 字节
 * @returns 包访问器或 null
 */
export async function openDocxPackage(buffer: Uint8Array): Promise<DocxPackage | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  /** 取条目(目录条目视为不存在) */
  const entryOf = (part: string): JSZip.JSZipObject | null => {
    const entry = zip.file(part);
    if (!entry || entry.dir) return null;
    return entry;
  };
  return {
    has(part: string): boolean {
      return entryOf(part) !== null;
    },
    async readText(part: string): Promise<string | null> {
      const entry = entryOf(part);
      if (!entry) return null;
      try {
        return await entry.async("string");
      } catch {
        return null;
      }
    },
    async readBinary(part: string): Promise<Uint8Array | null> {
      const entry = entryOf(part);
      if (!entry) return null;
      try {
        return await entry.async("uint8array");
      } catch {
        return null;
      }
    },
    listParts(): string[] {
      return Object.keys(zip.files)
        .filter((name) => zip.files[name]?.dir !== true)
        .sort();
    },
  };
}
