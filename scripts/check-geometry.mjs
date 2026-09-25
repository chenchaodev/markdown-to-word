/**
 * geometry gate(几何门禁):在真实 Electron 窗口里按规格场景采样 renderer 几何,
 * 交由纯判定层(geometry-core)裁决,失败非零退出。
 *
 * 用途:把「视口容纳 / 水平溢出 / 固定槽占位 / 阶段跳动 / 紧凑档免滚动 / 列轴对齐」
 * 这类此前只能靠人工目检的布局不变量变成可执行门禁,截图与机器可读 JSON 报告同时留存
 * (报告供 CI artifact 与代理排障,截图供目检复核)。
 *
 * 复用 visual-check 的场景序列与 preload(同一套离线 api 桩与驱动手法),
 * 故本门禁与目检工具对同一批界面状态给出一致结论;差别只在"是否裁决并退出码"。
 *
 * 前置:npm run build(dist/renderer 就绪,否则快速失败并给出修复动作)。
 * 用法:electron scripts/check-geometry.mjs
 *   M2W_GEOMETRY_REPORT      报告输出路径(默认 output/artifacts/ui-geometry/report.json)
 *   M2W_GEOMETRY_TOL_PX      恒定判定容差 px(默认 1)
 *   M2W_GEOMETRY_SCROLL_PX   紧凑/半屏档舞台区纵向滚动预算 px(默认 1,吸收分数像素舍入)
 *   M2W_GEOMETRY_SETTLE_MS   场景驱动后的起跳等待 ms(默认 250)
 *   M2W_GEOMETRY_STABLE_RESIZE_MS  resize 后的最小布局稳定窗口 ms(默认 1500,覆盖档位切换重排)
 *   M2W_GEOMETRY_STABLE_STEP_MS    交互驱动后的最小布局稳定窗口 ms(默认 250)
 *   M2W_GEOMETRY_MAX_WAIT_MS       单场景落定等待上限 ms(默认 15000)
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSTANT_GROUPS,
  DEFAULT_SCROLL_BUDGET_PX,
  DEFAULT_TOL_PX,
  NODE_SELECTORS,
  SCENARIOS,
  extractHeightMediaConditions,
  runGeometryGate,
} from "../test/tools/geometry/geometry-core.mjs";
import {
  buildFreezeAnimationScript,
  buildMeasureScript,
  buildViewportSettledScript,
  parseMeasureScript,
} from "../test/tools/geometry/geometry-page.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const distIndex = path.join(root, "dist", "renderer", "index.html");
const preload = path.join(root, "test", "tools", "visual-preload.cjs");
const styleDir = path.join(root, "src", "renderer", "style");
const outDir = path.join(root, "output", "artifacts", "ui-geometry");

const reportPath = path.resolve(
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

const tolPx = envNumber("M2W_GEOMETRY_TOL_PX", DEFAULT_TOL_PX);
const scrollBudgetPx = envNumber("M2W_GEOMETRY_SCROLL_PX", DEFAULT_SCROLL_BUDGET_PX);
const settleMs = envNumber("M2W_GEOMETRY_SETTLE_MS", 250);
const stableAfterResizeMs = envNumber("M2W_GEOMETRY_STABLE_RESIZE_MS", 1500);
const stableAfterStepMs = envNumber("M2W_GEOMETRY_STABLE_STEP_MS", 250);
const maxWaitMs = envNumber("M2W_GEOMETRY_MAX_WAIT_MS", 15000);
const mediaConditions = readMediaConditions();

/**
 * 高度维度媒体查询条件单源:从 renderer 样式表实读(不硬编码档位断点)。
 * 既用于「该视口下响应式档位是否真的生效」断言,也用于 resize 后的落定判据。
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待页面表达式为真(状态迁移/首渲染就绪;固定时长在冷启动下会抢拍) */
async function waitFor(exec, expr, timeout = 5000, label = expr) {
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

const OPS = {
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
async function measureStable(exec, measureSource, minStableMs, maxWaitMs) {
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

async function screenshot(win, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  return `${name}.png (${image.getSize().width}x${image.getSize().height})`;
}

async function main() {
  if (!fs.existsSync(distIndex)) {
    throw new Error(`dist/renderer/index.html 不存在,先执行 npm run build 再跑 geometry gate(${distIndex})`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  await app.whenReady();

  // 保持进程存活:窗口全部关闭后不自动退出,由末尾显式 app.exit(code) 收尾(退出码可控)
  app.on("window-all-closed", () => {});

  const win = new BrowserWindow({
    show: false,
    width: SCENARIOS[0].viewport[0],
    height: SCENARIOS[0].viewport[1],
    webPreferences: {
      preload,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 隐藏窗口仍正常出帧:capturePage 拿最新画面
    },
  });

  await win.loadFile(distIndex);
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await exec(buildFreezeAnimationScript());
  // 就绪判定:i18n 静态文案已应用(版本徽章回填)+ 历史条完成首渲染
  await waitFor(
    exec,
    `document.getElementById("appVersion").textContent.length > 0 && ` +
      `document.getElementById("recentList").children.length > 0`,
    5000,
    "init ready",
  );

  const measureSource = buildMeasureScript(NODE_SELECTORS, mediaConditions);
  const samples = [];
  let current = null; // 首个场景也走 setContentSize,保证视口口径与规格一致

  for (const sc of SCENARIOS) {
    const [wantW, wantH] = sc.viewport;
    const resized = current === null || current[0] !== wantW || current[1] !== wantH;
    if (resized) {
      // setContentSize 而非 setSize:视口(= 内容区)才是规格口径,
      // setSize 含窗口边框与标题栏,量到的视口会系统性小于规格
      win.setContentSize(wantW, wantH);
      current = [wantW, wantH];
      // 视口与响应式档位同时到位再量:高度媒体查询在隐藏窗口 resize 后重算滞后
      await waitFor(
        exec,
        buildViewportSettledScript(sc.viewport, mediaConditions),
        10000,
        `viewport ${wantW}x${wantH} + 档位 ${JSON.stringify(mediaConditions)}`,
      );
    }
    let sample = { id: sc.id, viewport: { width: wantW, height: wantH }, shot: null, error: null };
    try {
      for (const step of sc.steps) {
        const op = OPS[step.op];
        if (op === undefined) {
          throw new Error(`未知驱动指令:${step.op}(规格表与驱动实现漂移)`);
        }
        await op(exec, step);
      }
      await wait(settleMs);
      const measured = await measureStable(
        exec,
        measureSource,
        resized ? stableAfterResizeMs : stableAfterStepMs,
        maxWaitMs,
      );
      if (sc.shot) {
        sample.shot = await screenshot(win, sc.shot);
      }
      sample = { ...sample, ...measured, error: null };
    } catch (err) {
      sample.error = err instanceof Error ? err.message : String(err);
      if (sc.shot) {
        // 失败场景同样留痕截图,便于定位驱动/界面哪一步先崩
        sample.shot = await screenshot(win, `${sc.shot}-FAILED`);
      }
    }
    samples.push(sample);
    const stage = sample.nodes?.dropZone?.dataStage ?? "(未测到)";
    console.log(
      `[geo] ${sc.id} ${wantW}×${wantH} stage=${stage} ` +
        `${sample.error ? `失败:${sample.error}` : (sample.shot ?? "(无截图)")}`,
    );
  }

  win.destroy();

  const result = runGeometryGate(samples, { tolPx, scrollBudgetPx, mediaConditions });
  const report = {
    tool: "check-geometry",
    generatedAt: new Date().toISOString(),
    ok: result.ok,
    options: { tolPx, scrollBudgetPx, settleMs, stableAfterResizeMs, stableAfterStepMs, maxWaitMs },
    stats: result.stats,
    specs: {
      scenarios: SCENARIOS,
      constantGroups: CONSTANT_GROUPS,
      selectors: NODE_SELECTORS,
      mediaConditions,
    },
    findings: result.findings,
    samples,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const f of result.findings) {
    console.error(`[geo:fail] ${f.rule} | ${f.scenario} | ${f.node ?? "-"} | ${f.message}`);
  }
  if (result.ok) {
    console.log(
      `[geo:ok] 几何门禁通过:${result.stats.scenarios} 场景 / ${result.stats.groups} 恒定组 / ` +
        `容差 ${tolPx}px / 紧凑滚动预算 ${scrollBudgetPx}px;报告 ${path.relative(root, reportPath)}`,
    );
    return 0;
  }
  console.error(
    `[geo:fail] 几何门禁失败:共 ${result.findings.length} 项(报告 ${path.relative(root, reportPath)},` +
      `截图目录 ${path.relative(root, outDir)})`,
  );
  return 1;
}

// 退出码用 app.exit(显式码):Electron 的 app.quit() 走自身退出路径,
// 只设 process.exitCode 不生效(实测门禁判红而进程仍退出 0)。
// 报告与逐条 finding 已在 exit 之前落盘/打印,截图同时留存,便于 CI artifact 排障。
main().then(
  (code) => {
    process.exitCode = code;
    app.exit(code);
  },
  (err) => {
    console.error("[geo:fail] geometry gate 执行异常:", err);
    process.exitCode = 1;
    app.exit(1);
  },
);
