// @ts-check
/**
 * 测试公共 helper 自测段(位于 test/core/ = 跨域守护段;纯 Node,不依赖 dist):
 * 被测件是 test/harness/assert.js(公共断言集)与 test/harness/temp-resource.js(临时资源生命周期)。
 *
 * 为何值得有这一段:两个 helper 本身是「判定别的段对不对」的工具,一旦它们自身静默失真
 * (断言恒真、清理假装成功),全树 100+ 段的通过率就不再有信息量。故本段对两条线都做
 * **正向 + 负向**断言:
 * - 断言集:每条断言的失败消息必须含「实际值 + 期望值 + 差异位置」。只测「不抛错」是不够的
 *   ——恒真的断言同样不抛错;故意写错的期望值(负向锚点)才能证明它真的在比。
 * - 临时资源:删除失败必须**显式暴露**(removeTree 返回失败 / removeResource 抛 /
 *   cleanupTempResources 汇总点名),而不是像 test/main 若干段那样 `.catch(() => undefined)`
 *   把删不掉的目录留在系统临时区。
 *
 * 「删不掉」怎么造(三条锚点,互不依赖):
 * 1) 注入式:给 removeTree 传非法重试参数(maxRetries:-1),Node 必抛 ERR_OUT_OF_RANGE,
 *    目录必然还在 —— 跨平台确定性地证明「失败被上报、没有被当成成功」;
 * 2) 真实占用(仅 win32,本项目目标平台):把本进程 cwd 切进资源内的子目录,Windows 上
 *    「非空目录且被进程占用」时删除其父目录必 EPERM —— 这正是段里真实会遇到的情形
 *    (刚退出的 Electron 子进程句柄未释放)。POSIX 无此语义,故该半段按平台跳过并留痕;
 * 3) 退避真的在重试(仅 win32):占位子进程**自己**在数百毫秒后退出,于是删除必然
 *    「先失败、占用解除后才成功」。断言总耗时跨过至少一次 retryDelay —— 只断言「最终成功」
 *    是恒绿的(靠删后复查也能成功),抓不到「有没有真等」这件事;
 * 4) 释放占用后的**有界等待**(仅 win32):本进程 cwd 已切回、但占位子进程还活着 ——
 *    「释放动作已返回 ≠ Windows 已放掉句柄」。这条守的是 releaseOccupancy 之后第一次
 *    兜底清理的等待窗口(见 RELEASE_SETTLE_BUDGET_MS 的实测依据)。
 *
 * 防假通过三处:
 * 1) 「系统临时区前缀目录集合基线」在 run() 入口取,段末逐项比对 —— helper 真的漏了目录,
 *    集合会多出一项,而不是靠「注册表为空」自说自话;前缀**带本进程 pid**,故这个口径是
 *    本段自己那一份,不会被同机并发的另一套验收顶歪(见 SELFTEST_PREFIX 处的理由);
 * 2) 段末用目录存在性逐条复查本段建过的每个资源(沿用 install-smoke 段的手法:清理成功的
 *    判据是「目录真的不见了」,不是「没抛错」);
 * 3) 前缀集合口径自身**不许恒真**:段末先故意在系统临时区留一个同前缀目录(且**不经注册表**),
 *    断言集合必须变大 —— 否则「集合回到基线」就抓不到「helper 建了却没登记/没删」的目录,
 *    而那正是这条外部可见口径存在的唯一理由(`created` 名单复查覆盖不到那类)。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureAssertionFailure, createAsserter } from "../harness/assert.js";
import { createCaseSuite } from "../harness/case.js";
import {
  REMOVE_MAX_RETRIES,
  REMOVE_RETRY_DELAY,
  TEMP_PREFIX,
  cleanupTempResources,
  createTempResource,
  pendingTempResources,
  removeResource,
  removeTree,
  withTempResource,
} from "../harness/temp-resource.js";

/**
 * 本段测哪一层:**不是 core**(见头注第 2 行「测试公共 helper 自测段(位于 test/core/
 * = 跨域守护段;纯 Node,不依赖 dist): 被测件是 test/harness/assert.js(公共断言集)与
 * test/harness/temp-resource.js(临时资源生命周期)」)。
 *
 * 主体两条,均由头注明写:`test/harness/assert.js`(每条断言的失败消息必须含实际值 +
 * 期望值 + 差异位置 —— 头注论证「只测不抛错不够,恒真的断言同样不抛错」)与
 * `test/harness/temp-resource.js`(删除失败必须显式暴露)。`test/harness/case.js`
 * 是 case 契约的登记入口,随 assert 一并声明。
 *
 * ⚠ **同 runner-report 段**:主体在 `test/harness/`,而 L8 规定该目录下不得有段,
 * harness 又不是被测层(L7 的非镜像豁免位)⇒ 主体与「段的可归属目录」无交集。
 * 此处声明真实主体、**不声明任何 core 路径**,L4 因此仍判红 —— 那是「主体无处安放」的
 * 真实暴露,非声明可解,须由 T3 后续裁决。本段授权只到加声明,故如实留红。
 */
export const covers = [
  "test/harness/assert.js",
  "test/harness/temp-resource.js",
  "test/harness/case.js",
];

// 显式声明本段无验收样例(契约见 gates/fixtures/gen-fixtures.mjs 文件头)
export const fixtures = null;

const suite = createCaseSuite();

