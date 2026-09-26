/**
 * 驱动层:工程路径与门禁配置(单一读取点)、页面侧探针、视口落定与 DIP 取整补偿、报告落盘。
 *
 * 零 electron 依赖(窗口与页面执行器由 worker 以参数注入),可单独被 worker 与编排两个角色复用。
 * 页面探针的度量脚本仍取自 test/tools/geometry/geometry-page.mjs(共享探针单源);
 * 本文件只额外提供**带偏差的视口读数**探针 —— 取整补偿要用实测差值回补。
 *
 * 视口取整补偿的存在理由(不补偿则 1.5 档必然假红):setContentSize 的入参是 DIP,
 * 窗口管理器按物理像素量化后再折回 DIP,各缩放档的取整误差不同(实测 dpr1/1.25 → 0;
 * dpr2 → +1;dpr1.5 → +2;dpr2.25 → +1/+2)。1.5 档不补偿就会以 viewport-mismatch 判红,
 * 而那是驱动取整、不是界面回归;为缩放档放宽容差同样不对(会把真实溢出一起放过)。
 * 故按「实测差回补」再试一次,补偿后仍以原 1px 容差判定,次数有上限,超限即按未落定失败。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSTANT_GROUPS,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  NODE_SELECTORS,
  SCENARIOS,
  SLOT_INVARIANTS,
  evaluateMediaCondition,
  extractHeightMediaConditions,
} from "../../test/tools/geometry/geometry-core.mjs";
// 舞台/纸面/滚动容器 key 判定层只内部使用、未再导出,这三项直接取规格单源
import { PAPER_KEY, SCROLL_KEY, STAGE_KEY } from "../../test/tools/geometry/geometry-spec.mjs";
import { parseMeasureScript } from "../../test/tools/geometry/geometry-page.mjs";
import { DEFAULT_CROSS_DPI_TOL_PX } from "./judge-cross-dpi.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// 本岛比入口深一级( scripts/geometry/ ),故工程根回退两级
const root = path.resolve(here, "..", "..");
export { root };
/** 入口脚本绝对路径:worker 子进程拉起的就是它(回上一级取入口,不是本岛) */
export const entryScriptPath = path.resolve(here, "..", "check-geometry.mjs");
export const distIndex = path.join(root, "dist", "renderer", "index.html");
export const preload = path.join(root, "test", "tools", "visual-preload.cjs");
const styleDir = path.join(root, "src", "renderer", "style");
export const outDir = path.join(root, "output", "artifacts", "ui-geometry");

export const reportPath = path.resolve(
  root,
  process.env.M2W_GEOMETRY_REPORT ?? path.join("output", "artifacts", "ui-geometry", "report.json"),
);

const fixtures = (names) =>
  names.map((n) => path.join(root, "test", "fixtures", "acceptance", n));

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`环境变量 ${name} 非数值:${raw}`);
  }
  return value;
};

/** 可选数值环境变量(未设置或空白 → null;用于"钉住期望值"这类可选项) */
const envOptionalNumber = (name) => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`环境变量 ${name} 非法(须为正数):${raw}`);
  }
  return value;
};

/* ══════════════ §6 驱动层(页面探针、视口落定、场景驱动)══════════════ */

