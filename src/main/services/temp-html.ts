/**
 * 临时 HTML 文件生命周期(预览/打印共用):写文件 + 清理 一对操作。
 * 清理失败(如仍被 Chromium 占用)仅记录,不阻断。
 * 卫生加固:
 * - 文件名随机段改 crypto.randomUUID()(CSPRNG,替代 Math.random);
 * - writeFile 加 'wx' 独占标志(防理论上的文件名碰撞覆盖;碰撞时换名重试);
 * - 启动期清扫崩溃残留 tmp 未做:残留仅发生在「写入成功后进程即崩溃」的极端路径,
 *   审计评估风险极低;且扫描共享 %TEMP% 目录需按 pid 存活性判定,误删其他实例
 *   在用文件的风险大于收益——记录在案,暂不实现。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 文件名碰撞重试次数('wx' 独占写入遇 EEXIST 时换名重试;randomUUID 下实际不可达)。 */
const NAME_COLLISION_RETRIES = 3;

/**
 * 写入临时 HTML(os.tmpdir,命名 m2w-{pid}-{time}-{uuid短}.html),返回路径与清理函数。
 * 注意:调用方须在窗口 closed/销毁路径上调用 cleanup,避免残留。
 */
export async function writeTempHtml(
  html: string,
): Promise<{ htmlPath: string; cleanup: () => Promise<void> }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < NAME_COLLISION_RETRIES; attempt++) {
    const htmlPath = path.join(
      os.tmpdir(),
      `m2w-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}.html`,
    );
    try {
      // 'wx':独占创建,已存在即抛 EEXIST(防碰撞覆盖),换名重试
      await fs.writeFile(htmlPath, html, { encoding: "utf8", flag: "wx" });
      return {
        htmlPath,
        cleanup: async () => {
          await fs.rm(htmlPath, { force: true }).catch(() => undefined);
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
      lastError = err;
    }
  }
  throw lastError;
}
