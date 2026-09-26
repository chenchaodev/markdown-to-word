// 标记契约解析层:把一次运行的合并输出判成「逐条标记命中 + 缺失清单 + 降级留痕次数」,
// 并提供绝对路径脱敏(报告产物必须与机器无关)。**只做文本包含判定**,判定口径仍是
// 「标记齐 + 退出码 0」(问题列表单源在 scripts/smoke-proc.mjs 的 collectSmokeProblems,
// 本层不重写规则)。
//
// 依赖方向:仅 contract.mjs;不 import 进程层或 CLI 层。

import path from 'node:path';
import { SMOKE_MARKERS } from '../smoke-proc.mjs';
import { DEGRADATION_TOKENS } from './contract.mjs';

/**
 * 把文本里的绝对路径换成占位符(报告产物必须与机器无关)。
 * 覆盖两类形态:盘符绝对路径(`C:\Users\...\Temp\x`)与 POSIX 绝对路径(`/home/...`)。
 * 传入的 root 先被替换成 `<repo>` —— 相对路径信息保留,绝对路径信息丢弃。
 * @param {string} text 待净化文本
 * @param {string} root 仓库根绝对路径
 * @returns {string} 净化后文本
 */
export function redactPaths(text, root) {
  if (typeof text !== 'string' || text === '') return '';
  let out = text;
  for (const form of [root, root.split(path.sep).join('/'), root.split(path.sep).join('\\')]) {
    if (form !== '') out = out.split(form).join('<repo>');
  }
  return out
    .replace(/[A-Za-z]:[\\/][^\s"'<>|,;)\]]*/g, '<abs-path>')
    .replace(/(?:^|(?<=[\s"'(=]))\/(?:[^\s"'<>|,;)\]]+\/?)+/g, '<abs-path>');
}

/**
 * 判定一次运行的产出:逐条标记命中情况 + 降级留痕出现次数。
 * 只做「文本包含」判定(与 collectSmokeProblems 同口径),不改判定语义。
 * @param {string} output 合并后的 stdout+stderr
 * @returns {{ markers: {id: string, label: string, token: string, present: boolean}[], missing: string[], degradations: {id: string, label: string, token: string, count: number}[] }} 判定结果
 */
export function parseSmokeOutput(output) {
  const text = typeof output === 'string' ? output : '';
  const markers = SMOKE_MARKERS.map((marker) => ({
    id: marker.id,
    label: marker.label,
    token: marker.token,
    present: text.includes(marker.token),
  }));
  const missing = markers.filter((marker) => !marker.present).map((marker) => marker.label);
  const degradations = DEGRADATION_TOKENS.map((marker) => {
    let count = 0;
    for (let at = text.indexOf(marker.token); at !== -1; at = text.indexOf(marker.token, at + marker.token.length)) {
      count += 1;
    }
    return { id: marker.id, label: marker.label, token: marker.token, count };
  }).filter((entry) => entry.count > 0);
  return { markers, missing, degradations };
}
