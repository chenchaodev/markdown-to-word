// @ts-check
/**
 * 仓库路径单一来源(项目根 + 顶层目录 + 验收夹具目录)。
 *
 * 为什么需要这个模块:此前全仓 20+ 处各自用 `new URL('..', import.meta.url)` /
 * `import.meta.dirname` + `resolve('..')` 推项目根,而这些写法的正确性取决于**文件所在
 * 目录的深度**。深度是改布局时唯一无法被类型检查或 import 图发现的一类耦合 —— 目录挪一层,
 * 26 处一起错,且每处都「看起来对」。收口到本模块后,深度只在本文件出现一次。
 *
 * 本模块是**全仓唯一允许自算项目根的位置**(门禁 gates/repo/check-import-boundary.mjs 的
 * 规则 no-self-computed-root 对此单点豁免,其余任何文件出现自算写法即判红)。
 * 调用方一律 import 本模块,不要按自己的目录层级再推一遍。
 *
 * 自身深度的取法:本文件恒定住在 `shared/`,故根 = 本文件所在目录的上一级 —— 这是全仓
 * 唯一一处「按目录层级」写死的地方,且被上面那条门禁守着(改本文件位置必须同步改门禁豁免)。
 */
import path from "node:path";

/** 项目根(本文件位于 `<root>/shared/paths.js`) */
export const ROOT = path.resolve(import.meta.dirname, "..");

/** 验收样例(静态文件,随仓库维护) */
export const FIXTURES_DIR = path.join(ROOT, "test", "fixtures");
/** 验收断言产物(按主题命名,无编号) */
export const ARTIFACTS_DIR = path.join(ROOT, "output", "artifacts");
/** smoke 临时产物(运行时自清理) */
export const SMOKE_DIR = path.join(ROOT, "output", "smoke");
/** 失败段专属产物(失败日志 + 该段 buffer 快照;与成功路径产物目录分离,互不覆盖) */
export const FAILURES_DIR = path.join(ARTIFACTS_DIR, "failures");
