// @ts-check
/**
 * 标题排版粒度验收:headingScale(标题字号缩放档位)+ headingSpacing(标题间距档位)。
 * 断言分层:
 * - 纯函数直测:档位 → h1-h6 字号(pt)/间距(pt/twips)映射表(core/settings/typography.ts
 *   单源;standard 档 = 升级前 PDF 固定值,回归保障);
 * - docx 产物:标题 run 显式 w:sz(half-points)与 w:before/w:after(twips);
 * - pdf CSS:h1-h6 font-size(pt)/margin(pt)参数化;
 * - 双格式同源换算:两侧期望值均由同一纯函数导出(字号 pt×2 = half-points);
 * - 旧配置缺字段回归:headingScale/headingSpacing 缺失或非法 → 默认 standard 档
 *   (main sanitizeTypography 钳制 + renderer mergeSettingsWithDefaults 兜底双侧断言)。
 */
import {
  DEFAULT_TYPOGRAPHY,
  headingFontSizePt,
  headingSpacingPt,
  headingSpacingTwips,
} from "../../dist/core/settings/typography.js";
import { mergeSettingsWithDefaults } from "../../dist/renderer/settings/settings-logic.js";
import { FIXTURES_DIR } from "../harness/paths.js";
import { unzipPart } from "../harness/docx-utils.js";
import { asPdfArtifact, convertWithFs, docxBufferOf } from "../harness/convert-helpers.js";
import { backupSettingsFile, freshSettingsModule, settingsJsonPath } from "../harness/settings.js";
import fs from "node:fs/promises";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

const { assert } = createAsserter("heading-scale");

/**
 * 本段横跨的层(ADR-062 L6 判据要求 behavior 段显式声明):判据只校验「非空 ＋ 每个元素
 * 在磁盘上真实存在」,元素是**仓库相对 POSIX 路径**。
 */
export const covers = [
  "src/core/settings/typography.ts",
  "src/renderer/settings/settings-logic.ts",
];

/** 主样例:h1/h2/h3 + 一段正文(字号/间距断言锚点) */
const md = `# 标题排版粒度

## 二级标题

### 三级标题

正文段落,验证标题档位不影响正文样式。
`;