/** 契约类型的只读引用(编译期擦除) */
/** @typedef {import("../harness/temp-resource.js").TempResource} TempResource */

// 断言集在本段的自测对象之内(不拿被测件判被测件的失败路径),
// 故用 createAsserter 产出的同一组断言做正向判定,负向判定走 captureAssertionFailure
const {
  assert,
  assertEq,
  assertBytes,
  assertIncludes,
  assertNotIncludes,
  assertSameItems,
  assertCount,
  assertOccurrences,
} = createAsserter("test-common-helpers");

/**
 * 本段自用前缀(与 TEMP_PREFIX 区分,便于段末按前缀统计系统临时区)。
 *
 * **前缀带本进程 pid**:段末的前缀计数是「系统临时区里本段目录数」这条外部可见口径,
 * 而系统临时区是**跨进程共享**的 —— 前缀若是常量,同机并发的另一套验收(或任何别的进程)
 * 建同前缀目录就会把本段的入口基线与段末计数一起顶歪,判出一个与被测件无关的红。
 * (runner-report 段早为同类问题把沙盒改成 mkdtemp 唯一目录,见其 L66 注释「两套验收
 * 同时跑」是已知场景;这里是对同一问题的前缀侧等价处理。)
 *
 * pid 在活进程集合内唯一,故本段与任何并发跑的其它进程**前缀不重叠**,计数即本段自己那一份。
 * 上一轮崩在临时区的同 pid 残留若真存在,会同时落在入口基线与段末计数里(两侧相等仍判绿),
 * 与本改动前的行为一致 —— 不引入新的失效形态。
 */
const SELFTEST_PREFIX = `m2w-selftest-${process.pid}-`;

/** 本段建过的所有资源路径:段末逐条复查「目录真的不见了」 */
/** @type {string[]} */
const created = [];

/** 当前生效的目录占用(进程 cwd 占用);段末统一释放,避免占用泄漏到后续 case */
/** @type {{ release(): void } | null} */
let occupancy = null;

/**
 * 登记一条本段建过的资源(段末复查用)。
 * @param {TempResource} resource 资源描述
 * @returns {TempResource} 原样返回,便于链式写
 */
function track(resource) {
  created.push(resource.path);
  return resource;
}

/**
 * 系统临时区里本段前缀的目录名(外部可见口径:helper 漏删会体现在这里)。
 *
 * 只取**本段前缀**(带 pid,见 SELFTEST_PREFIX)⇒ 与同机并发的其它验收互不干扰;
 * 但它仍是「查文件系统」而非「查注册表」,故 helper 建了却没登记进 `created`、也没删掉的
 * 目录照样出现在这里 —— 这正是它相对 `created` 名单复查的独有价值。
 *
 * 返回**名字集合**而非计数:计数相等可以把「漏删一个 + 入口基线里另一个消失」互相抵消,
 * 集合相等不能;且判红时能直接点名是哪几个目录(计数只能报一个差值)。
 * 段末另有一条负向锚点证明它不是恒真(见 run() 末的「前缀集合口径非恒真」case)。
 * @param {string} prefix 目录名前缀
 * @returns {string[]} 目录名(已排序,便于逐项比对与报错定位)
 */
function listTempDirs(prefix) {
  return fs
    .readdirSync(os.tmpdir())
    .filter((name) => name.startsWith(prefix))
    .sort();
}

/**
 * 占用资源目录(Windows 口径):把进程 cwd 切进资源内的子目录,删除父目录必 EPERM。
 * 只支持一次占用(单进程单 cwd);重复占用先释放上一次。
 * @param {string} dir 资源根目录
 * @returns {void}
 */
function occupyDir(dir) {
  releaseOccupancy();
  const held = path.join(dir, "cwd-held");
  fs.mkdirSync(held, { recursive: true });
  fs.writeFileSync(path.join(held, "x.bin"), "M2W", "utf8");
  const previous = process.cwd();
  process.chdir(held);
  occupancy = {
    release() {
      process.chdir(previous);
      occupancy = null;
    },
  };
}

/** 释放目录占用(幂等:未占用时什么都不做) */
function releaseOccupancy() {
  occupancy?.release();
}

/** 退避锚点里占位子进程的存活时长(ms):须大于「一次退避」,否则夹具退化成「本来就删得掉」 */
const HOLDER_LIFETIME_MS = 800;

/**
 * 「延迟释放」锚点里占位子进程的存活时长(ms)。
 *
 * **取值被两侧夹住,不是随手取的**(两侧都是 `cleanupTempResources` 一次调用的真实形态):
 * - 下界:一次调用的默认重试预算 = 5×6/2×100 = **1500ms**(线性退避 100+200+…+500)。存活时长
 *   必须**超过**它,否则第一次调用就删得掉,「释放后需要等」这件事根本不会发生,锚点退化成恒绿。
 * - 上界:有界等待的第二次调用在约 2500ms 处就会成功。存活时长必须**低于**它,否则第一次调用
 *   就够、有界等待那一半又变成恒绿。
 * 取 2200ms:距下界 700ms、距上界约 300ms,两侧都不贴边(Windows 上 rmSync 本身耗时会让实际
 * 时刻略晚于名义值,贴下界会偶发变成「第一次就成功」)。
 */
const SLOW_RELEASE_HOLDER_MS = 2200;

