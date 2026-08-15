/**
 * 主进程 IPC 纯逻辑层直测(src/main/ipc-logic.ts;批次 15 R6 自 index.ts IPC handler 抽出):
 * 零 Electron API 纯函数,经 dist/main/ipc-logic.js 直接断言(Node 段)。
 * 断言面(可验证事实,与抽取前行为逐一对应):
 * - errorMessage:Error → message;字符串 → 原样;null/对象 → String(err)
 * - buildRecentFileEntries:过滤非字符串/空串;name 取 basename;format/ts 透传
 * - baseNameFromMdPath:.md/.markdown 去扩展(大小写不敏感);其它扩展/无扩展原样
 * - importPresetsFromText:坏 JSON/版本非 1/空 presets → 原错误文案透传;
 *   合法 → 合并序(incoming 在前)/同名取 incoming 值/imported-overridden 计数
 * - buildPresetsExportPayload:schemaVersion:1 包装 + 2 空格缩进 + 末尾换行(序列化字符串精确断言)
 */
import {
  baseNameFromMdPath,
  buildPresetsExportPayload,
  buildRecentFileEntries,
  errorMessage,
  importPresetsFromText,
} from "../../dist/main/ipc-logic.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`ipc-logic 断言失败:${msg}`);
}

const preset = (name, typography = {}, pageSetup = {}) => ({ name, typography, pageSetup });

/** 主进程 IPC 纯逻辑直测(纯 Node 段,零 Electron API) */
export async function run() {
  // ---------- errorMessage ----------
  assert(errorMessage(new Error("boom")) === "boom", "Error → message");
  assert(errorMessage("直接字符串") === "直接字符串", "字符串 → 原样");
  assert(errorMessage(null) === "null", "null → String(null)");
  assert(errorMessage({ a: 1 }) === "[object Object]", "对象 → String(err)");
  console.log("[ok] errorMessage:Error/字符串/null/对象 归一断言通过");

  // ---------- buildRecentFileEntries ----------
  const entries = buildRecentFileEntries(
    ["C:/docs/a.md", "", "C:/docs/b.pdf", 42, "C:/docs/c.MD"],
    "docx",
    123456,
  );
  assert(entries.length === 3, "非字符串/空串应被过滤");
  assert(
    entries[0].path === "C:/docs/a.md" && entries[0].name === "a.md",
    "name 应取 basename",
  );
  assert(entries[1].name === "b.pdf", "非 md 扩展也应取 basename");
  assert(entries[2].name === "c.MD", "basename 大小写保留");
  assert(
    entries.every((e) => e.format === "docx" && e.ts === 123456),
    "format/ts 应透传",
  );
  assert(buildRecentFileEntries([], "pdf", 1).length === 0, "空列表 → 空结果");
  console.log("[ok] buildRecentFileEntries:过滤/name=basename/format-ts 透传/空列表 断言通过");

  // ---------- baseNameFromMdPath ----------
  assert(baseNameFromMdPath("C:/docs/报告.md") === "报告", ".md 应去除");
  assert(baseNameFromMdPath("C:/docs/notes.MARKDOWN") === "notes", ".MARKDOWN 大小写不敏感");
  assert(baseNameFromMdPath("C:/docs/archive.tar.md") === "archive.tar", "仅去末尾 .md");
  assert(baseNameFromMdPath("C:/docs/readme.txt") === "readme.txt", "其它扩展原样");
  assert(baseNameFromMdPath("C:/docs/noext") === "noext", "无扩展原样");
  console.log("[ok] baseNameFromMdPath:.md/.MARKDOWN 去除/仅末尾/其它扩展/无扩展 断言通过");

  // ---------- importPresetsFromText ----------
  // 1. 坏 JSON → 原错误文案透传
  const r1 = importPresetsFromText("{not json!!", []);
  assert(!r1.ok && r1.error === "文件不是有效的 JSON", "坏 JSON → 「文件不是有效的 JSON」");
  // 2. schemaVersion 非 1 → 原错误文案透传
  const r2 = importPresetsFromText(JSON.stringify({ schemaVersion: 2, presets: [preset("x")] }), []);
  assert(!r2.ok && r2.error === "不支持的模板文件版本", "schemaVersion 非 1 → 「不支持的模板文件版本」");
  // 3. 空 presets → 「文件不含有效预设」
  const r3 = importPresetsFromText("[]", []);
  assert(!r3.ok && r3.error === "文件不含有效预设", "空 presets → 「文件不含有效预设」");
  // 4. 合法:同名覆盖 + 追加,imported/overridden 计数
  const r4 = importPresetsFromText(
    JSON.stringify({
      schemaVersion: 1,
      presets: [preset("A", { bodySizePt: 14 }), preset("B")],
    }),
    [preset("A", { bodySizePt: 10 })],
  );
  assert(r4.ok, "合法导入应成功");
  if (r4.ok) {
    assert(r4.presets.map((p) => p.name).join(",") === "A,B", "合并序:incoming 在前");
    assert(r4.presets[0].typography.bodySizePt === 14, "同名项取 incoming 值");
    assert(r4.imported === 2 && r4.overridden === 1, "imported=2 / overridden=1");
  }
  console.log("[ok] importPresetsFromText:错误文案透传(坏 JSON/版本/空)/合并序/同名覆盖/计数 断言通过");

  // ---------- buildPresetsExportPayload ----------
  const payload = buildPresetsExportPayload([preset("我的模板")]);
  const expected = `{
  "schemaVersion": 1,
  "presets": [
    {
      "name": "我的模板",
      "typography": {},
      "pageSetup": {}
    }
  ]
}
`;
  assert(payload === expected, "导出载荷应精确匹配(schemaVersion:1 + 2 空格缩进 + 末尾换行)");
  assert(
    buildPresetsExportPayload([]) === `{\n  "schemaVersion": 1,\n  "presets": []\n}\n`,
    "空预设导出载荷应精确匹配",
  );
  console.log("[ok] buildPresetsExportPayload:序列化字符串精确断言(单条/空列表)通过");
}