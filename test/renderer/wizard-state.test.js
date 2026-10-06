// @ts-check
/**
 * 成书向导状态机纯函数测试:边界与「可前进/可付印」判定。
 * 不依赖 DOM/IPC,直接对 dist/renderer/wizard/wizard-state.js 断言。
 */
import {
  WIZARD_TOTAL_STEPS,
  canAdvance,
  canFinish,
  createDraft,
  isFirstStep,
  isLastStep,
  nextStep,
  prevStep,
} from "../../dist/renderer/wizard/wizard-state.js";

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/**
 * 向导草稿:**直接取产物侧的类型**,不再在测试里维护一份同形副本。
 * 此前本文件手抄了一份 `WizardDraft`,理由写的是「dist 编译产物无类型标注,空数组
 * 字面量会被推成 never[]」—— 那条理由在 `declaration` 打开后已失效(ADR-069):
 * 产物带 `.d.ts` 后 `sources` 的元素类型就在声明里。手抄副本的真实代价是**契约改一处
 * 这份不跟着改,而没有任何判据会响** —— 它会被本文件自己用出来的那次调用判红,
 * 但只在有人碰 `wizard-state.ts` 的形状时才暴露。
 * @typedef {import("../../dist/renderer/wizard/wizard-state.js").WizardDraft} WizardDraft
 */

export async function run() {
  // 总步数 = 7
  if (WIZARD_TOTAL_STEPS !== 7) throw new Error(`WIZARD_TOTAL_STEPS 应为 7,实际 ${WIZARD_TOTAL_STEPS}`);

  // 首步/末步判定
  if (!isFirstStep(1)) throw new Error("step 1 应为首步");
  if (isFirstStep(2)) throw new Error("step 2 不应为首步");
  if (!isLastStep(7)) throw new Error("step 7 应为末步");
  if (isLastStep(6)) throw new Error("step 6 不应为末步");

  // 推进/回退钳制
  if (nextStep(7) !== 7) throw new Error("nextStep 在末步不应越界");
  if (prevStep(1) !== 1) throw new Error("prevStep 在首步不应越界");
  if (nextStep(1) !== 2 || prevStep(3) !== 2) throw new Error("nextStep/prevStep 单步推进异常");

  // 可付印:仅末步
  if (!canFinish(7)) throw new Error("末步应可付印");
  if (canFinish(6)) throw new Error("非末步不应可付印");

  // 可前进:第 5 步(合并源)要求 ≥2 文件
  const empty = createDraft();
  if (!canAdvance(1, empty)) throw new Error("非合并源步应恒可前进");
  if (canAdvance(5, empty)) throw new Error("合并源步 <2 文件不应可前进");
  // 草稿形状取自 src 的 WizardDraft(dist 为编译产物、无类型标注,空数组字面量会被推成 never[])
  const two = /** @type {WizardDraft} */ (createDraft());
  two.sources = ["a.md", "b.md"];
  if (!canAdvance(5, two)) throw new Error("合并源步 ≥2 文件应可前进");

  console.log("[ok] wizard-state:步数/首末步/推进回退/可前进/可付印 边界断言通过");
}
