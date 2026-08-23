/**
 * 路径收集/输出路径解析验收(位于 test/main/ = 主进程层;src/main/converter.ts,
 * 测试经 dist/main/converter.js,electron 环境):
 * 迭代 3 低优先级缺口(ROADMAP 141/142 行),重构后两函数已导出 → 升级为直测:
 * - collectMarkdownPaths:目录递归(.md/.markdown 含嵌套)、点开头目录(.git/.hidden)
 *   与点开头文件跳过、目录内非 md 静默忽略、直接传非 md/不存在 → skipped、
 *   直接传 .md → files、排序大小写不敏感(localeCompare sensitivity base)、
 *   seen 按 path.resolve 去重(重复路径只收集一次)
 * - resolveOutputPath:outputDir 空串 → 源目录、有效 → mkdir 创建并落指定目录、
 *   baseName 覆盖、pdf → .pdf、候选 >250 字符 → 回落源目录 +「输出路径过长」警告、
 *   outputDir mkdir 失败(指向已存在文件)→ 回落源目录 +「输出目录不可用」警告
 * 实现事实(读源码确认):
 * - skipped 记录传入原串(本段统一传绝对路径,断言确定);visit 的 seen 在 stat 前
 *   即去重,目录重复传入也只扫一次
 * - 点前缀跳过是「entry.name 以 . 开头」判定,对目录与文件一视同仁
 *   (.hiddenfile.md 同样不收集,断言以实际行为为准)
 * - 超长回落(源码 138-142 行):回落源目录后重算 candidate,但不再二次检查长度
 *   ——源目录 + 超长 baseName 仍 >250 时原样进入 pathExists 循环并返回
 * - 重名序号循环(pathExists → 「名 (2).ext」)本段不重复断言:converter.test.js
 *   经 convertImpl 两次转换已覆盖;runAfterConvert none 分支亦由 converter.test.js
 *   隐式覆盖(afterConvert 恒置 none),show-in-folder/open 触发真实 GUI 转实测
 * 样例/产物全部放 os.tmpdir() 独立目录,finally 整体删除,不污染 output/smoke
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectMarkdownPaths, resolveOutputPath } from "../../dist/main/converter.js";
import { formatWarning } from "../../dist/core/i18n.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`paths 断言失败:${msg}`);
}

function sameMembers(actual, expected, msg) {
  assert(
    actual.length === expected.length && expected.every((e) => actual.includes(e)),
    `${msg}:实际 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`,
  );
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-paths-${process.pid}`);
  try {
    // ================= 目录树(collectMarkdownPaths 扫描对象) =================
    const root = path.join(dir, "root");
    const f = {
      a: path.join(root, "a.md"),
      b: path.join(root, "b.markdown"),
      txt: path.join(root, "notes.txt"),
      png: path.join(root, "pic.png"),
      dotFile: path.join(root, ".hiddenfile.md"),
      gitHistory: path.join(root, ".git", "history.md"),
      hiddenSecret: path.join(root, ".hidden", "secret.md"),
      deep: path.join(root, "sub", "deep.md"),
      deepTxt: path.join(root, "sub", "deep.txt"),
      deepest: path.join(root, "sub", "nested", "deepest.markdown"),
      sortZebra: path.join(root, "sortdir", "zebra.md"),
      sortApple: path.join(root, "sortdir", "apple.md"),
      sortBanana: path.join(root, "sortdir", "Banana.md"),
      sortMango: path.join(root, "sortdir", "mango.md"),
    };
    for (const file of Object.values(f)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `# ${path.basename(file)}\n\n正文\n`, "utf8");
    }

    // ---- 1/2/3. 目录递归:嵌套子目录全部 .md/.markdown 收集;点开头目录(.git/.hidden)
    // 与其内文件、点开头文件(.hiddenfile.md)一律跳过;目录内非 md(notes.txt/pic.png/
    // deep.txt)静默忽略(不进 files 也不进 skipped) ----
    const tree = await collectMarkdownPaths([root]);
    const expectedTree = [
      f.a,
      f.b,
      f.sortApple,
      f.sortBanana,
      f.sortMango,
      f.sortZebra,
      f.deep,
      f.deepest,
    ];
    assert(tree.skipped.length === 0, `目录递归:skipped 应为空,实际 ${JSON.stringify(tree.skipped)}`);
    assert(
      tree.files.length === expectedTree.length && expectedTree.every((file) => tree.files.includes(file)),
      "目录递归:收集集合不符",
    );
    assert(
      !tree.files.includes(f.gitHistory) && !tree.files.includes(f.hiddenSecret),
      "目录递归:点开头目录内文件被收集",
    );
    assert(!tree.files.includes(f.dotFile), "目录递归:点开头文件被收集(实际行为:点前缀条目一律跳过)");
    console.log("[ok] paths:collectMarkdownPaths 目录递归(嵌套/点目录/点文件跳过/非 md 静默)");

    // ---- 6. 排序:localeCompare sensitivity base(大小写不敏感)。
    // apple < Banana 可区分大小写敏感排序(后者 B(66) < a(97) 会颠倒);
    // sortdir < sub(全路径字典序,跨目录稳定) ----
    const idx = (file) => tree.files.indexOf(file);
    assert(idx(f.sortApple) < idx(f.sortBanana), "排序:apple 应在 Banana 前(大小写不敏感)");
    assert(
      idx(f.sortBanana) < idx(f.sortMango) && idx(f.sortMango) < idx(f.sortZebra),
      "排序:sortdir 内字典序错误",
    );
    assert(idx(f.a) < idx(f.b) && idx(f.sortApple) < idx(f.deep), "排序:跨目录全路径字典序错误");
    console.log("[ok] paths:collectMarkdownPaths 排序(大小写不敏感字典序)");

    // ---- 4/5/7. 直接传:md 进 files、非 md 与不存在进 skipped、seen 去重 ----
    const ghost = path.join(dir, "ghost.md"); // 故意不写盘
    const direct = await collectMarkdownPaths([f.a, f.a, f.txt, f.deepest, ghost]);
    sameMembers(direct.files, [f.a, f.deepest], "直接传 md 收集错误");
    sameMembers(direct.skipped, [f.txt, ghost], "直接传非 md/不存在 skipped 错误");
    assert(direct.files.length === 2, "去重:重复传入同一路径仍收集两次");
    const dupDir = await collectMarkdownPaths([root, root]); // 目录重复传入 → seen 按 resolve 去重只扫一次
    assert(dupDir.files.length === expectedTree.length, "去重:目录重复传入收集数量不一致");
    console.log("[ok] paths:collectMarkdownPaths 直接传 md/skipped/不存在/去重");

    // ================= resolveOutputPath =================
    const srcMd = path.join(dir, "sample.md");
    await fs.writeFile(srcMd, "# 输出路径\n\n正文\n", "utf8");
    const srcDir = path.dirname(srcMd);

    // ---- 10. outputDir 空串 → 源目录(默认 baseName = 去扩展名);pdf → .pdf;
    // baseName 覆盖;有效 outputDir(不存在的目录)→ mkdir 创建并落指定目录 ----
    const emptyOut = await resolveOutputPath(srcMd, "docx", "");
    assert(emptyOut.warnings.length === 0, `空串输出目录:不应有警告,实际 ${JSON.stringify(emptyOut.warnings)}`);
    assert(path.dirname(emptyOut.outputPath) === srcDir, "空串输出目录:未落在源目录");
    assert(emptyOut.outputPath.endsWith("sample.docx"), `空串输出目录:文件名错误 ${emptyOut.outputPath}`);
    assert((await resolveOutputPath(srcMd, "pdf", "")).outputPath.endsWith(".pdf"), "pdf 格式扩展名错误");
    const renamed = await resolveOutputPath(srcMd, "docx", "", "custom-name");
    assert(path.basename(renamed.outputPath) === "custom-name.docx", "baseName 覆盖无效");
    const targetDir = path.join(dir, "out-target");
    const validOut = await resolveOutputPath(srcMd, "docx", targetDir);
    assert(
      validOut.warnings.length === 0 && path.dirname(validOut.outputPath) === targetDir,
      `有效输出目录:未落指定目录 ${validOut.outputPath}`,
    );
    await fs.stat(targetDir); // mkdir recursive 已创建
    console.log("[ok] paths:resolveOutputPath 输出目录(空串→源目录/有效→创建落盘/baseName/pdf)");

    // ---- 8. 超长路径(候选 >250):回落源目录 + 一条「输出路径过长」警告,文件名不截断;
    // 回落后的 candidate 不再二次检查长度——源目录 + 超长 baseName 仍 >250 时原样返回
    // (源码 138-142 行,以实际实现为准) ----
    const longName = "x".repeat(260);
    const longOut = await resolveOutputPath(srcMd, "docx", targetDir, longName);
    assert(
      longOut.warnings.length === 1 && formatWarning(longOut.warnings[0]).includes("输出路径过长"),
      `超长路径:应恰一条「输出路径过长」警告,实际 ${JSON.stringify(longOut.warnings)}`,
    );
    assert(path.dirname(longOut.outputPath) === srcDir, "超长路径:未回落源目录");
    assert(path.basename(longOut.outputPath) === `${longName}.docx`, "超长路径:文件名被截断或改动");
    assert(longOut.outputPath.length > 250, "超长路径:回落后的候选长度与实现不符(仍 >250)");
    console.log("[ok] paths:resolveOutputPath 超长路径回落(>250→源目录+警告,不截断)");

    // ---- 9. outputDir mkdir 失败(指向已存在的普通文件 → EEXIST)→ 回落源目录
    // + 一条「输出目录不可用」警告 ----
    const blocker = path.join(dir, "blocker.txt");
    await fs.writeFile(blocker, "blocker", "utf8");
    const badOut = await resolveOutputPath(srcMd, "docx", blocker);
    assert(
      badOut.warnings.length === 1 && formatWarning(badOut.warnings[0]).includes("输出目录不可用"),
      `mkdir 失败:应恰一条「输出目录不可用」警告,实际 ${JSON.stringify(badOut.warnings)}`,
    );
    assert(path.dirname(badOut.outputPath) === srcDir, "mkdir 失败:未回落源目录");
    assert(badOut.outputPath.endsWith("sample.docx"), "mkdir 失败:回落文件名错误");
    console.log("[ok] paths:resolveOutputPath mkdir 失败回落(输出目录不可用→源目录+警告)");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
