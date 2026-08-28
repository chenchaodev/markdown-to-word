/**
 * 主题字体集中配置专断言(锁 AGENTS 硬约束「docx 渲染字体集中配置,中文 eastAsia
 * 不允许散落硬编码」):
 * 架构现状(以实际实现为准):theme.ts 只收与用户设置无关的固定样式常量,
 * 正文 eastAsia 字体唯一来源 = core/typography.ts DEFAULT_TYPOGRAPHY(默认 微软雅黑),
 * 经 renderDocx 注入 styles.default。断言面:
 * - theme.ts 导出的固定样式常量齐全且非空(集中配置载体存在)
 * - 集中配置单源:DEFAULT_TYPOGRAPHY.fontEastAsia 非空;src/core/docx/ 全部源文件
 *   零 CJK 字体名硬编码(微软雅黑/宋体等只允许出现在 typography/settings 层)
 * - 产物级:renderDocx 产物 styles.xml 的 w:eastAsia 与集中配置一致;
 *   document.xml 中代码字体/链接色/引用底纹/分隔线灰与 theme 常量一致
 * (即「值来自集中配置」的端到端证据链:配置 → 渲染注入 → XML 落地)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { convert } from "../../dist/core/convert.js";
import { DEFAULT_TYPOGRAPHY } from "../../dist/core/settings/typography.js";
import {
  CODE_FONT,
  CODE_SIZE,
  LINK_COLOR,
  MUTED_TEXT_GRAY,
  QUOTE_BG_GRAY,
  RULE_GRAY,
  SECONDARY_TEXT_GRAY,
} from "../../dist/core/docx/theme.js";
import { FIXTURES_DIR, ROOT } from "../common/paths.js";
import { unzipPart } from "../common/docx-utils.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`theme-fonts 断言失败:${msg}`);
}

/** 样例:覆盖 theme 常量的四类消费点(行内代码/链接/引用块/分隔线) */
const sampleMd = `# 主题字体断言

正文含 \`inline code\`。

[链接文字](https://example.com)

> 引用块内容

---

`;

/** CJK 字体名硬编码黑名单(只允许出现在 core/typography.ts、core/settings-defaults.ts、
 *  main/settings.ts、renderer 设置层与 i18n 文案;docx/pdf 渲染层必须经 typography 注入) */
const CJK_FONT_RE = /微软雅黑|宋体|黑体|楷体|仿宋|SimSun|Microsoft YaHei/;

export async function run() {
  // ---- 1. theme 固定样式常量齐全且非空(集中配置载体存在) ----
  const constants = {
    CODE_FONT,
    CODE_SIZE,
    LINK_COLOR,
    MUTED_TEXT_GRAY,
    SECONDARY_TEXT_GRAY,
    QUOTE_BG_GRAY,
    RULE_GRAY,
  };
  for (const [name, value] of Object.entries(constants)) {
    assert(value !== undefined && `${value}`.length > 0, `theme 常量 ${name} 不应缺失或为空`);
  }
  console.log("[ok] theme-fonts:theme.ts 固定样式常量齐全且非空(7 项)");

  // ---- 2. eastAsia 单源:DEFAULT_TYPOGRAPHY 集中配置 + docx 渲染层零硬编码 ----
  assert(
    typeof DEFAULT_TYPOGRAPHY.fontEastAsia === "string" && DEFAULT_TYPOGRAPHY.fontEastAsia.length > 0,
    "DEFAULT_TYPOGRAPHY.fontEastAsia 应为非空字符串(eastAsia 唯一来源)",
  );
  const docxDir = path.join(ROOT, "src", "core", "docx");
  const docxSources = (await fs.readdir(docxDir)).filter((f) => f.endsWith(".ts"));
  assert(docxSources.length > 0, `src/core/docx 源文件扫描列表为空(${docxDir})`);
  for (const f of docxSources) {
    const src = await fs.readFile(path.join(docxDir, f), "utf8");
    const m = src.match(CJK_FONT_RE);
    assert(!m, `src/core/docx/${f} 出现 CJK 字体名硬编码「${m?.[0]}」(应经 typography 注入)`);
  }
  console.log(`[ok] theme-fonts:src/core/docx ${docxSources.length} 个源文件零 CJK 字体硬编码`);

  // ---- 3. 产物级:styles.xml eastAsia 与集中配置一致 ----
  // 不传 typography → renderDocx 回落 DEFAULT_TYPOGRAPHY(render.ts:options.typography ?? DEFAULT_TYPOGRAPHY)
  const artifact = await convert(sampleMd, "docx", { baseDir: FIXTURES_DIR, warnings: [] });
  const stylesXml = await unzipPart(artifact.buffer, "word/styles.xml");
  assert(
    stylesXml.includes(`w:eastAsia="${DEFAULT_TYPOGRAPHY.fontEastAsia}"`),
    `styles.xml 缺少 w:eastAsia="${DEFAULT_TYPOGRAPHY.fontEastAsia}"(应与集中配置逐字一致)`,
  );
  assert(
    stylesXml.includes(`w:ascii="${DEFAULT_TYPOGRAPHY.fontAscii}"`),
    `styles.xml 缺少 w:ascii="${DEFAULT_TYPOGRAPHY.fontAscii}"(西文槽同源注入)`,
  );
  console.log(`[ok] theme-fonts:styles.xml eastAsia=${DEFAULT_TYPOGRAPHY.fontEastAsia} 与集中配置一致`);

  // ---- 4. 产物级:document.xml 中 theme 常量消费点逐一落地 ----
  const documentXml = await unzipPart(artifact.buffer, "word/document.xml");
  // 代码字体:CODE_FONT=Consolas(code-block/code-highlight 经 theme 引用)
  assert(documentXml.includes('w:eastAsia="Consolas"'), "document.xml 缺少 Consolas(CODE_FONT 未落地)");
  // 代码字号:CODE_SIZE=20 half-points
  assert(documentXml.includes('<w:sz w:val="20"/>'), "document.xml 缺少 w:sz val=20(CODE_SIZE 未落地)");
  // 链接色:LINK_COLOR=0563C1(link-xref 经 theme 引用)
  assert(documentXml.includes(LINK_COLOR), `document.xml 缺少链接色 ${LINK_COLOR}(LINK_COLOR 未落地)`);
  // 引用块底纹:QUOTE_BG_GRAY=F2F2F2(content 经 theme 引用)
  assert(documentXml.includes(QUOTE_BG_GRAY), `document.xml 缺少引用底纹 ${QUOTE_BG_GRAY}(QUOTE_BG_GRAY 未落地)`);
  // 分隔线灰:RULE_GRAY=999999(thematicBreak 底边框)
  assert(documentXml.includes(RULE_GRAY), `document.xml 缺少分隔线灰 ${RULE_GRAY}(RULE_GRAY 未落地)`);
  console.log("[ok] theme-fonts:document.xml 消费点落地(CODE_FONT/CODE_SIZE/LINK_COLOR/QUOTE_BG_GRAY/RULE_GRAY)");
}
