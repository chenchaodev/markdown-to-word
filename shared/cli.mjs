// CLI 机制单源:极简参数解析 + 「本进程即入口」判定。
//
// 为什么从 gates/artifacts/check-dist-manifest.mjs 独立出来(本条决定的由来):
// 这两件事是**机制**不是断言 —— dist 清单门禁、供应链三脚本、产物核对、构建守卫、工具脚本
// 全都借它,而它寄居在一个「检查 dist 清单」的门禁名下,于是「谁在断言什么」与 import 图
// 同时失真(25 处外部 import,其中大半与 dist 无关)。下沉到 shared/ 后,机制归机制层,
// 门禁文件只留它真正断言的东西。
//
// 零跨树出边(ADR-043 精确为「零**跨树**出边」):本模块只 import node: 内建,不引任何仓内路径。
//
// 为什么用法文案由调用方传入而不在这里写死:本模块是机制层,一旦在这里写死某门禁的
// --help 文案,所有复用方参数写错时都会看到一段与自身无关的说明 —— 那正是本模块下沉前
// `check-dist-manifest.mjs` 里的私有 `USAGE` 造成的既有缺陷(clean-artifacts.mjs 曾为此
// 另写一份 parseArgs)。机制层不该知道任何门禁的参数表,故 `usage` 是可选入参。

import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 极简 CLI 解析:支持 `--key value` 与 `--key=value`,布尔开关只接受 `--key`。
 * 未知选项直接报错退出——检查脚本的参数写错时必须显式失败,
 * 不能被静默忽略后按默认值跑出「假通过」。
 * @param {string[]} argv 进程参数
 * @param {{ booleans?: string[]; values?: string[]; usage?: string }} [spec] 选项声明:
 *   布尔开关名 / 取值项名 / 本脚本自己的用法文案(缺失时诊断只报未知项本身)
 * @returns {Record<string, string | boolean>} 解析结果
 */
export function parseArgs(argv, { booleans = [], values = [], usage } = {}) {
  const options = {};
  // 调用方给了自己的 --help 文案就附在诊断后面,没给就不附 —— 附一段别人的说明比不附更糟
  const hint = usage === undefined ? '' : `(${usage})`;
  for (const name of booleans) options[name] = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`无法识别的参数:${token}${hint}`);
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (booleans.includes(name)) {
      if (eq !== -1) throw new Error(`--${name} 是开关,不接受取值`);
      options[name] = true;
      continue;
    }
    if (!values.includes(name)) {
      throw new Error(`无法识别的选项:--${name}${hint}`);
    }
    const value = eq === -1 ? argv[(i += 1)] : token.slice(eq + 1);
    if (value === undefined) throw new Error(`选项 --${name} 缺少取值`);
    options[name] = value;
  }
  return options;
}

/** 是否以脚本方式直接执行(被其他脚本 import 时不触发 CLI 行为) */
export function isMainModule(metaUrl) {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    const a = path.resolve(entry);
    const b = fileURLToPath(metaUrl);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}
