// @ts-check
/**
 * 视觉自查工具(`npm run ui:shots`):
 * 以离线 api 桩驱动 renderer 到各关键界面状态,逐状态截图到
 * output/artifacts/ui-v4/,供人工/代理目检布局一致性(不参与 CI 门禁)。
 * 场景:empty(空态)/ single(单文件)/ multi(多文件)/ history(历史浮层展开),
 * 另附 compact-stress(880×620 最小窗口附近的几何恒定压力位)、设置抽屉的六个分组、
 * 转换完成态(走真实 convert 链)与关于窗(独立窗口 + 独立 preload 桩)。
 * 抽屉逐组截图是刻意的:全部设置控件都住在抽屉里,而在此之前 ui:shots 一张抽屉都没有 ——
 * 控件位置或可见性出了问题,主窗那几张永远拍不到。
 * 前置:npm run build(dist/renderer 就绪)。
 *
 * 落定纪律:截图前的等待一律是状态表达式(`settle` / `resizeWin` / `shot` 内的画面稳定判据),
 * 不用固定时长。固定时长只在「恰好够长」时成立,抢拍(截到未落定旧帧、settle 不足时截出与
 * 上一张字节相同的帧)就从这里来;状态表达式表达的是「过渡已落定」这件事本身。
 * 三道判据分层:页面侧(无 running 动画 + 画面指纹跨帧/跨轮不变)· 视口侧(视口确实换档)·
 * 合成器侧(连续两次 capturePage 字节一致才落盘)。
 *
 * 已知项(接受不修,登记备查):10-about.png 存在两个稳定变体(同一份代码、两个字节集),
 * 成因是关于窗首帧的光栅化竞态 —— 三道判据答的是「这一帧是否落定」,答不出「首帧光栅化到哪一层」;
 * 已落盘基线同样双峰,故非任何一轮改动引入,登记为已知不复现项,不再当抢拍排查。
 *
 * 产物要直接进 README / 官网当产品图,故三处「会印到画面上」的桩值取真实/安全值,
 * 不取便于辨认的测试字面量:版本号读 package.json(本文件的 APP_VERSION —— 主窗桩
 * 自读同一字段,about 桩因 sandbox+CSP 读不到 node 内建,改由这里 additionalArguments 递入,
 * 全程只有这一个读取点)、完成态输出路径用样例路径而非本机工作区绝对路径
 * (SHOT_OUTPUT_PATH,避免把 C:\Users\<用户名>\… 印进公开仓库的图片)、
 * 更新检查桩造「有可用更新」态(见 visual-about-preload.cjs 的 availableUpdate)。
 *
 * 失败路径:走 test/common/entry-guard.mjs 的统一守卫 —— 抛错时打印阶段标签 + 原始堆栈
 * 并以非零码退出。旧实现是 `app.quit() + process.exitCode = 1`,实测**退出码是 0**
 * (quit 走自身退出路径,只设 exitCode 不生效),即截图工具失败会被读成成功。
 * 本文件的静态导入面只有 node 内建 + electron + 守卫 + 规格单源,无独立载荷(故无 load 阶段)。
 */
import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { runEntry } from "../shared/entry-guard.mjs";
// 抽屉分组序与选择器取自几何门禁的规格单源:两处各抄一份清单,改 IA 组序就会漏改其中一处
import { DRAWER_GROUPS, DRAWER_SELECTORS, drawerTabSelector } from "../shared/geometry/geometry-spec.mjs";
import { ROOT } from "../shared/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 工程根取单源(ADR-040):上跳层数与目录深度耦合,#07 把它搬到 dev/ 时正是因此算错成仓库父目录
const root = ROOT;
const distIndex = path.join(root, "dist", "renderer", "index.html");
const distAbout = path.join(root, "dist", "renderer", "about.html");
const preload = path.join(__dirname, "visual-preload.cjs");
const aboutPreload = path.join(__dirname, "visual-about-preload.cjs");
const outDir = path.join(root, "output", "artifacts", "ui-v4");

