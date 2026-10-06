import { emitConvertedArtifact } from "./dist/convert/run.js";
import { createConvertContext } from "./dist/convert/context.js";
import path from "node:path";

const plain = ["# 含图", "", "正文。", "", "```mermaid", "graph TD; A-->B;", "```", ""].join("\n");

const tmpDir = path.join(process.cwd(), "tmp_test6");
await import("node:fs/promises").then(fs => fs.mkdir(tmpDir, { recursive: true }));
const mdPath = path.join(tmpDir, "test.md");
await import("node:fs/promises").then(fs => fs.writeFile(mdPath, plain, "utf8"));

const result = await emitConvertedArtifact(
  {
    markdown: { body: plain, metadata: {} },
    sourcePath: path.resolve("tmp_test6", "test.md"),
    baseDir: tmpDir,
  },
  {
    format: "docx",
    settings: {},
    ctx: createConvertContext({ deadline: Date.now() + 120000 }),
    warnings: [],
    katexDir: undefined,
    onProgress: undefined,
    printPdf: undefined,
    mermaidResolver: undefined,
    onAfterCommit: undefined,
  },
);

console.log("result:", JSON.stringify(result, null, 2));
