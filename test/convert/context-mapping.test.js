// @ts-check
/**
 * 生产侧「设置 → convert 上下文」映射护栏(4-4 映射面):
 * 护栏不是「比对一份声明」,而是真的跑一次 buildConvertContext 看产物键集 ——
 * headingNumbering / captionNumbering / imageBudget 三项生产零写入者,接进生产映射
 * 就成了「设了也不生效」的假开关(步 01 刚清掉的那类静默失效)。它们由 core convert()
 * 的第 4 参 ConvertTestOverrides 承接(见 src/core/convert.ts)。
 *
 * 本段自 test/main/settings.test.js 拆出:断言对象自始是 convert 的
 * buildConvertContext,那份设置只是入参(见下方 settings 夹具注),故段归它所属的层。
 */
import { buildConvertContext, TEST_ONLY_CONTEXT_KEYS } from "../../dist/convert/context.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`context-mapping(convert) 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 入参设置(只取形状):本段断言的是 buildConvertContext 的**产物键集**,不判定任何设置
 * 取值 —— 原段传的是 main 侧 loadSettings 的产物(一份逐键兜底后的完整设置),换成本
 * 文件里这一份形状完整的设置,两条键集判定一字不改。故此处就地声明形状:既不经 main
 * 往返,也不取 settings-defaults 单源(那会给本段平白添一条跨层 import)。
 * 类型指向 dist 产物声明(ADR-069 后产物带 .d.ts):指向 src 是 declaration 打开前的
 * 替代品,已失效 —— 形状照旧由本段就地声明,但类型面与被测物归一,免得分叉。
 * @type {import("../../dist/core/settings/settings-defaults.js").AppSettings}
 */
const settings = {
  version: 1,
  format: "docx",
  pageSetup: {
    paper: "A4",
    orientation: "portrait",
    marginTop: 25,
    marginBottom: 25,
    marginLeft: 32,
    marginRight: 32,
  },
  typography: {
    fontAscii: "Calibri",
    fontEastAsia: "微软雅黑",
    bodySizePt: 12,
    lineSpacing: 1.5,
    firstLineIndent: true,
    align: "justify",
    headingNumbering: true,
    captionNumbering: true,
    headingScale: "standard",
    headingSpacing: "standard",
  },
  breakBeforeH1: false,
  toc: true,
  tocMode: "static",
  equationNumbering: true,
  afterConvert: "none",
  outputDir: "",
  customPresets: [],
  pdfCss: "",
  language: "zh",
  theme: "system",
  headerFooter: {
    headerMode: "default",
    headerText: "",
    headerLogoPath: "",
    headerLayout: "center",
    footerEnabled: true,
  },
  watermark: { text: "", angle: 315, opacity: 0.15, gray: true },
  aiCleanup: { enabled: false, tidy: true, rewrite: true },
  obsidian: { compat: false, attachmentFolder: "Attachments" },
};

export async function run() {
  const builtCtx = await buildConvertContext({
    baseDir: ".",
    title: "设置 schema 护栏",
    settings,
    imageResolver: async () => null,
  });
  for (const testOnly of TEST_ONLY_CONTEXT_KEYS) {
    assert(
      !(testOnly in builtCtx),
      `${testOnly} 生产零注入,不得出现在 buildConvertContext 产出的上下文里`,
    );
  }
  for (const k of [
    "pageSetup", "typography", "breakBeforeH1", "toc", "tocMode", "equationNumbering",
    "pdfCss", "headerFooter", "watermark",
  ]) {
    assert(k in builtCtx, `生产上下文应映射设置键 ${k}`);
  }
  console.log(`[ok] context-mapping(convert):生产上下文映射不含 ${TEST_ONLY_CONTEXT_KEYS.length} 个仅测试注入字段`);
}