/**
 * 仓库真实版本号(取自 package.json)。
 * 为什么读真值而不写死字面量:本工具的产物直接进 README / 官网当产品图,写死的
 * `0.0.0-visual` 既不是用户见得到的版本,又比真实版本串长 —— about 窗 420px 的卡片
 * 装不下,版本芯片会被裁掉一截。读 package.json 则「发版改号 → 图上版本自动跟着变」。
 * 与两个 preload 桩(visual-preload.cjs / visual-about-preload.cjs)读的是同一个字段,
 * 三处同源;本文件是 ESM,故直接 import JSON,不必绕 CJS 的 createRequire。
 * @type {string}
 */
const APP_VERSION = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
).version;

/**
 * 完成态截图里展示的输出路径 —— **刻意不含本机工作区路径**。
 * 为什么:这张图会进 README / 官网。原实现用 path.join(root, …) 拼真实绝对路径,
 * 于是 `C:\Users\<用户名>\Documents\Workspace\…` 这样的本机目录结构被原样印进
 * 公开仓库的图片里(隐私泄露,且图上出现一长串无用路径也干扰观感)。
 * 这里改用与历史桩一致的 C:\demo\ 风格样例路径 —— 它只说明「输出到某目录」这回事,
 * 不泄露任何本机信息。文件名沿用被转换的源文件名,保持画面自洽。
 * @type {string}
 */
const SHOT_OUTPUT_PATH = "C:\\demo\\季度报告.docx";

/**
 * 关于窗尺寸(与 src/main/menu.ts showAboutDialog 的 W/H 同值)。
 * 抄一份而不是 import:menu.ts 的 showAboutDialog 未导出,且它连带 getMainWindow /
 * ipcMain / nativeTheme,为一个截图工具把 main 侧模块树拖进来不划算。
 * 改窗尺寸时两边一起改。
 */
const ABOUT_W = 500;
const ABOUT_H = 560;

/**
 * 关于窗原生底色:固定取浅色值,不读 nativeTheme。
 * 为什么固定:内容随 @media (prefers-color-scheme) 走系统深浅,而 CI 与各人机器
 * 的系统主题不一致 —— 跟着系统走,同一份代码今天拍出浅色明天拍出深色,截图失去
 * 回归价值(这正是 menu.ts 那里刻意读 nativeTheme 的反面:那边要跟内容同源,
 * 这里要可复现)。这里改成固定浅色,内容侧也一并强制浅色(见 ABOUT_FORCE_LIGHT),
 * 两者必须同态,否则会出现浅底深字的穿帮。
 * 改法:要拍深色态就把本值与 ABOUT_FORCE_LIGHT 同时翻成 dark 一套。
 */
const ABOUT_BG = "#F1F1EE";

/**
 * 注入 about 页的强制浅色脚本。
 * about.html 的深色令牌挂在 @media (prefers-color-scheme: dark) 下的
 * `html:not([data-theme="light"])` 选择器上,故写 <html data-theme="light">
 * 即让整条媒体查询失配 —— 用页面自带的显式浅色通道,不新造机制。
 * @type {string}
 */
const ABOUT_FORCE_LIGHT = `document.documentElement.setAttribute("data-theme", "light");`;

/** 入口标识(诊断首行 `[entry:...]` 用) */
const ENTRY = "visual-check";

/**
 * 样例文件绝对路径(供页面侧桩注入)
 * @param {string[]} names 样例文件名
 * @returns {string[]}
 */
const fixtures = (names) =>
  names.map((n) => path.join(root, "test", "fixtures", "acceptance", n));

/** @param {number} ms @returns {Promise<void>} */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 轮询等待页面表达式为真(初始化/状态迁移就绪;固定时长在冷启动下会抢拍)。
 * @param {(code: string) => Promise<unknown>} exec 页面脚本执行器
 * @param {string} expr 页面表达式
 * @param {number} [timeout] 最长等待(ms)
 * @param {string} [label] 超时文案里的定位标签
 * @returns {Promise<void>}
 */
async function waitFor(exec, expr, timeout = 5000, label = expr) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await exec(`!!(${expr})`)) return;
    await wait(60);
  }
  throw new Error(`[ui:shots] timeout waiting for: ${label}`);
}

