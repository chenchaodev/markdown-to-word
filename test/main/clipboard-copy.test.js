// @ts-check
/**
 * 剪贴板复制链路(main 侧)段:
 * - `services/clipboard-write.ts` 的运行期收窄(跨进程边界上类型不存在,payload 一律不可信);
 * - `converter/clipboard.ts` 的装配分支:非法入参 / 非 md / 读取失败 / 成功。
 *
 * 成功路径**不写用户真实剪贴板**:临时替换 `clipboard.write` 为捕获函数,结束时还原。
 * 这样既验证「写入点收到的 html/text 是什么」,又不在测试机上留下副作用。
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clipboard } from "electron";
import { copyFileToClipboard } from "../../dist/main/converter/clipboard.js";
import {
  MAX_CLIPBOARD_HTML_BYTES,
  writeClipboardHtml,
} from "../../dist/main/services/clipboard-write.js";
import { createCaseSuite } from "../harness/case.js";
import { withTempResource } from "../harness/temp-resource.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();

  await suite.case("写入点的入参收窄:非对象/缺字段/空 html 一律 invalid", () => {
    for (const payload of [null, {}, { html: "", text: "" }, { html: "<p>x</p>" }]) {
      assert.deepEqual(writeClipboardHtml(payload), { ok: false, reason: "invalid" });
    }
    assert.ok(MAX_CLIPBOARD_HTML_BYTES > 0, "字节上限应为正数");
  });

  await suite.case("装配层入参收窄:非对象/空路径/非 md 一律 invalid", async () => {
    for (const payload of [null, {}, { path: "" }, { path: 123 }, { path: "notes.txt" }]) {
      assert.deepEqual(await copyFileToClipboard(payload), { ok: false, reason: "invalid" });
    }
  });

  await suite.case("读取失败归入 read-failed 且带原始文案", async () => {
    const missing = path.join(os.tmpdir(), `m2w-missing-${Date.now()}.md`);
    const result = await copyFileToClipboard({ path: missing });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "read-failed");
      assert.ok(result.message && result.message.length > 0, "失败必须带原始错误文案");
    }
  });

  await suite.case("成功路径:主进程渲染片段并交给唯一写入点", async () => {
    await withTempResource("m2w-clip-", async (resource) => {
      const source = path.join(resource.path, "样例.md");
      await fs.writeFile(source, "# 标题\n\n正文一段。\n", "utf8");

      /** @type {any} */
      const clip = clipboard;
      const originalWrite = clip.write;
      /** @type {any} */
      let captured = null;
      clip.write = (/** @type {any} */ data) => {
        captured = data;
      };
      try {
        const result = await copyFileToClipboard({ path: source });
        assert.equal(result.ok, true, "合法 md 应复制成功");
        if (result.ok) assert.ok(Array.isArray(result.warnings), "结果应带 warnings 数组");
      } finally {
        clip.write = originalWrite;
      }

      assert.ok(captured, "写入点未被调用");
      assert.match(captured.html, /<div style="/, "html 应为全内联 style 的片段");
      assert.match(captured.html, /1 标题/, "标题编号应已物化");
      assert.equal(typeof captured.text, "string");
      assert.match(captured.text, /标题/, "纯文本回退应含正文");
      assert.doesNotMatch(captured.html, /file:\/\//, "片段不得含 file:// 引用");
    });
  });

  return { cases: suite.results };
}
