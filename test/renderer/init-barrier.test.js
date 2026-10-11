// @ts-check
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
 * - 事件绑定仍先于屏障(时序不变量,勿为防闪调换);
 * - 首屏焦点:揭示之后再落焦,且落在舞台容器(键盘用户的起点是主入口而非 body)。
 * 屏障的实际视觉效果(首屏不闪白/无设置跳变)属 GUI 实测面(ACCEPTANCE 清单)。
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../harness/paths.js";
import { createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";

// 真值断言取公共单源(收敛重复面,口径见 assert.js 文件头)
const { assert } = createAsserter("init-barrier");

/**
 * 本段测哪一层(ADR-062 L4 声明通道):**renderer**,判据静态看不见本段的主体 ——
 * 被测源文件由 `fs.readFileSync(path.join(ROOT, "src", "renderer", "renderer.ts"))` 的
 * **字符串路径**读入,不是 import 语句,故 L4 的 import 图上看不到它。
 *
 * 主体依据(头注明写):头注第一行写「启动屏障段(src/renderer/renderer.ts 的组合根初始化编排)」,
 * 五组断言全部是对该文件文本的结构断言(屏障 Promise.all 汇合两路初始化、隐藏早于 await、
 * 揭示在 finally、事件绑定先于屏障、首屏焦点落在揭示之后)。
 */
export const covers = ["src/renderer/renderer.ts"];

const SRC = fs.readFileSync(
  path.join(ROOT, "src", "renderer", "renderer.ts"),
  "utf8",
);

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const suite = createCaseSuite();
  // 锚点下标跨多个 case 共用(每组断言读的是同一份文本位置),故在 case 之前一次备好,
  // 不让各 case 各自重算 —— 共享上下文留在 run() 层,case 内只引用结果。
  // 锚点用调用语句(声明处 runInitBarrier(): 的空参列表也会命中 "runInitBarrier()")
  const barrierIdx = SRC.indexOf("void runInitBarrier();");
  const allIdx = SRC.indexOf("Promise.all([");
  // 揭示点取屏障之后的那一处(初始化期另有一处 error 事件兜底揭示,见「隐藏早于 await」case)
  const hideIdx = SRC.indexOf('style.visibility = "hidden"');
  const revealIdx = SRC.indexOf('style.visibility = ""', allIdx);

  // ---- 1. 屏障调用点存在,且两路初始化汇合于同一个 Promise.all ----
  await suite.case("屏障调用点存在且两路初始化汇合同一个 Promise.all", () => {
    assert(barrierIdx > 0, "renderer.ts 应有启动屏障调用点 runInitBarrier()");
    assert(allIdx > 0, "renderer.ts 屏障内应有 Promise.all([...])");
    // Promise.all 的参数列表内必须同时出现两路初始化调用
    const listBody = SRC.slice(allIdx, SRC.indexOf("])", allIdx));
    assert(/settleInit\(\s*"loadSettings"\s*,\s*loadSettings\(\)\s*\)/.test(listBody),
      `屏障 Promise.all 应汇合 loadSettings,实际参数列表=${JSON.stringify(listBody)}`);
    // uiStateRestore 收 deps 形参(ADR-075 阶段④:组合根注入跨功能协作面),故此处
    // 匹配「传了一个实参」而非零参 —— 保住原意图:屏障仍汇合这一路,且它没有被
    // 拆成独立启动。刻意不把 \s* 放宽到允许空参列表:那会让「忘了接线」也判绿。
    assert(/settleInit\(\s*"initUiStateRestore"\s*,\s*initUiStateRestore\(\s*[A-Za-z_$][\w$]*\s*\)\s*\)/.test(listBody),
      `屏障 Promise.all 应汇合 initUiStateRestore(带 deps 实参),实际参数列表=${JSON.stringify(listBody)}`);
  });

  // ---- 2. 旧的「各自 void 启动」写法不得复现(否则又变回两路各自绘制) ----
  await suite.case("旧的两路各自 void 启动写法不复现", () => {
    assert(!/void\s+loadSettings\(\)\s*;/.test(SRC), "不应再有独立的 void loadSettings() 启动");
    // initUiStateRestore 现有 deps 实参,故此处匹配任意实参列表而非空参列表:
    // 只认 `()` 的话,改成 `void initUiStateRestore(recentFilesDeps);` 反而判绿,
    // 正是本条要防的「各自启动」形态。
    assert(!/void\s+initUiStateRestore\(\s*[^)]*\)\s*;/.test(SRC), "不应再有独立的 void initUiStateRestore() 启动");
  });

  // ---- 3. 隐藏早于 await 屏障;揭示在 finally(失败路径不白屏) ----
  await suite.case("隐藏早于 await 屏障且揭示落在 finally", () => {
    assert(hideIdx > 0, "启动期应隐藏根元素(CSSOM 赋值,不改 HTML/CSS)");
    assert(revealIdx > hideIdx && revealIdx > allIdx, "揭示应出现在隐藏与屏障之后");
    const finallyIdx = SRC.indexOf("finally", allIdx);
    assert(finallyIdx > allIdx && finallyIdx < revealIdx,
      `揭示必须落在屏障的 finally 内(实际 finally@${finallyIdx},reveal@${revealIdx})`);
    // 统一重绘:揭示前强制一次同步布局刷新,两路回填同帧生效
    const flushIdx = SRC.indexOf("offsetHeight", allIdx);
    assert(flushIdx > allIdx && flushIdx < revealIdx,
      "揭示前应有一次强制同步重绘(offsetHeight 读布局),避免先揭示再跳变");
  });

  // ---- 4. 初始化期抛未捕获错误时也不能停在隐藏态 ----
  await suite.case("error 事件兜底揭示(装配抛错不白屏)", () => {
    assert(/addEventListener\(\s*"error"/.test(SRC), "应有 error 事件兜底揭示(绑定/装配抛错不白屏)");
  });

  // ---- 5. 时序不变量:事件绑定先于屏障(不因防闪调换) ----
  await suite.case("事件绑定先于屏障的时序不变量", () => {
    // 正则容忍实参形态(事件绑定入口自 convert 刀起收 ConvertEventsDeps,且组合根把
    // 那份 deps 装配成一个具名常量),但**要求真有实参** —— 写成 indexOf("bindEvents(")
    // 会连「忘了接线」也放过,那正是这条要防的退化。
    // 实参形态两种都接受:内联对象字面量 `{ … }` 或具名常量标识符。
    const bindMatch = /bindEvents\(\s*(?:\{[^)]*\}|\w+)\s*\);/.exec(SRC);
    const bindIdx = bindMatch?.index ?? -1;
    assert(bindIdx > 0 && bindIdx < barrierIdx, "bindEvents(…) 应早于启动屏障调用(时序不变量)");
    // initFirstRunGuide 现有 deps 实参,锚点改用正则:既保住「这是一次真调用」(不是注释、
    // 不是只有名字),也保住它带上了注入的协作面。刻意不接受零参形态 —— 零参会放过
    // 「忘了接线」;这里要钉的是「同步装配早于屏障」这条顺序不变量。
    const firstRunIdx = SRC.search(/initFirstRunGuide\(\s*\{/);
    assert(firstRunIdx > 0 && firstRunIdx < barrierIdx,
      "initFirstRunGuide()(同步装配,带 deps 实参)应早于屏障调用");
  });

  // ---- 6. 首屏焦点:揭示之后再落焦,且落在舞台容器(主入口) ----
  await suite.case("首屏焦点落在揭示之后且在舞台容器", () => {
    // 不落焦的代价:键盘用户的起点是 body,Tab 要先穿过标题栏与整条动作栏才到文稿台。
    // 顺序也重要:屏障期间根元素 visibility:hidden,提前聚焦没有意义(且可能触发
    // 浏览器把焦点滚回顶部),故必须落在揭示之后。
    const focusIdx = SRC.indexOf("focusStageEntry();", revealIdx);
    assert(focusIdx > revealIdx, "首屏焦点应落在屏障 finally 的揭示之后(根元素可见后再落焦)");
    assert(
      /function focusStageEntry\(\)[\s\S]*?dropZone\.focus\(\)/.test(SRC),
      "首屏焦点应落在舞台容器 #dropZone(role=region + tabindex=0,文稿台是应用主入口)",
    );
  });

  console.log("[ok] init-barrier:两路初始化汇合 Promise.all/隐藏先于 await/揭示在 finally/绑定时序不变量/首屏焦点 断言通过");
  return { cases: suite.results };
}
