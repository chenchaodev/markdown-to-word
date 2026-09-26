// @ts-check
/**
 * electron 解析拦截 loader(供 gen-fixtures 使用):
 * 将 "electron" specifier 解析为 electron-mock.mjs,使段模块可在纯 Node
 * 下被动态 import(见 electron-mock.mjs 头注释)。
 */
/**
 * @param {string} specifier 待解析的模块说明符
 * @param {{ conditions: string[], importAttributes?: unknown, parentURL?: string }} context 解析上下文
 * @param {(specifier: string, context?: unknown) => Promise<{ url: string }>} nextResolve 交给默认解析器
 * @returns {Promise<{ url: string, shortCircuit?: boolean }>}
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return { url: new URL("./electron-mock.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}