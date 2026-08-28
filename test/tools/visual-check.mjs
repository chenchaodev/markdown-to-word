/**
 * 视觉自查工具(`npm run ui:shots`):
 * 以离线 api 桩驱动 renderer 到四个关键舞台状态,逐状态截图到
 * output/artifacts/ui-v4/,供人工/代理目检布局一致性(不参与 CI 门禁)。
 * 场景:empty(空态)/ single(单文件)/ multi(多文件)/ history(历史浮层展开),
 * 另附 compact-stress(880×620 最小窗口附近的几何恒定压力位)。
 * 前置:npm run build(dist/renderer 就绪)。
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const distIndex = path.join(root, "dist", "renderer", "index.html");
const preload = path.join(__dirname, "visual-preload.cjs");
const outDir = path.join(root, "output", "artifacts", "ui-v4");

const fixtures = (names) =>
  names.map((n) => path.join(root, "test", "fixtures", "acceptance", n));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待页面表达式为真(初始化/状态迁移就绪;固定时长在冷启动下会抢拍)。 */
async function waitFor(exec, expr, timeout = 5000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await exec(`!!(${expr})`)) return;
    await wait(60);
  }
  throw new Error(`[ui:shots] timeout waiting for: ${label}`);
}

async function shot(win, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, image.toPNG());
  console.log(`[ui:shots] ${name}.png (${image.getSize().width}x${image.getSize().height})`);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  await app.whenReady();

  const win = new BrowserWindow({
    show: false,
    width: 960,
    height: 680,
    webPreferences: {
      preload,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 隐藏窗口仍正常出帧:capturePage 拿最新画面而非旧帧
    },
  });

  await win.loadFile(distIndex);
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  // 冻结动效:隐藏窗口里 CSS transition 时钟不推进,浮层 opacity 会冻在中间帧
  // (半透明穿帮);与 reduced-motion 同款兜底,保证截到的是落定终态
  await exec(
    `const s = document.createElement("style");` +
      `s.id = "vc-freeze";` +
      `s.textContent = "*,*::before,*::after{transition-duration:0.01ms!important;animation-duration:0.01ms!important}";` +
      `document.head.appendChild(s);`,
  );
  // 就绪判定:i18n 静态文案已应用(版本徽章回填)+ 历史条完成首渲染
  await waitFor(
    exec,
    `document.getElementById("appVersion").textContent.length > 0 && ` +
      `document.getElementById("recentList").children.length > 0`,
    5000,
    "init ready",
  );
  await wait(300); // 入场动效落定

  // ① 空态 + 布局探针(sheet 垂直预算 / 列对齐;几何恒定回归用)
  const probe = (sel) =>
    `(() => { const el = document.querySelector("${sel}"); ` +
    `if (!el) return null; const b = el.getBoundingClientRect(); ` +
    `return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })()`;
  const metricsEmpty = await exec(
    `JSON.stringify({ stage: ${probe(".stage")}, dropCore: ${probe(".drop-core")}, ` +
      `quickBar: ${probe(".quick-bar")} })`,
  );
  console.log(`[ui:shots] metrics-empty ${metricsEmpty}`);
  await shot(win, "1-empty");

  // ② 单文件:对话框桩返回 1 个文件 → 点击「选择文件」→ 等待舞台迁移
  await exec(
    `window.__vc.setNextOpen(${JSON.stringify(fixtures(["basic-render.md"]))});` +
      `document.getElementById("selectBtn").click();`,
  );
  await waitFor(
    exec,
    `document.getElementById("dropZone").dataset.stage === "single"`,
    5000,
    "stage=single",
  );
  await wait(300);
  await shot(win, "2-single");

  // ③ 多文件:追加 2 个文件(n=3)→ 等待舞台迁移
  await exec(
    `window.__vc.setNextOpen(${JSON.stringify(
      fixtures(["toc-caption.md", "page-setup.md"]),
    )});document.getElementById("appendFileBtn").click();`,
  );
  await waitFor(
    exec,
    `document.getElementById("dropZone").dataset.stage === "multi"`,
    5000,
    "stage=multi",
  );
  await wait(300);
  await shot(win, "3-multi");

  // 布局探针:文件态关键盒(列对齐回归用)
  const metricsFiles = await exec(
    `JSON.stringify({ ph: ${probe(".ph")}, listcard: ${probe(".listcard")}, ` +
      `fhint: ${probe(".fhint")}, quickBar: ${probe(".quick-bar")} })`,
  );
  console.log(`[ui:shots] metrics-files ${metricsFiles}`);

  // ③b 转换中模拟:进度行出现 + 状态文案 → 断言动作栏/舞台几何恒定(防跳动回归)
  const rectOf = (sel) =>
    `JSON.stringify((el => { const b = el.getBoundingClientRect(); ` +
    `return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })` +
    `(document.querySelector("${sel}")))`;
  const stageBefore = await exec(rectOf(".stage"));
  const barBefore = await exec(rectOf(".actionbar"));
  await exec(
    `document.getElementById("progressArea").classList.remove("hidden");` +
      `document.getElementById("status").textContent = "正在转换 basic-render.md …";`,
  );
  await wait(300);
  const stageAfter = await exec(rectOf(".stage"));
  const barAfter = await exec(rectOf(".actionbar"));
  console.log(
    `[ui:shots] convert-jump stage ${stageBefore} -> ${stageAfter} | bar ${barBefore} -> ${barAfter}`,
  );
  await shot(win, "3b-converting");
  await exec(
    `document.getElementById("progressArea").classList.add("hidden");` +
      `document.getElementById("status").textContent = "";`,
  );
  await wait(200);

  // ④ 历史浮出面板展开(有文件态默认收起,手动展开)
  await exec(`document.getElementById("histToggle").click();`);
  await wait(350);
  await shot(win, "4-history-open");
  await exec(`document.getElementById("histToggle").click();`);
  await wait(250);

  // ⑤ 几何恒定压力位:收缩到最小窗附近(880×620),验证免滚动与列对齐
  win.setSize(880, 620);
  await wait(400);
  await shot(win, "5-compact-stress");
  const diag = await exec(
    `JSON.stringify({ scrollH: document.querySelector(".stage-wrap").scrollHeight, ` +
      `clientH: document.querySelector(".stage-wrap").clientHeight })`,
  );
  console.log(`[ui:shots] stage-wrap ${diag}`);

  // ⑥ 半屏档(640×560 最小窗):参数条折两行 + 纸面容器完整性
  win.setSize(640, 560);
  await wait(400);
  await shot(win, "6-halfscreen");

  // ⑦ 半屏空态:折行下裁切线仍严格贴容器四角
  await exec(
    `document.getElementById("clearListBtn").click();`,
  );
  await waitFor(
    exec,
    `document.getElementById("dropZone").dataset.stage === "empty"`,
    5000,
    "stage=empty",
  );
  await wait(300);
  await shot(win, "7-halfscreen-empty");

  win.destroy();
  app.quit();
}

main().catch((err) => {
  console.error("[ui:shots] FAILED:", err);
  app.quit();
  process.exitCode = 1;
});
