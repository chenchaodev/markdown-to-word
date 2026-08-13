/**
 * electron 解析拦截 loader(供 gen-fixtures 使用):
 * 将 "electron" specifier 解析为 electron-mock.mjs,使段模块可在纯 Node
 * 下被动态 import(见 electron-mock.mjs 头注释)。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return { url: new URL("./electron-mock.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}