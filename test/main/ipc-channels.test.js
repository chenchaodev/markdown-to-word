/**
 * IPC channel 单源恒等性断言(接入 case 级报告):
 * - main 侧单源:dist/main/ipc/channels.js 的 IPC_CHANNELS(命名统一「域:动作」);
 * - preload 侧镜像:preload.cts 因沙箱隔离(sandbox:true 下 preload.cjs 运行时
 *   只能 require electron)无法 import ESM 常量模块,侧内镜像同名常量;
 * - 本段对 dist/main/preload.cjs 与 dist/renderer/about-preload.cjs 文本提取
 *   全部 ipcRenderer.invoke/on/removeListener 的 channel 字面量,与单源做双向
 *   集合恒等断言(主窗 preload)或子集恒等 + 键集断言(about-preload),
 *   防两侧漂移;
 * - 附「域:动作」命名形状断言(域在前 + 冒号分隔),防新 channel 回退混名序。
 * 产物为 dist 产物漂移的诊断信息(失败快照),本段不产 docx/pdf 附件。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { IPC_CHANNELS } from "../../dist/main/ipc/channels.js";
import { assert, createCaseSuite } from "../common/case.js";

const distMain = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "dist",
  "main",
);

/** 提取 preload 源码里的 CH 镜像对象键值(产物结构变化时明确报错) */
function parseMirror(src, file) {
  const mirrorMatch = src.match(/const CH = \{([\s\S]*?)\};/);
  assert(mirrorMatch, `${file} 未找到 CH 镜像对象(产物结构变化)`);
  const mirror = {};
  for (const m of mirrorMatch[1].matchAll(/(\w+):\s*"([^"]+)"/g)) {
    mirror[m[1]] = m[2];
  }
  assert(Object.keys(mirror).length > 0, `${file} 的 CH 镜像对象未解析到任何键值对`);
  return mirror;
}

/** 找出首个裸字符串 channel 调用点(应全部经 CH.* 引用) */
function findBareChannelCall(src, file) {
  for (const m of src.matchAll(/\b(?:invoke|on|removeListener)\((["'])([^"']+)\1/g)) {
    return `${file} 出现裸字符串 channel "${m[2]}"(应经 CH.* 引用)`;
  }
  return null;
}

export async function run() {
  const suite = createCaseSuite();

  // ---- 命名形状:「域:动作」(域在前,冒号分隔,两段均非空且无再多冒号) ----
  await suite.case("全部 channel 符合「域:动作」命名", () => {
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      assert(
        /^[A-Za-z][\w-]*:[A-Za-z][\w-]*$/.test(value),
        `${key}="${value}" 不符合「域:动作」命名`,
      );
    }
  });

  const preloadSrc = fs.readFileSync(path.join(distMain, "preload.cjs"), "utf8");

  // ---- preload 侧镜像对象与单源恒等(双向键值一致) ----
  // tsc 编译不内联 const 对象属性访问,preload.cjs 内保留镜像对象字面量本体,
  // 直接解析其键值对与单源比对(比逐调用点提字面量更严:镜像对象即全部 channel)。
  await suite.case("preload 镜像与单源恒等", () => {
    const mirror = parseMirror(preloadSrc, "preload.cjs");
    for (const [key, value] of Object.entries(IPC_CHANNELS)) {
      assert(
        mirror[key] === value,
        `preload 镜像 ${key}="${mirror[key]}" 与单源 "${value}" 漂移`,
      );
    }
    for (const key of Object.keys(mirror)) {
      assert(key in IPC_CHANNELS, `preload 镜像多出单源没有的键 "${key}"`);
    }
  });

  await suite.case("preload 调用点无裸字符串 channel", () => {
    const bare = findBareChannelCall(preloadSrc, "preload.cjs");
    assert(bare === null, bare ?? "");
  });

  // ---- about-preload(关于窗独立 CJS preload,copied 到 dist/renderer)----
  // 同款提取:键集断言为 about 域两键(它是子集镜像——主窗 preload 才与单源全量恒等,
  // 故不反向要求单源键全出现)
  const aboutSrc = fs.readFileSync(
    path.join(path.dirname(distMain), "renderer", "about-preload.cjs"),
    "utf8",
  );

  await suite.case("about-preload 镜像恒等(about 域两键)", () => {
    const aboutMirror = parseMirror(aboutSrc, "about-preload.cjs");
    const expectedAboutKeys = ["aboutOpenExternal", "aboutCheckUpdate"].sort();
    const actualAboutKeys = Object.keys(aboutMirror).sort();
    assert(
      JSON.stringify(actualAboutKeys) === JSON.stringify(expectedAboutKeys),
      `about-preload 镜像键集应为 about 域两键,实际=${JSON.stringify(actualAboutKeys)}`,
    );
    for (const [key, value] of Object.entries(aboutMirror)) {
      assert(
        IPC_CHANNELS[key] === value,
        `about-preload 镜像 ${key}="${value}" 与单源 "${IPC_CHANNELS[key]}" 漂移`,
      );
    }
  });

  await suite.case("about-preload 调用点无裸字符串 channel", () => {
    const bare = findBareChannelCall(aboutSrc, "about-preload.cjs");
    assert(bare === null, bare ?? "");
  });

  // ---- main 侧接线抽查:dist/main 全部产物不应残留旧字面量(handle 全部经 CH.* 引用) ----
  // 目录重组后 handle 注册分散在 dist/main(含 ipc/、windows/ 子目录),递归全扫
  await suite.case("dist/main 全部产物无旧 channel 字面量残留", () => {
    const mainFiles = fs
      .readdirSync(distMain, { recursive: true, encoding: "utf8" })
      .filter((rel) => rel.endsWith(".js"))
      .map((rel) => path.join(distMain, rel));
    const legacy = [
      "dialog:openMarkdowns",
      "dialog:selectDir",
      "paths:collectMarkdown",
      "paths:filterExisting",
      "import:pdf-css",
      "shell:reveal",
      "shell:open",
      "batch:progress",
    ];
    for (const file of mainFiles) {
      const src = fs.readFileSync(file, "utf8");
      for (const old of legacy) {
        assert(!src.includes(`"${old}"`), `${path.basename(file)} 残留旧 channel 字面量 "${old}"`);
      }
    }
  });

  return { cases: suite.results };
}
