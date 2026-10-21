// @ts-check
/**
 * CLI 的 readback 子命令验收(位于 test/cli/,镜像顶层树 src/cli;ADR-060):
 *
 * 被测主体 = dist/cli/options.js(纯函数:argv → 契约)+ dist/cli/index.js(编排)。
 *
 * 为什么 index 经**真 node 子进程**跑:CLI 的核心契约是「纯 node 进程里能跑」——
 * 在 electron.exe 里断言这件事证明不了任何东西(装配层依赖链里混进一个 electron
 * import,本进程照样绿)。形态与 options.test.js 的 convert 段同款。
 *
 * 覆盖:
 * - **参数解析**(同进程 import options.js,零 IO 纯函数):子命令分派、该形态只认
 *   --json/--help、--format/--output/--template 在该形态判用法错(不默默忽略)、
 *   子命令名逐字相等(叫「readback」的文件仍是输入路径)、既有 convert 形态逐字未变。
 * - **真跑一次**(纯 node 子进程):自家稿 .docx → 退出码 0、产物 .md 落盘、
 *   --json 出结构化结果(计数与三类清单)、非 docx 字节 ⇒ 退出码 3、输入读不到 ⇒ 2。
 *
 * 夹具在段内用 jszip 现造(不依赖 output/artifacts —— 那些是别的段的产物,段间无先后
 * 保证);纯函数 + 落盘段,不产 docx/pdf 附件。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { resolveNode } from "../harness/node-exec.js";
import { ROOT } from "../harness/paths.js";
import { createTempResource, removeTree } from "../harness/temp-resource.js";
import {
  CliUsageError,
  parseCliArgs,
  READBACK_SUBCOMMAND,
  usageText,
} from "../../dist/cli/options.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

export const covers = ["src/cli/index.ts", "src/cli/options.ts"];

export const meta = {
  description:
    "CLI readback 子命令:参数解析(形态限制/不默默忽略/文件名不被吞)+ 真跑一次(落盘/--json/失败态退出码)",
};

// 本段无验收样例(夹具在段内用 jszip 现造 .docx,不属夹具区;契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

const { assert } = createAsserter("cli/readback");

/**
 * 自家稿形态的最小 .docx(标题 + 段落 + 粗体;够验「产物落盘 + 结构还原」)。
 * @returns {Promise<Uint8Array>}
 */