/**
 * 冻结动效的注入样式(主窗与关于窗共用一份单源)。
 * 改用状态判据后样式仍必须冻结:判据只回答「此刻还有没有东西在动」,答不出「这一帧是不是终态」。
 * 而只压 duration 不压循环次数,`infinite` 动画会以 0.01ms 为一步无限循环
 * (base.css 的 btn-pulse 光环 / status-breathe 圆点 / rot 指示环),每帧落在哪个相位随机 ——
 * 画面永远「在动」,落定判据永不成立,截图也永不可复现。故循环次数一并钉成 1:跑一遍即落定并停在终态。
 * delay 归零同理:about 的 stamp-in 是 280ms 延迟 + both 填充,不归零就停在 opacity:0 的首帧(空章);
 * 主窗的 `transition: visibility 0s linear 0.22s`(settings.css)也因而不拖尾。
 * duration 留 0.01ms 而非 0:0 会把带 delay 的动画整段跳过,拿不到「跑完」的终态。
 * @type {string}
 */
const FREEZE_CSS =
  "*,*::before,*::after{" +
  "transition-duration:0.01ms!important;transition-delay:0s!important;" +
  "animation-duration:0.01ms!important;animation-delay:0s!important;" +
  "animation-iteration-count:1!important}";

/** 单帧等待的兜底上限(ms):隐藏/被遮挡窗口里 rAF 可能不触发,兜底只防死锁,不参与任何判定 */
const FRAME_GUARD_MS = 250;

/** 落定所需的连续成立轮数:取 2 而非 1 —— 一轮成立只说明「此刻没在动」,说明不了「刚才那次变更走完了」 */
const SETTLE_STABLE_ROUNDS = 2;

/** 截图前允许的最大采样次数:连续两次字节一致才算落定,超限即显式失败(不落盘一张未定的帧) */
const SHOT_STABLE_ATTEMPTS = 8;

/**
 * 页面侧单轮「过渡已落定」采样(settle 的判据单源;在页面上下文求值,故为字符串)。
 * 一轮同时给三样:
 *   running —— document.getAnimations() 里 playState==="running" 的条数(含伪元素动画)。
 *              CSS transition/animation 播完即从该表消失,故它是「过渡已落定」的直接可测形态;
 *   stable  —— 相邻两帧的画面指纹是否相同(过渡在跑时 rect/opacity/transform 每帧都在变);
 *   fp      —— 本轮指纹,供调用方跨轮比较(相邻两轮 fp 相同才记一次稳定)。
 * 为什么不能一进来就采样:样式重算之前 transition 尚未被创建,此刻 getAnimations() 必然为空 ——
 * 那正是抢拍发生的空档。故先强制重算,再连过两帧。
 */
const PAGE_SETTLE_SAMPLE = `(async () => {
  const nextFrame = () => new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(go);
    setTimeout(go, ${FRAME_GUARD_MS});
  });
  const fingerprint = () => {
    const parts = [window.innerWidth + "x" + window.innerHeight + "@" +
      document.documentElement.scrollWidth + "x" + document.documentElement.scrollHeight];
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      parts.push(b.left.toFixed(1) + "," + b.top.toFixed(1) + "," +
        b.width.toFixed(1) + "," + b.height.toFixed(1));
      const cs = getComputedStyle(el);
      if (cs.opacity !== "1") parts.push("o" + cs.opacity);
      if (cs.transform !== "none") parts.push("t" + cs.transform);
    }
    return parts.join(";");
  };
  void document.documentElement.offsetHeight;
  await nextFrame();
  const fpA = fingerprint();
  await nextFrame();
  const fpB = fingerprint();
  const running = document.getAnimations().filter((a) => a.playState === "running");
  return JSON.stringify({
    running: running.length,
    stable: fpA === fpB,
    fp: fpB,
    who: running.length > 0 ? running[0].constructor.name : ""
  });
})()`;

/**
 * 等「过渡已落定」:无 running 动画 + 本轮两帧指纹一致 + 与上一轮指纹一致,连续 SETTLE_STABLE_ROUNDS 轮成立。
 * 这是固定时长的替代品(固定时长只在恰好够长时成立,抢拍即由此而来),判据表达的是状态本身。
 * @param {(code: string) => Promise<unknown>} exec 页面脚本执行器
 * @param {string} label 定位标签(日志 + 超时文案)
 * @param {number} [timeout] 最长等待(ms)
 * @returns {Promise<void>}
 */