/**
 * 释放占用后兜底清理的**有界等待**预算(ms)。
 *
 * 这是**上界,不是估计值** —— 取值依据分两侧:
 * - 下界有据:一次 `cleanupTempResources()` 的重试预算 1500ms,在 CI 上**被证明不足**(该 case
 *   耗时 4562ms,整段都在这次调用的退避里空转,最终仍抛「临时资源清理失败」)。任何小于该窗口
 *   的等待都是零效果,所以不能只把常数调小一档了事。
 * - 上界有据:本机实测(node 与 Electron 主进程,见 docs/evidence 的本条结论)在**健康**机器上
 *   「chdir 释放 → 可删」延迟 p99 = 2ms、最大 2ms —— 第一次调用即成功,本预算一分钱不花,
 *   它只在「真的会失败」时被消耗。故取 10000ms(约为已知不足的 1500ms 的 6.7 倍):
 *   真卡死的目录仍会在本预算内判红,不会退化成无限等。
 * ⚠️ 失败那台机器上的真实释放窗口**未被实测**(样本量 1),故只能取整成一个远大于下界的上界;
 * 若日后实测到更大窗口,调大本常数即可,机制无需改。
 */
const RELEASE_SETTLE_BUDGET_MS = 10000;

/**
 * 释放占用后的兜底清理:**有界等待**直到删掉或预算用尽(至少调用一次)。
 *
 * 为何需要:`releaseOccupancy()` 是同步 `process.chdir`,它返回只说明「本进程不再把该目录
 * 当 cwd」,**不代表 Windows 已经放掉句柄**;紧接着的那一次兜底清理只有 1500ms 重试预算,
 * CI 上被证明不够(见 RELEASE_SETTLE_BUDGET_MS)。
 *
 * 为何**反复调用**是合法的:靠的正是「删除失败时资源保留在注册表」这条既有设计(见下面
 * 「Windows 真实占用」case 里「删除失败时资源须保留在注册表(可被后续重试/兜底寻址)」那条断言)——
 * 失败项不被摘除,所以下一次调用仍能寻址到它并再试一次。**本函数用的是这条意图,不是绕开它**;
 * 反过来,任何「失败即清空注册表」的改法都会推翻那条断言,故不采用。
 * @param {number} budgetMs 有界等待预算(ms);至少调用一次,预算只约束**额外**重试
 * @returns {{ removed: string[] }} 已清理的路径(与 cleanupTempResources 同形)
 */
