// @ts-check
/**
 * docx 回读落盘段测试(src/convert/docx-readback/writer.ts):
 * - 写 .md + 媒体目录(图片字节逐字节落盘);
 * - md 里的图片引用是**相对路径**(相对 .md 所在目录),不是绝对路径;
 * - 媒体目录与 .md **成对命名**;
 * - 重名不静默覆盖:同名再写一次 ⇒ 递增「名 (2)」,既有文件逐字节不变;
 * - 无图片时不建媒体目录(md 里的图片引用退化为文件名)。
 *
 * 样例/产物全部放 os.tmpdir() 独立目录,finally 整体删除,不污染 output/smoke。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writeReadbackOutput } from "../../dist/convert/docx-readback/writer.js";
import { readDocxSource } from "../../dist/convert/docx-readback/source.js";
import { MAX_SOURCE_FILE_BYTES } from "../../dist/convert/preprocess.js";
import { withTempResource } from "../harness/temp-resource.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

export const meta = {
  description: "docx 回读落盘测试:.md + 媒体目录 + 相对路径引用 + 重名递增不覆盖",
};
export const fixtures = null;

const { assert, assertEq, assertIncludes } = createAsserter("docx-readback");

/**
 * 造一棵最小 mdast(本段只测落盘,不测回读本身 —— 回读段在 test/core/ooxml/readback.test.js)。
 * @returns {import("mdast").Root} mdast 根
 */
function buildRoot() {
  return {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "标题" }] },
      {
        type: "paragraph",
        children: [
          { type: "text", value: "看图 " },
          { type: "image", url: "image1.png", alt: "" },
        ],
      },
    ],
  };
}

const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

export async function run() {
  const suite = createCaseSuite();

  await suite.case("落盘:.md + 媒体目录 + 相对路径引用", async () => {
    await withTempResource("m2w-readback-", async (resource) => {
      const sourcePath = path.join(resource.path, "报告.docx");
      await fs.writeFile(sourcePath, "fake-docx");
      const written = await writeReadbackOutput({
        sourcePath,
        root: buildRoot(),
        images: [{ partName: "word/media/x.png", fileName: "image1.png", data: IMAGE_BYTES }],
      });
      assertEq(path.basename(written.markdownPath), "报告.md", "产出的 .md 文件名(与源同名)");
      assert(written.mediaDir !== undefined, "有图片时应产出媒体目录");
      assertEq(path.basename(written.mediaDir ?? ""), "报告_media", "媒体目录名(与 .md 成对)");
      assertEq(written.imageCount, 1, "写出的图片数");
      // .md 内容:图片走相对路径(相对 .md 所在目录)
      const markdown = await fs.readFile(written.markdownPath, "utf8");
      assertIncludes(markdown, "![](报告_media/image1.png)", "图片用相对路径引用");
      assert(!markdown.includes(resource.path), "md 里不得出现绝对路径");
      // 图片字节逐字节一致
      const image = await fs.readFile(path.join(written.mediaDir ?? "", "image1.png"));
      assertEq(image.length, IMAGE_BYTES.length, "图片字节长度");
      assert(Buffer.from(image).equals(Buffer.from(IMAGE_BYTES)), "图片字节应逐字节一致");
      // 源文件未被改动
      assertEq(await fs.readFile(sourcePath, "utf8"), "fake-docx", "源文件不得被改写");
    });
  });

  await suite.case("重名:递增「名 (2)」且既有文件逐字节不变", async () => {
    await withTempResource("m2w-readback-", async (resource) => {
      const sourcePath = path.join(resource.path, "报告.docx");
      await fs.writeFile(sourcePath, "fake-docx");
      const first = await writeReadbackOutput({
        sourcePath,
        root: buildRoot(),
        images: [{ partName: "word/media/x.png", fileName: "image1.png", data: IMAGE_BYTES }],
      });
      const firstBytes = await fs.readFile(first.markdownPath);
      const second = await writeReadbackOutput({
        sourcePath,
        root: buildRoot(),
        images: [{ partName: "word/media/x.png", fileName: "image1.png", data: IMAGE_BYTES }],
      });
      assertEq(path.basename(second.markdownPath), "报告 (2).md", "重名递增(序号从 2 起)");
      assertEq(path.basename(second.mediaDir ?? ""), "报告 (2)_media", "媒体目录与 .md 成对递增");
      const afterBytes = await fs.readFile(first.markdownPath);
      assert(Buffer.from(afterBytes).equals(Buffer.from(firstBytes)), "既有 .md 不得被覆盖");
    });
  });

  await suite.case("无图片:不建媒体目录", async () => {
    await withTempResource("m2w-readback-", async (resource) => {
      const sourcePath = path.join(resource.path, "报告.docx");
      await fs.writeFile(sourcePath, "fake-docx");
      const written = await writeReadbackOutput({ sourcePath, root: buildRoot(), images: [] });
      assertEq(written.imageCount, 0, "写出的图片数");
      assert(written.mediaDir === undefined, "无图片时不应产出媒体目录");
      const entries = await fs.readdir(resource.path);
      assert(
        !entries.some((name) => name.endsWith("_media")),
        `不应留下媒体目录:${entries.join(",")}`,
      );
    });
  });

  await suite.case("源文件读取:正常读出字节 + 体积超限被拒", async () => {
    await withTempResource("m2w-readback-", async (resource) => {
      const sourcePath = path.join(resource.path, "稿子.docx");
      const content = "fake-docx";
      await fs.writeFile(sourcePath, content);
      const bytes = await readDocxSource(sourcePath);
      assertEq(bytes.length, content.length, "读出的字节长度应与源文件一致");
      // 体积闸门:超限即拒(读前 stat 拦截)。用稀疏文件造出超限体积而不真写 32MB。
      const bigPath = path.join(resource.path, "超大.docx");
      const handle = await fs.open(bigPath, "w");
      try {
        await handle.truncate(MAX_SOURCE_FILE_BYTES + 1);
      } finally {
        await handle.close();
      }
      let failed = false;
      try {
        await readDocxSource(bigPath);
      } catch (error) {
        failed = error instanceof Error && error.message.includes("体积超过上限");
      }
      assert(failed, "超过体积上限的源文件应被拒绝(不得整篇读进内存)");
    });
  });

  return { cases: suite.results };
}
