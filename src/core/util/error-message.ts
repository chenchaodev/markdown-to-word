/**
 * 错误归一单源:Error → message,其余 → String(err)。
 *
 * 此前 main 与 renderer **各自收敛过一次**——`main/ipc/logic.ts` 与
 * `renderer/state/pure.ts` 两处的注释都写着「原…N 处内联拼写收敛于此」——
 * 但两份收敛结果逐字相同,于是跨进程边界上留下了同一语义的两份实现。
 * 这正是本仓 `core/ipc-contract.ts` 要消除的那类漂移(数据形状两侧各留一份会走偏),
 * 故把实现上提到 core:main 的 `logic.ts` 与 renderer 的 `state/pure.ts` 各自改为
 * re-export,既拿到单源,又不改动两侧任何消费者的导入路径。
 *
 * 纯函数、零依赖。
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
