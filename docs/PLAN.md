# REQ-133 验收段迁纯 node 宿主（大型需求）

> 相关 ADR 一行结论：adr-015（每段一个独立 Electron 子进程，本需求**不改其隔离语义**，只换宿主实现）· adr-017（并发池 + gate-probes 独占）· adr-016（门禁链内全量验收只跑一遍）。
> 验证基线一行指针：`docs/DEV-GUIDE.md`。

## 目标

把验收段的**宿主**由 Electron 子进程换成纯 node 子进程（+ 仓内 electron-mock），保留 ADR-015 的全部隔离语义，换取 CI 上「每段启动成本」从 2125ms 降到约 87ms。

## 依据（CI run 36820362921 实测）

| 档 | CI 实测 | 本机 |
|---|---|---|
| node（裸冷启） | 45ms | 70~81ms |
| segnode（node + mock + 跑真实段） | **87ms** | 121~140ms |
| segel（electron + 段宿主） | **2125ms**（取自段耗时分布，两轮 2125/2170 复现） | 166~186ms |

**24 倍差距**；地板占 CI `sum(段耗时)=432.5s` 约 60%。迁 107/125 段省约 218s 串行。

注：`[floor]` 脚本打出的 `segel=1ms` 是废数（脚本未检查 `spawnSync` 返回值，把「起不来」当成「极快」；已修）。可信的 segel 值来自段耗时分布：一个段不可能比「起一个 Electron 宿主 + 跑最小段体」更便宜。

## 不动的部分（隔离语义，逐条对照 ADR-015 / REQ-027）

一段一进程 · 硬超时杀进程树 · 段级独立 userData · case 级报告 · 失败 artifact · 结构化回传 · 退出码语义（0/1/2/3 同义）。**宿主只是「用什么可执行文件起这个进程」。**

## 步序与泳道

| 泳道 | 内容 | 写域 |
|---|---|---|
| A | 实测导出 opt-out 名单（哪些段在纯 node 宿主下真跑不通）+ 实现「默认 node + 显式 opt-out」 | `test/common/runner.js`、`test/common/electron-mock.mjs`、`test/common/segment-host-node.mjs` |
| B | opt-out 名单的漂移守护段 | `test/segments/*.test.js`（新增一个段文件） |

A 必须先跑完（名单是 B 的输入）。B 的守护形态待 A 的名单形态定下后再定。

## 整体完成标准

1. **默认路径全绿**：`npm run test:only` 125/125 段通过，且 opt-out 名单里的段确实仍走 Electron 宿主。
2. **零回归可证**：不设任何新环境变量时，执行模型与改动前逐字等价（宿主选择默认 Electron 或默认 node，须与实现一致并写明）。
3. **实测收益**：本机 `npm run test:only` 的 `sum(段耗时)` 与墙钟对比改动前；给出 CI 侧预期（**不把本机数当 CI 预测**，只报本机实测 + CI 地板推算区间）。
4. **门禁全绿**：`typecheck` · `lint` · `check:boundary` · `check:test-numbering` · `check:temp-cleanup` · `check:gates` · `check:contract` · `check:coverage-zero`（覆盖率门禁本身）· `check:docs`。
5. **opt-out 名单有守护**：名单腐化（段改名、段新增后忘记判断）必须能被抓住，不靠人记。
6. ADR：改宿主执行模型属改分层接口，**须新立 ADR-0NN**，写明「为什么换宿主、隔离语义一条未动、opt-out 名单的形态与守护」。

## 已知未决（用户裁决：单独处理，不阻塞本需求）

- **覆盖率影响未实测**。`--all` 的分母来自 `--include` glob（ADR-016 已固化「与跑几遍无关」），分子来自实际加载 ⇒ 迁走段若少加载某些 `dist/**` 模块，四项指标会下降。基线 branches 89.08 / 阈值 85，**余量仅 4.08pp，是四项里最薄的**。本需求完成后若 `check:coverage-zero` 判红，即为该风险的显形，按结果另开工作项处理。

## 怎么回滚

- 三处改动集中在 `test/common/`，单文件可逐个 `git checkout --` 回退；runner 的宿主选择是单一分支点，回退后执行模型与改动前逐字等价。
- 不改任何段断言、不改 `dist/`、不改 `package.json`、不改 `.github/`。
