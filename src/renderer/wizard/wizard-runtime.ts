/**
 * 成书向导单例运行态(拆分自 book-wizard.ts,纯搬移零行为改动):
 * 草稿(封面/合并源/付印格式)、模态容器引用与当前步——步骤渲染两岛、
 * 校验绑定与外壳提交均读写同一单例,单独落位以避免相互 import 成环
 * (若单例留外壳,交付步渲染 ⇄ 外壳构建会互指成环)。
 * 生命周期与拆分前一致:open 时重置草稿与步序,容器首次 open 构建后缓存复用,
 * 关闭仅隐藏不销毁、不重置草稿(下次 open 再重置)。
 *
 * **不再以可变绑定形态出口**(ADR-065 §决定 ③ 要的「store 之外无可重绑导出」,
 * 门禁 `renderer-no-export-let` 钉住):可重绑的出口让任何 import 方都能越过
 * resetDraft / setStep / setWizardEl 直接重绑单例,funnel 只剩一句口头约定。
 * 改为 `export const runtime` 只读门面 —— 可变态是模块私有 `let`,消费方只能读
 * 实时态(`runtime.draft` 始终等于当次赋值后的值,与原 ESM 实时绑定等价),
 * 试图 `runtime.currentStep = 5` 在 typecheck 处即编译不过。
 *
 * 收敛落点的完整裁决见 ADR-065 的三档登记:向导运行态是 **wizard 根内部闭环**
 * (四个 feature 之间无消费者),不进 store —— 搬进去只会让 store 长出一份只
 * 服务一个 feature 的形状。
 */
import { createDraft, type WizardDraft } from "./wizard-state.js";

let draft: WizardDraft = createDraft();

let wizardEl: HTMLElement | null = null;

let currentStep = 1;

/** 单例运行态的只读门面(赋值只经下方三个 setter)。 */
export const runtime = {
  get draft(): WizardDraft {
    return draft;
  },
  get wizardEl(): HTMLElement | null {
    return wizardEl;
  },
  get currentStep(): number {
    return currentStep;
  },
};

/** 重置草稿(打开向导时调用,等价拆分前 `draft = createDraft()`) */
export function resetDraft(): void {
  draft = createDraft();
}

/** 设置当前步(打开时归 1;推进由 goTo 钳制后写入) */
export function setStep(step: number): void {
  currentStep = step;
}

/** 缓存模态容器(仅首次构建时调用,等价拆分前 `wizardEl = buildWizard()`) */
export function setWizardEl(el: HTMLElement): void {
  wizardEl = el;
}
