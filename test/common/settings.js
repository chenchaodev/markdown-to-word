/**
 * 用户设置备份/恢复(save/restore 公共 helper,R8 批 3 L7):
 * 原内联逻辑在 test/main/converter.test.js,smoke.ts 有同款简化版(仅改两键)。
 * 注意:smoke.ts 属应用代码(src/main),不得 import test/,保持自身实现。
 */
import { app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { loadSettings, updateSettings } from "../../dist/main/settings.js";

/**
 * 备份用户设置,返回 { orig, restore }:
 * - orig:种子缓存快照(供断言构造「基于原值修改」的场景,如 landscape);
 * - restore():updateSettings(orig) 双写回原值;原本无文件则恢复后删除,不污染用户设置。
 * 崩溃残留风险与既有实现一致(updateSettings 双写原子性见 settings.ts)。
 */
export async function backupSettings() {
  const settingsFile = path.join(app.getPath("userData"), "settings.json");
  const orig = loadSettings(); // 种子缓存 + 恢复基准(文件 + 缓存)
  let hadFile = false;
  await fs.access(settingsFile).then(() => (hadFile = true), () => undefined);
  return {
    orig,
    restore: async function restore() {
      await updateSettings(orig);
      if (!hadFile) await fs.rm(settingsFile, { force: true });
    },
  };
}