function cleanupWithinBudget(budgetMs = RELEASE_SETTLE_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    try {
      return cleanupTempResources();
    } catch (error) {
      if (Date.now() >= deadline) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${reason}\n[另] 释放占用后的有界等待已用尽(${budgetMs}ms):占用未真正解除,`
            + "或该目录确实删不掉(本等待有界,不会无限重试)",
        );
      }
    }
  }
}

/**
 * 占位子进程的脚本:占住 cwd 的同时**自己**在 lifetimeMs 后退出。
 * 自退(而非由父进程在 rm 之后才 kill)才能造出「先失败、占用解除后才成功」——
 * 父进程没有任何夹具能在两次 rm 之间插进去释放占用(removePath 是同步 API)。
 * @param {number} lifetimeMs 存活时长(ms)
 * @returns {string} `-e` 脚本源码
 */
function holderScript(lifetimeMs) {
  return `process.stdout.write("ready\\n");setTimeout(() => process.exit(0), ${lifetimeMs});`;
}

/**
 * 起一个占住 dir 的子进程并等它真的就绪(就绪信号到达即证明 cwd 已被它持有)。
 * @param {string} dir 要占住的目录
 * @param {number} [lifetimeMs] 存活时长(ms);缺省 HOLDER_LIFETIME_MS
 * @returns {Promise<{ release(): void }>} 释放句柄(幂等)
 */
function holdDirUntilSelfExit(dir, lifetimeMs = HOLDER_LIFETIME_MS) {
  const child = spawn(process.execPath, ["-e", holderScript(lifetimeMs)], {
    cwd: dir,
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
    // 段跑在 Electron 里(process.execPath 是 electron.exe),该变量让它按 node 解释执行
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    child.kill();
  };
  return new Promise((resolve, reject) => {
    // 就绪前就退出/报错 = 夹具没搭起来:必须判红而不是干等(段默认无超时,干等会挂住整轮)
    child.once("error", (err) => {
      release();
      reject(new Error(`占位子进程启动失败:${err.message}`));
    });
    child.once("exit", (code) => {
      release();
      reject(new Error(`占位子进程在就绪前退出(码 ${code}),夹具没搭起来`));
    });
    child.stdout?.once("data", () => resolve({ release }));
  });
}

/**
 * 判定「失败消息同时含实际值与期望值」的通用锚点。
 * @param {{ threw: boolean; message: string }} outcome captureAssertionFailure 的结果
 * @param {string[]} required 必须出现的片段
 * @param {string} what 断言项名(失败时用)
 * @returns {void}
 */
function assertFailureCarries(outcome, required, what) {
  assert(outcome.threw, `${what}:断言未抛错(恒真或比较方向写反了)`);
  for (const fragment of required) {
    assertIncludes(outcome.message, fragment, `${what}:失败消息缺少「${fragment}」`);
  }
}

export async function run() {
  /**
   * 入口基线:本段跑完后系统临时区里本段前缀的目录名集合必须回到这个值
   * (前缀带 pid ⇒ 只数本段自己那一份,不被同机并发的另一套验收顶歪)。
   * 比**集合**而非计数:入口就存在的同 pid 残留(上一轮崩在本进程 pid 上的极端情形)不该
   * 让本段判红,但也不能被「本段漏删一个」抵消掉 —— 集合逐项相等两件事都不放过。
   */
  const tempDirBaseline = listTempDirs(SELFTEST_PREFIX);
  console.log(
    `[ok] test-common-helpers:系统临时区 ${SELFTEST_PREFIX}* 基线 ${tempDirBaseline.length} 个`
    + (tempDirBaseline.length > 0 ? `(${tempDirBaseline.join(",")})` : ""),
  );

  /* ================= 一、断言集 ================= */
  await suite.describe("公共断言集", async () => {
    await suite.case("真值断言:JS 真值口径,失败必带段名与事实", async () => {
      assert(true, "真值应通过");
      assert([], "空数组在 JS 里是真值(此锚点固化该口径,免得后来者当 bug 改)");
      for (const value of [false, 0, "", Number.NaN, null, undefined]) {
        const outcome = await captureAssertionFailure(() => {
          assert(value, `假值 ${String(value)}`);
        });
        assertFailureCarries(outcome, ["test-common-helpers 断言失败:", "假值"], "真值断言负向锚点");
      }
      console.log("[ok] test-common-helpers:真值断言(6 类假值全部判红且消息含段名与事实)");
    });

    await suite.case("相等断言:失败消息含实际/期望 + 首个差异字符,长串截断不淹没日志", async () => {
      assertEq(3, 3, "标量相等应通过");
      assertEq(null, null, "null 相等应通过");
      assertEq(undefined, undefined, "undefined 相等应通过");
      assertEq("同一段", "同一段", "同内容字符串应通过");
      const { path: sameRef } = { path: "x" };
      const { path: otherRef } = { path: "x" };
      assertEq(sameRef, otherRef, "同值不同引用的对象按引用比(此锚点说明 assertEq 不是深比较)");
      const scalar = await captureAssertionFailure(() => {
        assertEq(2, 3, "分页数");
      });
      assertFailureCarries(scalar, ["分页数", "实际 2", "期望 3"], "相等断言负向锚点");
      const strings = await captureAssertionFailure(() => {
        assertEq("abcdef", "abcxef", "正文串");
      });
      assertFailureCarries(strings, ["正文串", "abc", "abcxef", "首个差异在第 3 个字符"], "字符串差异定位");
      const long = await captureAssertionFailure(() => {
        assertEq("x".repeat(500), "y".repeat(500), "长正文");
      });
      assertIncludes(long.message, "共 500 字符", "长串应附总字符数");
      assert(long.message.length < 500, `长串失败消息应被截断,实际 ${long.message.length} 字符`);
      console.log("[ok] test-common-helpers:相等断言(标量/引用口径/差异字符定位/长串截断)");
    });

    await suite.case("逐字节断言:严格 Buffer.equals,不得降级为「包含即过」", async () => {
      assertBytes(Buffer.from("ab"), Buffer.from("ab"), "同字节应通过");
      const diff = await captureAssertionFailure(() => {
        assertBytes(Buffer.from([0x00, 0x01, 0x02]), Buffer.from([0x00, 0x09, 0x02]), "图片字节");
      });
      assertFailureCarries(
        diff,
        ["图片字节", "逐字节比对不一致", "3 字节", "偏移 1", "0x1", "0x9"],
        "逐字节差异定位",
      );
      // 前缀相同但长度不同同样判红:这正是「包含即过」会放过的那一类
      const longer = await captureAssertionFailure(() => {
        assertBytes(Buffer.from("abc"), Buffer.from("abcd"), "文件字节");
      });
      assert(longer.threw, "长度不同的 Buffer 必须判红(不得因前缀相同而放过)");
      // 非 Buffer 入参也判红(不静默通过):形状不符即失败,消息点名实际形态
      // 刻意绕过类型标注传字符串:这是运行期契约(形状不符即失败),不能被编译期挡掉
      const notBuffer = await captureAssertionFailure(() => {
        assertBytes(/** @type {any} */ ("ab"), /** @type {any} */ ("ab"), "非 Buffer");
      });
      assertFailureCarries(notBuffer, ["非 Buffer", "逐字节比对不一致"], "非 Buffer 入参");
      console.log("[ok] test-common-helpers:逐字节断言(偏移定位/长度差判红/非 Buffer 判红)");
    });

    await suite.case("包含/不包含:未命中报被检文本,误命中报上下文与位置", async () => {
      assertIncludes("目录含 <!-- page-break --> 分页", "<!-- page-break -->", "命中应通过");
      assertNotIncludes("正文无分页", "<!-- page-break -->", "未命中应通过");
      const missing = await captureAssertionFailure(() => {
        assertIncludes("<w:document>正文</w:document>", "<!-- page-break -->", "分页符");
      });
      assertFailureCarries(missing, ["分页符", "<!-- page-break -->", "w:document"], "包含失败须给被检文本");
      const hit = await captureAssertionFailure(() => {
        assertNotIncludes("<w:p/>分页<!-- page-break --><w:p/>", "<!-- page-break -->", "重复分页符");
      });
      assertFailureCarries(hit, ["重复分页符", "第 8 处", "page-break"], "不包含失败须给命中位置");
      console.log("[ok] test-common-helpers:包含/不包含(未命中提示/误命中上下文)");
    });

    await suite.case("逐项相等:顺序敏感,长度差与键序差都判红并点名差异项", async () => {
      assertSameItems([], [], "空数组逐项相等应通过");
      assertSameItems(["a", "b"], ["a", "b"], "同序同项应通过");
      assertSameItems(
        [
          { level: 1, id: "x" },
          { level: 2, id: "y" },
        ],
        [
          { level: 1, id: "x" },
          { level: 2, id: "y" },
        ],
        "对象项按 JSON 形态比",
      );
      const length = await captureAssertionFailure(() => {
        assertSameItems(["a", "b"], ["a", "b", "c"], "目录条目");
      });
      assertFailureCarries(length, ["目录条目", "长度 实际 2/期望 3"], "长度差须点名两侧长度");
      const order = await captureAssertionFailure(() => {
        assertSameItems(["a", "b"], ["b", "a"], "目录条目");
      });
      assertFailureCarries(order, ["首个差异在第 0 项", "实际 \"a\"", "期望 \"b\""], "顺序差须点名差异项");
      const keyOrder = await captureAssertionFailure(() => {
        assertSameItems([{ level: 1, id: "x" }], [{ id: "x", level: 1 }], "目录条目");
      });
      assert(keyOrder.threw, "键序不同的对象项必须判红(JSON 形态不同即事实不同)");
      console.log("[ok] test-common-helpers:逐项相等(顺序敏感/长度差/键序差)");
    });

    await suite.case("数量断言:实际次数与期望次数都进消息", async () => {
      const calls = ["./memo-a.png", "./memo-b.png", "./memo-a.png"];
      assertOccurrences(calls, "./memo-a.png", 2, "同 URL 命中次数应通过");
      assertCount(calls.length, 3, "总数应通过");
      const wrong = await captureAssertionFailure(() => {
        assertCount(1, 2, "分页数");
      });
      assertFailureCarries(wrong, ["分页数", "实际 1", "期望 2"], "数量断言负向锚点");
      const hits = await captureAssertionFailure(() => {
        assertOccurrences(calls, "./memo-a.png", 5, "同 URL 解析次数");
      });
      assertFailureCarries(
        hits,
        ["同 URL 解析次数", "./memo-a.png", "实际出现 2 次", "期望 5 次"],
        "出现次数负向锚点",
      );
      console.log("[ok] test-common-helpers:数量断言(次数/总数正负锚点)");
    });

    await suite.case("自检支撑:captureAssertionFailure 区分「抛了」与「没抛」", async () => {
      const silent = await captureAssertionFailure(() => {
        assertEq(1, 1, "不该失败");
      });
      assertEq(silent.threw, false, "通过的断言体不应被记为失败");
      const broken = await captureAssertionFailure(() => {
        assertEq(1, 2, "该失败");
      });
      assert(broken.threw, "失败的断言体必须被记为失败");
      assert(broken.error instanceof Error, "失败事实应带 Error 对象(供报告引用)");
      const asyncBroken = await captureAssertionFailure(async () => {
        await Promise.resolve();
        throw new Error("异步失败事实");
      });
      assertFailureCarries(asyncBroken, ["异步失败事实"], "异步体也应被捕获");
      console.log("[ok] test-common-helpers:失败捕获(同步/异步/未抛三种形态)");
    });
  });

  /* ================= 二、临时资源生命周期 ================= */
  await suite.describe("临时资源生命周期", async () => {
    await suite.case("建资源:落在指定父目录内、前缀生效、进注册表", async () => {
      const home = track(createTempResource({ prefix: SELFTEST_PREFIX, label: "段沙盒根" }));
      assert(fs.existsSync(home.path), "资源目录应已创建");
      assert(fs.statSync(home.path).isDirectory(), "资源应是目录");
      assertEq(path.dirname(home.path), os.tmpdir(), "缺省父目录应为系统临时区");
      assertIncludes(path.basename(home.path), SELFTEST_PREFIX, "目录名应带请求的前缀");
      const nested = track(createTempResource({ prefix: "nested-", parent: home.path, label: "子沙盒" }));
      assertEq(path.dirname(nested.path), home.path, "指定 parent 时资源应建在该父目录下");
      assert(
        pendingTempResources().some((r) => r.path === nested.path),
        "建完即应进注册表(可被兜底清理寻址)",
      );
      assertEq(TEMP_PREFIX, "m2w-tmp-", "默认前缀是识别残留的契约,变更须同步文档与清理口径");
      // 本 case 的资源即时收尾:cleanupTempResources 是全注册表口径,不留给后续 case
      // (否则后续 case 的「注册表应为空」断言会被本 case 的遗留物污染)
      const cleaned = cleanupTempResources();
      assertEq(cleaned.removed.length, 2, "建的两个资源应被兜底清理收走");
      assertEq(pendingTempResources().length, 0, "本 case 收尾后注册表应为空");
      console.log("[ok] test-common-helpers:建资源(父目录/前缀/注册表)");
    });

    await suite.case("withTempResource:成功路径返回值透传且目录消失", async () => {
      /** @type {string} */
      let dir = "";
      const value = await withTempResource({ prefix: SELFTEST_PREFIX, label: "透传沙盒" }, (resource) => {
        dir = resource.path;
        created.push(dir);
        fs.writeFileSync(path.join(dir, "a.md"), "# a", "utf8");
        return resource.path.length;
      });
      assertEq(typeof value, "number", "返回值应原样透传");
      assertEq(fs.existsSync(path.join(dir, "a.md")), false, "沙盒应已删除");
      assert(
        !pendingTempResources().some((r) => r.path === dir),
        "清理成功后应从注册表注销",
      );
      console.log("[ok] test-common-helpers:withTempResource 成功路径(透传 + 清理 + 注销)");
    });

    await suite.case("withTempResource:主体抛错仍清理,且原始错误不被清理噪声覆盖", async () => {
      /** @type {string} */
      let dir = "";
      const outcome = await captureAssertionFailure(() =>
        withTempResource({ prefix: SELFTEST_PREFIX, label: "失败沙盒" }, (resource) => {
          dir = resource.path;
          created.push(dir);
          throw new Error("主体失败:预期断言点");
        }),
      );
      assertFailureCarries(outcome, ["主体失败:预期断言点"], "主体失败须原样透传");
      assertEq(fs.existsSync(dir), false, "主体抛错时沙盒也必须被清理");
      console.log("[ok] test-common-helpers:withTempResource 失败路径(错误透传 + 仍清理)");
    });

    await suite.case("删除失败显式暴露:失败必上报,不得当成功(注入式失败锚点)", async () => {
      const resource = track(createTempResource({ prefix: SELFTEST_PREFIX, label: "注入失败沙盒" }));
      fs.writeFileSync(path.join(resource.path, "keep.bin"), "M2W", "utf8");
      // 非法重试参数让 fs.rmSync 必抛(跨平台确定):证明 removeTree 把失败如实上报而非吞掉
      const outcome = removeTree(resource.path, { maxRetries: -1 });
      assertEq(outcome.ok, undefined, "删除失败时不得返回 ok");
      assertEq(outcome.existed, true, "失败结果应记录删除前是存在的");
      assert(outcome.error instanceof Error, "失败结果须带 Error(供上层拼消息)");
      assertEq(fs.existsSync(resource.path), true, "失败时目录确实还在(证明上面不是假失败)");
      // 恢复合法参数后必须能删掉(证明失败不是粘性的:不会把一次失败记成永久残留)
      const retried = removeTree(resource.path);
      assertEq(retried.ok, true, "参数合法后重试应删除成功");
      assertEq(fs.existsSync(resource.path), false, "删除成功的判据是目录真的不见了");
      console.log("[ok] test-common-helpers:删除失败上报(不吞错/重试可恢复)");
    });

    await suite.case("Windows 真实占用:删不掉时全链路上报,解除占用后兜底能收干净", async () => {
      const canOccupy = process.platform === "win32";
      const stuck = track(createTempResource({ prefix: SELFTEST_PREFIX, label: "占用沙盒" }));
      const leaky = track(createTempResource({ prefix: SELFTEST_PREFIX, label: "可删沙盒" }));
      if (!canOccupy) {
        // POSIX 上「进程 cwd 占用」不阻止 unlink,无法造出真实的删不掉;跳过该半段但留痕
        console.log("[skip] test-common-helpers:真实占用锚点仅 win32 有效(当前 POSIX)");
        cleanupTempResources();
        assertEq(pendingTempResources().length, 0, "跳过分支同样不得残留");
        return;
      }
      occupyDir(stuck.path);
      try {
        const outcome = removeTree(stuck.path, { maxRetries: 1, retryDelay: 10 });
        assertEq(outcome.ok, undefined, "被占用时删除必须报失败(不得当成功)");
        assert(outcome.error instanceof Error, "占用失败须带 Error");
        // 三条上报路径都要点名:单资源清理抛错、兜底汇总抛错、注册项保留可再寻址
        const thrown = await captureAssertionFailure(() => {
          removeResource(stuck);
        });
        assertFailureCarries(thrown, ["占用沙盒", stuck.path, "临时资源清理失败"], "removeResource 须抛且点名路径");
        const reported = await captureAssertionFailure(() => cleanupTempResources());
        assertFailureCarries(reported, ["占用沙盒", stuck.path, "不得静默残留"], "兜底清理须点名删不掉的资源");
        // 形态一「占用未释放」:有界等待同样必须失败 —— 它不是「无脑重试到成功」。
        // 预算给 1ms 是刻意的:只证明「至少调用一次、且失败后按预算收手」,不让这条断言
        // 把段的时间预算押在等待上。两条断言分开写:第一条是行为(失败且仍点名该资源),
        // 第二条是诊断质量(失败消息须说明「有界等待已用尽」,否则排障时看不出等过、等到哪)。
        const bounded = await captureAssertionFailure(() => cleanupWithinBudget(1));
        assertFailureCarries(
          bounded,
          ["占用沙盒", stuck.path],
          "占用未释放时有界等待也必须失败(不得把删不掉的目录当成已清理)",
        );
        assertIncludes(bounded.message, "有界等待已用尽", "有界等待耗尽时的消息须说明等过且等到哪");
        assert(
          !reported.message.includes(leaky.path),
          "能删掉的资源不该出现在失败清单里(失败清单只列真失败项)",
        );
        assertEq(fs.existsSync(leaky.path), false, "能删的资源仍应被兜底清掉");
        assertEq(fs.existsSync(stuck.path), true, "被占用的资源确实还在(证明上面不是假失败)");
        assert(
          pendingTempResources().some((r) => r.path === stuck.path),
          "删除失败时资源须保留在注册表(可被后续重试/兜底寻址)",
        );
      } finally {
        releaseOccupancy();
      }
      const retried = cleanupWithinBudget();
      assertIncludes(retried.removed.join(","), stuck.path, "占用解除后兜底清理应能删掉它");
      assertEq(fs.existsSync(stuck.path), false, "兜底清理成功后目录应消失");
      assert(
        !pendingTempResources().some((r) => r.path === stuck.path),
        "兜底清理后不应仍挂在注册表",
      );
      console.log("[ok] test-common-helpers:Windows 占用(单条抛/汇总抛/保留注册项/解除后收干净)");
    });

    // 这一条是 REQ-136 的现场那条失败的**守门 case**:CI 上 :477 那一次「释放后立刻重试」
    // 把 1500ms 默认预算耗尽仍失败 → 目录留在注册表 → 后续两个 case 的兜底清理都再撞一次、
    // 再抛同一条消息(3 条失败同源)。本 case 用「本进程 cwd 已切回 + 占位子进程还活着」
    // 造出同一形态,并断言有界等待能等到句柄真放掉。
    await suite.case("释放占用后的有界等待:一次立即重试不够,有界等待等到句柄真放掉", async () => {
      const resource = track(createTempResource({ prefix: SELFTEST_PREFIX, label: "延迟释放沙盒" }));
      if (process.platform !== "win32") {
        console.log("[skip] test-common-helpers:延迟释放锚点仅 win32 有效(当前 POSIX)");
        cleanupTempResources();
        assertEq(pendingTempResources().length, 0, "跳过分支同样不得残留");
        return;
      }
      const held = path.join(resource.path, "cwd-held");
      occupyDir(resource.path);
      // 占位子进程活过「一次默认重试预算」(SLOW_RELEASE_HOLDER_MS 的下界说明):本进程 cwd
      // 切回之后,删除仍会因它持有的句柄而失败 —— 即「释放动作已返回 ≠ 句柄已放掉」。
      const holder = await holdDirUntilSelfExit(held, SLOW_RELEASE_HOLDER_MS);
      try {
        releaseOccupancy();
        const startedAt = Date.now();
        const cleaned = cleanupWithinBudget();
        const elapsed = Date.now() - startedAt;
        assertIncludes(cleaned.removed.join(","), resource.path, "有界等待应最终删掉它");
        assertEq(fs.existsSync(resource.path), false, "有界等待成功后目录应消失");
        assert(
          !pendingTempResources().some((r) => r.path === resource.path),
          "有界等待成功后应从注册表注销(不留给后续 case 撞第二次)",
        );
        // 有界:预算内没耗尽就返回。守护「不是无限重试」—— 若 cleanupWithinBudget 退化成死循环,
        // 这里永远到不了;而预算耗尽时它会带着「有界等待已用尽」抛错,由上面的断言接住。
        assert(
          elapsed < RELEASE_SETTLE_BUDGET_MS,
          `有界等待须在预算(${RELEASE_SETTLE_BUDGET_MS}ms)内返回,实际 ${elapsed}ms`,
        );
        console.log(
          `[ok] test-common-helpers:释放占用后的有界等待(占位子进程 ${SLOW_RELEASE_HOLDER_MS}ms 后自解,`
            + `有界等待耗时 ${elapsed}ms < 预算 ${RELEASE_SETTLE_BUDGET_MS}ms)`,
        );
      } finally {
        holder.release();
        releaseOccupancy();
      }
    });

    await suite.case("退避真的在重试:占用型 EPERM 靠等待化解(不是靠删后复查)", async () => {
      const resource = track(createTempResource({ prefix: SELFTEST_PREFIX, label: "退避沙盒" }));
      if (process.platform !== "win32") {
        // POSIX 上「进程 cwd 占用」不阻止 unlink,造不出「先失败后成功」;跳过并留痕
        console.log("[skip] test-common-helpers:退避锚点仅 win32 有效(当前 POSIX)");
        cleanupTempResources();
        assertEq(pendingTempResources().length, 0, "跳过分支同样不得残留");
        return;
      }
      const held = path.join(resource.path, "cwd-held");
      fs.mkdirSync(held, { recursive: true });
      fs.writeFileSync(path.join(held, "x.bin"), "M2W", "utf8");
      const holder = await holdDirUntilSelfExit(held);
      try {
        // 下面两个 150 必须相等(耗时下界 = 退避基数);门禁要求选项取值写成数字字面量
        // (见 gates/repo/check-temp-cleanup.mjs 的第二条规则),故调用点与断言各自写死
        const startedAt = Date.now();
        const outcome = removeTree(resource.path, { maxRetries: 20, retryDelay: 150 });
        const elapsed = Date.now() - startedAt;
        assertEq(outcome.ok, true, `占用解除后应最终删掉,实际:${outcome.error?.message ?? "未给 ok"}`);
        assert(
          elapsed >= 150,
          `删除总耗时须跨过至少一次退避(≥150ms),实际 ${elapsed}ms —— 不跨过即说明没等就重试;`
            + "只断言「成功」抓不到这一点(删后复查同样能成功)",
        );
        assertEq(fs.existsSync(resource.path), false, "删除成功的判据是目录真的不见了");
        console.log(
          `[ok] test-common-helpers:退避重试(占位子进程 ${HOLDER_LIFETIME_MS}ms 后自解,`
            + `删除耗时 ${elapsed}ms ≥ 退避 150ms)`,
        );
      } finally {
        holder.release();
      }
    });

    await suite.case("withTempResource:主体失败与清理失败同时发生时两条都在消息里", async () => {
      const outcome = await captureAssertionFailure(() =>
        withTempResource({ prefix: SELFTEST_PREFIX, label: "双失败沙盒" }, (resource) => {
          created.push(resource.path);
          if (process.platform === "win32") occupyDir(resource.path);
          throw new Error("主体失败:与清理失败并发");
        }),
      );
      assertFailureCarries(outcome, ["主体失败:与清理失败并发"], "主体失败须原样透传");
      if (process.platform === "win32") {
        // 占用必须在本 case 内释放(否则 cwd 被占会影响后续 case 的相对路径解析)
        try {
          assertFailureCarries(
            outcome,
            ["临时资源清理失败", "双失败沙盒", created[created.length - 1] ?? ""],
            "清理失败须与主体失败并列留痕(不得互相覆盖)",
          );
          assertEq(fs.existsSync(created[created.length - 1] ?? ""), true, "清理失败时目录确实还在(显式暴露)");
        } finally {
          releaseOccupancy();
        }
      }
      cleanupWithinBudget();
      assertEq(pendingTempResources().length, 0, "该 case 收尾后注册表应清空");
      console.log("[ok] test-common-helpers:主体失败 + 清理失败双留痕");
    });

    await suite.case("清理参数契约:重试次数与退避不得被调成 0(否则 Windows 必假失败)", async () => {
      assert(REMOVE_MAX_RETRIES >= 3, `重试次数应 ≥3(当前 ${REMOVE_MAX_RETRIES}),否则句柄未释放即误判失败`);
      assert(REMOVE_RETRY_DELAY >= 50, `退避基数应 ≥50ms(当前 ${REMOVE_RETRY_DELAY}),否则重试形同虚设`);
      console.log("[ok] test-common-helpers:清理重试参数(重试次数与退避基数)");
    });
  });

  /* ================= 三、段末残留复查(清理可验证) ================= */
  await suite.case("前缀集合口径非恒真:未登记的本段前缀目录必须被系统临时区口径看见", async () => {
    // 这条守的是段末那条「集合回到基线」的**有效性**:若 listTempDirs 恒返回基线,
    // 段末断言就成了恒绿。而「helper 建了目录却既没登记进 `created` 也没删掉」正是
    // `created` 名单复查覆盖不到、只有这条外部口径能覆盖的失效模式 —— 故必须用
    // **不经注册表**的裸 mkdtemp 造夹具,走一遍「集合变大 → 删掉 → 集合回落」。
    const before = listTempDirs(SELFTEST_PREFIX);
    // 刻意不进注册表、不进 created:这正是「helper 漏登记且漏删」的形态
    const unregistered = fs.mkdtempSync(path.join(os.tmpdir(), SELFTEST_PREFIX));
    const grown = listTempDirs(SELFTEST_PREFIX);
    try {
      assert(
        grown.length === before.length + 1 && grown.includes(path.basename(unregistered)),
        `系统临时区里多一个本段前缀目录时,前缀集合必须看见它(否则段末「回到基线」是恒真断言):`
          + `前 ${before.length} 项 → 现 ${grown.length} 项 ${grown.join(",")}`,
      );
    } finally {
      const outcome = removeTree(unregistered);
      assertEq(outcome.ok, true, `夹具目录清理失败:${outcome.error?.message ?? "删除后目录仍存在"}`);
    }
    assertSameItems(
      listTempDirs(SELFTEST_PREFIX),
      before,
      "夹具目录删掉后系统临时区的前缀集合应回到原值",
    );
    console.log("[ok] test-common-helpers:前缀集合口径非恒真(未登记目录 → 集合变大 → 删掉 → 回落)");
  });

  await suite.case("段末无临时资源残留:注册表空 + 每个目录都不在了 + 系统临时区回到基线", async () => {
    // 前面的 case 故意留下的占用先释放,再让兜底清理收尾:否则本 case 带着占用判红,
    // 就分不清是「漏清理」还是「故意占用」
    releaseOccupancy();
    const removed = cleanupWithinBudget();
    assert(Array.isArray(removed.removed), "兜底清理应返回已清理清单");
    assertEq(pendingTempResources().length, 0, "段末注册表应为空");
    for (const dir of created) {
      assertEq(fs.existsSync(dir), false, `临时资源残留:${dir}`);
    }
    // 集合逐项相等(而非计数相等):漏删一个与入口基线里另一个消失不能互相抵消,
    // 且判红时直接点名是哪几个目录 —— 这段判红的唯一下一步动作就是「看哪个目录没删掉」
    // (CI 上靠它定位),只报一个差值等于没给。
    assertSameItems(
      listTempDirs(SELFTEST_PREFIX),
      tempDirBaseline,
      `系统临时区里本段前缀目录集合未回到入口基线(基线 ${tempDirBaseline.length} 项)`
        + ` —— 残留即漏清理;当前 ${listTempDirs(SELFTEST_PREFIX).join(",")}`,
    );
    console.log(
      `[ok] test-common-helpers:段末无残留(注册表空 / ${created.length} 个目录均已删除 / 临时区前缀集合回到基线 ${tempDirBaseline.length} 项)`,
    );
  });

  return { cases: suite.results };
}
