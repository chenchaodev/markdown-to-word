/**
 * GBK 编码端到端(main 进程层;经 dist/main/converter.js,electron 环境):
 * 用 iconv-lite 写 GBK 编码的中文 markdown 文件 → convertImpl("docx") → 断言:
 * - warnings 含「已按 GBK 编码读取:文件编码非 UTF-8」(文案见 src/main/converter.ts
 *   convertImpl;触发链:src/core/encoding.ts decodeMarkdown 严格 UTF-8 校验失败 →
 *   按 gb18030 解码标记 encoding="gbk")
 * - 产物 JSZip 解包 word/document.xml 含正确中文文本(GBK → gb18030 解码无损,无乱码)
 * 与 converter.test.js 同款卫生:tmpdir 独立目录,finally 整体删除;
 * backupSettings 恢复设置(outputDir "" → 产物落源文件同目录,afterConvert "none" 不触发打开文件)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import iconv from "iconv-lite";
import JSZip from "jszip";
import { updateSettings } from "../../dist/main/settings.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { backupSettings } from "../common/settings.js";
import { convertImpl } from "../../dist/main/converter.js";

const GBK_MD = "# GBK 中文标题\n\n正文内容 你好世界\n";

function assert(cond, msg) {
  if (!cond) throw new Error(`gbk-encoding 断言失败:${msg}`);
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-gbk-${process.pid}`);
  const restoreSettings = await backupSettings();
  try {
    await fs.mkdir(dir, { recursive: true });
    // 输出目录指回源目录(样例同目录),afterConvert 置 none 保证断言确定性
    await updateSettings({ outputDir: "", afterConvert: "none" });
    const gbkMd = path.join(dir, "gbk-sample.md");
    await fs.writeFile(gbkMd, iconv.encode(GBK_MD, "gbk"));

    const result = await convertImpl(gbkMd, "docx");
    // B6:警告为 KeyedWarning 对象,断言经 formatWarning 格式化后的最终文案
    assert(
      result.warnings.some((w) => formatWarning(w).includes("已按 GBK 编码读取")),
      `warnings 缺少 GBK 警告: ${JSON.stringify(result.warnings)}`,
    );
    const zip = await JSZip.loadAsync(await fs.readFile(result.outputPath));
    const xml = await zip.file("word/document.xml").async("string");
    assert(xml.includes("中文标题"), "document.xml 缺少中文标题(GBK 解码乱码?)");
    assert(xml.includes("你好世界"), "document.xml 缺少正文中文(GBK 解码乱码?)");
    console.log(
      `[ok] gbk-encoding:GBK 文件转换 → 警告文案 + document.xml 中文正确 (${path.basename(result.outputPath)})`,
    );
  } finally {
    // 恢复设置文件 + 模块级缓存;原本无文件则删除,不污染用户设置
    await restoreSettings.restore();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