export const config = {
  tolPx: envNumber("M2W_GEOMETRY_TOL_PX", DEFAULT_TOL_PX),
  scrollBudgetPx: envNumber("M2W_GEOMETRY_SCROLL_PX", DEFAULT_SCROLL_BUDGET_PX),
  settleMs: envNumber("M2W_GEOMETRY_SETTLE_MS", 250),
  stableAfterResizeMs: envNumber("M2W_GEOMETRY_STABLE_RESIZE_MS", 1500),
  stableAfterStepMs: envNumber("M2W_GEOMETRY_STABLE_STEP_MS", 250),
  maxWaitMs: envNumber("M2W_GEOMETRY_MAX_WAIT_MS", 15000),
  viewportSettleMs: envNumber("M2W_GEOMETRY_VIEWPORT_SETTLE_MS", 10000),
  // 视口取整补偿次数上限(负数/小数归零):补偿只是把驱动取整误差压回容差,不是无限重试
  viewportCompensations: Math.max(0, Math.trunc(envNumber("M2W_GEOMETRY_VIEWPORT_COMPENSATIONS", 2))),
  crossTolPx: envNumber("M2W_GEOMETRY_CROSS_TOL_PX", DEFAULT_CROSS_DPI_TOL_PX),
  runTimeoutMs: envNumber("M2W_GEOMETRY_RUN_TIMEOUT_MS", 900000),
  expectDpr: envOptionalNumber("M2W_GEOMETRY_EXPECT_DPR"),
  selfTest: process.env.M2W_GEOMETRY_SELFTEST !== "0",
  selfTestOnly: process.env.M2W_GEOMETRY_SELFTEST_ONLY === "1",
};

/**
 * 跨 DPI 像素基线覆盖的节点(从规格单源派生,不另列一份清单):
 * 恒定组受约束节点(舞台/动作栏/历史标题条/消息槽)+ 固定槽 + 舞台容器/纸面/滚动容器
 * + 各场景列轴组成员(队列三件套与纸面脚注条)—— 即「关键槽位与舞台几何」全集。
 */
export const CROSS_DPI_NODES = [
  ...new Set([
    ...CONSTANT_GROUPS.map((group) => group.node),
    ...SLOT_INVARIANTS.map((slot) => slot.node),
    STAGE_KEY,
    SCROLL_KEY,
    PAPER_KEY,
    ...SCENARIOS.flatMap((scenario) =>
      (scenario.columnAxis ?? []).flatMap((group) => [group.ref, ...group.members]),
    ),
  ].filter((key) => typeof key === "string")),
].sort();

/**
 * 高度维度媒体查询条件单源:从 renderer 样式表实读(不硬编码档位断点)。
 * 既用于「该视口下响应式档位是否真的生效」断言,也用于 resize 后的落定判据。
 * @returns {string[]} 条件串(去重、保持出现序)
 */
function readMediaConditions() {
  const conds = [];
  for (const file of fs.readdirSync(styleDir).filter((f) => f.endsWith(".css"))) {
    for (const cond of extractHeightMediaConditions(fs.readFileSync(path.join(styleDir, file), "utf8"))) {
      if (!conds.includes(cond)) conds.push(cond);
    }
  }
  if (conds.length === 0) {
    throw new Error("renderer 样式表未找到任何高度维度媒体查询;档位断言将失去依据,请复核样式表结构");
  }
  return conds;
}

export const mediaConditions = readMediaConditions();

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待页面表达式为真(状态迁移/首渲染就绪;固定时长在冷启动下会抢拍) */
export async function waitFor(exec, expr, timeout = 5000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await exec(`!!(${expr})`)) return;
    await wait(60);
  }
  throw new Error(`等待页面条件超时:${label}`);
}

/** 存在性断言后再点击:选择器缺失时给出可定位的错误,不静默跳过 */
async function click(exec, selector) {
  const exists = await exec(`document.querySelector(${JSON.stringify(selector)}) !== null`);
  if (!exists) {
    throw new Error(`驱动步骤失败:选择器不存在 ${selector}`);
  }
  await exec(`document.querySelector(${JSON.stringify(selector)}).click()`);
}

export const OPS = {
  /** 设定下一次对话框返回的路径列表(消费即清空) */
  setFiles: (exec, step) =>
    exec(`window.__vc.setNextOpen(${JSON.stringify(fixtures(step.fixtures ?? []))})`),
  click: (exec, step) => click(exec, step.selector),
  /** 模拟转换中:进度行显隐 + 状态行写入(与 visual-check 同手法,验几何恒定) */
  progress: async (exec, step) => {
    if (step.show === true) {
      await exec(
        `document.getElementById("progressArea").classList.remove("hidden");` +
          `document.getElementById("progressFill").style.width = "45%";` +
          `document.getElementById("progressText").textContent = "45%";` +
          `document.getElementById("status").textContent = "正在转换 basic-render.md …";`,
      );
    } else {
      await exec(
        `document.getElementById("progressArea").classList.add("hidden");` +
          `document.getElementById("progressFill").style.width = "0%";` +
          `document.getElementById("progressText").textContent = "0%";` +
          `document.getElementById("status").textContent = "";`,
      );
    }
  },
};

