// @ts-check
/**
 * docx 样式表自洽验收段(ADR-086 §一/§二,REQ-262):
 *
 * 判什么:本仓产出的 docx 里「样式引用闭合 + 默认样式齐备」这件事此前**没有任何机器判据**。
 * 悬空引用(`basedOn="Normal"` / `pStyle="TOC1"` / `rStyle="IndexLink"`)不改变渲染结果
 * (Word 按「无该样式」渲染),用户看得见的只是「目录层级样式不生效」「第三方工具按 styleId
 * 查不到 Normal」,查不出根因 ⇒ 这类问题此前只能靠人看产物。
 *
 * 判据本体是**零 IO 纯函数**(src/core/ooxml/package-integrity.ts),本段只做三件事:
 * ① 造一份**真产物**(含 h1-h3 / 目录 / 脚注 / 表格 / 链接 / 图片)并跑判据 ⇒ 必须是绿的;
 * ② **负向夹具**:把产物的 styles.xml 在**内存里**改坏(删样式定义 / 去掉 w:default /
 * 加未声明前缀 / 重复 styleId)后重跑 ⇒ 判据必须**确实报红**(证明判据有牙,不是恒绿);
 * ③ 告警通道:C5(同类多个 w:default="1" = 歧义,库升级可能引入)只告警不判红。
 *
 * 级别判别式(ADR-086 §二):闭合性/一致性判据(内容型、稳定)⇒ 判红;快照/位置型(漂移源)⇒ 告警。
 * ⚠ 负向夹具**只改内存里的视图**,绝不改写 output/artifacts/ 里的真产物。
 *
 * 本段(`test/core/docx-styles.test.js`)是这道判据在门禁索引(gates/repo/gate-index.mjs)
 * 里的载体:`modulePath` 指本段、`npmScripts: []`、`access: offchain`(它不是 npm script
 * 门禁,而是验收段内的一道门禁,由 M2W_ONLY 单独跑)—— 与 `dual-matrix` 先例同形。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { buildExternalStylesXml } from "../../dist/core/docx/external-styles.js";
import { checkDocxIntegrity } from "../../dist/core/ooxml/package-integrity.js";
import { openDocxPackage } from "../../dist/core/ooxml/parts.js";
import { assert, createCaseSuite } from "../harness/case.js";
import { docxBufferOf, convertWithFs } from "../harness/convert-helpers.js";
import { unzipPart } from "../harness/docx-utils.js";
import { saveArtifact } from "../harness/artifacts.js";
import { FIXTURES_DIR } from "../harness/paths.js";

/** 被测主体清单(声明通道:L4 判「段 import 本层主体」时,import 已满足,这里是给人读的) */
export const covers = ["src/core/docx/external-styles.ts", "src/core/ooxml/package-integrity.ts"];

export const meta = {
  description:
    "docx 样式表自洽验收段:样式引用闭合 + 默认样式齐备 + 命名空间声明完整(C1-C8 判据与负向夹具)",
};

/** 本段复用既有验收样例(samples/docs/dual-pipeline-matrix.md),不新增样例文件 */
export const fixtures = null;

/** 验收样例(仓内既有):一级/二级/三级标题 + 目录 + 图片 + 表格 + 链接 + 脚注 + 公式 */
const SAMPLE_REL = path.join("docs", "dual-pipeline-matrix.md");

/** 测试用图片 resolver:读 samples/ 下的本地图片,外链失败(与 image-size 段同口径) */
const imageResolver = async (/** @type {string} */ src) => {
  if (src.startsWith("http")) return null;
  try {
    return await fs.readFile(path.resolve(FIXTURES_DIR, src));
  } catch {
    return null;
  }
};

/**
 * 从 docx 字节构建判据入参(包视图:部件名清单 + XML 部件文本)。
 *
 * 用 core 的解包原语(src/core/ooxml/parts.ts,内存解包、零磁盘 IO)而不是再引一份 jszip:
 * 同一份「部件怎么读」的口径只有一处。
 * @param {Buffer} buffer docx 字节
 * @returns {Promise<{ partNames: string[], texts: Map<string, string> }>} 包视图
 */
async function buildPackageView(buffer) {
  const pkg = await openDocxPackage(buffer);
  if (pkg === null) throw new Error("docx 字节应能解开成包(不是 zip 或已损坏)");
  const partNames = pkg.listParts();
  /** @type {Map<string, string>} */
  const texts = new Map();
  for (const name of partNames) {
    if (!name.endsWith(".xml") && !name.endsWith(".rels")) continue;
    const text = await pkg.readText(name);
    if (text !== null) texts.set(name, text);
  }
  return { partNames, texts };
}

