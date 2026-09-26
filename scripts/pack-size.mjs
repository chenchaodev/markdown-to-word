// 打包体积实测 + 体积回归门禁的**入口**(只做 re-export 与 CLI 触发;实现分层在
// scripts/pack-size/ 下)。
//
// 分层(依赖方向单向,被依赖的纯判定层不反向 import 装配层):
//   asar.mjs      app.asar 头部解析 / 整树求和 / 成员读取 / 目录求和      (叶子)
//   semver.mjs    最小 semver 判定器(判重唯一的「是否落在声明范围内」判据)(叶子)
//   util.mjs      仓库根、仓库相对路径、正则元字符转义                    (叶子)
//   contract.mjs  契约常量 + 实测条目表 + 类型契约                        (叶子)
//   verdict.mjs   单包名定性(解析落点 / 分类 / 跨版本文件对照)             → semver
//   duplicates.mjs 判重枚举与编排                                       → asar, verdict
//   measure.mjs   一次 dist 的字节事实 + 判重总账                        → asar, duplicates, contract, util
//   baseline.mjs  基线解析 + 门禁判定(阈值与名单在此)                    → contract
//   report.mjs    报告组装 + 人类摘要                                    → contract
//   cli.mjs       参数解析、编排、落盘、退出码                            → 以上全部
//
// 判定口径与拆分前完全一致(本轮是纯搬迁:同一份输入产出逐字节相同的 report.json 与摘要)。
//
// 用法:
//   node scripts/pack-size.mjs [选项]
//   node scripts/pack-size.mjs --print-measurements   # 只打印实测值(人工据此手改基线)
// 完整选项见 `node scripts/pack-size.mjs --help`。
import { isMainModule } from './check-dist-manifest.mjs';

// 契约与常量
export {
  BASELINE_SCHEMA,
  DEFAULT_BASELINE_REL,
  DEFAULT_RELEASE_DIR,
  DEFAULT_REPORT_REL,
  EXIT,
  MEASURED_ITEMS,
  REPORT_SCHEMA,
  STATUS,
  UNPACKED_DIR_NAME,
} from './pack-size/contract.mjs';
// asar 字节事实
export { asarTreeBytes, dirBytes, readAsarText, readAsarTree } from './pack-size/asar.mjs';
// 最小 semver 判定器
export { satisfiesRange } from './pack-size/semver.mjs';
// 判重:枚举/定性两侧都导出,便于直测原语
export { analyzeDuplicates, enumeratePackages, findPackageCopies } from './pack-size/duplicates.mjs';
export { classifyName, crossVersionIdenticalFiles, resolveCopy, resolveCopyExcept } from './pack-size/verdict.mjs';
// 测量 / 基线判定 / 报告 / CLI
export { measure } from './pack-size/measure.mjs';
export { evaluate, parseBaseline } from './pack-size/baseline.mjs';
export { buildReport, renderSummary, toMiB } from './pack-size/report.mjs';
// CLI:既作本文件的再导出(测试段直测装配层),也在被直接执行时就地触发
import { main } from './pack-size/cli.mjs';

export { main };

if (isMainModule(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
