// @ts-check
/**
 * 标题区版本号徽章段(src/renderer/renderer.ts 末尾那次 getVersion 调用):
 *
 * 守护的不变量:版本号取不到时**不许静默**。原实现是
 * `void window.api.getVersion().then(...)` 且**无 reject 分支** —— reject 时
 * 徽标恒空、只留一条 unhandled rejection、不报任何错。那一路静默失败正是上一轮
 * 把一处断链放大成「门禁等 5s 无解释」的原因(几何门禁 `init ready` 用 `&&`
 * 串了版本号,这一路挂了就让整条门禁超时,且没有任何线索指向版本号)。
 *
 * 三条断言(注入 reject 时):
 * 1. 徽标文案**非空且可辨识**(不得留白 —— 空白既看不出「取不到」,也看不出
 *    「还没取到」,两者都把排查引向错误方向);
 * 2. **不得伪装成成功**:不得回填任何看起来像真实版本号的值(判据 = 文案里
 *    不得出现数字版本形态,`v0.0.0` / `vunknown` 这类「假版本号」比空白更坏:
 *    用户会拿一个错版本号去报 bug);
 * 3. 错误须经本仓既有可见通道呈现(状态行 #status 经 setError 写入)，
 *    且带上原因 —— 徽标 title 与状态行都要能定位到失败。
 *
 * 判据只许加严:任一条回退(留白 / 回填假版本 / 吞掉错误)本段即判红。
 *
 * 为什么用子进程实跑而不像 init-barrier 段那样只读源文件文本:本段要断言的是
 * **reject 注入后的实际可见文案**,读源码结构证明不了「运行时确实写了非空文案」。
 * renderer.js 是模块顶层即绑定 DOM 的组合根,一个进程内 import 一次就固化,
 * 故成功/失败两条用例各起一个子进程(同 clean-artifacts-gate 段的沙箱纪律:
 * 不碰真实工作树,只用 DOM stub + api 桩)。
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveNode } from "../harness/node-exec.js";
import { ROOT } from "../harness/paths.js";
import { createAsserter } from "../harness/assert.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("version-chip");

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,判据静态看不见本段的主体 ——
 * 被测的 `dist/renderer/renderer.js` 由子进程 `--input-type=module -e` 的**字符串内
 * `import(file://…)`** 载入(URL 逐段拼进脚本文本),段内零 renderer import。
 *
 * 主体依据(头注明写):头注第一行写「标题区版本号徽章段(src/renderer/renderer.ts 末尾那次
 * getVersion 调用)」,三条断言全部对那处 `.then(...)` 的 reject 分支输出下判。状态行那条
 * 断言落在既有通道 `setError` 上,故一并声明其定义处。
 */
export const covers = [
  "src/renderer/renderer.ts",
  "src/renderer/ui/dom-ops.ts",
];

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * --input-type=module -e 里的 import 只接受 file:// URL(裸 Windows 路径会被当未知协议)。
 * @param {string} abs 绝对路径
 * @returns {string} file:// URL
 */
const url = (abs) => pathToFileURL(abs).href;
const DIST_RENDERER = path.join(ROOT, "dist", "renderer");
const DOM_STUB = path.resolve(here, "./dom-stub.js");

const NODE = resolveNode();

/**
 * 在子进程里装载真实 dist 组合根并驱动 getVersion,回读徽标与状态行文案。
 *
 * 子进程脚本做的事:装最小 DOM stub → 注入 api 桩(getVersion 按 mode resolve/reject)
 * → import 真实 dist/renderer/renderer.js → 等微任务与启动屏障落定 → 打印三条文案。
 * 用 JSON 打印而非断言进程内状态:子进程崩溃/抛错时 stderr 会带出来,便于定位。
 *
 * @param {"resolve" | "reject"} mode getVersion 的行为
 * @returns {{ chip: string, title: string, status: string, unhandled: string[] }}
 */