/**
 * 复制包视图并替换某个 XML 部件的文本(负向夹具用;只动内存)。
 * @param {{ partNames: string[], texts: Map<string, string> }} view 原视图
 * @param {string} partName 部件名
 * @param {string} text 新文本
 * @returns {{ partNames: string[], texts: Map<string, string> }} 新视图
 */
function withPartText(view, partName, text) {
  const texts = new Map(view.texts);
  texts.set(partName, text);
  return { partNames: view.partNames, texts };
}

/**
 * 取判红项里属于某条判据的行。
 * @param {string[]} problems 判红项
 * @param {string} criterionId 判据号前缀(如 "C1-style-reference-closure")
 * @returns {string[]} 命中行
 */
function problemsOf(problems, criterionId) {
  return problems.filter((line) => line.startsWith(`${criterionId}:`));
}

/**
 * 取某个样式定义块(归一化:抹掉标签之间的空白)。
 *
 * ⚠ **为什么归一化**:库会把外部 XML **重新序列化**(缩进空白被吃掉),而属性与元素的
 * 顺序原样保留 ⇒ 归一化后构建器输出与产物里的样式块应当逐字一致;不一致即说明
 * 「产物里的样式定义不是构建器产出的」(出现了第二真源)。
 * @param {string} xml 样式表 XML
 * @param {string} styleId 样式 id
 * @returns {string} 样式块(归一化后);找不到即空串
 */
function styleBlockOf(xml, styleId) {
  const block = xml.match(new RegExp(`<w:style [^>]*w:styleId="${styleId}">[\\s\\S]*?</w:style>`))?.[0] ?? "";
  return block.replace(/>\s+</g, "><");
}