async function settle(exec, label, timeout = 5000) {
  const t0 = Date.now();
  let stable = 0;
  /** @type {string | null} */
  let lastFp = null;
  let last = "无采样";
  while (Date.now() - t0 < timeout) {
    const sample = JSON.parse(String(await exec(PAGE_SETTLE_SAMPLE)));
    last = `running=${sample.running} stable=${sample.stable} who=${sample.who}`;
    if (sample.running === 0 && sample.stable === true && sample.fp === lastFp) {
      stable += 1;
      if (stable >= SETTLE_STABLE_ROUNDS) {
        console.log(`[ui:shots] settle ${label} ${Date.now() - t0}ms (${stable} 轮)`);
        return;
      }
    } else {
      stable = 0;
    }
    lastFp = sample.fp;
  }
  throw new Error(`[ui:shots] settle timeout: ${label} (${last})`);
}

/**
 * 注入动效冻结样式(幂等,同一窗口重复调用不叠加)
 * @param {(code: string) => Promise<unknown>} exec 页面脚本执行器
 * @returns {Promise<void>}
 */
async function freezeMotion(exec) {
  await exec(
    `(() => { if (document.getElementById("vc-freeze")) return;` +
      `const s = document.createElement("style");` +
      `s.id = "vc-freeze";` +
      `s.textContent = ${JSON.stringify(FREEZE_CSS)};` +
      `document.head.appendChild(s); })()`,
  );
}

/**
 * 改窗宽高,并等视口**真的**换档且重排落定。
 * 为什么不是固定时长:setSize 到视口更新之间隔着窗口管理器与重排,时长只能猜。
 * 判据只断言「视口确实变了」并把实测值打进日志 —— setSize 给的是窗口尺寸,内容视口受窗框影响,
 * 各机器不等(且截图尺寸随视口走),故不写死期望像素值。
 * @param {import("electron").BrowserWindow} win 目标窗口
 * @param {(code: string) => Promise<unknown>} exec 页面脚本执行器
 * @param {number} w 目标窗宽
 * @param {number} h 目标窗高
 * @param {string} label 定位标签
 * @returns {Promise<void>}
 */
async function resizeWin(win, exec, w, h, label) {
  const vp = `window.innerWidth + "x" + window.innerHeight`;
  const before = String(await exec(vp));
  win.setSize(w, h);
  await waitFor(exec, `(${vp}) !== ${JSON.stringify(before)}`, 5000, `${label} 视口换档`);
  await settle(exec, `${label} 视口重排`);
  console.log(`[ui:shots] ${label} viewport ${before} -> ${String(await exec(vp))} (setSize ${w}x${h})`);
}

/** 已落盘截图的字节,用于「两张图字节相同」告警(未落定旧帧的可测征兆) @type {Map<string, Buffer>} */
const writtenShots = new Map();

/**
 * 截当前窗口画面落盘。
 * 落盘判据:连续两次 capturePage 的 PNG 字节完全一致 —— 画面还在动(动效未落定 / 合成器尚未提交
 * 新帧)时两次采样必然不同,字节相等即「这一帧已定」。这道判据管的是合成器侧,与 settle 的页面侧互补。
 * 不再无条件写盘:超限仍未定则显式失败,宁可不产出,也不产出一张未落定的帧冒充通过。
 * @param {import("electron").BrowserWindow} win 目标窗口
 * @param {string} name 截图名(不含扩展名)
 * @returns {Promise<void>}
 */
