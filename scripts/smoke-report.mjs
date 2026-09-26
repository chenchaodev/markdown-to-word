// 机器可读冒烟报告的**入口**(只做 re-export 与 CLI 触发;实现分层在 scripts/smoke-report/ 下)。
//
// 分层(依赖方向单向,被依赖的纯判定层不反向 import 装配层):
//   contract.mjs  报告 schema/状态/退出码、降级标记清单、默认落点、类型契约   (叶子)
//   markers.mjs   标记契约解析(逐条命中 / 缺失清单 / 降级次数 / 路径脱敏)    → contract
//   process.mjs   可执行文件定位、预检、以 --smoke 启动、一次性 userData 生命周期
//                  → contract, smoke-proc.mjs(进程原语单一来源)
//   report.mjs    报告组装 + 人类摘要(状态由问题列表归一)
//                  → contract, markers, smoke-proc.mjs
//   cli.mjs       参数解析、编排、落盘、退出码                              → 以上全部
//
// 判定口径与拆分前完全一致(纯搬迁:同一份输入产出逐字节相同的 report.json 与摘要)。
// 退出码语义:0 = 通过(标记齐 + 退出码 0)/ 1 = 跑了但没过 / 2 = 未执行(无产物、无 Electron、
// 未构建)。「没跑」必须与「通过」区分,故 2 与 0 不可混读。
//
// 用法:
//   node scripts/smoke-report.mjs [--source unpacked|dev] [选项]
// 完整选项与退出码说明见 `node scripts/smoke-report.mjs --help`。
import { isMainModule } from './check-dist-manifest.mjs';

// 契约与常量
export {
  DEGRADATION_TOKENS,
  DEFAULT_RELEASE_DIR,
  DEFAULT_REPORT_REL,
  DEFAULT_SCRATCH_REL,
  EXIT,
  LOG_SUFFIX,
  projectRoot,
  REPORT_STATUS,
  SMOKE_REPORT_SCHEMA,
  UNPACKED_DIR_NAME,
} from './smoke-report/contract.mjs';
// 标记契约解析
export { parseSmokeOutput, redactPaths } from './smoke-report/markers.mjs';
// 进程与预检
export {
  findAppExe,
  preflight,
  readProductName,
  removeScratch,
  repoRelative,
  resolveElectronBinary,
} from './smoke-report/process.mjs';
// 报告组装
export {
  buildNotRunReport,
  buildSmokeReport,
  exitCodeForStatus,
  renderSmokeSummary,
} from './smoke-report/report.mjs';
// CLI
import { main } from './smoke-report/cli.mjs';

export { main };

if (isMainModule(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