export async function run() {
  const suite = createCaseSuite();

  // ---- 真产物:含 h1-h3 / 目录 / 脚注 / 表格 / 链接 / 图片 ----
  const sampleMd = await fs.readFile(path.join(FIXTURES_DIR, SAMPLE_REL), "utf8");
  const artifact = docxBufferOf(
    await convertWithFs(sampleMd, "docx", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      imageResolver,
    }),
  );
  await saveArtifact("docx-styles", { docx: artifact });
  const stylesXml = await unzipPart(artifact, "word/styles.xml");
  const documentXml = await unzipPart(artifact, "word/document.xml");
  const view = await buildPackageView(artifact);

  /* ---------- 形态:本仓补的 6 个样式确实落在产物里 ---------- */
  await suite.case("产物样式表含 Normal/DefaultParagraphFont 两个默认样式(各带 w:default=\"1\")", () => {
    assert(
      stylesXml.includes('<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'),
      "styles.xml 缺带 w:default=\"1\" 的 Normal 段落样式",
    );
    assert(
      stylesXml.includes('<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">'),
      "styles.xml 缺带 w:default=\"1\" 的 DefaultParagraphFont 字符样式",
    );
  });
  await suite.case("Normal/DefaultParagraphFont 不带 rPr(正文属性唯一来自 docDefaults)", () => {
    const normal =
      stylesXml.match(/<w:style w:type="paragraph" w:default="1" w:styleId="Normal">[\s\S]*?<\/w:style>/)?.[0] ?? "";
    assert(normal !== "", "styles.xml 里找不到 Normal 样式块");
    assert(!normal.includes("<w:rPr>"), "Normal 样式里不该有 w:rPr(正文属性会产生第二真源)");
    const defaultFont =
      stylesXml.match(
        /<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont">[\s\S]*?<\/w:style>/,
      )?.[0] ?? "";
    assert(defaultFont !== "", "styles.xml 里找不到 DefaultParagraphFont 样式块");
    assert(!defaultFont.includes("<w:rPr>"), "DefaultParagraphFont 样式里不该有 w:rPr");
  });
  await suite.case("目录三级样式齐备且缩进阶梯为 Word 内置值 0/220/440", () => {
    for (const [level, indent] of [
      [1, 0],
      [2, 220],
      [3, 440],
    ]) {
      const block =
        stylesXml.match(
          new RegExp(`<w:style w:type="paragraph" w:styleId="TOC${level}">[\\s\\S]*?</w:style>`),
        )?.[0] ?? "";
      assert(block !== "", `styles.xml 缺 TOC${level} 样式`);
      assert(block.includes(`<w:ind w:left="${indent}"/>`), `TOC${level} 的缩进应为 ${indent} twips`);
      assert(block.includes('<w:basedOn w:val="Normal"/>'), `TOC${level} 应基于 Normal`);
      assert(block.includes('<w:next w:val="Normal"/>'), `TOC${level} 的后继样式应为 Normal`);
    }
    assert(
      stylesXml.includes('<w:style w:type="character" w:styleId="IndexLink">'),
      "styles.xml 缺 IndexLink 字符样式",
    );
  });
  await suite.case("正文确实引用了 TOC1/IndexLink(C1 的判定面不是空的)", () => {
    assert(/<w:pStyle w:val="TOC1"\/>/.test(documentXml), "document.xml 里没有 TOC1 段落样式引用");
    assert(/<w:rStyle w:val="IndexLink"\/>/.test(documentXml), "document.xml 里没有 IndexLink 字符样式引用");
  });
  await suite.case("本仓 6 个样式以构建器输出为唯一来源(产物与构建器逐块一致)", () => {
    const built = buildExternalStylesXml();
    for (const styleId of ["Normal", "DefaultParagraphFont", "TOC1", "TOC2", "TOC3", "IndexLink"]) {
      const expected = styleBlockOf(built, styleId);
      assert(expected !== "", `构建器输出里应有 ${styleId} 样式`);
      const actual = styleBlockOf(stylesXml, styleId);
      assert(
        actual === expected,
        `${styleId} 的样式定义与构建器输出不一致(出现了第二真源):\n实际 ${actual}\n期望 ${expected}`,
      );
    }
  });

  /* ---------- 判据全绿 ---------- */
  const green = checkDocxIntegrity(view);
  await suite.case("判据 C1-C8 在真产物上全绿(零判红、零告警)", () => {
    assert(
      green.problems.length === 0,
      `真产物不该有判红项,实得 ${green.problems.length} 条:${green.problems.join(" | ")}`,
    );
    assert(
      green.warnings.length === 0,
      `真产物不该有告警项,实得 ${green.warnings.length} 条:${green.warnings.join(" | ")}`,
    );
  });

  /* ---------- 负向夹具:改坏产物 ⇒ 判据确实报红 ---------- */
  await suite.case("负向夹具① 删掉 TOC1 样式定义 ⇒ C1 报红(引用悬空)", () => {
    const broken = stylesXml.replace(
      /<w:style w:type="paragraph" w:styleId="TOC1">[\s\S]*?<\/w:style>/,
      "",
    );
    assert(broken !== stylesXml, "夹具无效:TOC1 样式块没匹配上(产物形态变了?)");
    const report = checkDocxIntegrity(withPartText(view, "word/styles.xml", broken));
    const hits = problemsOf(report.problems, "C1-style-reference-closure");
    assert(hits.length > 0, `删掉 TOC1 定义后 C1 应报红,实得:${report.problems.join(" | ")}`);
    assert(
      hits.some((line) => line.includes("TOC1")),
      `C1 的诊断应点名悬空的 TOC1,实得:${hits.join(" | ")}`,
    );
  });
  await suite.case("负向夹具② 去掉 Normal 的 w:default ⇒ C4 报红(默认样式缺位)", () => {
    const broken = stylesXml.replace(
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">',
      '<w:style w:type="paragraph" w:styleId="Normal">',
    );
    assert(broken !== stylesXml, "夹具无效:Normal 样式块没匹配上(产物形态变了?)");
    const report = checkDocxIntegrity(withPartText(view, "word/styles.xml", broken));
    const hits = problemsOf(report.problems, "C4-default-style");
    assert(hits.length > 0, `去掉 w:default 后 C4 应报红,实得:${report.problems.join(" | ")}`);
    assert(
      hits.some((line) => line.includes("paragraph")),
      `C4 的诊断应点名段落类型,实得:${hits.join(" | ")}`,
    );
  });
  await suite.case("负向夹具③ 加未声明前缀 ⇒ C6 报红(MCE 非法文档)", () => {
    // ① mc:Ignorable 列了根上没声明的前缀;② 正文里用了没声明的前缀
    const brokenIgnorable = stylesXml.replace(
      'mc:Ignorable="w14 w15"',
      'mc:Ignorable="w14 w15 w99"',
    );
    assert(brokenIgnorable !== stylesXml, "夹具无效:mc:Ignorable 没匹配上(产物形态变了?)");
    const reportIgnorable = checkDocxIntegrity(
      withPartText(view, "word/styles.xml", brokenIgnorable),
    );
    const hitsIgnorable = problemsOf(reportIgnorable.problems, "C6-namespace-prefix");
    assert(
      hitsIgnorable.length > 0,
      `mc:Ignorable 列未声明前缀时 C6 应报红,实得:${reportIgnorable.problems.join(" | ")}`,
    );
    assert(
      hitsIgnorable.some((line) => line.includes("w99")),
      `C6 的诊断应点名未声明的前缀 w99,实得:${hitsIgnorable.join(" | ")}`,
    );
    const brokenElement = stylesXml.replace(
      "</w:styles>",
      '<w99:probe w99:attr="1"/></w:styles>',
    );
    assert(brokenElement !== stylesXml, "夹具无效:styles.xml 结尾没匹配上(产物形态变了?)");
    const reportElement = checkDocxIntegrity(withPartText(view, "word/styles.xml", brokenElement));
    const hitsElement = problemsOf(reportElement.problems, "C6-namespace-prefix");
    assert(
      hitsElement.length > 0,
      `正文用了未声明前缀时 C6 应报红,实得:${reportElement.problems.join(" | ")}`,
    );
  });
  await suite.case("负向夹具④ 重复定义同一 styleId ⇒ C2 报红", () => {
    const broken = stylesXml.replace(
      "</w:styles>",
      '<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/></w:style></w:styles>',
    );
    assert(broken !== stylesXml, "夹具无效:styles.xml 结尾没匹配上(产物形态变了?)");
    const report = checkDocxIntegrity(withPartText(view, "word/styles.xml", broken));
    const hits = problemsOf(report.problems, "C2-style-id-unique");
    assert(hits.length > 0, `重复 styleId 时 C2 应报红,实得:${report.problems.join(" | ")}`);
  });
  await suite.case("负向夹具⑤ 部件缺失 ⇒ C8 报红(关系目标不存在)", () => {
    const broken = {
      partNames: view.partNames.filter((name) => name !== "word/styles.xml"),
      texts: view.texts,
    };
    const report = checkDocxIntegrity(broken);
    const hits = problemsOf(report.problems, "C8-relationship");
    assert(hits.length > 0, `部件缺失时 C8 应报红,实得:${report.problems.join(" | ")}`);
  });
  await suite.case("负向夹具⑥ 多出一个没被声明的部件 ⇒ C7 报红", () => {
    const broken = { partNames: [...view.partNames, "word/media/undeclared.bin"], texts: view.texts };
    const report = checkDocxIntegrity(broken);
    const hits = problemsOf(report.problems, "C7-content-types");
    assert(hits.length > 0, `未声明部件时 C7 应报红,实得:${report.problems.join(" | ")}`);
  });
  await suite.case("负向夹具⑦ 缺 [Content_Types].xml ⇒ C7 报红(声明面无从核对)", () => {
    const broken = { partNames: view.partNames, texts: new Map(view.texts) };
    broken.texts.delete("[Content_Types].xml");
    const report = checkDocxIntegrity(broken);
    const hits = problemsOf(report.problems, "C7-content-types");
    assert(hits.length > 0, `缺 [Content_Types].xml 时 C7 应报红,实得:${report.problems.join(" | ")}`);
  });
  await suite.case("负向夹具⑧ styles.xml 读不出根元素 ⇒ 判红(不许静默放过)", () => {
    const broken = withPartText(view, "word/styles.xml", "这不是 XML");
    const report = checkDocxIntegrity(broken);
    assert(
      report.problems.length > 0,
      "styles.xml 读不出根元素时判据必须报红(零判定面上恒绿是最坏的失效形态)",
    );
  });

  /* ---------- 告警通道:C5 只告警不判红 ---------- */
  await suite.case("C5 走告警通道:同类多个 w:default=\"1\" 只告警、不判红", () => {
    const ambiguous = stylesXml.replace(
      '<w:style w:type="paragraph" w:styleId="Title">',
      '<w:style w:type="paragraph" w:default="1" w:styleId="Title">',
    );
    assert(ambiguous !== stylesXml, "夹具无效:Title 样式块没匹配上(产物形态变了?)");
    const report = checkDocxIntegrity(withPartText(view, "word/styles.xml", ambiguous));
    const warnings = report.warnings.filter((line) => line.startsWith("C5-ambiguous-default:"));
    assert(warnings.length > 0, `同类多个默认样式应出 C5 告警,实得:${report.warnings.join(" | ")}`);
    assert(
      problemsOf(report.problems, "C4-default-style").length === 0,
      `同类多个默认样式不该触发 C4 判红,实得:${report.problems.join(" | ")}`,
    );
  });

  console.log(
    `[ok] docx-styles(adr-086):产物样式表自洽判据 C1-C8 全绿,负向夹具逐条报红(${suite.results.length} 个 case)`,
  );
  return { cases: suite.results };
}
