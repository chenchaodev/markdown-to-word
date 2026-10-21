// @ts-check
/**
 * 主题部件解析测试(src/core/ooxml/part-theme.ts):
 * - 字体方案:major/minor 的 latin/ea/cs + 按 script 的补充字体
 * - 配色槽:srgbClr 取 val;sysClr 取 lastClr(缺则 val)
 * - 缺部件 / 畸形 ⇒ 空结果,不抛
 * 纯函数段,无产物输出。
 */
import { parseTheme } from "../../../dist/core/ooxml/part-theme.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "主题部件解析测试:字体方案(major/minor/script) + 配色槽(srgbClr/sysClr) + 畸形降级",
};
export const fixtures = null;

const THEME_XML = `<?xml version="1.0"?>
<a:theme xmlns:a="urn:a">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Calibri Light"/>
        <a:ea typeface="等线 Light"/>
        <a:cs typeface=""/>
        <a:font script="Hans" typeface="等线 Light"/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri"/>
        <a:ea typeface="等线"/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`;

export async function run() {
  const suite = createCaseSuite();
  const theme = parseTheme(THEME_XML);

  await suite.case("字体方案:major/minor 的 latin/ea 与 script 补充字体", () => {
    assert(theme.major.latin === "Calibri Light", `major 的 latin 应为 Calibri Light,实际 ${theme.major.latin}`);
    assert(theme.major.ea === "等线 Light", `major 的 ea 应为 等线 Light,实际 ${theme.major.ea}`);
    assert(theme.major.cs === undefined, "空 typeface 不应留下空串");
    assert(theme.major.scripts?.Hans === "等线 Light", "major 的 Hans 脚本字体应读出");
    assert(theme.minor.latin === "Calibri", `minor 的 latin 应为 Calibri,实际 ${theme.minor.latin}`);
    assert(theme.minor.ea === "等线", `minor 的 ea 应为 等线,实际 ${theme.minor.ea}`);
    assert(theme.minor.scripts === undefined, "minor 无 script 字体时不应凭空出现");
  });

  await suite.case("配色槽:srgbClr 取 val,sysClr 取 lastClr", () => {
    assert(theme.colors.dk1 === "000000", `dk1 应为 000000,实际 ${theme.colors.dk1}`);
    assert(theme.colors.lt1 === "FFFFFF", `lt1 应为 FFFFFF,实际 ${theme.colors.lt1}`);
    assert(theme.colors.dk2 === "44546A", `dk2 应为 44546A,实际 ${theme.colors.dk2}`);
    assert(theme.colors.accent1 === "4472C4", `accent1 应为 4472C4,实际 ${theme.colors.accent1}`);
    assert(theme.colors.accent6 === "70AD47", `accent6 应为 70AD47,实际 ${theme.colors.accent6}`);
    assert(theme.colors.hlink === "0563C1", `hlink 应为 0563C1,实际 ${theme.colors.hlink}`);
    assert(theme.colors.folHlink === "954F72", `folHlink 应为 954F72,实际 ${theme.colors.folHlink}`);
  });

  await suite.case("sysClr 无 lastClr 时退回 val", () => {
    const only = parseTheme(
      `<a:theme xmlns:a="urn:a"><a:themeElements><a:clrScheme><a:dk1><a:sysClr val="windowText"/></a:dk1></a:clrScheme></a:themeElements></a:theme>`,
    );
    assert(only.colors.dk1 === "windowText", `缺 lastClr 时应退回 val,实际 ${only.colors.dk1}`);
  });

  await suite.case("缺 themeElements / 畸形 ⇒ 空结果,不抛", () => {
    const empty = parseTheme("");
    assert(Object.keys(empty.colors).length === 0, "空部件应得到空配色");
    assert(empty.major.latin === undefined, "空部件不应有 major 字体");
    const noElements = parseTheme(`<a:theme xmlns:a="urn:a"/>`);
    assert(noElements.minor.latin === undefined, "缺 themeElements 时应为空结果");
    const broken = parseTheme("<a:theme><a:themeElements>");
    assert(Object.keys(broken.colors).length === 0, "畸形部件应得到空结果");
    const missing = parseTheme(null);
    assert(Object.keys(missing.colors).length === 0, "缺部件(null)应得到空结果");
  });

  console.log("[ok] 主题部件解析:字体方案 + 配色槽 + 畸形降级 断言通过");
  return { cases: suite.results };
}
