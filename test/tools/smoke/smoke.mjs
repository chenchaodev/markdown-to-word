// @ts-check
/**
 * 冒烟自测的 dev 侧入口(薄封装,零实现)。
 *
 * 唯一实现在 src/main/smoke.ts(编译产物 dist/main/smoke.js):实现必须进 src 编译面
 * 才能随包分发,发布侧检查(check:unpacked-smoke / check:install-smoke)正是以 --smoke
 * 启动真实可执行文件并断言诊断标记,dev-only 的 test/ 设施进不了 app.asar。
 * 本文件因此只做转调:既有诊断设施的引用点(人工排查、手工脚本化冒烟)仍可用本路径,
 * 而冒烟逻辑只有一份,不会与实现漂移。
 *
 * 注意:本模块 import 的是 dist 运行实例(dist/main/persist/settings.js 等),与运行中
 * 应用共享同一模块缓存(settings/ui-state 隔离语义依赖此点),不可改为 import src 源码。
 * 主进程 --smoke 分支直连 dist/main/smoke.js,不经本文件(见 src/main/index.ts)。
 */
export { runSmoke } from "../../../dist/main/smoke.js";