/** 排版基线(正文 12pt,新字段按被测场景覆盖) */
function typo(overrides = {}) {
  return { ...DEFAULT_TYPOGRAPHY, bodySizePt: 12, ...overrides };
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // ================= 1. 纯函数直测:档位 → 字号/间距映射表 =================
  // standard 档 @12pt = 升级前 PDF 模板固定值(22/17/14/12/11/11),回归锚点
  await suite.case("纯函数:三档 h1-h6 字号映射表", () => {
    const standardSizes = [1, 2, 3, 4, 5, 6].map((d) => headingFontSizePt(12, "standard", d));
    assert(
      JSON.stringify(standardSizes) === JSON.stringify([22, 17, 14, 12, 11, 11]),
      `standard 档 h1-h6 字号应为 [22,17,14,12,11,11],实际 ${JSON.stringify(standardSizes)}`,
    );
    const compactSizes = [1, 2, 3, 4, 5, 6].map((d) => headingFontSizePt(12, "compact", d));
    assert(
      JSON.stringify(compactSizes) === JSON.stringify([18, 15, 13, 12, 11, 11]),
      `compact 档 h1-h6 字号应为 [18,15,13,12,11,11],实际 ${JSON.stringify(compactSizes)}`,
    );
    const spaciousSizes = [1, 2, 3, 4, 5, 6].map((d) => headingFontSizePt(12, "spacious", d));
    assert(
      JSON.stringify(spaciousSizes) === JSON.stringify([26, 20, 16, 13, 12, 12]),
      `spacious 档 h1-h6 字号应为 [26,20,16,13,12,12],实际 ${JSON.stringify(spaciousSizes)}`,
    );
    // 随正文字号缩放(bodySizePt 14 × standard h2 系数 1.4167 ≈ 20pt)
    assert(headingFontSizePt(14, "standard", 2) === 20, "bodySizePt=14 时 standard h2 应为 20pt");
  });

  await suite.case("纯函数:depth 钳制 1-6 且 scale 缺省回落 standard", () => {
    assert(headingFontSizePt(12, "spacious", 0) === 26, "depth<1 应钳制到 h1");
    assert(headingFontSizePt(12, "spacious", 99) === 12, "depth>6 应钳制到 h6");
    assert(headingFontSizePt(12, undefined, 1) === 22, "scale 缺省应回落 standard(旧配置回归)");
  });

  await suite.case("纯函数:三档段前段后间距(pt 与 twips)", () => {
    // 间距:standard h2 = 基准 [18,9]pt × 1.0;twips = pt×20
    const stdH2Tw = headingSpacingTwips("standard", 2);
    assert(stdH2Tw.before === 360 && stdH2Tw.after === 180, `standard h2 间距应为 360/180 twips,实际 ${JSON.stringify(stdH2Tw)}`);
    const cmpH1Pt = headingSpacingPt("compact", 1);
    // 浮点容差比较(12×0.6=7.2 在 IEEE754 下为 7.199999999999999)
    assert(cmpH1Pt.before === 0 && Math.abs(cmpH1Pt.after - 7.2) < 1e-9, `compact h1 间距应为 0/7.2pt,实际 ${JSON.stringify(cmpH1Pt)}`);
    const spcH2Tw = headingSpacingTwips("spacious", 2);
    assert(spcH2Tw.before === 540 && spcH2Tw.after === 270, `spacious h2 间距应为 540/270 twips,实际 ${JSON.stringify(spcH2Tw)}`);
    console.log("[ok] heading-scale:纯函数映射表(三档字号/间距 + depth 钳制 + 缺省回落)直测通过");
  });

  // ================= 2. docx 产物:标题 run w:sz + 段前段后 twips =================
  // spacious 档:h1 26pt→52 half-points,h2 20pt→40;h2 段前/后 540/270 twips
  const spcDocx = await convertWithFs(md, "docx", {
    baseDir: FIXTURES_DIR,
    warnings: [],
    typography: typo({ headingScale: "spacious", headingSpacing: "spacious" }),
  });
  const spcDocument = await unzipPart(docxBufferOf(spcDocx), "word/document.xml");
  const spcStyles = await unzipPart(docxBufferOf(spcDocx), "word/styles.xml");

  await suite.case("docx:spacious 档标题 run 字号与段前段后 twips 生效", () => {
    assert(spcDocument.includes('<w:sz w:val="52"/>'), "spacious h1 标题 run 应含 w:sz=52(26pt×2)");
    assert(spcDocument.includes('<w:sz w:val="40"/>'), "spacious h2 标题 run 应含 w:sz=40(20pt×2)");
    assert(
      spcDocument.includes('w:before="540"') && spcDocument.includes('w:after="270"'),
      "spacious h2 段前/段后应为 540/270 twips",
    );
  });

  await suite.case("docx:正文默认字号不受标题档位影响", () => {
    // 正文样式不受标题档位影响(styles.xml 默认字号仍为 bodySizePt×2 = 24)
    assert(spcStyles.includes('<w:sz w:val="24"/>'), "正文默认字号应保持 12pt×2=24,不受标题档位影响");
    console.log("[ok] heading-scale:docx 标题字号(w:sz)与段前段后(twips)按 spacious 档生效");
  });

  // ================= 3. pdf CSS:font-size / margin 参数化 =================
  const spcPdf = asPdfArtifact(
    await convertWithFs(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      typography: typo({ headingScale: "spacious", headingSpacing: "spacious" }),
    }),
  );

  await suite.case("pdf:spacious 档 h1/h2 字号与 margin 按档位生成", () => {
    assert(spcPdf.html.includes("h1 { font-size: 26pt;"), "pdf spacious h1 应为 font-size 26pt");
    assert(spcPdf.html.includes("margin: 0pt 0 18pt;"), "pdf spacious h1 margin 应为 0pt 0 18pt");
    assert(spcPdf.html.includes("h2 { font-size: 20pt;"), "pdf spacious h2 应为 font-size 20pt");
  });

  // 默认(不传新字段,模拟旧配置)→ standard 档 = 升级前固定值
  const legacyPdf = asPdfArtifact(
    await convertWithFs(md, "pdf", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      typography: { ...DEFAULT_TYPOGRAPHY, headingScale: undefined, headingSpacing: undefined },
    }),
  );

  await suite.case("pdf:缺省档位回落 standard(升级前固定值)", () => {
    assert(legacyPdf.html.includes("h1 { font-size: 22pt;"), "缺省档位 pdf h1 应保持升级前 22pt(回归)");
    assert(legacyPdf.html.includes("h2 { font-size: 17pt;"), "缺省档位 pdf h2 应保持升级前 17pt(回归)");
    assert(legacyPdf.html.includes("h6 { font-size: 11pt;"), "缺省档位 pdf h6 应保持升级前 11pt(回归)");
    console.log("[ok] heading-scale:pdf CSS h1-h6 字号/间距按档位生成,缺省回落 standard(升级前值)");
  });

  // ================= 4. 双格式同源换算:两侧数值均由同一纯函数导出 =================
  const scale = "compact";
  // 三档各自的 docx 与 pdf 产物是 6 次真实转换(多 case 共享的昂贵前置),先备好。
  /** @type {{ document: string, html: string }[]} */
  const compactSides = [];
  // 三档各自跑一次真实转换(本段最贵的一步),产物按下标存入;断言在下面那个循环里逐档做
  // —— 故这里只数次数、不需要循环值。
  for (let sideIndex = 0; sideIndex < 3; sideIndex += 1) {
    const cmpDocx = await convertWithFs(md, "docx", {
      baseDir: FIXTURES_DIR,
      warnings: [],
      typography: typo({ headingScale: scale }),
    });
    const cmpDocument = await unzipPart(docxBufferOf(cmpDocx), "word/document.xml");
    const cmpPdfHtml = asPdfArtifact(
      await convertWithFs(md, "pdf", {
        baseDir: FIXTURES_DIR,
        warnings: [],
        typography: typo({ headingScale: scale }),
      }),
    ).html;
    compactSides.push({ document: cmpDocument, html: cmpPdfHtml });
  }

  for (const [i, level] of [1, 2, 3].entries()) {
    await suite.case(`双格式同源换算一致(compact h${level})`, () => {
      const pt = headingFontSizePt(12, scale, level);
      const side = compactSides[i];
      assert(
        side !== undefined && side.document.includes(`<w:sz w:val="${pt * 2}"/>`),
        `docx compact h${level} 应含 w:sz=${pt * 2}(同源换算 ${pt}pt×2)`,
      );
      assert(
        side !== undefined && side.html.includes(`h${level} { font-size: ${pt}pt;`),
        `pdf compact h${level} 应为 font-size ${pt}pt(与 docx 同源)`,
      );
    });
  }
  console.log("[ok] heading-scale:双格式字号同源换算一致(compact h1-h3,纯函数单源)");

  // ================= 5. 旧 settings.json 缺字段 / 非法档位 → 默认 standard =================
  const { restore } = await backupSettingsFile();
  try {
    await fs.mkdir(settingsJsonPath().replace(/[/\\][^/\\]+$/, ""), { recursive: true });
    // 场景 A:headingScale 非法值 + headingSpacing 缺失 → 双双兜底 standard
    await fs.writeFile(
      settingsJsonPath(),
      JSON.stringify({
        version: 1,
        format: "docx",
        afterConvert: "none",
        breakBeforeH1: false,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
        typography: { ...DEFAULT_TYPOGRAPHY, headingScale: "bogus", headingSpacing: undefined },
      }),
      "utf8",
    );
    const mod = await freshSettingsModule("heading-scale-legacy");
    const loaded = mod.loadSettings();

    await suite.case("旧配置非法档位与缺失档位在 main 侧兜底 standard", () => {
      assert(loaded.typography.headingScale === "standard", "非法 headingScale 应被 sanitize 钳制回 standard");
      assert(loaded.typography.headingSpacing === "standard", "缺失 headingSpacing 应兜底 standard");
    });

    await suite.case("旧配置缺字段 typography 在 renderer 侧兜底 standard", () => {
      // renderer 侧 mergeSettingsWithDefaults 同语义兜底(双侧防御)
      // 夹具按「旧档 typography 只带部分字段」构造,而入参声明是**浅层** Partial<AppSettings>
      // (typography 若出现须字段齐全),实现却是逐字段深合并
      // (`typography: { ...DEFAULT_SETTINGS.typography, ...source.typography }`)。
      // 即声明面比运行期契约窄 —— 故只在这一处标注「此处深合并兜底是本段要守的行为」,
      // 外层对象与其余字段仍由 Partial<AppSettings> 逐字段校验(不整体 cast 掉推断)。
      const merged = mergeSettingsWithDefaults({
        ...DEFAULT_SETTINGS_MERGE_SEED(),
        typography: /** @type {import("../../dist/core/settings/settings-defaults.js").TypographySettings} */ ({
          fontAscii: "Arial",
        }),
      });
      assert(merged.typography.headingScale === "standard", "renderer 合并缺字段 typography 应兜底 headingScale=standard");
      assert(merged.typography.headingSpacing === "standard", "renderer 合并缺字段 typography 应兜底 headingSpacing=standard");
    });

    // 场景 B:合法档位原样保留
    await fs.writeFile(
      settingsJsonPath(),
      JSON.stringify({
        version: 1,
        format: "docx",
        afterConvert: "none",
        breakBeforeH1: false,
        pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
        typography: typo({ headingScale: "compact", headingSpacing: "spacious" }),
      }),
      "utf8",
    );
    const mod2 = await freshSettingsModule("heading-scale-valid");
    const loaded2 = mod2.loadSettings();

    await suite.case("合法档位原样保留", () => {
      assert(loaded2.typography.headingScale === "compact", "合法 headingScale 应原样保留");
      assert(loaded2.typography.headingSpacing === "spacious", "合法 headingSpacing 应原样保留");
      console.log("[ok] heading-scale:旧配置缺字段/非法档位双侧兜底 standard,合法档位保留");
    });
  } finally {
    await restore();
  }
  return { cases: suite.results };
}

/**
 * mergeSettingsWithDefaults 输入种子(顶层必填字段的合法占位;仅测 typography 兜底)
 * 标注返回类型使字面量(version: 1 / format / paper / orientation)受契约校验 ——
 * 不标则被拓宽成 number/string,与 `Partial<AppSettings>` 对不上。
 * @returns {Partial<import("../../dist/core/settings/settings-defaults.js").AppSettings>} 顶层合法占位
 */
function DEFAULT_SETTINGS_MERGE_SEED() {
  return {
    version: 1,
    format: "docx",
    afterConvert: "none",
    breakBeforeH1: false,
    pageSetup: { paper: "A4", orientation: "portrait", marginTop: 25, marginBottom: 25, marginLeft: 32, marginRight: 32 },
    customPresets: [],
  };
}
