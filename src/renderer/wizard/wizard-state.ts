/**
 * 成书向导状态机(纯函数,可单测):
 * 7 步 stepper 的推进/回退/边界与「可前进/可付印」判定,不依赖 DOM/IPC。
 * 设计文档 §3 步骤序:①模板 ②封面 ③页眉页脚 ④水印 ⑤合并源 ⑥目录 ⑦付印。
 */

/** 向导总步数(设计 §3.3) */
export const WIZARD_TOTAL_STEPS = 7;

/** 封面元数据草稿(标题/作者/日期;与核心 DocMetadata 同形,不含单位字段) */
export interface WizardCover {
  title: string;
  author: string;
  date: string;
}

/** 向导草稿(跨步共享;封面为一次性元数据,不写 state.settings) */
export interface WizardDraft {
  cover: WizardCover;
  /** 合并源文件绝对路径(顺序 = 合并顺序) */
  sources: string[];
  /** 付印格式(docx / pdf / 双格式) */
  format: "docx" | "pdf" | "both";
}

/** 新建空白草稿 */
export function createDraft(): WizardDraft {
  return { cover: { title: "", author: "", date: "" }, sources: [], format: "docx" };
}

/** 下一步(钳制在 [1, TOTAL]) */
export function nextStep(current: number): number {
  return Math.min(current + 1, WIZARD_TOTAL_STEPS);
}

/** 上一步(钳制在 [1, TOTAL]) */
export function prevStep(current: number): number {
  return Math.max(current - 1, 1);
}

/** 是否首步(「上一步」禁用) */
export function isFirstStep(current: number): boolean {
  return current <= 1;
}

/** 是否末步(显示「付印」) */
export function isLastStep(current: number): boolean {
  return current >= WIZARD_TOTAL_STEPS;
}

/**
 * 是否可前进到下一步:第 5 步(合并源)要求至少 2 个文件,否则禁用「下一步/付印」;
 * 「跳过」不受此约束(跳过 = 该步留空/默认)。其余步恒可前进。
 */
export function canAdvance(current: number, draft: WizardDraft): boolean {
  if (current === 5) return draft.sources.length >= 2;
  return true;
}

/** 是否显示「付印」按钮(仅末步) */
export function canFinish(current: number): boolean {
  return current === WIZARD_TOTAL_STEPS;
}
