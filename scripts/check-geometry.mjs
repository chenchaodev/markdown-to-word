/**
 * 几何门禁(几何 + 跨 DPI 缩放档位):在真实 Electron 窗口里按规格场景采样 renderer 几何,
 * 交由纯判定层(geometry-core)裁决,并按多个设备缩放档位各跑一遍,失败非零退出。
 *
 * 用途:把「视口容纳 / 水平溢出 / 固定槽占位 / 阶段跳动 / 紧凑档免滚动 / 列轴对齐」
 * 这类此前只能靠人工目检的布局不变量变成可执行门禁,截图与机器可读 JSON 报告同时留存
 * (报告供 CI artifact 与代理排障,截图供目检复核);跨 DPI 档位让同一套 12 场景 × 10 恒定组
 * 在 125% / 150% 等缩放下也各跑一遍,并对关键槽位与舞台几何做档位间像素 diff。
 *
 * 复用 visual-check 的场景序列与 preload(同一套离线 api 桩与驱动手法),
 * 故本门禁与目检工具对同一批界面状态给出一致结论;差别只在"是否裁决并退出码"。
 *
 * 角色(同一入口,按环境变量切换 —— 设备缩放因子只在 Chromium 启动早期可读,一档必须一进程):
 *   编排(默认,electron scripts/check-geometry.mjs):先跑判定层自检,再按
 *     M2W_GEOMETRY_SCALES 逐档起 worker 子进程(同一可执行文件 + 本脚本),收各档报告、
 *     算跨 DPI 像素基线与 diff、落一份总报告。
 *   worker(内部):M2W_GEOMETRY_ROLE=worker + M2W_GEOMETRY_SCALE_FACTOR=<档位>,只跑该档 12 场景。
 *
 * 文件布局(判定口径只出现在判定层;依赖方向单向:入口 → 编排/worker → 驱动 → 判定):
 *   scripts/geometry/judge-scale.mjs     判定层:缩放档位解析、缩放生效裁决、单档状态语义
 *   scripts/geometry/judge-cross-dpi.mjs 判定层:跨 DPI 像素基线与 diff、总判定与退出码
 *   scripts/geometry/selftest.mjs        判定层自检(锚点 + 负向探针)
 *   scripts/geometry/driver.mjs          驱动层:路径/配置、页面探针、视口落定与取整补偿
 *   scripts/geometry/worker.mjs          worker 角色:单档 12 场景采样与裁决
 *   scripts/geometry/orchestrator.mjs    编排角色:多档位串行、基线汇总、总报告与退出码
 *   本文件                              入口:角色分派、自检门与退出码收尾
 * 判定层零 Electron / 零 fs:缩放与像素基线判定可脱离窗口独立验证(selftest.mjs 逐条断言)。
 *
 * 阈值口径(单 DPI 与跨 DPI 分开,缩放只增不改):
 * - 单 DPI 判定(容差 1px、固定槽区间、舞台/动作栏恒定、紧凑档滚动预算 1px)在
 *   test/tools/geometry/geometry-core.mjs 内;每个缩放档位都用**同一套** tolPx=1 跑它,
 *   档位之间不因缩放而放宽任何既有阈值。
 * - 跨 DPI diff 单独放宽到 2 CSS px:布局在 CSS px 内算,理论上各档位应相同;但窗口尺寸要经
 *   「DIP → 物理像素 → DIP」两次取整(实测各档误差 0~2px,取整补偿见 driver.mjs settleViewport),叠加不同
 *   GPU/驱动下 1~2px 栅格化抖动,同一元素 rect 会在 1~2px 间摆动。2px 是"吸收上述取整与抖动"
 *   够用、又不至于掩盖真实回归的上限(恒定契约本身是 0px 级契约,放到 4px 以上就失去守护意义)。
 *   宁可漏报 —— 环境差异不得把门禁变成常态红灯。
 * - 不落任何跨运行基线文件:基线是"同一次门禁运行内各档位互比"。提交一份机器相关的基线会让
 *   换机器/换驱动的一方必然判红,那是环境噪声不是回归。
 *
 * 前置:npm run build(dist/renderer 就绪,否则快速失败并给出修复动作)。
 * 用法:electron scripts/check-geometry.mjs
 *   M2W_GEOMETRY_SCALES      缩放档位列表(默认**仅 native**,即不干预系统缩放;多档须显式指定,
 *                          例如 native,1.25,1.5 —— 理由见 DEFAULT_SCALES 处注)
 *   M2W_GEOMETRY_CROSS_TOL_PX 跨 DPI diff 阈值 CSS px(默认 2,取值理由见文件头)
 *   M2W_GEOMETRY_EXPECT_DPR  显式钉住期望 devicePixelRatio(如 CI 断言必须落在 100%);
 *                            不设则强制档按档位值校验、native 档只要求读到稳定有效读数
 *   M2W_GEOMETRY_RUN_TIMEOUT_MS 单档 worker 硬超时 ms(默认 900000,超时记「未测量」)
 *   M2W_GEOMETRY_SELFTEST=0  跳过判定层自检(默认跑:纯函数,含负向探针)
 *   M2W_GEOMETRY_SELFTEST_ONLY=1 只跑判定层自检不起窗口(秒级,用于快速核验判定层)
 *   M2W_GEOMETRY_REPORT      总报告输出路径(默认 output/artifacts/ui-geometry/report.json;
 *                            各档明细与截图在其同级 scale-<档位>/ 下)
 *   M2W_GEOMETRY_SHOT_DIR    worker 角色截图目录(编排角色自动下发,一般不用手设)
 *   M2W_GEOMETRY_TOL_PX      恒定判定容差 px(默认 1)
 *   M2W_GEOMETRY_SCROLL_PX   紧凑/半屏档舞台区纵向滚动预算 px(默认 1,吸收分数像素舍入)
 *   M2W_GEOMETRY_SETTLE_MS   场景驱动后的起跳等待 ms(默认 250)
 *   M2W_GEOMETRY_STABLE_RESIZE_MS  resize 后的最小布局稳定窗口 ms(默认 1500,覆盖档位切换重排)
 *   M2W_GEOMETRY_STABLE_STEP_MS    交互驱动后的最小布局稳定窗口 ms(默认 250)
 *   M2W_GEOMETRY_MAX_WAIT_MS       单场景落定等待上限 ms(默认 15000)
 *   M2W_GEOMETRY_VIEWPORT_SETTLE_MS 视口落定等待上限 ms(默认 10000)
 *   M2W_GEOMETRY_VIEWPORT_COMPENSATIONS 视口取整补偿最大额外次数(默认 2)
 * 退出码:0 全绿 / 1 实测红灯 / 2 有档位未测量(未测量 ≠ 通过)/ 4 入口自身崩溃
 *   (载荷加载失败、ready 回调内异常、加载看门狗超时;与判定结论无关,详见 test/common/entry-guard.mjs)
 */
