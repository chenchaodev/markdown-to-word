/**
 * 「渲染前变换」阶段的分派点:纯函数、零 IO,docx 与 pdf 共用。
 *
 * 阶段位置:**在格式分叉之前**。调用方先拿到本函数的输出,再交给 renderDocx /
 * renderPdfDocument;frontmatter 的隔离与拼回不在本文件(那要原样保留前缀,属调用
 * 方的 IO/编排职责)。本文件刻意不 import 任何 `node:*` —— 边界门禁的 node: 内建
 * 白名单是逐文件的,新落点进白名单等于给 core 又开一个宿主能力面(adr-024 要点五)。
 *
 * 契约为什么携带主开关(`aiCleanup.enabled`):主开关判定是本函数要做的第一个决定。
 * 契约里若没有它,该判定只能退回调用方,那里就得逐个列举变换键 —— 枚举点变成三处
 * (分派 / 档位映射 / 主开关),正是本模块要消灭的东西。「总开关不进下一层」那条只约束
 * **档位映射** `aiCleanupOptions`(其入参仍是不含 `enabled` 的窄 `Pick`),不约束本
 * 函数的契约:见 adr-027。
 *
 * 三重门控分处三处(adr-021;adr-024 决定要点二「双重门控不得压成一层」):主开关在
 * 本文件 · 档位到 per-rule 的派生在 ai-cleanup.ts · per-rule 全 false 的零改动短路
 * 在 cleanupMarkdown。三者任一被合并成一层,验收判据「关掉结构改写 = 回到本决策前
 * 的产物」即不成立。
 */
import type { AiCleanupSettings, ObsidianSettings } from "../settings/settings-defaults.js";
import { aiCleanupOptions, cleanupMarkdown } from "./ai-cleanup.js";
import { normalizeObsidian } from "./obsidian.js";

/**
 * 本阶段的窄契约:只含与渲染前变换相关的键组,不含 typography / headerFooter /
 * watermark 等任何非变换键。两侧都是完整块(obsidian 侧的主开关 `compat` 本就在块
 * 内),故「新增一个变换键组时调用方无须改动」这条判据在类型层就成立:调用方传的是
 * `AppSettings`,结构上是本契约的超集,投影由类型系统隐式完成。
 */
export interface PreprocessBodyOptions {
  /** AI 清理:总开关 + 两个档位。总开关在本函数内判定,档位不构成旁路 */
  aiCleanup: Pick<AiCleanupSettings, "enabled" | "tidy" | "rewrite">;
  /** Obsidian 兼容:语法归一开关 + 附件子目录名 */
  obsidian: ObsidianSettings;
}

/**
 * 对正文执行渲染前变换,顺序:先 Obsidian 语法归一、后 AI 清理。
 * 两组开关各自独立、仅启用项生效;均未启用时原样返回,零改动。
 * 只处理正文 —— frontmatter 由调用方隔离后再送进来,免得 metadata 文本被规则改写。
 */
export function preprocessBody(body: string, options: PreprocessBodyOptions): string {
  let out = body;
  if (options.obsidian.compat) {
    out = normalizeObsidian(out, { attachmentFolder: options.obsidian.attachmentFolder });
  }
  if (options.aiCleanup.enabled) {
    out = cleanupMarkdown(out, aiCleanupOptions(options.aiCleanup));
  }
  return out;
}
