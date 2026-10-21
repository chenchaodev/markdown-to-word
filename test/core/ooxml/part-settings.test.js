// @ts-check
/**
 * 设置部件解析测试(src/core/ooxml/part-settings.ts):
 * - 默认制表位、缩放、奇偶页页眉页脚、兼容设置、主题语言标记
 * - 本轮这些值不进设置模型(ADR-086 决定五),但解析层要读出来备用
 * - 缺部件 / 畸形 ⇒ 空结果,不抛
 * 纯函数段,无产物输出。
 */
import { parseSettings } from "../../../dist/core/ooxml/part-settings.js";
import { assert, createCaseSuite } from "../../harness/case.js";

export const meta = {
  description: "设置部件解析测试:制表位/缩放/奇偶页/兼容设置/主题语言 + 畸形降级",
};
export const fixtures = null;

const SETTINGS_XML = `<?xml version="1.0"?>
<w:settings xmlns:w="urn:w">
  <w:zoom w:percent="110"/>
  <w:defaultTabStop w:val="420"/>
  <w:evenAndOddHeaders/>
  <w:compat>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
    <w:compatSetting w:name="overrideTableStyleFontSizeAndJustification" w:uri="http://schemas.microsoft.com/office/word" w:val="1"/>
  </w:compat>
  <w:themeFontLang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/>
</w:settings>`;

export async function run() {
  const suite = createCaseSuite();
  const settings = parseSettings(SETTINGS_XML);

  await suite.case("读出制表位、缩放与奇偶页开关", () => {
    assert(settings.defaultTabStopTwips === 420, `默认制表位应为 420,实际 ${settings.defaultTabStopTwips}`);
    assert(settings.zoomPercent === 110, `缩放应为 110,实际 ${settings.zoomPercent}`);
    assert(settings.evenAndOddHeaders === true, "无 val 的 w:evenAndOddHeaders 应读出 true");
  });

  await suite.case("读出兼容设置(name/uri/val)", () => {
    assert(settings.compatSettings.length === 2, `兼容设置应有 2 条,实际 ${settings.compatSettings.length}`);
    const first = settings.compatSettings[0];
    assert(first?.name === "compatibilityMode", `首条 name 应为 compatibilityMode,实际 ${first?.name}`);
    assert(first?.value === "15", `首条 value 应为 15,实际 ${first?.value}`);
    assert(first?.uri !== undefined, "首条应带 uri");
  });

  await suite.case("读出主题语言标记", () => {
    assert(settings.themeFontLang?.value === "en-US", `主语言应为 en-US,实际 ${settings.themeFontLang?.value}`);
    assert(settings.themeFontLang?.eastAsia === "zh-CN", "东亚语言应为 zh-CN");
    assert(settings.themeFontLang?.bidi === "ar-SA", "双向语言应为 ar-SA");
  });

  await suite.case("evenAndOddHeaders 显式置 0 ⇒ false", () => {
    const off = parseSettings(`<w:settings xmlns:w="urn:w"><w:evenAndOddHeaders w:val="0"/></w:settings>`);
    assert(off.evenAndOddHeaders === false, "显式 val=0 应读出 false");
  });

  await suite.case("缺部件 / 畸形 ⇒ 空结果,不抛", () => {
    const empty = parseSettings("");
    assert(empty.defaultTabStopTwips === undefined, "空部件应无制表位");
    assert(empty.evenAndOddHeaders === false, "空部件的奇偶页开关应为 false");
    assert(empty.compatSettings.length === 0, "空部件应无兼容设置");
    const broken = parseSettings("<w:settings><w:compat");
    assert(broken.compatSettings.length === 0, "畸形部件应得到空结果");
    const missing = parseSettings(null);
    assert(missing.defaultTabStopTwips === undefined, "缺部件(null)应得到空结果");
  });

  console.log("[ok] 设置部件解析:制表位/缩放/奇偶页/兼容设置/主题语言 + 畸形降级 断言通过");
  return { cases: suite.results };
}
