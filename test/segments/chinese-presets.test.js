import { TEMPLATE_PRESETS } from "../../dist/core/settings/settings-defaults.js";

export async function run() {
  const ids = TEMPLATE_PRESETS.map((p) => p.id);
  for (const id of ["official-cn", "cn-reader", "cn-minimal"]) {
    if (!ids.includes(id)) throw new Error(`缺少中文场景预设: ${id}`);
  }
  console.log("[ok] chinese-presets: 三个中文场景预设存在");

  const official = TEMPLATE_PRESETS.find((p) => p.id === "official-cn");
  if (official.typography.fontEastAsia !== "仿宋_GB2312") {
    throw new Error(`公文正文字体错误: ${official.typography.fontEastAsia}`);
  }
  if (official.pageSetup.marginTop !== 37) throw new Error("公文上边距错误");
  console.log("[ok] chinese-presets: 公文预设字段正确（仿宋 + GB 页边距）");

  const reader = TEMPLATE_PRESETS.find((p) => p.id === "cn-reader");
  if (reader.typography.lineSpacing !== 1.75) throw new Error("长文行距错误");
  if (reader.typography.firstLineIndent !== true) throw new Error("长文首行缩进错误");
  console.log("[ok] chinese-presets: 长文预设字段正确（宋体 + 1.75 行距）");

  const minimal = TEMPLATE_PRESETS.find((p) => p.id === "cn-minimal");
  if (minimal.typography.firstLineIndent !== false) throw new Error("极简首行缩进错误");
  if (minimal.typography.align !== "left") throw new Error("极简对齐错误");
  console.log("[ok] chinese-presets: 极简预设字段正确（无缩进 + 左对齐）");
}
