/**
 * 产物提交器验收(位于 test/main/ = 主进程层;src/main/converter/artifact-writer.ts,
 * 测试经 dist/main/converter/artifact-writer.js 直连,electron 环境):
 * 断言「选名与占位合并为独占提交」的完整契约(端到端转换链路的并发同名回归在
 * converter.test.js,本段只测提交器自身):
 * - 提交成功:首选路径即落盘路径,内容逐字节一致,目录内无临时文件残留;
 * - 重名递增:首选被占 → 「名 (2).ext」,序号语义与旧实现一致(从 2 起);
 * - 真并发同名不覆盖:24 路并发提交同一首选路径 → 24 个互异路径,内容与各自载荷
 *   严格对应(无覆盖、无交叉污染);这是旧「stat 判空 → 写盘」实现必然失守的面;
 * - 魔数闸门:.docx 收 PDF 字节 / .pdf 收 ZIP 字节 / 空载荷 / 未知扩展名 → 抛错,
 *   最终路径零副作用、无临时文件残留(半成品不被当成成功产物);
 * - 失败与取消:提交(link)抛真实故障(EIO)或提交前闸门抛错(取消)→ 上抛给调用方,
 *   不产生最终文件、临时文件已清理;
 * - 不支持硬链接的环境(FAT32/exFAT/部分网络盘等,注入 EPERM/EACCES/EXDEV/ENOSYS/
 *   EOPNOTSUPP/ENOTSUP/EMLINK/EINVAL):**不做**「独占创建 + 直写最终路径」的非原子
 *   退化写,直接抛可操作错误(原因/路径/建议齐全),目录内零文件(无半截最终文件、无临时
 *   文件);与真实故障(EIO 原样上抛、不被改写成「换目录」提示)严格区分;
 *   判定顺序上 EEXIST 优先于「不支持」——同名先递增序号,空闲名才报不支持;
 *   正常路径(第 1 组,本机 NTFS 走真实 fs.link)是唯一的原子提交通道。
 * 样例/产物全部放 os.tmpdir() 独立目录,finally 整体删除,不污染 output/smoke。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ARTIFACT_TEMP_PREFIX, commitArtifact } from "../../dist/main/converter/artifact-writer.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`artifact-commit 断言失败:${msg}`);
}

/** 造带合法 ZIP 魔数的载荷(内容带唯一 tag,用于验证不发生交叉污染) */
function zipBytes(tag, size = 512) {
  const body = Buffer.alloc(size, 0x20);
  body.write(`m2w-payload:${tag}`, 0, "utf8");
  return Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), body]);
}

/** 造带合法 %PDF 魔数的载荷 */
function pdfBytes(tag) {
  return Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), Buffer.from(`m2w-payload:${tag}\n`, "utf8")]);
}

/** 目录内残留的提交器临时文件名(空数组 = 已清理干净) */
async function tempLeftovers(dir) {
  return (await fs.readdir(dir)).filter((name) => name.startsWith(ARTIFACT_TEMP_PREFIX));
}

/** 造一个带指定 errno code 的错误(注入 link 用,与 Node 系统错误同形) */
function errnoError(code) {
  const err = new Error(`mock ${code}`);
  err.code = code;
  return err;
}

