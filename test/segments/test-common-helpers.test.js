// @ts-check
/**
 * 测试公共 helper 自测段(位于 test/segments/ = 跨域守护段;纯 Node,不依赖 dist):
 * 被测件是 test/common/assert.js(公共断言集)与 test/common/temp-resource.js(临时资源生命周期)。
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
 * 「删不掉」怎么造(两条独立锚点,互不依赖):
 * 1) 注入式:给 removeTree 传非法重试参数(maxRetries:-1),Node 必抛 ERR_OUT_OF_RANGE,
 *    目录必然还在 —— 跨平台确定性地证明「失败被上报、没有被当成成功」;
 * 2) 真实占用(仅 win32,本项目目标平台):把本进程 cwd 切进资源内的子目录,Windows 上
 *    「非空目录且被进程占用」时删除其父目录必 EPERM —— 这正是段里真实会遇到的情形
 *    (刚退出的 Electron 子进程句柄未释放)。POSIX 无此语义,故该半段按平台跳过并留痕。
 *
 * 防假通过两处:
 * 1) 「系统临时区前缀计数基线」在 run() 入口取,段末比对 —— helper 真的漏了目录,计数会涨,
 *    而不是靠「注册表为空」自说自话;
 * 2) 段末用目录存在性逐条复查本段建过的每个资源(沿用 install-smoke 段的手法:清理成功的
 *    判据是「目录真的不见了」,不是「没抛错」)。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureAssertionFailure, createAsserter } from "../common/assert.js";
import { createCaseSuite } from "../common/case.js";
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
} from "../common/temp-resource.js";

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

const suite = createCaseSuite();

/** 契约类型的只读引用(编译期擦除) */
/** @typedef {import("../common/temp-resource.js").TempResource} TempResource */

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

/** 本段自用前缀(与 TEMP_PREFIX 区分,便于段末按前缀统计系统临时区) */
const SELFTEST_PREFIX = "m2w-selftest-";

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
 * 系统临时区里本段前缀的目录数(外部可见口径:helper 漏删会体现在这里)。
 * @param {string} prefix 目录名前缀
 * @returns {number}
 */
function countTempDirs(prefix) {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)).length;
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
  /** 入口基线:本段跑完后系统临时区里本段前缀的目录数必须回到这个值 */
  const tempDirBaseline = countTempDirs(SELFTEST_PREFIX);
  console.log(`[ok] test-common-helpers:系统临时区 ${SELFTEST_PREFIX}* 基线 ${tempDirBaseline}`);

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
      const retried = cleanupTempResources();
      assertIncludes(retried.removed.join(","), stuck.path, "占用解除后兜底清理应能删掉它");
      assertEq(fs.existsSync(stuck.path), false, "兜底清理成功后目录应消失");
      assert(
        !pendingTempResources().some((r) => r.path === stuck.path),
        "兜底清理后不应仍挂在注册表",
      );
      console.log("[ok] test-common-helpers:Windows 占用(单条抛/汇总抛/保留注册项/解除后收干净)");
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
      cleanupTempResources();
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
  await suite.case("段末无临时资源残留:注册表空 + 每个目录都不在了 + 系统临时区回到基线", async () => {
    // 前面的 case 故意留下的占用先释放,再让兜底清理收尾:否则本 case 带着占用判红,
    // 就分不清是「漏清理」还是「故意占用」
    releaseOccupancy();
    const removed = cleanupTempResources();
    assert(Array.isArray(removed.removed), "兜底清理应返回已清理清单");
    assertEq(pendingTempResources().length, 0, "段末注册表应为空");
    for (const dir of created) {
      assertEq(fs.existsSync(dir), false, `临时资源残留:${dir}`);
    }
    assertEq(countTempDirs(SELFTEST_PREFIX), tempDirBaseline, "系统临时区里本段前缀目录数应回到入口基线");
    console.log(
      `[ok] test-common-helpers:段末无残留(注册表空 / ${created.length} 个目录均已删除 / 临时区计数回到 ${tempDirBaseline})`,
    );
  });

  return { cases: suite.results };
}
