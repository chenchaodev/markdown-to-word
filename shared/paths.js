// @ts-check
/**
 * 仓库路径单一来源(项目根 + 顶层目录 + 验收夹具目录)。
 *
 * 为什么需要这个模块:此前全仓 20+ 处各自用 `new URL('..', import.meta.url)` /
 * `import.meta.dirname` + `resolve('..')` 推项目根,而这些写法的正确性取决于**文件所在
 * 目录的深度**。深度是改布局时唯一无法被类型检查或 import 图发现的一类耦合 —— 目录挪一层,
 * 26 处一起错,且每处都「看起来对」。收口到本模块后,深度只在本文件出现一次。
 *
 * 本模块是**全仓唯一「定义」项目根语义的位置**(门禁 gates/repo/check-import-boundary.mjs 的
 * 规则 no-self-computed-root 对此单点豁免,其余任何文件出现自算写法即判红)。
 * 调用方一律 import 本模块,不要按自己的目录层级再推一遍。
 *
 * 取值是 `process.cwd()`,**不是**本文件的位置:根因此是「调用方的工作目录」这一**约定**,
 * 而不是「本模块住在哪」这一代码事实 —— 前者随启动方式变,后者不变,所以任何把 cwd 换成
 * 「按位置派生」的写法(以及 `--root` / 环境变量 / 双分支兜底这三条)都已被否决:
 * 它们要么重新引入位置耦合,要么把一次响亮的启动失败换成静默指向错目录。
 *
 * 代价与它的对应义务:**cwd 是环境依赖,不是代码事实**,所以「以何种 cwd 被启动」必须由调用
 * 方保证。本仓的保证方式是:所有入口守卫一律用 `fileURLToPath(import.meta.url)` 自比
 * (位置事实),而不是拿 ROOT 反推自身路径(那是拿环境去断言代码位置,反了)。
 */
import path from "node:path";

/**
 * 项目根 = 调用方的工作目录(约定,非代码事实;见文件头「代价与它的对应义务」)。
 *
 * 求值只发生一次(模块加载期)。全仓对 `shared/paths.js` 的引用都是静态 import,
 * ESM 提升保证它在任何 `process.chdir` 之前就已定值 —— 故对 chdir 不免疫也无需免疫。
 */
export const ROOT = process.cwd();

/** 验收样例(静态文件,随仓库维护) */
export const FIXTURES_DIR = path.join(ROOT, "test", "fixtures");
/** 验收断言产物(按主题命名,无编号) */
export const ARTIFACTS_DIR = path.join(ROOT, "output", "artifacts");
/** smoke 临时产物(运行时自清理) */
export const SMOKE_DIR = path.join(ROOT, "output", "smoke");
/** 失败段专属产物(失败日志 + 该段 buffer 快照;与成功路径产物目录分离,互不覆盖) */
export const FAILURES_DIR = path.join(ARTIFACTS_DIR, "failures");
