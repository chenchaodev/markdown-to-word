/**
 * renderer 纯函数层(B1 自 utils.ts 拆出,零 DOM 依赖,可 Node 直测):
 * - 来源:R8 自 renderer.ts 抽出(utils.ts);B1 再拆纯函数层——isMarkdown /
 *   baseName / truncateMiddle / STAGE_TEXT / stageText / STAGE_PERCENT 均不触碰
 *   DOM 与 state,原被 utils.ts 的 dom.ts 顶层 import 挡住无法 Node 直测,
 *   现可经 dist/renderer/state/pure.js 直接导入断言(批③目录重组)
 * - 本文件零 import(纯函数,契约语义与注释随代码搬移不精简);
 *   utils.ts re-export 保持 renderer 内部 import 路径不变
 *   (renderer.ts 等仍从 ./utils.js 导入)
 */
export function isMarkdown(filePath: string): boolean {
  return /\.(md|markdown)$/i.test(filePath);
}

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
 * B9 进度分阶段:pdf 链路细分 parse/inline/mermaid/katex(print 由 main/converter.ts
 * 在 printToPDF 前上报);docx 保持 read/render/done。未知键原样兜底(向后兼容:
 * 旧/新阶段混发均不破)。
 * 本文件零 import 约束:zh 文案作为默认输出保留于此(与 i18n 字典 convert.stage.*
 * 的 zh 值逐字一致),translate 注入时按阶段键名翻译(调用处传 t)。
 */
export const STAGE_TEXT: Record<
  "read" | "render" | "done" | "parse" | "inline" | "mermaid" | "katex" | "print",
  string
> = {
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
 * B9:pdf 链路 read(15) → parse(30) → inline(45) → mermaid(55) → katex(65)
 * → print(85) → done(95);docx 沿用 read/render/done(render=70 兼容保留,
 * 仅 docx 链路发射)。单调递增,不回退。
 */
export const STAGE_PERCENT: Record<string, number> = {
  read: 15,
  parse: 30,
  inline: 45,
  mermaid: 55,
  katex: 65,
  render: 70,
  print: 85,
  done: 95,
};

/* ---------- 最近转换相对时间 ---------- */
/** 两位补零(时/分),如 9:05 → "09:05"。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 最近转换相对时间(批次 11):当天「今天 HH:mm」/ 昨天「昨天 HH:mm」/
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

/* ---------- 批量结果路径提取(批次 11 迭代 2:重试失败项 / 复制全部路径) ---------- */
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

/* ---------- B9:错误码 → 可操作文案映射 ---------- */
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

/* ---------- B9:拖放反馈细化(重复文件单独文案) ---------- */
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