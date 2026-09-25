/**
 * 启动屏障段(src/renderer/renderer.ts 的组合根初始化编排):
 * renderer.ts 是 DOM 绑定的组合根(模块顶层即 querySelector 取节点),Node/Electron
 * 主进程内无法 import 直测(同 renderer 纯函数段拆 pure.ts 的理由);本段改为对**源文件
 * 结构契约**做断言(先例:segments/identity-guards 读 src 文本守护双源恒等),
 * 守护的是「屏障不被回退」这一条不变量:
 * - 设置回填(loadSettings)与 UI 状态恢复(initUiStateRestore)必须汇合于同一个
 *   Promise.all(各自独立 void 启动 = 首屏先按默认设置绘制一帧);
 * - 隐藏根元素必须早于屏障 await,揭示必须落在 finally(任一路 reject 也不能白屏);
 * - 旧的「void loadSettings() / void initUiStateRestore()」各自启动写法不得复现;
 * - 事件绑定仍先于屏障(时序不变量,勿为防闪调换)。
 * 屏障的实际视觉效果(首屏不闪白/无设置跳变)属 GUI 实测面(ACCEPTANCE 清单)。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "renderer", "renderer.ts"),
  "utf8",
);

function assert(cond, msg) {
  if (!cond) throw new Error(`init-barrier 断言失败:${msg}`);
}

export async function run() {
  // ---- 1. 屏障调用点存在,且两路初始化汇合于同一个 Promise.all ----
  // 锚点用调用语句(声明处 runInitBarrier(): 的空参列表也会命中 "runInitBarrier()")
  const barrierIdx = SRC.indexOf("void runInitBarrier();");
  assert(barrierIdx > 0, "renderer.ts 应有启动屏障调用点 runInitBarrier()");
  const allIdx = SRC.indexOf("Promise.all([");
  assert(allIdx > 0, "renderer.ts 屏障内应有 Promise.all([...])");
  // Promise.all 的参数列表内必须同时出现两路初始化调用
  const listBody = SRC.slice(allIdx, SRC.indexOf("])", allIdx));
  assert(/settleInit\(\s*"loadSettings"\s*,\s*loadSettings\(\)\s*\)/.test(listBody),
    `屏障 Promise.all 应汇合 loadSettings,实际参数列表=${JSON.stringify(listBody)}`);
  assert(/settleInit\(\s*"initUiStateRestore"\s*,\s*initUiStateRestore\(\)\s*\)/.test(listBody),
    `屏障 Promise.all 应汇合 initUiStateRestore,实际参数列表=${JSON.stringify(listBody)}`);

  // ---- 2. 旧的「各自 void 启动」写法不得复现(否则又变回两路各自绘制) ----
  assert(!/void\s+loadSettings\(\)\s*;/.test(SRC), "不应再有独立的 void loadSettings() 启动");
  assert(!/void\s+initUiStateRestore\(\)\s*;/.test(SRC), "不应再有独立的 void initUiStateRestore() 启动");

  // ---- 3. 隐藏早于 await 屏障;揭示在 finally(失败路径不白屏) ----
  const hideIdx = SRC.indexOf('style.visibility = "hidden"');
  // 揭示点取屏障之后的那一处(初始化期另有一处 error 事件兜底揭示,见下条断言)
  const revealIdx = SRC.indexOf('style.visibility = ""', allIdx);
  assert(hideIdx > 0, "启动期应隐藏根元素(CSSOM 赋值,不改 HTML/CSS)");
  assert(revealIdx > hideIdx && revealIdx > allIdx, "揭示应出现在隐藏与屏障之后");
  const finallyIdx = SRC.indexOf("finally", allIdx);
  assert(finallyIdx > allIdx && finallyIdx < revealIdx,
    `揭示必须落在屏障的 finally 内(实际 finally@${finallyIdx},reveal@${revealIdx})`);
  // 初始化期抛未捕获错误时也不能停在隐藏态(error 事件兜底揭示)
  assert(/addEventListener\(\s*"error"/.test(SRC), "应有 error 事件兜底揭示(绑定/装配抛错不白屏)");
  // 统一重绘:揭示前强制一次同步布局刷新,两路回填同帧生效
  const flushIdx = SRC.indexOf("offsetHeight", allIdx);
  assert(flushIdx > allIdx && flushIdx < revealIdx,
    "揭示前应有一次强制同步重绘(offsetHeight 读布局),避免先揭示再跳变");

  // ---- 4. 时序不变量:事件绑定先于屏障(不因防闪调换) ----
  const bindIdx = SRC.indexOf("bindEvents();");
  assert(bindIdx > 0 && bindIdx < barrierIdx, "bindEvents() 应早于启动屏障调用(时序不变量)");
  const firstRunIdx = SRC.indexOf("initFirstRunGuide();");
  assert(firstRunIdx > 0 && firstRunIdx < barrierIdx,
    "initFirstRunGuide()(同步装配)应早于屏障调用");

  console.log("[ok] init-barrier:两路初始化汇合 Promise.all/隐藏先于 await/揭示在 finally/绑定时序不变量 断言通过");
}
