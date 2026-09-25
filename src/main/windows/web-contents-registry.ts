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

/**
 * 原子占用 webContents;已有活动操作时返回 null(不覆盖既有 context),
 * 调用方须返回明确 busy。占用在调用栈内同步完成(无 await 前置),
 * 故同一 tick 内连续发起的多个 handler 首个占用成功、其余必得 null。
 */
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

/** 是否有活动操作(关窗确认与等待释放只判存在性,不取用 context)。 */
export function hasWebContentsOperation(webContentsId: number): boolean {
  return operationsByWebContents.has(webContentsId);
}

/**
 * 取消当前操作;返回是否确有活动操作被取消(无活动操作为空操作)。
 * 取消只置位 ctx 标志,注销仍由任务 finally 的 compare-and-delete 完成,
 * 故取消与「旧 token 释放」不会互相误删。
 */
export function cancelWebContentsOperation(webContentsId: number): boolean {
  const current = operationsByWebContents.get(webContentsId);
  if (!current) return false;
  current.context.cancel();
  return true;
}