import { app } from "electron";
import { runEntry } from "../test/common/entry-guard.mjs";

/** 入口标识(诊断首行 `[entry:...]` 用) */
const ENTRY = "check-geometry";

/**
 * 载荷:编排与 worker 两条路径用到的判定/驱动/编排模块。
 * @typedef {object} GeometryPayload
 * @property {import("./geometry/selftest.mjs").runScaleSelfTest} runScaleSelfTest
 * @property {import("./geometry/worker.mjs").runWorker} runWorker
 * @property {import("./geometry/orchestrator.mjs").runOrchestrator} runOrchestrator
 * @property {import("./geometry/driver.mjs").config} config
 * @property {import("./geometry/judge-scale.mjs").parseScales} parseScales
 */

/* ══════════════ §9 角色分派与退出 ═══════════════ */

/**
 * 载荷加载阶段:业务依赖一律走**动态** import,使加载失败被入口守卫捕获并带「模块加载期」标签。
 * 静态 import 的 link 期失败发生在本文件任何语句之前、进程内无处接管(结构性残余,见
 * entry-guard 文件头),故静态导入面只留 electron + 本守卫。
 * @returns {Promise<GeometryPayload>} 载荷绑定
 */
async function loadPayload() {
  const [selftest, worker, orchestrator, driver, judgeScale] = await Promise.all([
    import("./geometry/selftest.mjs"),
    import("./geometry/worker.mjs"),
    import("./geometry/orchestrator.mjs"),
    import("./geometry/driver.mjs"),
    import("./geometry/judge-scale.mjs"),
  ]);
  return {
    runScaleSelfTest: selftest.runScaleSelfTest,
    runWorker: worker.runWorker,
    runOrchestrator: orchestrator.runOrchestrator,
    config: driver.config,
    parseScales: judgeScale.parseScales,
  };
}

