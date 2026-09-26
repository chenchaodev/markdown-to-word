// @ts-check
import { TEMPLATE_PRESETS } from "../../dist/core/settings/settings-defaults.js";

/**
 * 按 id 取预设:缺失即显式抛错(find 的返回是「可能不存在」,断言层需要确定项)。
 * @param {string} id 预设 id
 * @returns {(typeof TEMPLATE_PRESETS)[number]} 命中的预设
 */
function presetById(id) {
  const preset = TEMPLATE_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`缺少预设: ${id}`);
  return preset;
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const ids = TEMPLATE_PRESETS.map((p) => p.id);
  for (const id of ["official-cn", "cn-reader", "cn-minimal"]) {
    if (!ids.includes(id)) throw new Error(`缺少中文场景预设: ${id}`);
  }
  console.log("[ok] chinese-presets: 三个中文场景预设存在");

  // 上方已逐个断言 id 存在,presetById 缺失即抛(等价断言,附可定位信息)
  const official = presetById("official-cn");
  if (official.typography.fontEastAsia !== "仿宋_GB2312") {
    throw new Error(`公文正文字体错误: ${official.typography.fontEastAsia}`);
  }
  if (official.pageSetup.marginTop !== 37) throw new Error("公文上边距错误");
  console.log("[ok] chinese-presets: 公文预设字段正确（仿宋 + GB 页边距）");

  const reader = presetById("cn-reader");
  if (reader.typography.lineSpacing !== 1.75) throw new Error("长文行距错误");
  if (reader.typography.firstLineIndent !== true) throw new Error("长文首行缩进错误");
  console.log("[ok] chinese-presets: 长文预设字段正确（宋体 + 1.75 行距）");

  const minimal = presetById("cn-minimal");
  if (minimal.typography.firstLineIndent !== false) throw new Error("极简首行缩进错误");
  if (minimal.typography.align !== "left") throw new Error("极简对齐错误");
  console.log("[ok] chinese-presets: 极简预设字段正确（无缩进 + 左对齐）");
}
