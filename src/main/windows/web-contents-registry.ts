/**
 * webContents 活动操作注册表:同一 webContents 同时最多一个转换或预检。
 * IPC handler 原子占用,convert:cancel 与主窗关闭共享当前操作;释放使用 token
 * compare-and-delete,旧任务不得删除后继操作。
 */
import type { ConvertContext } from "../converter/index.js";

export type WebContentsOperationKind = "single" | "batch" | "merge" | "precheck";

export interface WebContentsOperation {
  token: symbol;
  kind: WebContentsOperationKind;
  context: ConvertContext;
}

const operationsByWebContents = new Map<number, WebContentsOperation>();

/** 原子占用 webContents;已有活动操作时返回 null,调用方须返回明确 busy。 */
export function beginWebContentsOperation(
  webContentsId: number,
  kind: WebContentsOperationKind,
  context: ConvertContext,
): symbol | null {
  if (operationsByWebContents.has(webContentsId)) return null;
  const token = Symbol(kind);
  operationsByWebContents.set(webContentsId, { token, kind, context });
  return token;
}

/** 仅当前 token 可释放,避免旧任务 finally 删除已经启动的新任务。 */
export function finishWebContentsOperation(webContentsId: number, token: symbol): boolean {
  const current = operationsByWebContents.get(webContentsId);
  if (!current || current.token !== token) return false;
  operationsByWebContents.delete(webContentsId);
  return true;
}

export function getWebContentsOperation(webContentsId: number): WebContentsOperation | undefined {
  return operationsByWebContents.get(webContentsId);
}

/** 取消当前操作;无活动操作时为空操作。 */
export function cancelWebContentsOperation(webContentsId: number): void {
  operationsByWebContents.get(webContentsId)?.context.cancel();
}
