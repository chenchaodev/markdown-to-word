# ADR-084 · 免安装档 zip 压缩档降为 normal

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-20 |
| 关联 | 部分取代 [ADR-082](ADR-082-免安装档双格式zip与7z.md) 决定 3 的 zip 部分 ｜ 打包配置 [`package.json`](../../package.json) 的 `build.compression` 与 `scripts.dist` ｜ 产物核对门禁 [`gates/artifacts/check-release-artifacts.mjs`](../../gates/artifacts/check-release-artifacts.mjs) ｜ 工作项 REQ-256 |

---

## 决定

**zip 目标单独使用 `compression: "normal"`，7z 与 NSIS 继续使用 `maximum`。**

- `build.compression` 仍钉 `"maximum"`，作为 7z / NSIS 的基准，不依赖 electron-builder 默认值。
- `scripts.dist` 拆成两次调用：先 `electron-builder --win zip --x64 --publish never -c.compression=normal`，再 `electron-builder --win 7z nsis --x64 --publish never`。
- 产物文件名、Release ASSETS、产物核对清单均不变。

## 背景

4.6.0 发版实测（run 39434058978，Windows runner）：

- Release 总计 22m53s，其中 `verify:release` 单步 1252s。
- `dist` 内 zip 与 7z 并行执行：`win-unpacked` 于 14:00:22 完成，NSIS 于 14:12:41 才开始，压缩段 12m19s。
- 本地同一份 `win-unpacked` 的文件时间戳把两条并行任务分开：`.7z` 于 21:40:17 完成（2m47s），`.zip` 于 21:50:03 完成（12m33s）——**慢的是 zip，不是 7z**。

根因是 ADR-082 钉住的 `build.compression: "maximum"`：zip 映射为 `-mx=9 -mfb=258 -mpass=15`，15 轮 Deflate 在 389 MB、8000+ 文件上耗时约 12 分钟。同机实测 `-mx=5` 只用 30s，体积 156,245,210 B，比当前 zip 的 154,848,981 B 仅大 0.9%。electron-builder 的类型注释也写明 `maximum` 对体积「没有明显差别，只增加构建时间」。

7z 在 `maximum` 下只有 2m47s，且是用户为体积主动选择的格式，不动。

## 备选方案

1. **全局改 `normal`（zip 与 7z 都降）** —— 否决。7z 从 96,926,183 B 涨到 109,890,619 B（+13.4%），而只降 zip 已拿到几乎全部时间收益；7z 的体积优势是该格式存在的理由。
2. **保留 `maximum` 不动** —— 否决。为不到 1% 的 zip 体积付 12 分钟，且 zip 是「不想装工具」的兼容档，用户对它的体积敏感度低于 7z。
3. **用仓外/传递依赖的 7za 自定义 zip 步骤** —— 否决。多一条依赖仓外二进制的产物生成路径，且绕开 electron-builder 的 artifactName / 签名链；两次 electron-builder 调用虽多一次打包（约 24s），但仍在同一套工具链内。
4. **删掉 zip 只发 7z** —— 否决。理由同 ADR-082 备选 1：Windows 资源管理器不原生支持 `.7z`。

## 后果

- **时间**：压缩段从约 12m19s 降到约 3m（zip 与 7z 并行，NSIS 约 1m）；本地 `dist` 实测 866s → **334s**（5m34s），Release 预计从 23 min 降到约 10–11 min。
- **体积**：electron-builder 实测 zip 154,848,981 → **155,200,638 B（+0.23%）**；7z **96,922,022 B 不变**；7z 相对 zip 仍小约 37.6%。基准测试（`7z a -tzip -mx=5`，30s）得到 +0.9%，electron-builder 的 normal 档实际更接近原体积。
- **构建次数**：`electron-builder` 跑两遍，打包与签名各多一次（约 +24s）；两次的 `win-unpacked` 由同一份 `dist` 生成，内容一致。
- **门禁**：`check:ci-contract` 仍能在 `scripts.dist` 中定位 `electron-builder` 与前后步骤，断言不需改；`check:release` 的文件清单不变。
- **重看条件**：electron-builder 支持按目标单独设压缩档时，合并回一次调用；或 zip 体积涨幅超过 3% 时重新评估。
