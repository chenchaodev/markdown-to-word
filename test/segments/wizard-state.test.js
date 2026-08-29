/**
 * 成书向导状态机纯函数测试(B4):边界与「可前进/可付印」判定。
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
  const two = createDraft();
  two.sources = ["a.md", "b.md"];
  if (!canAdvance(5, two)) throw new Error("合并源步 ≥2 文件应可前进");

  console.log("[ok] wizard-state:步数/首末步/推进回退/可前进/可付印 边界断言通过");
}
