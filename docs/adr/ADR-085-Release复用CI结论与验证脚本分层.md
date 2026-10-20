# ADR-085 · Release 复用 CI 结论与验证脚本分层

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-20 |
| 关联 | [`package.json`](../../package.json) 的 `verify:static` / `verify:build` / `verify:test` / `verify:ci` / `verify:release` / `dist` ｜ [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) ｜ [`.github/workflows/release.yml`](../../.github/workflows/release.yml) ｜ [`gates/repo/check-ci-contract.mjs`](../../gates/repo/check-ci-contract.mjs) ｜ 工作项 REQ-257 · REQ-259 |

---

## 决定

**Release 不再重跑 `verify:ci`：同 SHA 的 CI 已经给过结论，Release 的 gate job 只负责等它并判读，package job 只跑 `dist`。**

1. **脚本分层**：`verify:ci` 由三条子链顺序组成 —— `verify:static`（纯源码/文本判定）→ `verify:build`（`build` + 产物侧层向 + `typecheck` + `lint`）→ `verify:test`（`test:coverage` + 零覆盖/夹具/smoke/几何）。`verify:release` 仍是 `verify:ci + dist`，`dist` 仍是「清理 → 构建 → 清单 → 两次 electron-builder → 产物核对」的单一打包入口。
2. **gate job（ubuntu）**：按 `head_sha` 查 `ci.yml` 的最新 run；最多等 2 分钟让它出现，最多等 25 分钟让它完成；`success` 才放行，红/取消/超时/查不到一律失败关闭。不自动回退到重跑 `verify:release`。
3. **package job（windows）**：默认只跑 `npm run dist`。CI 在验证通过后把 `output/artifacts/dist-manifest.json` 随 `ci-diagnostics` 留档；Release 下载该 artifact，重建后与本次 `dist` 生成的清单**逐字节比较**，不一致即失败，且发生在 `gh release create` 之前。
4. **兜底入口**：`workflow_dispatch` 带 `full_verify`（默认 false）与 `dry_run`（默认 true）；必须用 `gh workflow run release.yml --ref <tag>` 触发，`github.sha` / `github.ref_name` 才指向 tag 提交。`full_verify=true` 走完整 `verify:release`，不依赖 CI artifact。
5. **CI 双 job 并行**不在本决定内，后续单独评估；当前只消除「同一份提交验证两遍」。

## 生产加固（2026-10-21，REQ-259）

4.7.1 实发暴露了 gate 的边界，按「失败关闭 + 可重跑 + 可审计」补齐。这些是决定 2–4 的实现约束，不改变「Release 只消费 CI 结论」的主决定：

1. **gate 只认 master push，并先把 tag 解析成 commit**：CI 查询加 `event=push&branch=master`，jq 侧再按 `head_sha` / `event` / `head_branch` 过滤；同 SHA 的 PR run 不再可能被误当成发布验证。tag 用 `gh api repos/<repo>/commits/<tag>` 解析到 commit（兼容 annotated tag），输出 `sha` 供 release 复核，不直接信任 `github.sha` 对 tag object 的解析口径。
2. **master CI 不取消在途**：`ci.yml` 的 `cancel-in-progress` 只对 `pull_request` 为 `true`。新 master push 不会取消 Release gate 正在等的同 SHA CI；代价是旧 master run 仍会跑完，消耗少量 Windows runner 分钟。
3. **artifact 可重跑**：CI 与 Release 的同名诊断/供应 artifact 上传加 `overwrite: true`；CI rerun 不再因 `ci-diagnostics` 已存在而失败，Release 重跑也不会被旧 `failure-artifacts` 卡住。
4. **tag/SHA 三方一致 + Release 去重**：release 在 install 前校验「远端 tag 当前指向」「checkout HEAD」「gate CI run 的 `head_sha`」三者相同，任一不一致即拒绝发版，覆盖 tag 在触发后被移动的情况；`gh release view` 发现同名 Release 已存在则明确失败，不覆盖资产。
5. **artifact 过期提示**：`gh run download` 失败时提示 7 天保留期与 `workflow_dispatch -f full_verify=true` 退路，不再只留通用下载错误。

## 背景

4.7.0 的实测（同一提交 `c234478`）：