async function shot(win, name) {
  const file = path.join(outDir, `${name}.png`);
  /** @type {Buffer | null} */
  let prev = null;
  for (let i = 1; i <= SHOT_STABLE_ATTEMPTS; i++) {
    const image = await win.webContents.capturePage();
    const png = image.toPNG();
    if (prev !== null && png.equals(prev)) {
      fs.writeFileSync(file, png);
      const same = [...writtenShots].find(([, buf]) => buf.equals(png));
      if (same !== undefined) {
        console.log(
          `[ui:shots] WARN ${name}.png 与 ${same[0]}.png 字节完全相同 —— ` +
            `两个不同状态拍出同一帧,查是不是某一态没真生效(而不是本次未落定)`,
        );
      }
      writtenShots.set(name, png);
      console.log(
        `[ui:shots] ${name}.png (${image.getSize().width}x${image.getSize().height}) settled@${i}`,
      );
      return;
    }
    prev = png;
  }
  throw new Error(
    `[ui:shots] ${name}: 连续 ${SHOT_STABLE_ATTEMPTS} 次 capturePage 画面仍在变(未落定),不落盘`,
  );
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
  /**
   * @param {string} code 页面脚本源码
   * @returns {Promise<unknown>} 页面返回值
   */
  const exec = (code) => win.webContents.executeJavaScript(code, true);
  // 冻结动效:隐藏窗口里 CSS transition 时钟不推进,浮层 opacity 会冻在中间帧
  // (半透明穿帮);与 reduced-motion 同款兜底,保证截到的是落定终态(样式单源见 FREEZE_CSS)
  await freezeMotion(exec);
  // 就绪判定:i18n 静态文案已应用(版本徽章回填)+ 历史条完成首渲染
  await waitFor(
    exec,
    `document.getElementById("appVersion").textContent.length > 0 && ` +
      `document.getElementById("recentList").children.length > 0`,
    5000,
    "init ready",
  );
  // 落定判据:无 running 动画 + 画面指纹跨帧跨轮不变(入场动效走完、画面定格)
  await settle(exec, "init 入场动效");

  // ① 空态 + 布局探针(sheet 垂直预算 / 列对齐;几何恒定回归用)
  /**
   * @param {string} sel CSS 选择器
   * @returns {string} 量测表达式
   */
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
  await settle(exec, "stage=single 入场动效");
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
  await settle(exec, "stage=multi 入场动效");
  await shot(win, "3-multi");

  // 布局探针:文件态关键盒(列对齐回归用)
  const metricsFiles = await exec(
    `JSON.stringify({ ph: ${probe(".ph")}, listcard: ${probe(".listcard")}, ` +
      `fhint: ${probe(".fhint")}, quickBar: ${probe(".quick-bar")} })`,
  );
  console.log(`[ui:shots] metrics-files ${metricsFiles}`);

  // ③b 转换中模拟:进度行出现 + 状态文案 → 断言动作栏/舞台几何恒定(防跳动回归)
  /**
   * @param {string} sel CSS 选择器
   * @returns {string} 量测表达式
   */
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
  // 判据取注入结果本身(这一步是纯注入,没有迁移标志可等):进度区已可见 + 状态行文案已就位
  await waitFor(
    exec,
    `!document.getElementById("progressArea").classList.contains("hidden") && ` +
      `document.getElementById("status").textContent.length > 0`,
    5000,
    "progress shown",
  );
  await settle(exec, "转换中布局落定");
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
  // 判据取收起态本身:hidden 类已回到节点上,再等重排落定
  await waitFor(
    exec,
    `document.getElementById("progressArea").classList.contains("hidden")`,
    5000,
    "progress hidden",
  );
  await settle(exec, "进度区收起落定");

  // ④ 历史浮出面板展开(有文件态默认收起,手动展开)
  await exec(`document.getElementById("histToggle").click();`);
  // 判据取面板自身的状态载体 aria-expanded(与 recent-files.ts 写的是同一处),不靠等时长
  await waitFor(
    exec,
    `document.getElementById("histToggle").getAttribute("aria-expanded") === "true"`,
    5000,
    "history open",
  );
  await settle(exec, "历史浮层展开落定");
  await shot(win, "4-history-open");
  await exec(`document.getElementById("histToggle").click();`);
  await waitFor(
    exec,
    `document.getElementById("histToggle").getAttribute("aria-expanded") === "false"`,
    5000,
    "history closed",
  );
  await settle(exec, "历史浮层收起落定");

  // ⑤ 几何恒定压力位:收缩到最小窗附近(880×620),验证免滚动与列对齐
  await resizeWin(win, exec, 880, 620, "compact-stress");
  await shot(win, "5-compact-stress");
  const diag = await exec(
    `JSON.stringify({ scrollH: document.querySelector(".stage-wrap").scrollHeight, ` +
      `clientH: document.querySelector(".stage-wrap").clientHeight })`,
  );
  console.log(`[ui:shots] stage-wrap ${diag}`);

  // ⑥ 半屏档(640×560 最小窗):参数条折两行 + 纸面容器完整性
  await resizeWin(win, exec, 640, 560, "halfscreen");
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
  await settle(exec, "stage=empty 入场动效");
  await shot(win, "7-halfscreen-empty");

  // ⑧ 设置抽屉:全部设置控件都住在这里,主窗那几张永远拍不到它们。
  // 先回到基准尺寸 —— 抽屉在 640×560 的半屏档里是唯一能看的形态,拍出来的图对目检没用
  await resizeWin(win, exec, 960, 680, "back-to-baseline");
  await exec(`document.querySelector(${JSON.stringify(DRAWER_SELECTORS.open)}).click();`);
  await waitFor(
    exec,
    `!document.querySelector(${JSON.stringify(DRAWER_SELECTORS.shell)}).classList.contains("hidden")`,
    5000,
    "drawer open",
  );
  await settle(exec, "抽屉入场动效");
  // 逐组 tab 截图:分组序取自规格单源,故新增一组 IA 分组时这里自动跟上
  for (const [index, group] of DRAWER_GROUPS.entries()) {
    const tab = drawerTabSelector(group);
    await exec(`document.querySelector(${JSON.stringify(tab)}).click();`);
    // 判据取面板自身:激活分组必须真的切到本组(此前是「同步重排,等一拍」的手测假设,抢拍就在这一拍)
    await waitFor(
      exec,
      `document.querySelector(${JSON.stringify(DRAWER_SELECTORS.activePanel)})?.dataset.group === ` +
        `${JSON.stringify(group)}`,
      5000,
      `drawer tab ${group}`,
    );
    await settle(exec, `drawer ${group} 面板落定`);
    await shot(win, `8-drawer-${group}`);
    const active = await exec(
      `document.querySelector(${JSON.stringify(DRAWER_SELECTORS.activePanel)})?.dataset.group ?? "(无激活面板)"`,
    );
    console.log(`[ui:shots] drawer tab ${index + 1}/${DRAWER_GROUPS.length} ${group} → active=${String(active)}`);
  }

  // ⑨ 转换完成态:走真实的 convert 链(预检 → convert 桩 → 状态行 / 汇总条 / 警告区),
  // 不像 3b 那样纯注入 DOM —— 完成态的布局全部由页面自己按 ConvertResult 渲染,
  // 注入假结构只能证明「我写的那段 HTML 好看」,证明不了真链路好看。
  await exec(`document.getElementById("drawerCloseBtn").click();`);
  await waitFor(
    exec,
    `document.getElementById("settingsDrawer").classList.contains("hidden")`,
    5000,
    "drawer closed",
  );
  // 回到文件态:完成态要有选中文件,先清空重选一个(单文件走 convert 而非 convertBatch)
  await exec(
    `window.__vc.setNextOpen(${JSON.stringify(fixtures(["basic-render.md"]))});` +
      `document.getElementById("selectBtn").click();`,
  );
  await waitFor(
    exec,
    `document.getElementById("dropZone").dataset.stage === "single"`,
    5000,
    "stage=single (convert done)",
  );
  // 桩值形状按 core/ipc-contract.ts 的 ConvertResult;带一条 keyed 告警是为了让
  // 汇总条的折叠警告区(固定消息槽内滚动)也进画面 —— 空警告区拍不出布局问题
  const outputPath = SHOT_OUTPUT_PATH;
  await exec(
    `window.__vc.setNextConvert(${JSON.stringify({
      ok: true,
      outputPath,
      warnings: [
        {
          key: "warn.imageNotFound",
          params: { src: "images/配图-01.png" },
          fallback: "图片文件不存在: images/配图-01.png",
        },
      ],
    })});` + `document.getElementById("convertBtn").click();`,
  );
  // 完成判据取汇总条自身:类与路径同时到位才算渲染完(showSummary 是同步的,
  // 但 res-beat 重挂会触发一次重排,留一拍余量)
  await waitFor(
    exec,
    `document.getElementById("resultSummary").classList.contains("result-summary--ok") && ` +
      `document.getElementById("summaryPath").textContent === ${JSON.stringify(outputPath)}`,
    5000,
    "summary ok",
  );
  await settle(exec, "完成态汇总条落定");
  console.log(
    `[ui:shots] convert-done stage ${await exec(rectOf(".stage"))} | bar ${await exec(rectOf(".actionbar"))}`,
  );
  await shot(win, "9-convert-done");

  // ⑩ 关于窗:独立 BrowserWindow + 独立 preload 桩(见 visual-about-preload.cjs)。
  // 不走 menu.ts 的 showAboutDialog:它要 getMainWindow / ipcMain / nativeTheme,
  // 截图工具没有 main 侧上下文,且其底色读宿主深浅(不可复现,见 ABOUT_BG 注记)。
  // 这里只复刻「同一份 dist 产物 + 同一套 webPreferences 口径」这一层。
  const about = new BrowserWindow({
    show: false,
    width: ABOUT_W,
    height: ABOUT_H,
    resizable: false,
    backgroundColor: ABOUT_BG,
    webPreferences: {
      preload: aboutPreload,
      // 与 menu.ts 同口径(勿改成 false):桩走 contextBridge,与真实 about 窗一致
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // 隐藏窗口仍正常出帧:capturePage 拿最新画面
      // 版本号递给桩:about 窗 sandbox:true + about.html 的 `script-src 'self'` CSP
      // 下,桩内既 require 不到 node 内建、也被 CSP 拦掉动态 import(两者均实测失败),
      // 故 package.json 的唯一读取点留在本文件(普通 Node ESM),经 additionalArguments 递进去。
      additionalArguments: [`--m2w-version=${APP_VERSION}`],
    },
  });
  await about.loadFile(distAbout, { query: { v: APP_VERSION } });
  /**
   * @param {string} code 页面脚本源码
   * @returns {Promise<unknown>} 页面返回值
   */
  const aboutExec = (code) => about.webContents.executeJavaScript(code, true);
  // 冻结动效:钤印 stampIn 是 animation + backwards 填充,隐藏窗口里时钟不推进时
  // 会冻在 opacity:0 的首帧(印章整块看不见),与主窗同一兜底口径。
  // 另注 delay 归零:钤印有 280ms 延迟 + both 填充,只压 duration 的话延迟期仍按
  // 首帧填 backwards,拍到的还是一枚没落下的空章(样式单源见 FREEZE_CSS)。
  await freezeMotion(aboutExec);
  await aboutExec(ABOUT_FORCE_LIGHT);
  // 就绪判据:版本徽标回填(读 query.v 的真实版本号)+ 更新状态行离开 checking 态
  // (checkUpdate 桩返回 available → 落 --available 类并显示下载按钮);
  // 两者齐了画面才是终态。判据取状态类名而非等时长,理由同主窗 settle 那套。
  await waitFor(
    aboutExec,
    `document.getElementById("version").textContent.length > 0 && ` +
      `document.getElementById("updateStatus").className.includes("update-status--available")`,
    5000,
    "about ready",
  );
  await settle(aboutExec, "about 入场动效");
  await shot(about, "10-about");
  // 断言外链确实被桩拦下(而非真开了浏览器):about 加载完自己不发外链,
  // 故这里主动点一次仓库链接,确认走的是桩而不是 shell.openExternal
  await aboutExec(`document.getElementById("repoLink").click();`);
  const openedUrls = await aboutExec(`JSON.stringify(window.__vcAbout.openedUrls())`);
  console.log(`[ui:shots] about openExternal stubbed ${openedUrls}`);
  about.destroy();
  // 主窗必须**最后**销毁:Windows 上 Electron 最后一个窗口关闭即触发
  // window-all-closed → 应用退出,此时再建关于窗会与退出竞态,
  // 表现为 loadFile 报 ERR_FAILED(-2)(产物与路径均正常,易误判成构建问题)
  win.destroy();

  return 0;
}

// 截图成功也要显式退出码 0(app.quit 的退出码不受 process.exitCode 控制,实测恒为 0);
// 任何抛错由壳层接住 → 打印诊断 + 非零退出,不再「打一行 FAILED 然后退出 0」。
void runEntry({ entry: ENTRY, work: main });