function runCompositionRoot(mode) {
  const script = `
    globalThis.MutationObserver = class { observe(){} disconnect(){} takeRecords(){ return []; } };
    const { installDomStub } = await import(${JSON.stringify(url(DOM_STUB))});
    const dom = installDomStub({});
    const unhandled = [];
    process.on("unhandledRejection", (reason) => unhandled.push(String(reason)));
    dom.window.api = new Proxy({}, {
      get(_t, prop) {
        if (prop === "getVersion") {
          return () => ${mode === "reject"
            ? 'Promise.reject(new Error("ipc channel gone"))'
            : 'Promise.resolve("9.9.9")'};
        }
        return () => Promise.resolve({});
      },
      has() { return true; },
    });
    await import(${JSON.stringify(url(path.join(DIST_RENDERER, "renderer.js")))});
    // 等启动屏障(两路初始化)与版本号回填都落定
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 10));
    const chip = dom.elementFor("appVersion");
    process.stdout.write(JSON.stringify({
      chip: chip.textContent,
      title: chip.title,
      status: dom.elementFor("status").textContent,
      unhandled,
    }));
  `;
  const res = spawnSync(NODE, ["--input-type=module", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert(
    res.status === 0,
    `子进程装载 dist 组合根失败(${mode} 用例):status=${res.status}\n${res.stderr ?? ""}`,
  );
  /** @type {{ chip: string, title: string, status: string, unhandled: string[] }} */
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (err) {
    throw new Error(`version-chip 断言失败:子进程输出不是合法 JSON(${String(err)}):${res.stdout}`);
  }
  return parsed;
}

/** 数字版本形态:`v` 前缀后跟数字(带不带点号分段都算,如 v3 / v3.15.1) */
const LOOKS_LIKE_VERSION = /^v\d/;

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

/** 版本号徽章的成功/失败两态(实跑 dist 组合根,注入 getVersion 行为) */
export async function run() {
  // ---- 成功路径:注入 resolve → 徽标显示真实版本号 ----
  const ok = runCompositionRoot("resolve");
  assert(
    ok.chip === "v9.9.9",
    `注入 resolve 时徽标应显示真实版本号,实际 ${JSON.stringify(ok.chip)}`,
  );
  assert(ok.unhandled.length === 0, `成功路径不该有未处理拒绝:${ok.unhandled.join(" | ")}`);

  // ---- 失败路径:注入 reject → 徽标非空可辨识,且不伪装成成功 ----
  const bad = runCompositionRoot("reject");
  assert(bad.unhandled.length === 0, `注入 reject 时不应留下未处理拒绝(静默失败会变成一条无人认领的 unhandledRejection):${bad.unhandled.join(" | ")}`);

  // 断言 1:文案非空且可辨识
  assert(
    bad.chip.trim() !== "",
    `注入 reject 时徽标文案不得为空(空白既看不出「取不到」也看不出「还没取到」):实际 ${JSON.stringify(bad.chip)}`,
  );
  assert(
    bad.chip !== ok.chip,
    `失败态文案必须与成功态可区分(否则无法从界面分辨「取不到」),成功=${JSON.stringify(ok.chip)} 失败=${JSON.stringify(bad.chip)}`,
  );
  assert(
    bad.chip.includes("?"),
    `失败态徽标应带可辨识的未知标记(问号),实际 ${JSON.stringify(bad.chip)}`,
  );

  // 断言 2:不得伪装成成功 —— 不得回填看起来像真实版本号的值
  assert(
    !LOOKS_LIKE_VERSION.test(bad.chip),
    `失败态不得回填数字版本号(假版本号会把「取不到」伪装成「取到了」,比空白更难排查):实际 ${JSON.stringify(bad.chip)}`,
  );
  assert(
    !LOOKS_LIKE_VERSION.test(bad.chip.trim().replace(/^v\?+$/, "v")),
    `失败态不得用「去掉问号即为版本」的写法变相回填版本号:实际 ${JSON.stringify(bad.chip)}`,
  );

  // 断言 3:错误经既有通道(setError → #status)呈现,且带原因可定位
  assert(
    bad.status.trim() !== "",
    `注入 reject 时错误须经既有通道(#status)可见呈现,实际状态行为空:${JSON.stringify(bad.status)}`,
  );
  assert(
    bad.status.includes("ipc channel gone"),
    `状态行须带上失败原因(否则只知道「失败」不知为何),实际 ${JSON.stringify(bad.status)}`,
  );
  assert(
    bad.title.includes("ipc channel gone"),
    `徽标 title 应带上失败原因(悬停即可定位),实际 ${JSON.stringify(bad.title)}`,
  );

  console.log(
    "[ok] version-chip:resolve→显示真实版本号 / reject→文案非空可辨识且非数字版本号(不伪装成功)/ 错误经 #status 与 title 双处可见并带原因 / 两侧均无未处理拒绝",
  );
}
