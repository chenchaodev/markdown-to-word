# 安装包签名状态记录

> 本文件是**签名状态的声明侧单源**（事实侧由 `scripts/check-signature-status.mjs` 在发布链上核对）。
> 二者不一致即判红，由 `test/segments/signature-status.test.js` 断言两者措辞一致。
> 裁决出处：`docs/ADR.md` ADR-013 发布供应链与「现阶段明确不签名」。

## 当前状态：**未签名（unsigned）**

| 项 | 值 |
|---|---|
| 声明状态 | `unsigned` |
| 代码签名 | **未接入**（不采购证书、不接签名服务） |
| 打包配置 | `package.json` `build.win` / `build.nsis` 中**无** `certificate`、`signtoolOptions`、`forceCodeSigning` |
| 决策 | ADR-013：现阶段明确不签名，未签名作为**明确风险**保留，不因缺签名阻断发布 |
| 状态记录日期 | 2026-09-26 |

## 为什么不用 `forceCodeSigning: true`

安全评审曾建议设置 `forceCodeSigning: true`，让「无证书时发版失败」而不是静默产出未签名包。
**本项目有意不采用**：ADR-013 裁决是「暂不签名」而非「必须签名才能发版」——若设 `forceCodeSigning`，
在没有证书时整个发布链会直接失败，与该裁决冲突。

取而代之的补偿控制是**可核验的如实披露**（本文件 + 用户文档 + 发布期事实核对），
而不是让发布失败。若未来决定正式签名，需同时改三处（见下方「更新规则」）。

## 风险与缓解手段

| 风险 | 缓解手段 | 落点 |
|---|---|---|
| SmartScreen 提示「已保护你的电脑」 | 用户文档 FAQ 明确解释，并说明只从 GitHub Releases 官方页下载 | `docs/USER-GUIDE.md` 常见问题 + 已知限制 |
| 用户无法校验安装包来源 | 发布页给出安装包 SHA-256 | `scripts/check-release-artifacts.mjs` 生成 SHA-256 报告，发布时随产物公布 |
| 产物被投毒无法归因 | SHA-256 可比对；发布说明记录版本与 tag | 发布流程（tag ↔ package.json ↔ lockfile ↔ CHANGELOG 四源同源） |
| 签名状态与实际不符（假话风险） | 发布链核对 Authenticode 实际状态 vs 本文件声明 | `scripts/check-signature-status.mjs` |

## 如何核验

发布链内自动执行（`npm run check:signature`）。手工核验：

```powershell
# 查看某个产物的真实签名状态(Status 取值:Valid / NotSigned / NotTrusted / UnknownError …)
Get-AuthenticodeSignature -LiteralPath "release\MarkdownToWord-Setup-<版本>.exe" | Select-Object Status
```

- `NotSigned` → 与本声明一致（预期状态）
- `Valid` → 已签名，与本声明**冲突**，须走「更新规则」
- `NotTrusted` → 有签名但证书链不受信，**不等于未签名**，本项目脚本按「无法判定」判红
- `UnknownError` 等 → 无法判定，同样判红，不得当作「未签名」放行

## 更新规则

签名状态一旦有意变更（例如正式接入证书），必须**同批**修改以下三处，缺一即门禁判红：

1. `scripts/check-signature-status.mjs` 的 `EXPECTED_SIGNATURE_STATUS`
2. 本文件「当前状态」表格
3. `docs/USER-GUIDE.md` 的已知限制与 SmartScreen FAQ

## 相关

- 裁决：ADR-013 发布供应链与「现阶段明确不签名」（`docs/ADR.md`）
- 待办状态：`docs/BACKLOG.md`「代码签名 = 暂缓」「安装包未签名 = 风险记录」
- 事实核对脚本：`scripts/check-signature-status.mjs`
- 守护测试：`test/segments/signature-status.test.js`
