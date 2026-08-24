/**
 * 临时 HTML 文件生命周期段(src/main/services/temp-html.ts 纯 Node 层,零 Electron API):
 * TEST-4 覆盖缺口补测(main/services 此前唯二无专属测试的服务之一)。
 * 实现事实(读源码确认,MR-14 加固后):
 * - writeTempHtml:写入 os.tmpdir(),命名 m2w-{pid}-{time}-{uuid短}.html
 *   (随机段为 crypto.randomUUID() 前 8 位,CSPRNG;非 Math.random);
 * - 'wx' 独占创建标志:文件已存在即 EEXIST 换名重试(防碰撞覆盖;
 *   randomUUID 下实际不可达,不可低成本构造碰撞场景,未覆盖);
 * - cleanup:fs.rm force 删除,失败静默(不阻断);幂等(文件已删再调不抛)。
 * 断言面:路径形状(pid/时间戳/8 位 hex 随机段)、内容逐字写入(utf8 中文)、
 * cleanup 删除 + 幂等、并发多次调用路径唯一且全部可清理。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeTempHtml } from "../../dist/main/services/temp-html.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`temp-html 断言失败:${msg}`);
}

/** 纯 Node 段(零 Electron API) */
export async function run() {
  // ---- 1. 基本写入:tmpdir 下命名形状 + 内容逐字(utf8 中文) ----
  const html = "<html><body><h1>中文标题</h1><p>preview</p></body></html>";
  const { htmlPath, cleanup } = await writeTempHtml(html);
  try {
    assert(path.dirname(htmlPath) === os.tmpdir(), `临时文件应位于 os.tmpdir(),实际 ${path.dirname(htmlPath)}`);
    const name = path.basename(htmlPath);
    assert(
      new RegExp(`^m2w-${process.pid}-\\d+-[0-9a-f]{8}\\.html$`).test(name),
      `文件名应为 m2w-{pid}-{time}-{uuid8hex}.html,实际 ${name}`,
    );
    assert((await fs.readFile(htmlPath, "utf8")) === html, "写入内容应与输入逐字一致");
    console.log("[ok] temp-html:tmpdir 路径/命名形状(randomUUID 段)/内容逐字 断言通过");

    // ---- 2. cleanup 删除 + 幂等(force:文件已删再调不抛) ----
    await cleanup();
    let gone = false;
    try {
      await fs.access(htmlPath);
    } catch {
      gone = true;
    }
    assert(gone, "cleanup 后临时文件应被删除");
    await cleanup(); // 幂等:第二次调用不抛(fs.rm force)
    console.log("[ok] temp-html:cleanup 删除 + 幂等 断言通过");
  } finally {
    await fs.rm(htmlPath, { force: true }).catch(() => undefined); // 兜底清理,防断言失败残留
  }

  // ---- 3. 并发唯一性:25 次并发写入 → 路径互不相同、全部存在、全部可清理 ----
  // (randomUUID 随机段 + 'wx' 独占创建的间接验证:无碰撞、无覆盖)
  const results = await Promise.all(
    Array.from({ length: 25 }, () => writeTempHtml("<p>x</p>")),
  );
  const paths = results.map((r) => r.htmlPath);
  assert(new Set(paths).size === paths.length, "并发写入应产生互不相同的路径(无碰撞)");
  for (const p of paths) {
    let exists = false;
    try {
      await fs.access(p);
      exists = true;
    } catch {
      /* 不存在 */
    }
    assert(exists, `并发写入的文件应存在:${p}`);
  }
  await Promise.all(results.map((r) => r.cleanup()));
  for (const p of paths) {
    let gone = true;
    try {
      await fs.access(p);
      gone = false;
    } catch {
      /* 已删除 */
    }
    assert(gone, `cleanup 后不应残留:${p}`);
  }
  console.log("[ok] temp-html:并发 25 次路径唯一/全部清理 断言通过");
}
