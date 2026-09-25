/**
 * 成书向导单例运行态(拆分自 book-wizard.ts,D1,纯搬移零行为改动):
 * 草稿(封面/合并源/付印格式)、模态容器引用与当前步——步骤渲染两岛、
 * 校验绑定与外壳提交均读写同一单例,单独落位以避免相互 import 成环
 * (若单例留外壳,交付步渲染 ⇄ 外壳构建会互指成环)。
 * 生命周期与拆分前一致:open 时重置草稿与步序,容器首次 open 构建后缓存复用,
 * 关闭仅隐藏不销毁、不重置草稿(下次 open 再重置)。
 * ESM 导入绑定只读——重新赋值经本模块 resetDraft/setStep/setWizardEl 收口,
 * 各消费方仅读取实时绑定。
 */
import { createDraft, type WizardDraft } from "./wizard-state.js";

/** 向导草稿(跨步共享;封面为一次性元数据,不写 state.settings) */
export let draft: WizardDraft = createDraft();

/** 模态容器(首次 open 构建后缓存;关闭仅加 hidden) */
export let wizardEl: HTMLElement | null = null;

/** 当前步(1..WIZARD_TOTAL_STEPS;推进钳制在 wizard-state 纯函数) */
export let currentStep = 1;

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