async function buildDocx() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
      `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
      `</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles xmlns:w="urn:w">` +
      `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/></w:style>` +
      `</w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0"?><w:document xmlns:w="urn:w" xmlns:r="urn:r"><w:body>` +
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>回读标题</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>正文段落</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>粗体</w:t></w:r></w:p>` +
      `</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * 在纯 node 子进程里跑一次 dist/cli/index.js。
 * @param {string[]} args CLI 参数
 * @returns {{ code: number, stdout: string, stderr: string }}
 */function runCli(args) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 带着它连 electron.exe 都能当 node 用,那样证明不了「不经 electron」
  const result = spawnSync(resolveNode(), [path.join(ROOT, "dist", "cli", "index.js"), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    env,
  });
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** CLI readback 段验收 */
export async function run() {
  const suite = createCaseSuite();

  // ---------- 一、参数解析(同进程纯函数) ----------
  await suite.case("readback 子命令被识别,产出 readback 形态", () => {
    const parsed = parseCliArgs([READBACK_SUBCOMMAND, "a.docx"]);
    assert(parsed.mode === "readback", `首个 token 是子命令时应走 readback 形态,实际 ${parsed.mode}`);
    assert(parsed.inputs.length === 1 && parsed.inputs[0] === "a.docx", "readback 应原样保留输入路径");
  });
  await suite.case("readback 形态里 --format/--output/--template 判用法错(不默默忽略)", () => {
    for (const flag of ["--format", "--output", "--template"]) {
      let failed = false;
      try {
        parseCliArgs([READBACK_SUBCOMMAND, "a.docx", flag, "x"]);
      } catch (error) {
        failed = error instanceof CliUsageError;
      }
      assert(failed, `${flag} 在 readback 形态应判用法错(无意义的 flag 不该被默默忽略)`);
    }
  });
  await suite.case("readback 缺输入路径 / 多于一个输入 ⇒ 用法错", () => {
    for (const argv of [[READBACK_SUBCOMMAND], [READBACK_SUBCOMMAND, "a.docx", "b.docx"]]) {
      let failed = false;
      try {
        parseCliArgs(argv);
      } catch (error) {
        failed = error instanceof CliUsageError;
      }
      assert(failed, `${argv.join(" ")} 应判用法错`);
    }
  });
  await suite.case("叫「readback.md」的文件名仍是输入路径,不被子命令吞掉", () => {
    // 子命令名**逐字相等**才算子命令(口径见 options.ts 的 parseCliArgs 头注):
    // 「readback.md」这种带扩展名的文件名是输入路径,不被子命令吞掉。
    const parsed = parseCliArgs(["readback.md"]);
    assert(parsed.mode === "convert", "token 不逐字等于子命令名时应走 convert 形态");
    assert(parsed.inputs[0] === "readback.md", "该 token 应作为输入路径");
  });
  await suite.case("既有 convert 形态逐字未变(默认 docx / 多个输入 / --json)", () => {
    const parsed = parseCliArgs(["a.md", "b.md", "--json"]);
    assert(parsed.mode === "convert", "无子命令时应走 convert 形态");
    assert(parsed.format === "docx" && parsed.inputs.length === 2 && parsed.json === true, "convert 形态的解析结果应与改动前一致");
  });
  await suite.case("--help 文本列出 readback 子命令与其形态限制", () => {
    const help = usageText();
    assert(help.includes(READBACK_SUBCOMMAND), "用法文本应列出 readback 子命令");
    assert(help.includes("--json"), "readback 子命令的说明段应提到可用选项");
  });

  // ---------- 二、真跑一次(纯 node 子进程) ----------
  const { path: dir } = createTempResource({ label: "cli-readback" });
  try {
    const docxPath = path.join(dir, "样稿.docx");
    fs.writeFileSync(docxPath, await buildDocx());

    await suite.case("readback 真跑:退出码 0、产物 .md 落盘、内容还原", () => {
      const r = runCli([READBACK_SUBCOMMAND, docxPath]);
      assert(r.code === 0, `退出码应为 0,实际 ${r.code};stderr=${r.stderr.slice(-300)}`);
      const mdPath = path.join(dir, "样稿.md");
      assert(fs.existsSync(mdPath), `产物 .md 应落盘,实际不存在 ${mdPath}`);
      const md = fs.readFileSync(mdPath, "utf8");
      assert(md.includes("回读标题"), "回读产物应含标题文本");
      assert(md.includes("正文段落"), "回读产物应含段落文本");
      assert(md.includes("**粗体**"), "回读产物应把粗体还原成 Markdown 行内样式");
    });
    await suite.case("readback --json:stdout 是可解析的 JSON 数组,含计数与三类清单", () => {
      const r = runCli([READBACK_SUBCOMMAND, docxPath, "--json"]);
      assert(r.code === 0, `退出码应为 0,实际 ${r.code}`);
      let parsed;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        throw new Error(`--json 的 stdout 必须是可解析 JSON,实际 ${r.stdout.slice(0, 200)}`);
      }
      assert(Array.isArray(parsed) && parsed.length === 1, "stdout 应是恰好一项的数组");
      const item = parsed[0];
      assert(item.ok === true, "结果项应标成功");
      assert(item.counts.headings === 1, `标题计数应为 1,实际 ${item.counts.headings}`);
      assert(Array.isArray(item.preserved) && item.preserved.length > 0, "结果项应带「会保真」清单");
      assert(Array.isArray(item.notManaged) && item.notManaged.length > 0, "结果项应带「不接管」清单");
    });
    await suite.case("readback 遇非 docx 字节 ⇒ 退出码 3(不谎报成功)", () => {
      const broken = path.join(dir, "坏稿.docx");
      fs.writeFileSync(broken, Buffer.from([1, 2, 3, 4, 5]));
      const r = runCli([READBACK_SUBCOMMAND, broken]);
      assert(r.code === 3, `非 docx 应判转换失败(退出码 3),实际 ${r.code}`);
      assert(r.stdout.trim() === "", `失败时 stdout 不该出数据,实际 ${r.stdout.slice(0, 120)}`);
    });
    await suite.case("readback 输入读不到 ⇒ 退出码 2", () => {
      const r = runCli([READBACK_SUBCOMMAND, path.join(dir, "不存在.docx")]);
      assert(r.code === 2, `输入读不到应判退出码 2,实际 ${r.code}`);
    });
  } finally {
    await removeTree(dir);
  }

  console.log("[ok] cli/readback:子命令解析(形态限制/不默默忽略/文件名不吞)+ 真跑(落盘/--json/失败态)");
  return { cases: suite.results };
}
