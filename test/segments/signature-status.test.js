// @ts-check
/**
 * 安装包签名状态守护段(现阶段明确不接入代码签名,口径见 docs/ADR.md 的 ADR-013;位于 test/segments/ = 跨域守护段)。
 *
 * 该裁决是「暂不签名,未签名作为明确风险保留」。风险被如实告知的前提是三处一致:
 *   1) 打包配置确实没有证书(否则「未签名」是假话);
 *   2) `docs/SIGNATURE-STATUS.md` 声明的状态 == `scripts/check-signature-status.mjs`
 *      的 `EXPECTED_SIGNATURE_STATUS`(声明侧与事实侧的判定基准必须同源);
 *   3) 用户文档仍保留 SmartScreen / 未签名披露(否则用户侧无任何提示)。
 *
 * 本段同时对签名状态**三态词汇**做纯逻辑锚点。刻意不用二值:Authenticode 的
 * `NotTrusted`(有签名但证书链不受信)与 `NotSigned`(真的没签名)语义相反,
 * 把前者归入「未签名」就是谎报风险,故一律映射为 `indeterminate` 并判红。
 *
 * 防假通过:先用合成输入做正/负锚点证明判定函数会抓错,再用于真实配置与文档;
 * 沙箱目录在 finally 清理。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "../common/paths.js";
import {
  buildEntry,
  classifyAuthenticode,
  collectExeFiles,
  compareStatus,
  EXPECTED_SIGNATURE_STATUS,
} from "../../scripts/check-signature-status.mjs";

/**
 * 断言辅助。
 * @param {unknown} cond 判定条件
 * @param {string} msg 失败消息
 * @returns {void}
 */
function assert(cond, msg) {
  if (!cond) throw new Error(`signature-status 断言失败:${msg}`);
}

/**
 * 读取仓库内文本文件。
 * @param {...string} parts 相对 ROOT 的路径片段
 * @returns {string} 文件内容
 */
function readRepoText(...parts) {
  return fs.readFileSync(path.join(ROOT, ...parts), "utf8");
}

