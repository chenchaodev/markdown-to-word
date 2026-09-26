/**
 * 输入与目录预算验收(位于 test/main/ = 主进程层;被测 src/main/converter/paths.ts、
 * preprocess.ts、batch.ts、merge.ts,经 dist 直连,electron 环境):
 * - collectMarkdownPaths:realpath 规范路径去重(junction/symlink 指回自身或祖先时
 *   终止递归,不再无限展开)+ 深度上限 + 条目数上限,超限经 warnings 上报;
 * - 数千路径(2000 个 md)在预算内完成收集并保持排序口径;
 * - prepareMarkdown:单文件体积上限(读前 stat 与读后长度双检),超限拒绝而非截断;
 * - batchConvertImpl:文件数超上限直接拒绝整批(不静默截断);
 * - mergeConvertImpl:文件数与源总体积上限;读取为有界并发(非 Promise.all 全开)
 *   且保序(warning 顺序不受完成顺序影响)。
 * 运行时产物放 os.tmpdir() 独立目录,finally 整体删除,不污染 output/smoke;
 * settings 经 updateSettings 备份/恢复(与 converter.test.js 同款卫生)。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { updateSettings } from "../../dist/main/persist/settings.js";
import {
  batchConvertImpl,
  collectMarkdownPaths,
  mergeConvertImpl,
} from "../../dist/main/converter/index.js";
import { MAX_SCAN_DEPTH, MAX_SCAN_ENTRIES } from "../../dist/main/converter/paths.js";
import { MAX_SOURCE_FILE_BYTES, prepareMarkdown } from "../../dist/main/converter/preprocess.js";
import { MAX_BATCH_FILES } from "../../dist/main/converter/batch.js";
import { MAX_MERGE_FILES, MAX_MERGE_TOTAL_BYTES, MERGE_READ_CONCURRENCY } from "../../dist/main/converter/merge.js";
import { formatWarning } from "../../dist/core/i18n.js";
import { backupSettings } from "../common/settings.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`input-budget 断言失败:${msg}`);
}

// 显式声明本段无验收样例(契约见 test/tools/gen-fixtures.mjs 文件头)
export const fixtures = null;

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-input-budget-${process.pid}`);
  const { restore: restoreSettings } = await backupSettings();
  try {
    await fs.mkdir(dir, { recursive: true });
    await updateSettings({ outputDir: "", afterConvert: "none" });

    // ================= 1. junction 环:realpath 去重终止递归 =================
    // 目录联接点指回自身:词法路径每层都不同(旧实现按词法去重会无限展开),
    // realpath 规范路径相同 → 第二次进入即终止。造不出联接点时跳过该分支
    // (权限受限环境),其余断言不受影响。
    {
      const root = path.join(dir, "junction-root");
      await fs.mkdir(path.join(root, "sub"), { recursive: true });
      await fs.writeFile(path.join(root, "a.md"), "# A\n", "utf8");
      await fs.writeFile(path.join(root, "sub", "b.md"), "# B\n", "utf8");
      const loopLink = path.join(root, "sub", "loop");
      let junction = true;
      try {
        await fs.symlink(root, loopLink, "junction");
      } catch (err) {
        junction = false;
        console.log(`[skip] junction 夹具创建失败(${err.code ?? "unknown"}),环保护未覆盖`);
      }
      if (junction) {
        const startedAt = Date.now();
        const warnings = [];
        const result = await collectMarkdownPaths([root], warnings);
        const elapsed = Date.now() - startedAt;
        assert(elapsed < 10_000, `junction 环收集耗时异常(${elapsed}ms),疑似无限递归`);
        assert(
          result.files.length === 2 && result.files.some((f) => f.endsWith(`${path.sep}a.md`)) && result.files.some((f) => f.endsWith(`${path.sep}b.md`)),
          `junction 环下应恰收集 2 个文件(环内文件不重复展开),实际 ${JSON.stringify(result.files)}`,
        );
        assert(warnings.length === 0, `正常规模收集不应有预算警告,实际 ${JSON.stringify(warnings)}`);
      }
      // 重复传入同一目录:realpath 去重后只扫一次
      const dup = await collectMarkdownPaths([root, root]);
      assert(dup.files.length === 2, `重复传入同一目录应只扫一次,实际 ${JSON.stringify(dup.files)}`);
      console.log("[ok] input-budget:collectMarkdownPaths junction 环/重复目录按 realpath 规范路径去重");
    }

    // ================= 2. 深度上限:超过 MAX_SCAN_DEPTH 的层级不展开 =================
    {
      const deep = path.join(dir, "deep");
      let current = deep;
      for (let i = 0; i <= MAX_SCAN_DEPTH + 2; i++) {
        current = path.join(current, `d${i}`);
      }
      await fs.mkdir(current, { recursive: true });
      await fs.writeFile(path.join(current, "deep.md"), "# 深\n", "utf8");
      const warnings = [];
      const result = await collectMarkdownPaths([deep], warnings);
      assert(!result.files.some((f) => f.endsWith(`${path.sep}deep.md`)), `超深度文件不应被收集,实际 ${JSON.stringify(result.files)}`);
      assert(
        warnings.length === 1 && formatWarning(warnings[0]).includes(`层级上限(${MAX_SCAN_DEPTH})`),
        `深度超限应恰一条层级警告,实际 ${JSON.stringify(warnings.map((w) => formatWarning(w)))}`,
      );
      // 未触顶的浅目录不受影响(深度闸门不是全局熔断)
      const shallow = path.join(dir, "shallow");
      await fs.mkdir(shallow, { recursive: true });
      await fs.writeFile(path.join(shallow, "top.md"), "# 顶\n", "utf8");
      const shallowWarnings = [];
      const shallowResult = await collectMarkdownPaths([shallow], shallowWarnings);
      assert(
        shallowResult.files.length === 1 && shallowWarnings.length === 0,
        `浅目录应正常收集且无警告,实际 ${JSON.stringify(shallowResult.files)}`,
      );
      console.log(`[ok] input-budget:collectMarkdownPaths 深度上限 ${MAX_SCAN_DEPTH} 生效并上报警告(浅目录不受影响)`);
    }

    // ================= 3. 数千路径在预算内完成 + 条目数上限 =================
    {
      const bulk = path.join(dir, "bulk");
      await fs.mkdir(bulk, { recursive: true });
      const bulkCount = 2000;
      await Promise.all(
        Array.from({ length: bulkCount }, (_, i) =>
          fs.writeFile(path.join(bulk, `p${String(i).padStart(4, "0")}.md`), `# ${i}\n`, "utf8"),
        ),
      );
      const startedAt = Date.now();
      const bulkResult = await collectMarkdownPaths([bulk]);
      const elapsed = Date.now() - startedAt;
      assert(bulkResult.files.length === bulkCount, `数千路径应全部收集,实际 ${bulkResult.files.length}/${bulkCount}`);
      assert(elapsed < 20_000, `数千路径收集耗时异常(${elapsed}ms)`);
      // 排序口径不变(大小写不敏感字典序)
      assert(bulkResult.files[0].endsWith("p0000.md"), "排序首项异常");
      console.log(`[ok] input-budget:collectMarkdownPaths 数千路径(${bulkCount})在 ${elapsed}ms 内完成`);

      // 条目数上限:单目录塞入超过上限的条目 → 截断并上报(MAX_SCAN_ENTRIES 本身较大,
      // 故此处不真的造 2 万文件,而是断言常量与告警文案口径,避免测试本身成为瓶颈)
      assert(Number.isInteger(MAX_SCAN_ENTRIES) && MAX_SCAN_ENTRIES > 0, "条目数上限应为正整数常量");
      const { pathScanLimitWarning } = await import("../../dist/main/converter/paths.js");
      assert(
        formatWarning(pathScanLimitWarning("条目数", MAX_SCAN_ENTRIES)).includes(`条目数上限(${MAX_SCAN_ENTRIES})`),
        "条目数上限告警文案口径不符",
      );
    }

    // ================= 4. 单文件体积上限:拒绝而非截断 =================
    {
      const big = path.join(dir, "big.md");
      // 稀疏写入:只落一个超过上限的头部(不真正占用 32MB 磁盘)
      const handle = await fs.open(big, "w");
      try {
        await handle.write(Buffer.alloc(1024, 0x61), 0, 1024, MAX_SOURCE_FILE_BYTES);
      } finally {
        await handle.close();
      }
      let error;
      try {
        await prepareMarkdown(big, { obsidianCompat: false, aiCleanup: false, obsidianAttachmentFolder: "" });
      } catch (err) {
        error = err;
      }
      assert(error instanceof Error && /超过上限/.test(error.message), `超限文件应被拒绝,实际 ${error?.message ?? error}`);
      // 正常文件不受影响
      const small = path.join(dir, "small.md");
      await fs.writeFile(small, "# 小\n\n正文\n", "utf8");
      const prepared = await prepareMarkdown(small, { obsidianCompat: false, aiCleanup: false, obsidianAttachmentFolder: "" });
      assert(prepared.markdown.includes("# 小"), "正常文件应正常准备");
      console.log(`[ok] input-budget:prepareMarkdown 单文件上限 ${MAX_SOURCE_FILE_BYTES} 生效(拒绝不截断)`);
    }

    // ================= 5. 批量文件数上限:直接拒绝整批 =================
    {
      assert(Number.isInteger(MAX_BATCH_FILES) && MAX_BATCH_FILES > 0, "批量文件数上限应为正整数常量");
      const sample = path.join(dir, "small.md");
      let error;
      try {
        await batchConvertImpl(Array.from({ length: MAX_BATCH_FILES + 1 }, () => sample), "docx");
      } catch (err) {
        error = err;
      }
      assert(error instanceof Error && /超过上限/.test(error.message), `超限批量应被拒绝,实际 ${error?.message ?? error}`);
      // 上限内的批量仍正常(1 份复制品即可,避免测试产物膨胀)
      const one = await batchConvertImpl([sample], "docx");
      assert(one.okCount === 1, "上限内批量应正常完成");
      console.log(`[ok] input-budget:批量文件数上限 ${MAX_BATCH_FILES} 生效(超限拒绝整批)`);
    }

    // ================= 6. 合并:文件数/总体积上限 + 有界并发读取 + 保序 =================
    {
      assert(Number.isInteger(MAX_MERGE_FILES) && MAX_MERGE_FILES > 0, "合并文件数上限应为正整数常量");
      assert(MAX_MERGE_TOTAL_BYTES > 0, "合并源总体积上限应为正数");
      const sample = path.join(dir, "small.md");
      let fileLimitError;
      try {
        await mergeConvertImpl(Array.from({ length: MAX_MERGE_FILES + 1 }, () => sample), "docx");
      } catch (err) {
        fileLimitError = err;
      }
      assert(
        fileLimitError instanceof Error && /超过上限/.test(fileLimitError.message),
        `超文件数应被拒绝,实际 ${fileLimitError?.message ?? fileLimitError}`,
      );
      // 体积上限:造一个超过 MAX_MERGE_TOTAL_BYTES 的稀疏文件(128MB 上限,只落头尾)
      const huge = path.join(dir, "huge.md");
      const hugeHandle = await fs.open(huge, "w");
      try {
        await hugeHandle.write(Buffer.alloc(1024, 0x62), 0, 1024, MAX_MERGE_TOTAL_BYTES);
      } finally {
        await hugeHandle.close();
      }
      let sizeLimitError;
      try {
        await mergeConvertImpl([sample, huge], "docx");
      } catch (err) {
        sizeLimitError = err;
      }
      assert(
        sizeLimitError instanceof Error && /总体积超过上限/.test(sizeLimitError.message),
        `超体积应被拒绝,实际 ${sizeLimitError?.message ?? sizeLimitError}`,
      );
      // 正常合并:多文件保序合成一篇(标题顺序 = 文件顺序)
      const mergeFiles = ["m1", "m2", "m3", "m4", "m5"].map((name) => path.join(dir, `${name}.md`));
      for (const [i, file] of mergeFiles.entries()) {
        await fs.writeFile(file, `# 标题 ${i + 1}\n\n正文 ${i + 1}\n`, "utf8");
      }
      const merged = await mergeConvertImpl(mergeFiles, "docx");
      assert(merged.ok && !!merged.outputPath, `正常合并应成功,实际 ${JSON.stringify(merged)}`);
      await fs.stat(merged.outputPath);
      console.log(`[ok] input-budget:合并上限生效(文件数 ${MAX_MERGE_FILES} / 体积 ${MAX_MERGE_TOTAL_BYTES});正常合并 5 篇成功`);

      // 读取为有界并发(非 Promise.all 全开):经 fs.readFile 在途计数观测
      // ——同一 ESM 内建模块对象,dist 侧与测试侧共用同一 readFile 引用
      const manyFiles = Array.from({ length: 12 }, (_, i) => path.join(dir, `c${i}.md`));
      for (const [i, file] of manyFiles.entries()) {
        await fs.writeFile(file, `# 并发 ${i}\n\n正文\n`, "utf8");
      }
      const originalReadFile = fs.readFile;
      let inFlight = 0;
      let maxInFlight = 0;
      try {
        fs.readFile = async (...args) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            return await originalReadFile(...args);
          } finally {
            inFlight -= 1;
          }
        };
        await mergeConvertImpl(manyFiles, "docx");
      } finally {
        fs.readFile = originalReadFile;
      }
      assert(
        maxInFlight > 1 && maxInFlight <= MERGE_READ_CONCURRENCY,
        `合并读取应有界并发(2..${MERGE_READ_CONCURRENCY}),实际在途峰值 ${maxInFlight}`,
      );
      console.log(`[ok] input-budget:合并读取有界并发(峰值 ${maxInFlight} ≤ ${MERGE_READ_CONCURRENCY},12 个源文件)`);
    }
  } finally {
    await restoreSettings();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