/**
 * 编排角色的判定层自检门:不通过就不启动任何窗口(判定层自身不可信时不得再给结论)。
 * @param {GeometryPayload} payload 载荷绑定
 * @returns {number} 退出码(0 通过)
 */
function runSelfTestGate({ runScaleSelfTest, config }) {
  const selfTest = runScaleSelfTest();
  if (config.selfTestOnly) {
    for (const item of selfTest.checks) {
      console.log(`[geo:selftest] ${item.ok ? "PASS" : "FAIL"} ${item.name}${item.detail === null ? "" : ` | ${item.detail}`}`);
    }
  }
  if (!selfTest.ok) {
    for (const item of selfTest.checks.filter((c) => !c.ok)) {
      console.error(`[geo:fail] 自检断言不成立 ${item.name}:${item.detail ?? ""}`);
    }
    console.error("[geo:fail] 缩放判定层自检不通过,门禁不启动(判定层自身不可信时不得再给结论)");
    return 1;
  }
  console.log(
    `[geo:selftest] 缩放判定层自检通过:${selfTest.checks.length} 条断言(锚点 ${selfTest.anchors} / 负向探针 ${selfTest.probes})`,
  );
  return 0;
}

/**
 * 入口执行期:角色分派 + 自检门 + 编排。抛错由壳层接住(阶段「入口执行期」,非零退出)。
 * @param {GeometryPayload} payload 载荷绑定
 * @returns {Promise<number>} 退出码(0 绿 / 1 红灯 / 2 未测量)
 */
async function work(payload) {
  if (process.versions.electron === undefined) {
    throw new Error(
      `本脚本须经 Electron 运行(需真实窗口采样):请用 npm run check:geometry` +
        `(直接 node 运行会因取不到 app/BrowserWindow 而失败)`,
    );
  }
  // worker 角色必须**先于** app ready 跑完自身编排(app.commandLine 追加
  // force-device-scale-factor 只在 Chromium 启动早期生效),故不进 ready 回调
  if (process.env.M2W_GEOMETRY_ROLE === "worker") return payload.runWorker();
  const { config, runOrchestrator, parseScales } = payload;
  // 编排角色自身不建窗口,只负责起子进程与汇总;等 ready 只是为了让 app.exit 收尾干净
  await app.whenReady();
  if (config.selfTestOnly) return runSelfTestGate(payload) === 0 ? 0 : 1;
  if (config.selfTest && runSelfTestGate(payload) !== 0) return 1;
  return runOrchestrator(parseScales(process.env.M2W_GEOMETRY_SCALES));
}

// 退出码由壳层统一收口(报告与逐条 finding 已在 exit 之前落盘/打印,截图同时留存,便于 CI artifact 排障):
// 载荷加载失败 / ready 回调内抛错 / 加载看门狗超时 一律带阶段标签 + 原始堆栈 + 非零码退出,
// 不再退化成「只打一句 App threw an error during load 然后挂到 CI job 超时」。
// 成功/失败都走 app.exit(显式码):app.quit() + process.exitCode 实测退出码是 0(失败被判绿)。
void runEntry({ entry: ENTRY, load: loadPayload, work });