| 事件 | run | 时长 |
|---|---|---|
| CI（`verify:ci`） | 39442837407 | 6m59s |
| Release（`verify:release`） | 39442856111 | 13m57s |

`verify:release = verify:ci + dist`，所以 Release 里约 7 分钟是把 CI 刚跑过的同一批门禁再跑一遍；打包（含 zip/7z/NSIS 与产物核对）约 6 分钟。4.6.0 的 Release 曾是 22m53s，压缩档修复后已降到约 14 分钟，剩下的重复部分就是本条要消掉的对象。

tag 与 master 同步推送时，Release 可能与 CI 同时开始甚至更早；gate 必须能等 CI 出现并完成，而不是假定「push 时 CI 一定已经绿」。

## 备选方案

1. **复用 CI 的 dist 制品（上传/下载整棵 dist）** —— 否决。dist 是数百 MB、数千文件，上传与下载的耗时和存储成本都高于「在 Windows runner 上重建约 4 秒 + 打包」；而且住制品会把「构建可重建」这条现有性质换成「制品必须存够久」。
2. **用 `workflow_run` 在 CI 成功后触发 Release** —— 暂不采用。需要把 tag 与 CI run 可靠关联（tag 可能晚于 CI 推送、同一 SHA 可能有多次 run），关联规则本身就是 gate 现在做的事；等出现「tag 与 CI 分离」的稳定需求再评估。
3. **查不到 CI 时自动回退 `verify:release`** —— 否决。失败开放会把「tag 指向未验证提交」变成一次静默的 14 分钟重跑，既掩盖了流程错误，又恢复全部重复成本。需要兜底时显式 `full_verify=true`。
4. **把 `pack` 从 `dist` 拆成独立脚本供 Release 调用** —— 否决。Release 不消费打包中间产物，`pack` 没有第二个消费者；拆出会制造两份「打包入口」并迫使 `check:ci-contract` 同时守 `dist → pack` 与 `pack` 内部顺序。`dist` 保持单一入口，语义更窄。
5. **CI 拆双 job 并行** —— 押后。它优化的是 CI 自身墙钟，与「Release 不重复验证」正交；同批做会把两个变量的收益混在一起，无法归因。

## 后果

- **墙钟**：tag 在 CI 绿之后推送时，Release 只剩 gate（秒级）+ 打包，约 6–7 分钟；tag 与 master 同步推送时，gate 等 CI 约 7 分钟再打包，总墙钟仍约 13–14 分钟，但不再重复执行测试，runner 分钟数下降约 7 分钟（gate 是 ubuntu 空等，不占 Windows runner）。
- **可信度边界**：清单比较证明「重建的 `dist` 树与 CI 验证过的那棵树逐文件一致（路径/大小/SHA-256）」，不证明安装包字节级可复现（NSIS 压缩与时间戳本就不保证）。这是廉价可得的最强证据；若将来要求安装包 attestation，需另立工作项。
- **失败面**：CI 红、取消、查不到、等待超时、清单缺失或不等，全部在 `gh release create` 之前失败；不会发出「验证未通过但已发布」的 Release。
- **保留期耦合**：清单随 `ci-diagnostics` 保留 7 天。对很久以前的提交补发 tag 时 artifact 可能已过期，gate 会失败关闭；release 的下载步骤现在会明确提示这一点并给出 `full_verify=true` 退路。
- **契约**：`check:ci-contract` 仍按展开后的链断言 `verify:ci` 的必需步骤与顺序（分层不改变叶子顺序），并继续要求 release workflow 保留 `verify:release` 兜底入口；gate 的等待/判读语义、tag/SHA 三方校验与 Release 去重目前靠 `workflow_dispatch` dry-run 和真实 tag 发版演练，没有独立门禁 —— 这是本决定已知的残余风险，改动 gate 时必须实际演练一次。
- **runner 成本**：master 不取消在途会让旧 master run 继续跑完；这是用少量 Windows runner 分钟换「gate 等待的同 SHA CI 不会被并发 push 取消」的可等性，属于有意的成本交换。
- **重看条件**：CI 能提供可复用的构建制品且传输成本低于重建；或 gate 的等待语义成为新的故障源；或 Release 墙钟重新被测试段主导。
