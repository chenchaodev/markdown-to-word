/**
 * 设置 patch 的「残缺块可接受」形状(跨进程单源)。
 *
 * 为什么单源住在 core 而不是声明它的那个 merge 函数旁边:`AppSettings` 的 patch 要
 * 穿过 renderer 纯逻辑层(renderer/settings/settings-logic.ts 的两个 merge 函数)、
 * renderer 草稿台账(renderer/settings/settings-save.ts)、preload 暴露面
 * (core/preload-api.ts)、preload 实现(main/preload.cts)、main 侧 IPC 处理器与持久化
 * 合并(main/ipc/register.ts、main/persist/settings.ts)。任一侧的类型若自己另写一份,
 * 就回到「同一个形状 N 份声明」的老问题;而放在 renderer 侧则 core 不得依赖 renderer
 * (依赖方向单向,`npm run check:boundary` 判红),`PreloadApi` 根本没法引它。
 * ⇒ 类型随**被描述的域**(`AppSettings` 住在 core/settings)走,六处调用方共用一份。
 *
 * 形状 = `Partial<AppSettings>` + **逐字段兜底的那几块块内也浅可选**。
 * 刻意不套全局 `DeepPartial<T>`:`customPresets` / `pageSetup` 这类「整块替换、
 * 从不逐字段展开」的字段若被一并放宽,声明面会比运行期契约宽 —— 与「声明面比运行期
 * 契约窄」是同一类毛病的反面(见 ADR-072 背景三)。
 *
 * **清单是实现的投影,不是「看起来该有的宽松」**:某个 merge 函数改成整块替换那一天,
 * 那块必须从这里去掉(ADR-070 后果②,ADR-072 沿用)。
 */
import type { AppSettings } from "./settings-defaults.js";

/**
 * 逐字段展开(patch 与基准 `{...a, ...b}`)合并的块 —— 即调用方允许只提交块内部分字段。
 * `mergeSettingsWithDefaults` 走 `{ ...DEFAULT_SETTINGS.X, ...source.X }`,
 * `mergePendingSavePatch` 走 `mergeBlock`(两者同一份实现语义)。
 * 不在本清单内的字段保持**浅可选不变**(`pageSetup` 见 ADR-072 后果「刻意不放开的一处」)。
 */
type DeepMergedBlock =
  | "typography"
  | "headerFooter"
  | "watermark"
  | "aiCleanup"
  | "obsidian";

/**
 * 设置合并/patch 的入参形状:顶层浅可选 + 上述五块**块内也浅可选**。
 *
 * 为什么不是 `Partial<AppSettings>`:`Partial` 是**浅的**,`typography` / `aiCleanup` /
 * `obsidian` 这类子块仍要求字段齐全 —— 而这条链上函数的意义恰恰是「把残缺的设置块
 * 补齐」(旧档缺整块或缺单字段都按默认兜底,与 main 侧 sanitize 同语义)。
 * 声明面比运行期契约窄,故按声明写不出这些函数的正当调用(实测见 ADR-070 / ADR-072 背景)。
 *
 * **只放宽入参,不放宽出参**:`mergeSettingsWithDefaults` 的返回仍是完整 `AppSettings`
 * (main 侧 `settingsSet` 亦然),故本类型不作返回值下发。
 */
export type SettingsMergePatch = Partial<Omit<AppSettings, DeepMergedBlock>> & {
  [K in DeepMergedBlock]?: Partial<AppSettings[K]>;
};