/**
 * 布局落定采样:连续稳定达到 minStableMs 才采用。
 *
 * 依据(Windows 隐藏窗口实测):setContentSize 后 innerWidth/innerHeight 与 matchMedia
 * 立即更新,但当响应式档位发生切换时(如 960×680 → 880×620,矮窗档 --tbh 生效),
 * 布局树要约 1s 后才真正重排 —— 期间量到的是"新视口 + 旧档位"混合态
 * (实测 --tbh 已是 40px 而 .h-head 仍 40px 高、.stage 仍按上一档偏移 8px)。
 * 故不能只等视口/档位标志位,必须要求布局采样在最小稳定窗口内保持不变。
 * resize 后用较长窗口(默认 1500ms),交互驱动用短窗口(默认 250ms,点击为同步重排)。
 * 超过 maxWaitMs 仍未收敛则返回最后一次采样 —— 残留不稳定会由判定层的恒定/越界断言暴露。
 */
export async function measureStable(exec, measureSource, minStableMs, maxWaitMs) {
  const t0 = Date.now();
  let prev = null;
  let prevAt = 0;
  for (;;) {
    const cur = parseMeasureScript(await exec(measureSource));
    const now = Date.now();
    if (prev !== null && JSON.stringify(cur) === JSON.stringify(prev) && now - prevAt >= minStableMs) {
      return cur;
    }
    if (now - t0 >= maxWaitMs) return cur;
    prev = cur;
    prevAt = now;
    await wait(150);
  }
}

/**
 * 视口落定探针表达式(页面侧一次读出视口与响应式档位匹配态)。
 * 与 geometry-page 的 buildViewportSettledScript 同形,但这里需要的是**带偏差的读数**
 * (取整补偿要用实测差值回补),故就地构造;共享探针模块属 test/ 契约,不在本改动面内。
 * @param {[number, number]} viewport 目标视口
 * @returns {string} 表达式
 */
function buildViewportProbe(viewport) {
  const tierChecks = mediaConditions.map(
    (cond) =>
      `window.matchMedia(${JSON.stringify(cond)}).matches === ` +
      JSON.stringify(evaluateMediaCondition(cond, { width: viewport[0], height: viewport[1] })),
  );
  return (
    `JSON.stringify({ vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio, tiersOk: ` +
    `${tierChecks.length === 0 ? "true" : tierChecks.join(" && ")} })`
  );
}

/**
 * 轮询视口与档位,返回最后一次读数(不抛错:由调用方决定是补偿还是失败)。
 * @param {(code: string) => Promise<unknown>} exec 页面执行器
 * @param {[number, number]} viewport 目标视口
 * @param {number} tolPx 视口容差(CSS px)
 * @param {number} timeoutMs 落定等待上限
 * @returns {Promise<{ settled: boolean, vw: number, vh: number, tiersOk: boolean }>} 读数
 */
async function pollViewport(exec, viewport, tolPx, timeoutMs) {
  const probe = buildViewportProbe(viewport);
  const t0 = Date.now();
  for (;;) {
    const last = JSON.parse(await exec(probe));
    const settled =
      last.tiersOk && Math.abs(last.vw - viewport[0]) <= tolPx && Math.abs(last.vh - viewport[1]) <= tolPx;
    if (settled || Date.now() - t0 >= timeoutMs) {
      return { settled, vw: last.vw, vh: last.vh, tiersOk: last.tiersOk };
    }
    await wait(60);
  }
}

