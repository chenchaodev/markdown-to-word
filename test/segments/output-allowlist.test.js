// @ts-check
/**
 * shell 产物白名单段(本批健壮性加固的跨域守护段;被测为
 * src/main/ipc/output-allowlist.ts,经 dist/main/ipc/output-allowlist.js,electron 环境):
 *
 * 白名单是 renderer 触达宿主文件系统的唯一入口(shell.openPath / showItemInFolder),
 * 集合怎么存直接决定能不能被绕开。本段把三条收口各自钉成可证伪断言:
 * 1. 与真实产物绑定:尚未生成的路径 / 目录 / 登记后被删除的路径,一律拒;
 * 2. 规范化后再比对:非绝对路径拒;`..` 穿越后指向别处的路径拒;同路径的等价写法
 *    (分隔符冗余、win32 下大小写不同)仍放行(否则等于自断合法入口);
 * 3. 有界增长:超出上限按插入序淘汰最旧,集合大小恒不超过上限。
 * 另附:stat 异常/非文件一律视为否(不得因异常放行)、clear 清空、默认上限为正。
 * 本段不触达真实 shell(无用户可见副作用);register.ts 两个 handler 的接线断言
 * 见 test/main/ipc-register.test.js(白名单外路径拒绝)。
 * 夹具落 os.tmpdir() 独立目录,finally 整体删除。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createOutputAllowlist,
  normalizeOutputPath,
  OUTPUT_ALLOWLIST_MAX_ENTRIES,
} from "../../dist/main/ipc/output-allowlist.js";

/**
 * 断言辅助:条件不成立即抛错,消息带本段前缀便于定位。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {asserts cond}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`output-allowlist 断言失败:${msg}`);
}

export const meta = { description: "shell 产物白名单:绑定真实产物/路径规范化/条目有界" };
// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-output-allowlist-${process.pid}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    // ---- 1. 绑定真实产物:真实文件放行;未生成 / 目录 / 已删除的拒 ----
    const allowlist = createOutputAllowlist();
    const artifact = path.join(dir, "out.docx");
    await fs.writeFile(artifact, "docx", "utf8");
    assert(allowlist.allow(artifact), "真实存在的产物应入白名单");
    assert(
      allowlist.resolveOpenable(artifact) === normalizeOutputPath(artifact),
      "放行时应给出规范化路径",
    );

    const missing = path.join(dir, "not-yet.docx");
    assert(allowlist.allow(missing) === false, "尚未生成的路径不得入白名单");
    assert(allowlist.size() === 1, `未生成的路径不应占条目,当前 ${allowlist.size()}`);

    const subDir = path.join(dir, "sub");
    await fs.mkdir(subDir, { recursive: true });
    assert(allowlist.allow(subDir) === false, "目录不得入白名单(只放行产物文件)");

    // 登记后被删除:成员判定仍在,但打开前复验必须拒(否则给「等它再出现」留窗口)
    assert(allowlist.has(artifact), "删除前应仍是白名单成员");
    await fs.rm(artifact);
    assert(allowlist.resolveOpenable(artifact) === null, "登记后被删除的路径不得放行");
    // 登记后被换成目录:同样不得放行(防「同名目录被顶替」)
    await fs.mkdir(artifact);
    assert(allowlist.resolveOpenable(artifact) === null, "登记后被换成目录的路径不得放行");
    await fs.rm(artifact, { recursive: true, force: true });
    console.log("[ok] output-allowlist:绑定真实产物(未生成/目录/已删除/被换目录均拒)");

    // ---- 2. 路径规范化:绕开写法拒,等价写法仍放行 ----
    const victim = path.join(dir, "victim.docx");
    await fs.writeFile(victim, "docx", "utf8");
    assert(allowlist.allow(victim), "真实产物应入白名单");
    const canonical = /** @type {string} */ (normalizeOutputPath(victim));

    // 非绝对路径(按 cwd 解析,cwd 不可控)→ 拒
    assert(normalizeOutputPath("out.docx") === null, "相对路径必须被规范化拒绝");
    assert(normalizeOutputPath("") === null, "空串必须被拒绝");
    assert(normalizeOutputPath("   ") === null, "纯空白必须被拒绝");
    // 穿越写法:同目录穿越归一到同一键(合法入口不因归一而自断)
    const traversal = path.join(dir, "..", path.basename(dir), "victim.docx");
    assert(
      normalizeOutputPath(traversal) === canonical,
      "同目录穿越写法应归一到同一键(否则合法入口自断)",
    );
    assert(
      allowlist.resolveOpenable(traversal) === canonical,
      "同目录穿越写法仍应放行(归一后同键)",
    );
    // 穿越到别处的路径:键不同 → 拒
    const escape = path.join(dir, "..", "victim.docx");
    assert(normalizeOutputPath(escape) !== canonical, "穿越到别处的路径不应与已登记条目同键");
    assert(allowlist.resolveOpenable(escape) === null, "穿越到别处的路径不得放行");
    // 前缀同名的兄弟文件不得因字符串前缀比较而搭便车
    const sibling = `${victim}.bak`;
    await fs.writeFile(sibling, "bak", "utf8");
    assert(allowlist.allow(sibling), "兄弟产物自身入白名单");
    assert(allowlist.resolveOpenable(victim) === canonical, "已登记产物仍应放行");
    assert(
      allowlist.resolveOpenable(sibling) === normalizeOutputPath(sibling),
      "兄弟产物应各自放行",
    );
    // win32:大小写不同的同一路径仍应放行(Windows 文件名本身大小写不敏感)
    if (process.platform === "win32") {
      const shouted = victim.toUpperCase();
      assert(normalizeOutputPath(shouted) === canonical, "win32 下大小写不同的同一路径应归一到同一键");
      assert(allowlist.resolveOpenable(shouted) === canonical, "win32 下大小写不同的同一路径应放行");
    }
    // 等价写法(冗余分隔符)仍放行
    const redundant = path.join(dir, ".", "victim.docx");
    assert(allowlist.resolveOpenable(redundant) === canonical, "冗余分隔符写法应仍放行");
    // 注入 isFile=false 的替身:stat 异常/非文件一律视为否(不得因异常放行)
    const injected = createOutputAllowlist({ deps: { isFile: () => false, normalize: normalizeOutputPath } });
    assert(injected.allow(victim) === false, "isFile 判否时不得入白名单");
    assert(injected.size() === 0, "未入白名单不应占条目");
    assert(injected.resolveOpenable(victim) === null, "未入白名单的路径不得放行");
    console.log("[ok] output-allowlist:路径规范化(相对/穿越/前缀拒,等价写法与 win32 大小写放行)");

    // ---- 3. 有界增长:超出上限按插入序淘汰最旧 ----
    const bounded = createOutputAllowlist({ maxEntries: 3 });
    const made = [];
    for (let i = 0; i < 6; i += 1) {
      const p = path.join(dir, `bulk-${i}.docx`);
      await fs.writeFile(p, "x", "utf8");
      made.push(p);
      assert(bounded.allow(p), `批量产物 ${i} 应入白名单`);
    }
    assert(bounded.size() === 3, `条目数应被上限约束为 3,实际 ${bounded.size()}`);
    assert(bounded.resolveOpenable(made[0]) === null, "最旧条目应被淘汰");
    assert(bounded.resolveOpenable(made[1]) === null, "次旧条目应被淘汰");
    for (const p of made.slice(3)) {
      assert(bounded.resolveOpenable(p) !== null, `近期条目 ${path.basename(p)} 不应被淘汰`);
    }
    // 重复登记刷新最近使用序:老条目不会因「重复 allow」被当最旧淘汰
    const refreshed = createOutputAllowlist({ maxEntries: 2 });
    const a = path.join(dir, "refresh-a.docx");
    const b = path.join(dir, "refresh-b.docx");
    const c = path.join(dir, "refresh-c.docx");
    for (const p of [a, b, c]) await fs.writeFile(p, "x", "utf8");
    refreshed.allow(a);
    refreshed.allow(b);
    refreshed.allow(a); // 刷新 a 的最近使用序
    refreshed.allow(c); // 触发淘汰:应淘汰 b(更旧),a 因刷新而保留
    assert(refreshed.resolveOpenable(a) !== null, "重复登记应刷新最近使用序,不该被淘汰");
    assert(refreshed.resolveOpenable(b) === null, "未刷新的较旧条目应被淘汰");
    assert(refreshed.resolveOpenable(c) !== null, "最新条目不应被淘汰");
    assert(OUTPUT_ALLOWLIST_MAX_ENTRIES > 0, "默认条目上限应为正数");
    bounded.clear();
    assert(bounded.size() === 0, "clear 后条目应清空");
    console.log(
      `[ok] output-allowlist:条目有界(默认上限 ${OUTPUT_ALLOWLIST_MAX_ENTRIES}/测试用 3,超出淘汰最旧,重复登记刷新次序)`,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
