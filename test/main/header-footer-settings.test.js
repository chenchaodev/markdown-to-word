/**
 * 页眉页脚设置主进程层验收:
 * - sanitize 往返:旧档无 headerFooter 字段 → 默认(现状行为);非法值逐字段回退;
 *   合法值保留(updateSettings patch 路径同语义)
 * - resolveHeaderLogo:路径不存在 → undefined + warn.headerLogoLoadFailed keyed 警告
 *   (降级为无 logo,不抛错);非 custom 模式 / 空路径 → 不读文件直接 undefined
 */
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_HEADER_FOOTER } from "../../dist/core/settings/settings-defaults.js";
import { backupSettingsFile, freshSettingsModule, settingsJsonPath } from "../common/settings.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`header-footer(main) 断言失败:${msg}`);
}

export async function run() {
  const settingsFile = settingsJsonPath();
  const { restore } = await backupSettingsFile();
  try {
    await fs.mkdir(path.dirname(settingsFile), { recursive: true });

    // ---- 1. 旧档无 headerFooter 字段 → 兜底默认(其余字段保留) ----
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

    // ---- 2. 非法值逐字段回退默认(整块兜底,不整体回退文件) ----
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

    // ---- 3. 合法值保留 + patch 路径(updateSettings)同语义 ----
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

    // ---- 4. resolveHeaderLogo:读取失败 → 警告 + undefined;非 custom/空路径 → 不读 ----
    const ctxMod = await import("../../dist/main/converter/context.js");
    const warnings = [];
    const missing = await ctxMod.resolveHeaderLogo(
      { ...DEFAULT_HEADER_FOOTER, headerMode: "custom", headerLogoPath: "Z:\\no\\such\\logo.png" },
      warnings,
    );
    assert(missing === undefined, "读取失败应返回 undefined(降级为无 logo)");
    assert(
      warnings.length === 1 && warnings[0].key === "warn.headerLogoLoadFailed",
      "读取失败应产生 warn.headerLogoLoadFailed keyed 警告",
    );
    const skipped = await ctxMod.resolveHeaderLogo({ ...DEFAULT_HEADER_FOOTER, headerLogoPath: "C:\\x.png" });
    assert(skipped === undefined, "非 custom 模式不应读 logo 文件");

    console.log("[ok] header-footer(main):sanitize 往返(旧档默认/非法回退/合法保留/patch)+ logo 读取失败降级 断言通过");
  } finally {
    await restore();
  }
}
