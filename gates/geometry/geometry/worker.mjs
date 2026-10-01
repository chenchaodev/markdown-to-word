/**
 * worker 角色:在**一个**缩放档位下打开真实 Electron 窗口,按 12 个规格场景采样 renderer 几何,
 * 交由判定层(shared/geometry/geometry-core)裁决,写该档报告并给出该档退出码。
 *
 * 一档一进程的原因:设备缩放因子由 Chromium 的 --force-device-scale-factor 在启动早期读取,
 * 同进程内改不动;该开关是**进程内模拟**手段,不改系统 DPI 设置(改用户环境需授权,门禁不得做)。
 * 防假绿第一道:加载后立刻读页面实读 devicePixelRatio,与期望因子不符就整档记「未测量」——
 * 跑完 全量场景却不知道跑在什么缩放下,等于没测。
 *
 * 退出码:0 绿 / 1 红 / 2 未测量(未测量 ≠ 通过)。
 *
 * 本模块不是 Electron 入口:worker 角色由 gates/geometry/check-geometry.mjs 以同一可执行文件派生
 * (M2W_GEOMETRY_ROLE=worker),并被它以**动态 import** 加载。加载失败与本函数抛出的异常都
 * 收敛到那个入口的失败路径守卫(阶段标签 + 原始堆栈 + 非零退出码,见 test/common/entry-guard.mjs);
 * 本文件只负责给出 0/1/2 三种判定语义,退出逻辑不要在这里另抄一份。
 */