export async function run() {
  const dir = path.join(os.tmpdir(), `m2w-artifact-commit-${process.pid}`);
  await fs.mkdir(dir, { recursive: true });
  try {
    // ================= 1. 提交成功:首选路径 + 逐字节一致 + 无临时残留 =================
    const plain = path.join(dir, "plain.docx");
    const plainPayload = zipBytes("plain");
    const plainResult = await commitArtifact(plain, plainPayload);
    assert(plainResult === plain, `首选路径空闲时应原样落盘,实际 ${plainResult}`);
    const plainRead = await fs.readFile(plain);
    assert(plainRead.equals(plainPayload), "落盘内容应与载荷逐字节一致");
    assert(
      (await tempLeftovers(dir)).length === 0,
      `提交成功后不应残留临时文件,实际 ${JSON.stringify(await tempLeftovers(dir))}`,
    );
    const pdfPlain = path.join(dir, "plain.pdf");
    const pdfResult = await commitArtifact(pdfPlain, pdfBytes("plain"));
    assert(pdfResult === pdfPlain && (await fs.readFile(pdfResult)).equals(pdfBytes("plain")), "PDF 提交路径/内容异常");
    console.log("[ok] artifact-commit:提交成功(首选路径/逐字节一致/PDF 同款/无临时残留)");

    // ================= 2. 重名递增:首选被占 → 「名 (2).ext」,序号从 2 起 =================
    const dupPreferred = path.join(dir, "dup.docx");
    await fs.writeFile(dupPreferred, "既有产物", "utf8");
    const dupPayload = zipBytes("dup");
    const dupResult = await commitArtifact(dupPreferred, dupPayload);
    assert(
      path.basename(dupResult) === "dup (2).docx",
      `首选被占时应递增为「dup (2).docx」,实际 ${path.basename(dupResult)}`,
    );
    assert((await fs.readFile(dupPreferred, "utf8")) === "既有产物", "重名提交不得覆盖既有文件");
    assert((await fs.readFile(dupResult)).equals(dupPayload), "序号变体内容应为本轮载荷");
    const dup2Result = await commitArtifact(dupPreferred, zipBytes("dup2"));
    assert(
      path.basename(dup2Result) === "dup (3).docx",
      `第二个序号应为「dup (3).docx」,实际 ${path.basename(dup2Result)}`,
    );
    console.log("[ok] artifact-commit:重名递增(EEXIST → 名 (2)/(3),既有文件零覆盖)");

    // ================= 3. 真并发同名不覆盖(24 路同一首选路径) =================
    const raceDir = path.join(dir, "race");
    await fs.mkdir(raceDir, { recursive: true });
    const racePreferred = path.join(raceDir, "race.docx");
    const raceCount = 24;
    const racePayloads = Array.from({ length: raceCount }, (_, i) => zipBytes(`race-${i}`));
    const raceResults = await Promise.all(
      racePayloads.map((payload) => commitArtifact(racePreferred, payload)),
    );
    assert(
      new Set(raceResults).size === raceCount,
      `并发同名提交应得到 ${raceCount} 个互异路径,实际去重后 ${new Set(raceResults).size} 个:${JSON.stringify(
        raceResults.map((p) => path.basename(p)),
      )}`,
    );
    // 逐路径核对内容:每个产物必须完整等于某一载荷,不得出现被覆盖/交错的半份内容
    const raceFiles = (await fs.readdir(raceDir)).filter((name) => name.endsWith(".docx"));
    assert(raceFiles.length === raceCount, `并发提交应落 ${raceCount} 个产物,实际 ${raceFiles.length}`);
    const matched = new Set();
    for (const name of raceFiles) {
      const bytes = await fs.readFile(path.join(raceDir, name));
      const index = racePayloads.findIndex((payload) => payload.equals(bytes));
      assert(index >= 0, `产物 ${name} 内容与任一载荷都不一致(疑似覆盖/交错)`);
      assert(!matched.has(index), `载荷 race-${index} 出现在多个产物中(覆盖)`);
      matched.add(index);
    }
    assert((await tempLeftovers(raceDir)).length === 0, "并发提交后临时文件应清理干净");
    console.log(`[ok] artifact-commit:真并发同名不覆盖(${raceCount} 路并发 → ${raceCount} 个互异产物,内容逐一对应)`);

    // ================= 4. 魔数闸门:不符/空/未知扩展名 → 抛错 + 无最终文件 =================
    const magicDir = path.join(dir, "magic");
    await fs.mkdir(magicDir, { recursive: true });
    const magicCases = [
      { name: "docx 收 PDF 字节", target: path.join(magicDir, "wrong.docx"), payload: pdfBytes("x") },
      { name: "pdf 收 ZIP 字节", target: path.join(magicDir, "wrong.pdf"), payload: zipBytes("x") },
      { name: "docx 空载荷", target: path.join(magicDir, "empty.docx"), payload: Buffer.alloc(0) },
      { name: "截断 ZIP(仅 PK 前缀)", target: path.join(magicDir, "stub.docx"), payload: Buffer.from([0x50, 0x4b]) },
      { name: "未知扩展名", target: path.join(magicDir, "weird.rtf"), payload: zipBytes("x") },
    ];
    for (const testCase of magicCases) {
      let failed = null;
      try {
        await commitArtifact(testCase.target, testCase.payload);
      } catch (err) {
        failed = err;
      }
      assert(!!failed, `${testCase.name}:应抛错阻断提交`);
      assert(
        !(await fs.access(testCase.target).then(() => true, () => false)),
        `${testCase.name}:不应产生最终文件 ${path.basename(testCase.target)}`,
      );
    }
    assert(
      (await fs.readdir(magicDir)).length === 0,
      `魔数失败不得留下任何文件(含临时文件),实际 ${JSON.stringify(await fs.readdir(magicDir))}`,
    );
    // 空 ZIP 容器(合法 ZIP 魔数之一)与 PDF 正常放行,确保闸门不是「一律拒绝」
    const emptyZip = path.join(magicDir, "empty-zip.docx");
    await commitArtifact(emptyZip, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00]));
    await fs.stat(emptyZip);
    console.log("[ok] artifact-commit:提交前魔数闸门(5 类不符/空/未知扩展名均抛错且零文件,合法空 ZIP 放行)");

    // ================= 5. 提交失败(真实故障上抛)与取消闸门:无最终文件、无临时残留 =================
    const failDir = path.join(dir, "fail");
    await fs.mkdir(failDir, { recursive: true });
    const failTarget = path.join(failDir, "fail.docx");
    let failError = null;
    try {
      await commitArtifact(failTarget, zipBytes("fail"), { link: async () => { throw errnoError("EIO"); } });
    } catch (err) {
      failError = err;
    }
    assert(!!failError && failError.code === "EIO", `提交故障应原样上抛 EIO,实际 ${failError}`);
    assert(
      (await fs.readdir(failDir)).length === 0,
      `提交失败后目录应为空(无最终文件、无临时文件),实际 ${JSON.stringify(await fs.readdir(failDir))}`,
    );
    // 取消闸门:提交前抛错(与 ConvertCanceledError 同形)→ 不提交任何文件
    const cancelTarget = path.join(failDir, "cancel.docx");
    let cancelError = null;
    try {
      await commitArtifact(cancelTarget, zipBytes("cancel"), {
        beforeCommit: () => {
          const err = new Error("已取消");
          err.name = "ConvertCanceledError";
          throw err;
        },
      });
    } catch (err) {
      cancelError = err;
    }
    assert(cancelError?.name === "ConvertCanceledError", `取消闸门应原样上抛,实际 ${cancelError}`);
    assert(
      (await fs.readdir(failDir)).length === 0,
      `取消后目录应为空(无最终文件、无临时文件),实际 ${JSON.stringify(await fs.readdir(failDir))}`,
    );
    console.log("[ok] artifact-commit:提交失败/取消(故障上抛不留残文件,临时文件已清理)");

    // ================= 6. 不支持硬链接的环境:抛可操作错误,零文件(不做非原子退化写) =================
    // 6a. 逐个注入「无法创建硬链接」错误码:必须抛错且目录零文件(无半截最终文件、无 temp)。
    // 若实现退化为「独占创建 + 直写最终路径」,本组会看到文件落盘 → 断言失败。
    const noLinkDir = path.join(dir, "nolink");
    await fs.mkdir(noLinkDir, { recursive: true });
    const unsupportedCodes = ["EPERM", "EACCES", "EXDEV", "ENOSYS", "EOPNOTSUPP", "ENOTSUP", "EMLINK", "EINVAL"];
    for (const code of unsupportedCodes) {
      const target = path.join(noLinkDir, `nolink-${code}.docx`);
      let failed = null;
      try {
        await commitArtifact(target, zipBytes(code), {
          link: async () => {
            throw errnoError(code);
          },
        });
      } catch (err) {
        failed = err;
      }
      assert(!!failed, `不支持链接错误码 ${code}:应抛错,而不是把产物直写最终路径`);
      assert(
        typeof failed.message === "string" &&
          failed.message.includes("原子提交") &&
          failed.message.includes(noLinkDir) &&
          failed.message.includes("输出目录"),
        `不支持链接错误码 ${code}:错误文案应可操作(原因 + 路径 + 改选输出目录的建议),实际 ${failed?.message}`,
      );
      assert(
        !(await fs.access(target).then(() => true, () => false)),
        `不支持链接错误码 ${code}:不得产生最终文件(哪怕半截)`,
      );
    }
    assert(
      (await fs.readdir(noLinkDir)).length === 0,
      `不支持硬链接时目录应零文件(无最终文件、无 temp),实际 ${JSON.stringify(await fs.readdir(noLinkDir))}`,
    );

    // 6b. 真实故障与「环境不支持」严格区分:EIO 原样上抛,不被改写成「换目录」提示
    const eioTarget = path.join(noLinkDir, "eio.docx");
    let eioError = null;
    try {
      await commitArtifact(eioTarget, zipBytes("eio"), {
        link: async () => {
          throw errnoError("EIO");
        },
      });
    } catch (err) {
      eioError = err;
    }
    assert(
      eioError?.code === "EIO" && !eioError.message.includes("原子提交"),
      `真实故障(EIO)应原样上抛而不被改写成「不支持原子提交」,实际 ${eioError}`,
    );
    assert(
      (await fs.readdir(noLinkDir)).length === 0,
      `真实故障后目录应零文件,实际 ${JSON.stringify(await fs.readdir(noLinkDir))}`,
    );

    // 6c. 判定顺序:EEXIST 优先于「不支持」——同名先递增序号,空闲名才报不支持。
    // 桩须区分两种情形(被占 → EEXIST,空闲 → EPERM),否则永远走不到递增分支
    await fs.writeFile(path.join(noLinkDir, "order.docx"), "既有产物", "utf8");
    const occupiedThenUnsupported = async (_existingPath, newPath) => {
      const taken = await fs.access(newPath).then(
        () => true,
        () => false,
      );
      throw taken ? errnoError("EEXIST") : errnoError("EPERM");
    };
    let orderError = null;
    try {
      await commitArtifact(path.join(noLinkDir, "order.docx"), zipBytes("order"), {
        link: occupiedThenUnsupported,
      });
    } catch (err) {
      orderError = err;
    }
    assert(
      orderError?.message.includes("order (2).docx"),
      `同名时应先递增序号再报不支持,实际 ${orderError?.message}`,
    );
    assert(
      (await fs.readFile(path.join(noLinkDir, "order.docx"), "utf8")) === "既有产物" &&
        (await fs.readdir(noLinkDir)).length === 1,
      "递增过程不得覆盖既有文件,也不得留下额外产物/临时文件",
    );
    console.log(
      `[ok] artifact-commit:不支持硬链接(${unsupportedCodes.length} 个错误码 → 可操作错误/目录零文件,` +
        "与真实故障 EIO 区分,EEXIST 优先递增)",
    );

    // 6d. 正常路径复核:不注入 link → 真实 fs.link 原子提交(内容逐字节一致、无 temp)
    const normalDir = path.join(dir, "normal");
    await fs.mkdir(normalDir, { recursive: true });
    const normalPayload = zipBytes("normal");
    const normalResult = await commitArtifact(path.join(normalDir, "normal.docx"), normalPayload);
    assert(
      normalResult === path.join(normalDir, "normal.docx") &&
        (await fs.readFile(normalResult)).equals(normalPayload) &&
        (await tempLeftovers(normalDir)).length === 0,
      "正常路径应走真实硬链接原子提交(首选路径/内容一致/无 temp)",
    );
    console.log("[ok] artifact-commit:正常路径(真实 fs.link 原子提交,内容一致/无 temp 残留)");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
