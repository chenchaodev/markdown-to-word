/**
 * 转换 context 注册表(按 webContents id 存取):
 * - IPC 层(register.ts runWithCtx)转换开始时 set、finally 时 delete;
 * - convert:cancel handler 按 sender id 取 ctx 调 cancel();
 * - windows/main-window 关窗确认按窗口 webContents id 查询转换进行中状态。
 * 下沉理由:原居 ipc/register.ts 迫使 windows/main-window 反向依赖 IPC 层;
 * 独立模块后 ipc 与 windows 双方单向依赖本模块,依赖方向恢复单向(无环:
 * 本模块只依赖 converter 的类型,不依赖任何消费方)。
 */
import type { ConvertContext } from "../converter/index.js";

/**
 * 各窗口进行中的转换 context(convert:cancel 入口按 webContents id 取,
 * 多窗口并发互不串扰);转换完成/异常/取消后删除,避免悬挂引用。
 */
export const ctxByWebContents = new Map<number, ConvertContext>();