/**
 * setContentSize + 落定 + **取整补偿**。
 *
 * 取整补偿的依据(本机逐档实测,setContentSize 的 DIP 入参 → 页面实读 innerWidth/innerHeight):
 *   缩放 1    → 960×680 偏差 0
 *   缩放 1.25 → 960×680 偏差 0
 *   缩放 2    → 961×681 偏差 +1
 *   缩放 1.5  → 962×682 偏差 +2(补偿一次后精确命中 960×680)
 *   缩放 2.25 → 961×682 偏差 +1/+2(补偿一次后 960×679,落在容差内)
 * 即入参是 DIP,窗口管理器按物理像素量化后再折回 DIP,各档误差不同。不补偿的话 1.5 档会以
 * viewport-mismatch 判红 —— 那是驱动取整,不是界面回归;为缩放档放宽容差同样不对(会把真实
 * 溢出一起放过)。故按"实测差回补"再试一次,补偿后仍以原容差判定,次数有上限;超限即按未落定
 * 失败(不静默放行)。native 档(本机缩放 2)首次即落在容差内,补偿不触发 —— 单 DPI 判定口径
 * 零变化。
 * @param {import("electron").BrowserWindow} win 窗口
 * @param {(code: string) => Promise<unknown>} exec 页面执行器
 * @param {[number, number]} viewport 目标视口
 * @returns {Promise<{ attempts: number, compensated: boolean, requested: [number, number], actual: [number, number] }>} 落定证据
 */
export async function settleViewport(win, exec, viewport) {
  let requestW = viewport[0];
  let requestH = viewport[1];
  for (let attempt = 0; attempt <= config.viewportCompensations; attempt += 1) {
    // setContentSize 而非 setSize:视口(= 内容区)才是规格口径,
    // setSize 含窗口边框与标题栏,量到的视口会系统性小于规格
    win.setContentSize(requestW, requestH);
    const probe = await pollViewport(exec, viewport, config.tolPx, config.viewportSettleMs);
    if (probe.settled) {
      return { attempts: attempt + 1, compensated: attempt > 0, requested: [requestW, requestH], actual: [probe.vw, probe.vh] };
    }
    if (!probe.tiersOk) {
      throw new Error(
        `视口 ${viewport.join("×")} 落定后响应式档位仍不匹配(实读 ${probe.vw}×${probe.vh},` +
          `档位条件 ${JSON.stringify(mediaConditions)});高度档未生效时量到的是上一档布局`,
      );
    }
    requestW = viewport[0] + (viewport[0] - probe.vw);
    requestH = viewport[1] + (viewport[1] - probe.vh);
  }
  throw new Error(
    `视口 ${viewport.join("×")} 在 ${config.viewportCompensations + 1} 次 setContentSize 内未落入 ±${config.tolPx}px` +
      `(DIP↔物理像素取整补偿无法收敛)`,
  );
}

export async function screenshot(win, shotDir, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(shotDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  return `${name}.png (${image.getSize().width}x${image.getSize().height})`;
}

/** 实测视口与规格视口的最大轴向偏差(供「视口取整类 finding」窄口径降级判定用) */
export function viewportMaxDelta(samples) {
  const want = new Map(SCENARIOS.map((sc) => [sc.id, sc.viewport]));
  let max = 0;
  for (const sample of samples) {
    if (sample.error || sample.viewport === undefined) continue;
    const spec = want.get(sample.id);
    if (spec === undefined) continue;
    max = Math.max(max, Math.abs(sample.viewport.width - spec[0]), Math.abs(sample.viewport.height - spec[1]));
  }
  return max;
}

/**
 * 写报告(确定性:无时间戳、无随机目录名、无绝对路径)。
 * @param {string} file 报告绝对路径
 * @param {object} report 报告正文
 * @returns {void}
 */
export function writeReport(file, report) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

/** 规格与配置的公共部分(总报告与各档报告共用同一份,便于交叉核对) */
export function reportSpecs() {
  return { scenarios: SCENARIOS, constantGroups: CONSTANT_GROUPS, selectors: NODE_SELECTORS, mediaConditions };
}
