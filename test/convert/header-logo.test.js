// @ts-check
/**
 * 页眉 logo 读取(装配层唯一 IO 点,core 零 IO):
 * - 读取失败 → warn.headerLogoLoadFailed keyed 警告 + undefined(降级为无 logo,不中断转换)
 * - 非 custom 模式 / 空路径 → 不读文件直接 undefined
 *
 * 本段自 test/main/header-footer-settings.test.js 的第 4 小节拆出:断言对象自始是
 * convert 的 resolveHeaderLogo(那段留给 main 的 sanitize 往返断言仍在原处),页眉页脚
 * 设置只作入参。
 */
import { resolveHeaderLogo } from "../../dist/convert/context.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`header-logo(convert) 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 合法页眉页脚设置(只取形状):resolveHeaderLogo 只读 headerMode / headerLogoPath 两键,
 * 其余字段与默认值同形即可 —— 原段取自 core 的 DEFAULT_HEADER_FOOTER,换成本地这份
 * 同形字面量判定不变,且不给本段添跨层 import。
 * 类型指向 dist 产物声明(ADR-069 后产物带 .d.ts):指向 src 是 declaration 打开前的
 * 替代品,已失效 —— 就地声明形状的意图不变,类型面与被测物归一。
 * @type {import("../../dist/core/settings/settings-defaults.js").HeaderFooterSettings}
 */
const headerFooter = {
  headerMode: "default",
  headerText: "",
  headerLogoPath: "",
  headerLayout: "center",
  footerEnabled: true,
};

export async function run() {
  const warnings = /** @type {import("../../dist/core/i18n/warning.js").KeyedWarning[]} */ ([]);
  const missing = await resolveHeaderLogo(
    { ...headerFooter, headerMode: "custom", headerLogoPath: "Z:\\no\\such\\logo.png" },
    warnings,
  );
  assert(missing === undefined, "读取失败应返回 undefined(降级为无 logo)");
  assert(
    warnings.length === 1 && warnings[0]?.key === "warn.headerLogoLoadFailed",
    "读取失败应产生 warn.headerLogoLoadFailed keyed 警告",
  );
  const skipped = await resolveHeaderLogo({ ...headerFooter, headerLogoPath: "C:\\x.png" });
  assert(skipped === undefined, "非 custom 模式不应读 logo 文件");

  console.log("[ok] header-logo(convert):logo 读取失败降级(undefined + keyed 警告)/非 custom 不读 断言通过");
}