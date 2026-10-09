// @ts-check
/**
 * 页眉页脚设置主进程层验收(只管持久化那一半):
 * - sanitize 往返:旧档无 headerFooter 字段 → 默认(现状行为);非法值逐字段回退;
 *   合法值保留(updateSettings patch 路径同语义)
 * 页眉 logo 读取(resolveHeaderLogo)自本段拆出,落在 test/convert/header-logo.test.js ——
 * 它的断言对象自始是 convert 的实现,不在 main 层。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_HEADER_FOOTER } from "../../dist/core/settings/settings-defaults.js";
import { backupSettingsFile, freshSettingsModule, settingsJsonPath } from "../harness/settings.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**main**,判据静态看不见本段的主体 ——
 * 被测的 `dist/main/persist/settings.js` 经 `test/harness/settings.js` 的
 * `freshSettingsModule()` 进入,那里是**模板串动态 import**
 * (`import(\`../../dist/main/persist/settings.js?${tag}=${freshSeq++}\`)`,
 *  整条说明符在运行时才成形),L4 的静态 import 抽取看不见它 ⇒ 段内零 main 层 import。
 *
 * 主体依据(头注明写 + 断言落点):头注第一行写「页眉页脚设置主进程层验收(只管持久化
 * 那一半)」,四条断言逐条对 `persist/settings.ts` 下判 —— 旧档缺 `headerFooter` 兜底默认、
 * 非法值逐字段回退、合法值保留、`updateSettings` patch 路径同语义。
 *
 * 另 import 的 `dist/core/settings/settings-defaults.js` 只取 `DEFAULT_HEADER_FOOTER`
 * 作**夹具基线**(合法值/非法值的起点都从它派生),已在 L5 豁免表登记;断言对象是 main 的
 * 持久化实现,故不声明 core 层元素。
 */
export const covers = ["src/main/persist/settings.ts"];

const { assert } = createAsserter("header-footer(main)");

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  const settingsFile = settingsJsonPath();
  const { restore } = await backupSettingsFile();
  try {
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });

    // ---- 1. 旧档无 headerFooter 字段 → 兜底默认(其余字段保留) ----
    await suite.case("旧档缺 headerFooter 兜底默认(其余字段保留)", async () => {
      await fs.writeFile(
        settingsFile,
        JSON.stringify({
          version: 1,
          format: "pdf",
          afterConvert: "open",
          breakBeforeH1: true,
          pageSetup: { paper: "A4", orientation: "portrait", marginTop: 10, marginBottom: 20, marginLeft: 30, marginRight: 40 },
        }),
        "utf8",
      );
      const mod = await freshSettingsModule("hf-legacy");
      const s1 = mod.loadSettings();
      assert(JSON.stringify(s1.headerFooter) === JSON.stringify(DEFAULT_HEADER_FOOTER), "旧档缺 headerFooter 应兜底默认");
      assert(s1.format === "pdf" && s1.pageSetup.paper === "A4", "旧档既有字段应保留");
    });

    // ---- 2. 非法值逐字段回退默认(整块兜底,不整体回退文件) ----
    await suite.case("非法值逐字段回退默认(不整体回退文件)", async () => {
      await fs.writeFile(
        settingsFile,
        JSON.stringify({
          version: 1,
          format: "pdf",
          afterConvert: "none",
          breakBeforeH1: false,
          pageSetup: { paper: "A4", orientation: "portrait", marginTop: 10, marginBottom: 20, marginLeft: 30, marginRight: 40 },
          headerFooter: {
            headerMode: "bogus",
            headerText: 123,
            headerLogoPath: null,
            headerLayout: "diagonal",
            footerEnabled: "yes",
          },
        }),
        "utf8",
      );
      const mod2 = await freshSettingsModule("hf-invalid");
      const s2 = mod2.loadSettings();
      assert(s2.headerFooter.headerMode === "default", "headerMode 枚举外值应回退 default");
      assert(s2.headerFooter.headerText === "", "headerText 非 string 应回退空串");
      assert(s2.headerFooter.headerLogoPath === "", "headerLogoPath 非 string 应回退空串");
      assert(s2.headerFooter.headerLayout === "center", "headerLayout 枚举外值应回退 center");
      assert(s2.headerFooter.footerEnabled === true, "footerEnabled 非布尔应回退 true");
      assert(s2.format === "pdf", "headerFooter 部分非法不应拖垮整个设置文件");
    });

    // ---- 3. 合法值保留 + patch 路径(updateSettings)同语义 ----
    await suite.case("合法值经 patch 保留 + 局部覆盖/单字段非法回退", async () => {
      const valid = {
        headerMode: "custom",
        headerText: "内部资料",
        headerLogoPath: "C:\\img\\logo.png",
        headerLayout: "leftRight",
        footerEnabled: false,
      };
      const mod3 = await freshSettingsModule("hf-valid");
      const r3 = await mod3.updateSettings({ headerFooter: valid });
      assert(JSON.stringify(r3.headerFooter) === JSON.stringify(valid), "合法 headerFooter 经 patch 应原样保留");
      const r4 = await mod3.updateSettings({ headerFooter: { ...valid, headerMode: "none" } });
      assert(r4.headerFooter.headerMode === "none" && r4.headerFooter.footerEnabled === false, "patch 局部覆盖应保留其余合法字段");
      const r5 = await mod3.updateSettings({ headerFooter: { ...valid, footerEnabled: "nope" } });
      assert(r5.headerFooter.footerEnabled === true && r5.headerFooter.headerText === "内部资料", "patch 单字段非法应回退默认且不影响其他字段");
    });

    console.log("[ok] header-footer(main):sanitize 往返(旧档默认/非法回退/合法保留/patch)断言通过");
  } finally {
    await restore();
  }
  return { cases: suite.results };
}