export async function run() {
  // ---- 1. 判定逻辑正/负锚点:先证明会抓错,再用于真实配置 ----
  assert(classifyAuthenticode("Valid") === "signed", "Valid 应映射为 signed");
  assert(classifyAuthenticode("NotSigned") === "unsigned", "NotSigned 应映射为 unsigned");
  assert(classifyAuthenticode("NotTrusted") === "indeterminate", "NotTrusted(有签名但链不受信)不得当作 unsigned");
  assert(classifyAuthenticode("UnknownError") === "indeterminate", "UnknownError 应为 indeterminate");
  assert(classifyAuthenticode("HashMismatch") === "indeterminate", "HashMismatch 应为 indeterminate");
  assert(classifyAuthenticode("") === "indeterminate", "空状态不得当作 unsigned");
  assert(classifyAuthenticode("  notsigned  ") === "indeterminate", "大小写不匹配的状态不得当作 unsigned");
  console.log("[ok] signature-status:三态映射锚点(Valid/NotSigned/NotTrusted/UnknownError/空/大小写不符)");

  assert(compareStatus("unsigned", "unsigned").ok === true, "一致状态应放行");
  const mismatch = compareStatus("signed", "unsigned");
  assert(mismatch.ok === false && Boolean(mismatch.reason), "状态冲突应判红并给出原因");
  const indet = compareStatus("indeterminate", "unsigned");
  assert(indet.ok === false, "无法判定必须判红");
  assert(
    Boolean(indet.reason) && String(indet.reason).includes("不得当作"),
    "无法判定的提示须明确「不得当作未签名放行」",
  );
  console.log("[ok] signature-status:比对锚点(一致放行/冲突判红/无法判定判红且措辞正确)");

  // ---- 1b. buildEntry:探测路径(注入 probe)----
  // 回归:CI 上实测 Get-AuthenticodeSignature 因 Microsoft.PowerShell.Security
  // 模块加载不了而直接抛错(PSModulePath 被 CI 注入值污染)。原实现里 execFileSync
  // 抛错会绕过全部三态逻辑,直接崩成 Node 原始堆栈;「探测手段不可用」必须
  // 与「状态无法判定」分开,同样判红,不得被当成 unsigned 放行。
  {
    const okEntry = buildEntry(path.join(ROOT, "release", "Setup-1.0.0.exe"), () => "NotSigned");
    assert(okEntry.status === "unsigned" && okEntry.ok === true, "探测返回 NotSigned 应判为 unsigned 且放行");

    const signedEntry = buildEntry(path.join(ROOT, "release", "Setup-1.0.0.exe"), () => "Valid");
    assert(signedEntry.ok === false, "探测返回 Valid 与声明 unsigned 冲突须判红");

    const indetEntry = buildEntry(path.join(ROOT, "release", "Setup-1.0.0.exe"), () => "NotTrusted");
    assert(
      indetEntry.status === "indeterminate" && indetEntry.ok === false,
      "NotTrusted 仍走 indeterminate 路径且判红",
    );

    const boom = buildEntry(path.join(ROOT, "release", "Setup-1.0.0.exe"), () => {
      // 忠实复刻 CI 上真实 PowerShell 报错形态(含末行的 FullyQualifiedErrorId 标签)
      throw new Error(
        "Get-AuthenticodeSignature : The 'Get-AuthenticodeSignature' command was found in the module \n" +
          "'Microsoft.PowerShell.Security', but the module could not be loaded.\n" +
          "    + FullyQualifiedErrorId : CouldNotAutoloadMatchingModule",
      );
    });
    assert(boom.status === "probe-unavailable", `探测命令失败须单列 probe-unavailable,实际 ${boom.status}`);
    assert(boom.ok === false, "探测手段不可用必须判红(取不到事实不得放行)");
    assert(
      Boolean(boom.reason) &&
        String(boom.reason).includes("不得据此推断") &&
        String(boom.reason).includes("探测手段不可用"),
      "探测失败的提示须区分于签名状态异常,并写明不得据此推断未签名",
    );
    assert(
      String(boom.reason).includes("CouldNotAutoloadMatchingModule"),
      `探测失败须带上原始错误首行以便定位,实际:${String(boom.reason)}`,
    );
  }
  console.log("[ok] signature-status:buildEntry(正常映射/探测不可用单列并判红且措辞正确)");

  // ---- 2. 沙箱:collectExeFiles 只收 exe,递归且忽略非可执行产物 ----
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "m2w-signature-"));
  try {
    fs.mkdirSync(path.join(sandbox, "win-unpacked"));
    fs.writeFileSync(path.join(sandbox, "Setup-1.0.0.exe"), "MZ");
    fs.writeFileSync(path.join(sandbox, "Setup-1.0.0.exe.blockmap"), "{}");
    fs.writeFileSync(path.join(sandbox, "latest.yml"), "version: 1.0.0");
    fs.writeFileSync(path.join(sandbox, "win-unpacked", "MarkdownToWord.exe"), "MZ");
    const found = collectExeFiles(sandbox).map((f) => path.relative(sandbox, f).split(path.sep).join("/")).sort();
    assert(
      found.length === 2 && found.includes("Setup-1.0.0.exe") && found.includes("win-unpacked/MarkdownToWord.exe"),
      `exe 收集应只收 exe 且递归,实际 ${JSON.stringify(found)}`,
    );
    assert(
      !found.some((f) => f.endsWith(".blockmap") || f.endsWith(".yml")),
      "blockmap/yml 等非可执行产物不得被当作 exe",
    );
    assert(collectExeFiles(path.join(sandbox, "no-such-dir")).length === 0, "目录不存在应返回空数组而非抛错");
    console.log("[ok] signature-status:exe 收集锚点(递归/排除非 exe/缺目录不抛)");
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }

  // ---- 3. 打包配置确实无证书(否则「未签名」是假话)----
  const pkg = JSON.parse(readRepoText("package.json"));
  const win = pkg.build?.win ?? {};
  const nsis = pkg.build?.nsis ?? {};
  for (const key of ["certificate", "certificateFile", "signtoolOptions", "sign", "signingHashAlgorithms"]) {
    assert(!(key in win), `build.win 不得出现 ${key}(当前存在 → 声明的未签名状态为假话)`);
    assert(!(key in nsis), `build.nsis 不得出现 ${key}(当前存在 → 声明的未签名状态为假话)`);
  }
  assert(
    pkg.build?.forceCodeSigning === undefined,
    "build.forceCodeSigning 不得为 true:ADR-013 选择「披露」而非「无证书即发版失败」,置 true 会让发布链直接失败",
  );
  console.log("[ok] signature-status:打包配置无证书且未设 forceCodeSigning");

  // ---- 4. 声明侧文档与事实侧常量同源 ----
  assert(
    EXPECTED_SIGNATURE_STATUS === "unsigned",
    `脚本声明状态应为 unsigned,实际 ${String(EXPECTED_SIGNATURE_STATUS)}`,
  );
  const doc = readRepoText("docs", "SIGNATURE-STATUS.md");
  assert(/当前状态[：:]\s*\*\*未签名/.test(doc), "SIGNATURE-STATUS.md 必须声明当前状态为未签名");
  assert(doc.includes("ADR-013"), "SIGNATURE-STATUS.md 必须引用裁决出处 ADR-013");
  assert(
    doc.includes("forceCodeSigning") && doc.includes("有意不采用"),
    "SIGNATURE-STATUS.md 必须写明为何有意不采用 forceCodeSigning(防后续被当缺陷「修复」)",
  );
  for (const token of ["SHA-256", "SmartScreen", "check-signature-status.mjs", "更新规则"]) {
    assert(doc.includes(token), `SIGNATURE-STATUS.md 缺少必需内容:${token}`);
  }
  console.log("[ok] signature-status:声明文档与脚本常量同源且含缓解手段/更新规则");

  // ---- 5. 用户文档仍保留未签名披露(用户侧唯一提示面)----
  const guide = readRepoText("docs", "USER-GUIDE.md");
  assert(guide.includes("SmartScreen"), "USER-GUIDE 必须保留 SmartScreen 说明");
  assert(
    guide.includes("未做代码签名") || guide.includes("未签名"),
    "USER-GUIDE 必须保留未签名披露,不得因优化而删除用户可见的风险提示",
  );
  console.log("[ok] signature-status:用户文档保留 SmartScreen 与未签名披露");

  console.log("[ok] signature-status:门禁通过(配置/声明/用户文档三处一致,声明为 unsigned)");
}

export const fixtures = null;