import { app, BrowserWindow, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import {
  CSS_TOKEN_RULES,
  NODE_SELECTORS,
  SCENARIOS,
  judgeCssTokens,
  runGeometryGate,
} from "../../../shared/geometry/geometry-core.mjs";
import {
  buildCssTokenScript,
  buildFreezeAnimationScript,
  buildMeasureScript,
  parseCssTokenScript,
} from "../../../shared/geometry/geometry-page.mjs";
import { classifyScaleRun, measureScaleEffect, parseScales, scaleLabel, scaleRequestText } from "./judge-scale.mjs";
import {
  OPS,
  ROOT_ARGUMENT,
  config,
  distIndex,
  measureStable,
  mediaConditions,
  outDir,
  preload,
  reportSpecs,
  root,
  screenshot,
  settleViewport,
  viewportMaxDelta,
  wait,
  waitFor,
  writeReport,
} from "./driver.mjs";

/* ══════════════ §7 worker 角色:在指定缩放档位下采 全量场景并裁决 ═══════════════ */

/**
 * worker 角色:在指定缩放档位下采 全量场景样本并裁决。
 * @returns {Promise<number>} 退出码(0 绿 / 1 红 / 2 未测量)
 */
export async function runWorker() {
  const scales = parseScales(process.env.M2W_GEOMETRY_SCALE_FACTOR ?? "native");
  if (scales.length !== 1) {
    throw new Error(`worker 角色只接受单一缩放档位,收到「${process.env.M2W_GEOMETRY_SCALE_FACTOR}」`);
  }
  const request = scales[0];
  const label = scaleLabel(request);
  const workerReport =
    process.env.M2W_GEOMETRY_REPORT === undefined ? null : path.resolve(root, process.env.M2W_GEOMETRY_REPORT);
  const shotDir =
    process.env.M2W_GEOMETRY_SHOT_DIR === undefined
      ? (workerReport ?? path.join(outDir, `scale-${label}`))
      : path.resolve(root, process.env.M2W_GEOMETRY_SHOT_DIR);
  const reportFile = workerReport ?? path.join(shotDir, "report.json");

  if (!fs.existsSync(distIndex)) {
    throw new Error(`dist/renderer/index.html 不存在,先执行 npm run build 再跑 geometry gate(${distIndex})`);
  }
  fs.mkdirSync(shotDir, { recursive: true });
  // 缩放因子只在 Chromium 启动早期生效,必须早于 app ready 追加进程内开关;
  // 这是**模拟**系统缩放,不改系统 DPI 设置(改用户环境需授权,门禁不得做)
  if (request.mode === "forced") {
    app.commandLine.appendSwitch("force-device-scale-factor", String(request.value));
  }
  await app.whenReady();

  // 保持进程存活:窗口全部关闭后不自动退出,由末尾显式 app.exit(code) 收尾(退出码可控)
  app.on("window-all-closed", () => {});
  const displayScaleFactor = screen.getPrimaryDisplay().scaleFactor;

  const win = new BrowserWindow({
    show: false,
    width: SCENARIOS[0].viewport[0],
    height: SCENARIOS[0].viewport[1],
    webPreferences: {
      preload,
      // 项目根由本层注入(ADR-040:根只有 shared/paths.js 一个来源,且桩不自算):
      // preload 跑在 sandbox 里、又是 CJS,拿不到 ESM 单源,自算则与目录深度耦合
      // ——#07 把它从 test/ 深处(深 2 层)搬到顶层时就因此算成了仓库的父目录。
      // 通道与 tools/visual-about-preload.cjs 的版本号同款(additionalArguments 递旗标)。
      additionalArguments: [ROOT_ARGUMENT],
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 隐藏窗口仍正常出帧:capturePage 拿最新画面
    },
  });

  await win.loadFile(distIndex);
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  await exec(buildFreezeAnimationScript());

  // 缩放生效核验(防假绿第一道):页面实读 devicePixelRatio 与期望因子不符 → 本档不跑场景,
  // 直接记「未测量」。跑完 全量场景却不知道跑在什么缩放下,等于没测。
  const bootReadings = [Number(await exec("window.devicePixelRatio"))];
  const bootEffect = measureScaleEffect({
    request,
    measuredDevicePixelRatios: bootReadings,
    displayScaleFactor,
    expectedDevicePixelRatio: config.expectDpr,
  });
  if (!bootEffect.inEffect) {
    writeReport(reportFile, {
      tool: "check-geometry",
      scaleFactor: {
        label,
        requested: scaleRequestText(request),
        mode: request.mode,
        expectedDevicePixelRatio: bootEffect.expected,
        measuredDevicePixelRatios: bootEffect.measured,
        displayScaleFactor,
        inEffect: false,
        effectReason: bootEffect.reason,
      },
      status: "unmeasured",
      ok: false,
      reason: bootEffect.reason,
      geometry: null,
      reclassified: [],
      viewport: null,
      options: { ...config },
      specs: reportSpecs(),
      samples: [],
    });
    console.error(`[geo] 档位 ${label} 未测量:${bootEffect.reason}`);
    win.destroy();
    return 2;
  }
  console.log(`[geo] 档位 ${label}:devicePixelRatio=${bootEffect.measured.join("/")}(期望 ${String(bootEffect.expected)})`);

  // 就绪判定:i18n 静态文案已应用(版本徽章回填)+ 历史条完成首渲染
  await waitFor(
    exec,
    `document.getElementById("appVersion").textContent.length > 0 && ` +
      `document.getElementById("recentList").children.length > 0`,
    5000,
    "init ready",
  );

  const measureSource = buildMeasureScript(NODE_SELECTORS, mediaConditions());
  const samples = [];
  const settles = [];
  let current = null; // 首个场景也走 setContentSize,保证视口口径与规格一致

  for (const sc of SCENARIOS) {
    const [wantW, wantH] = sc.viewport;
    const resized = current === null || current[0] !== wantW || current[1] !== wantH;
    if (resized) {
      // 视口与响应式档位同时到位再量:高度媒体查询在隐藏窗口 resize 后重算滞后
      settles.push({ scenario: sc.id, ...(await settleViewport(win, exec, sc.viewport)) });
      current = [wantW, wantH];
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
      await wait(config.settleMs);
      const measured = await measureStable(
        exec,
        measureSource,
        resized ? config.stableAfterResizeMs : config.stableAfterStepMs,
        config.maxWaitMs,
      );
      if (sc.shot) {
        sample.shot = await screenshot(win, shotDir, sc.shot);
      }
      sample = { ...sample, ...measured, error: null };
    } catch (err) {
      sample.error = err instanceof Error ? err.message : String(err);
      if (sc.shot) {
        // 失败场景同样留痕截图,便于定位驱动/界面哪一步先崩
        sample.shot = await screenshot(win, shotDir, `${sc.shot}-FAILED`);
      }
    }
    samples.push(sample);
    const stage = sample.nodes?.dropZone?.dataStage ?? "(未测到)";
    console.log(
      `[geo] ${sc.id} ${wantW}×${wantH} stage=${stage} ` +
        `${sample.error ? `失败:${sample.error}` : (sample.shot ?? "(无截图)")}`,
    );
  }

  // CSS 令牌恒等(取消态不得被读成成功绿 / 失败红):在**场景循环之后**、窗口销毁之前跑一次。
  // 放这里而不是混进场景采样:它与视口/档位无关(同一套 CSS 算一次即够),而探针要短暂往
  // 真实锚点旁边插合成节点 —— 插在场景循环里会污染同批布局测量,放在循环外就没有这个面。
  // 探针自身用完即摘;判红不影响几何样本,两类 finding 合并进同一份报告。
  const tokenVerdict = await (async () => {
    try {
      const readings = parseCssTokenScript(await exec(buildCssTokenScript(CSS_TOKEN_RULES)));
      return judgeCssTokens(readings);
    } catch (err) {
      // 探针崩了**显式判红**,不许降级成「跳过」(静默跳过正是这批判据迁出来的病根)
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        findings: [
          {
            rule: "css-token/probe-failed",
            severity: "error",
            scenario: "css-token-identity",
            node: null,
            message: `CSS 令牌恒等探针执行失败:${reason};本批判据未测量(≠ 通过)`,
          },
        ],
        stats: { rules: CSS_TOKEN_RULES.length, readings: 0, findings: 1 },
      };
    }
  })();
  console.log(
    `[geo] CSS 令牌恒等:${tokenVerdict.stats.rules} 条判据 / ${tokenVerdict.stats.readings} 条读数 ` +
      `${tokenVerdict.ok ? "通过" : `判红(${tokenVerdict.stats.findings} 项)`}`,
  );

  win.destroy();

  const result = runGeometryGate(samples, {
    tolPx: config.tolPx,
    scrollBudgetPx: config.scrollBudgetPx,
    mediaConditions: mediaConditions(),
  });
  // 令牌 finding 并入总 findings:退出码与报告只有一条出口,不另开分支(避免「几何绿就算过」)
  const allFindings = [...result.findings, ...tokenVerdict.findings];
  const dprReadings = samples
    .map((sample) => sample.devicePixelRatio)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const maxDeltaPx = viewportMaxDelta(samples);
  // 判定层 finding 原样保留;状态语义(measured/failed/unmeasured)与跨档基线由编排层汇总
  const verdict = classifyScaleRun({
    label,
    request,
    status: /** @type {const} */ ("measured"),
    reason: null,
    measuredDevicePixelRatios: dprReadings,
    displayScaleFactor,
    findings: allFindings,
    viewportMaxDeltaPx: maxDeltaPx,
  });
  writeReport(reportFile, {
    tool: "check-geometry",
    scaleFactor: {
      label,
      requested: scaleRequestText(request),
      mode: request.mode,
      expectedDevicePixelRatio: bootEffect.expected,
      measuredDevicePixelRatios: dprReadings,
      displayScaleFactor,
      inEffect: bootEffect.inEffect,
      effectReason: bootEffect.reason,
    },
    status: verdict.status,
    ok: verdict.status === "measured",
    reason: verdict.reason,
    geometry: {
      ok: result.ok && tokenVerdict.ok,
      stats: result.stats,
      findings: result.findings,
      // 令牌恒等单列一段(不混进 geometry.stats):它与场景/视口无关,统计口径不同,
      // 混在一起会让「场景数/恒定组数」这类既有数字的含义被污染
      cssToken: { ok: tokenVerdict.ok, stats: tokenVerdict.stats, findings: tokenVerdict.findings },
    },
    reclassified: verdict.reclassified,
    viewport: {
      maxAbsDeltaPx: maxDeltaPx,
      compensationsUsed: settles.filter((item) => item.compensated).length,
      settles,
    },
    options: { ...config },
    specs: reportSpecs(),
    samples,
  });

  for (const f of allFindings) {
    console.error(`[geo:fail] ${f.rule} | ${f.scenario} | ${f.node ?? "-"} | ${f.message}`);
  }
  if (verdict.status === "measured") {
    console.log(
      `[geo:ok] 档位 ${label} 几何门禁通过:${result.stats.scenarios} 场景 / ${result.stats.groups} 恒定组 / ` +
        `${tokenVerdict.stats.rules} 令牌恒等判据 / ` +
        `容差 ${config.tolPx}px / 紧凑滚动预算 ${config.scrollBudgetPx}px;报告 ${path.relative(root, reportFile)}`,
    );
    return 0;
  }
  if (verdict.status === "unmeasured") {
    console.error(`[geo:partial] 档位 ${label} 记「未测量」(≠ 通过):${verdict.reason ?? "(无原因)"}`);
    return 2;
  }
  console.error(
    `[geo:fail] 档位 ${label} 几何门禁失败:共 ${allFindings.length} 项` +
      `(报告 ${path.relative(root, reportFile)},截图目录 ${path.relative(root, shotDir)})`,
  );
  return 1;
}
