# ADR-082 · 免安装档双格式:zip 与 7z 同时发布

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-10-19 |
| 关联 | 打包配置 [`package.json`](../../package.json) 的 `build.win.target` 与 `build.compression` ｜ 发布资产 [`.github/workflows/release.yml`](../../.github/workflows/release.yml) 的 ASSETS 推导 ｜ 产物核对门禁 [`gates/artifacts/check-release-artifacts.mjs`](../../gates/artifacts/check-release-artifacts.mjs) ｜ 前身:免安装档工作项（REQ-253，单 zip）｜ **不触发** [ADR-013](ADR-013-发布供应链与明确不签名.md) 的签名面（本仓明确不签名） |

---

## 决定

免安装档**同时发布两种格式**，内容一致、同一份产物：

1. **`.zip`** —— 保留。Windows 资源管理器原生可解压，不要求用户装任何额外工具。
2. **`.7z`** —— 新增，体积更小（LZMA2，`-mx=9`），但**需 7-Zip / WinRAR 才能解压**。
3. **压缩级别**：`build.compression: "maximum"` 钉住（zip → `-mx=9 -mfb=258 -mpass=15`；7z → `-mx=9`）。不依赖 electron-builder 的默认值，避免升级后静默漂移。
4. **产出侧**：`build.win.target` 含 `nsis` / `zip` / `7z`；打包命令 `electron-builder --win nsis zip 7z`；Release 的 ASSETS 由同一份 artifactName 模板按 `zip`、`7z` 两个扩展名展开。
5. **核对侧**：产物核对门禁按固定格式清单 `['zip', '7z']` 展开期望文件名，**缺任一即判红**；两处（package.json 的目标列表、门禁的格式清单）是同一契约的两侧，同改。

## 背景

issue #2 要求把免安装档改成 7z 以减小体积。实测口径来自 electron-builder 自身：zip 目标默认只跑 `-mx=7`（Deflate），而 7z 默认即 `-mx=9`（LZMA2 + 固实块），两者压缩率不在一档；Electron 包里 `.node` / `.wasm` / `.exe` 占比高、可压空间有限，收益主要来自文本与 JSON，**具体百分比需实测后记录**。

## 备选方案

1. **只发 7z** —— 否决。Windows 资源管理器**不原生支持 .7z**，解压门槛从「双击即可」变成「先装 7-Zip」；对不愿装工具的用户，这等于把可用性换成体积。
2. **不换格式，只把 zip 提到 maximum** —— 否决。零 UX 变化但收益明显小于换 7z（Deflate 上限摆在那里），且 issue #2 要的正是格式切换。
3. **改成 electron-builder 的 `portable` 单文件目标** —— 否决。那是「单文件免安装 exe」的另一套语义（自解压、启动慢、无法直接改数据目录），与现有「目录型便携版 + 设置随用户数据走」的定位不同，属另一件事。
4. **用 `.tar.gz` 一类** —— 否决。同样需要额外工具，且 7z 在同等体积下更常见于 Windows 分发。

## 后果

- **发布资产多一份**：Release 页面同时挂 `.zip` 与 `.7z`；CI 多一次归档（7z 比 zip 慢、更吃内存，本机打包需 4 GB 堆这一约束不变）。
- **用户可见差异**：文档（USER-GUIDE、README）与 Release notes 必须说明 `.7z` 的解压工具要求，否则会出现「下载后打不开」的支持问题。
- **实测体积差（4.4.0 构建，同一份内容）**：`.zip` 154,836,612 B（147.7 MiB）、`.7z` 96,915,315 B（92.4 MiB）⇒ 7z 小 37.4%。对比口径是两者都取 `compression: maximum`（zip 为 `-mx=9`、7z 为 `-mx=9`）。后续是否收敛为只发 7z，依此判断。
- **不改**：安装包（NSIS）与自动更新通道（`latest.yml` + blockmap）不受影响；冒烟与签名核对仍针对解包目录与 exe。
