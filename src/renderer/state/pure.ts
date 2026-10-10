/**
 * renderer 纯函数层(零 DOM 依赖,可 Node 直测):isMarkdown / baseName /
 * truncateMiddle / STAGE_TEXT / stageText / STAGE_PERCENT 等。
 * 除 `errorMessage` 外本文件零 import(纯函数);该一个改为 re-export core 的实现单源
 * (见下方说明)。`dom/dom-ops.ts` re-export 本文件以保持 renderer 内部导入路径不变。
 */
export function isMarkdown(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

// 错误归一的实现单源在 core/text/error-message.ts:此前此处与 main 的 ipc/logic.ts
// 各留一份逐字相同的定义(两边注释都写着「原…N 处内联拼写收敛于此」)。此处改为
// re-export 以保持既有导入路径不变。
export { errorMessage } from "../../core/text/error-message.js";

// 阶段键联合单源 core/ipc-contract.ts:type-only,编译期擦除,不破坏本文件「除
// errorMessage 外零 import」的运行时纯函数约束。
import type { ConvertStage } from "../../core/ipc-contract.js";

export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** 超长路径中间截断,保留首尾(尾部含文件名,信息价值最高)。 */
export function truncateMiddle(text: string, max = 88): string {
  if (text.length <= max) return text;
  const head = Math.ceil(max * 0.62);
  const tail = max - head - 1;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

/* ---------- 转换进度 ---------- */
/**
 * 阶段文案(默认语言 zh 原文;i18n 注入翻译):
 * 主进程可能发「read」等键名,也可能是现成中文文案,原样兜底。
 * pdf 链路细分 parse/inline/mermaid/katex(print 由
 * main/converter/single.ts renderPdf 在 printToPDF 前上报);docx 保持 read/render/done。
 * 未知键原样兜底(向后兼容:旧/新阶段混发均不破)。
 * 本文件零 import 约束:zh 文案作为默认输出保留于此(与 i18n 字典 convert.stage.*
 * 的 zh 值逐字一致),translate 注入时按阶段键名翻译(调用处传 t)。
 * 键集取自 core/ipc-contract.ts 的 `ConvertStage`(发射侧同用一份联合):新增阶段
 * 在此与 STAGE_PERCENT / STAGE_INTERRUPTIBLE 漏改即编译红,勿在旁另写一份阶段清单。
 */
export const STAGE_TEXT: Record<ConvertStage, string> = {
  read: "正在读取文件…",
  render: "正在渲染文档…",
  done: "正在完成…",
  parse: "正在解析 Markdown…",
  inline: "正在处理图片…",
  mermaid: "正在渲染 Mermaid 图表…",
  katex: "正在准备公式样式…",
  print: "正在写入 PDF…",
};

export function stageText(
  stage: string,
  translate?: (key: string) => string,
): string {
  const text = STAGE_TEXT[stage as keyof typeof STAGE_TEXT];
  if (text === undefined) return stage;
  return translate ? translate(`convert.stage.${stage}`) : text;
}

/**
 * 阶段 → 进度百分比(主进程只发阶段键,映射近似进度)。
 * pdf 链路 read(15) → parse(30) → inline(45) → mermaid(55) → katex(65)
 * → print(85) → done(95);docx 沿用 read/render/done(render=70 兼容保留,
 * 仅 docx 链路发射)。单调递增,不回退。
 */
export const STAGE_PERCENT: Record<ConvertStage, number> = {
  read: 15,
  parse: 30,
  inline: 45,
  mermaid: 55,
  katex: 65,
  render: 70,
  print: 85,
  done: 95,
};

/**
 * 阶段 → 该阶段能否被用户取消(消费点:取消按钮是否置灰)。
 *
 * **① 它是「阶段」属性,不是「交付面」属性。**
 * 原先「宿主能力是否可中断」被设想成按交付面声明(如 CLI.interruptible),方向是错的:
 * `src/main/cli-pdf-host.ts` 复用 `src/main/converter/electron-side.ts` 的 `renderPdf`,
 * 所以 **CLI 的 pdf 转换同样会发 `print` 阶段** —— 声明「CLI 不可中断」等于描述一个
 * 并不存在的消费点(CLI 本就没有取消按钮)。真实的知识主语是 `printToPDF` 这个
 * **原子调用本身不可中断**(electron-side.ts 在调用前上报 `onStage?.("print")`,
 * 期间无取消检查点),renderer 只是消费了这个事实。
 *
 * **② 为什么是 `Record<ConvertStage, boolean>` 而非 `Set<ConvertStage>`。**
 * `Record` 的键集受联合约束 ⇒ 新增转换阶段时本表**缺键即编译红**,判据等级与上方
 * STAGE_TEXT / STAGE_PERCENT 同档(ADR-066 决定 1「新增阶段必须同时改联合与这些表」)。
 * `Set` 做不到这点:少写一个成员不报任何错,新增阶段会静默沿用「可中断」默认值。
 *
 * **③ 取值为正(`true` = 可中断)**,与 STAGE_PERCENT 的正向取值口径一致,避免读表处
 * 再做一次取反。
 */
export const STAGE_INTERRUPTIBLE: Record<ConvertStage, boolean> = {
  read: true,
  render: true,
  done: true,
  parse: true,
  inline: true,
  mermaid: true,
  katex: true,
  print: false, // printToPDF 是原子调用,期间无取消检查点(见上方 ①)
};

/* ---------- 最近转换相对时间 ---------- */
/** 两位补零(时/分),如 9:05 → "09:05"。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 最近转换相对时间:当天「今天 HH:mm」/ 昨天「昨天 HH:mm」/
 * 今年内「M月D日」/ 更早「YYYY年M月D日」。now 可注入(测试),默认取当前时间;
 * 全部按本地时间判定(与用户感知一致)。
 * i18n:默认输出 zh 原文(零 import 约束,与 i18n 字典 recent.time.* 的 zh 值逐字一致);
 * translate 注入时按 key 翻译(调用处传 t)。
 */
export function formatRecentTime(
  ts: number,
  now?: number,
  translate?: (key: string, params?: Record<string, string | number>) => string,
): string {
  const t = new Date(ts);
  const n = new Date(now ?? Date.now());
  const time = `${pad2(t.getHours())}:${pad2(t.getMinutes())}`;
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(t, n)) {
    return translate ? translate("recent.time.today", { time }) : `今天 ${time}`;
  }
  const yesterday = new Date(n);
  yesterday.setDate(n.getDate() - 1);
  if (sameDay(t, yesterday)) {
    return translate ? translate("recent.time.yesterday", { time }) : `昨天 ${time}`;
  }
  if (t.getFullYear() === n.getFullYear()) {
    const params = { month: t.getMonth() + 1, day: t.getDate() };
    return translate
      ? translate("recent.time.monthDay", params)
      : `${t.getMonth() + 1}月${t.getDate()}日`;
  }
  const params = { year: t.getFullYear(), month: t.getMonth() + 1, day: t.getDate() };
  return translate
    ? translate("recent.time.fullDate", params)
    : `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`;
}

/* ---------- 批量结果路径提取(重试失败项 / 复制全部路径) ---------- */
/**
 * 重试目标:失败(非取消)项路径,保持原始列表顺序。
 * 取消项不算失败(用户主动中止,不自动重试);结构类型匹配 BatchItem。
 */
export function batchRetryPaths(
  items: readonly { ok: boolean; canceled?: boolean; file: string }[],
): string[] {
  return items.filter((item) => !item.ok && !item.canceled).map((item) => item.file);
}

/** 复制目标:成功项的输出路径(换行分隔),按原始列表顺序。 */
export function batchSuccessPaths(
  items: readonly { ok: boolean; outputPath?: string }[],
): string[] {
  return items
    .filter((item): item is { ok: true; outputPath: string } => item.ok === true && !!item.outputPath)
    .map((item) => item.outputPath);
}

/* ---------- 错误码 → 可操作文案映射 ---------- */
/**
 * 常见文件系统错误码 → 「原因 + 建议」可操作提示(对齐 preview.failed 形态):
 * EBUSY(占用)/ ENOENT(不存在)/ EACCES(无权限)/ ENOSPC(磁盘满)/
 * 长路径(ENAMETOOLONG 或 MAX_PATH 字样)。未识别错误原样透传,不破坏既有展示。
 * translate 注入保持零 import 约束(调用处传 t)。
 */
export function actionableError(
  message: string,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (/\bEBUSY\b/.test(message)) return translate("error.fileBusy");
  if (/\bENOENT\b/.test(message)) return translate("error.fileNotFound");
  if (/\bEACCES\b/.test(message)) return translate("error.accessDenied");
  if (/\bENOSPC\b/.test(message)) return translate("error.diskFull");
  if (/\bENAMETOOLONG\b/.test(message) || /MAX_PATH|path too long/i.test(message)) {
    return translate("error.pathTooLong");
  }
  return message;
}

/* ---------- 拖放反馈细化(重复文件单独文案) ---------- */
/** 追加合并拆分:incoming 与 existing 去重 → added(新增)/ duplicates(重复)。 */
export function partitionDuplicates(
  existing: readonly string[],
  incoming: readonly string[],
): { added: string[]; duplicates: string[] } {
  const seen = new Set(existing);
  const added: string[] = [];
  const duplicates: string[] = [];
  for (const filePath of incoming) {
    if (seen.has(filePath)) duplicates.push(filePath);
    else {
      added.push(filePath);
      seen.add(filePath); // incoming 内部互相重复同样计入 duplicates
    }
  }
  return { added, duplicates };
}

/**
 * 选择状态文案组装:摘要 + 非 Markdown 跳过数 + 重复文件数三段组合,
 * 单独/并存各有句式(与 i18n file.skippedSuffix / file.duplicatesSuffix /
 * file.skippedBothSuffix 一一对应)。translate 必传(零 import 约束,测试注入假 t)。
 */
export function selectionStatus(
  summary: string,
  skipped: number,
  duplicates: number,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (skipped > 0 && duplicates > 0) {
    return translate("file.skippedBothSuffix", { summary, skipped, duplicates });
  }
  if (skipped > 0) return translate("file.skippedSuffix", { summary, count: skipped });
  if (duplicates > 0) return translate("file.duplicatesSuffix", { summary, count: duplicates });
  return summary;
}