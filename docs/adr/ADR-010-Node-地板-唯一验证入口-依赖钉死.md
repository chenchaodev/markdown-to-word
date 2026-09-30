# ADR-010 · 工程口径:Node 地板、唯一验证入口、依赖钉死

| 项 | 值 |
|---|---|
| 状态 | 现行 |
| 日期 | 2026-09-26 |

## 背景

触发事实写在「理由」行：连续四次「本机绿、远端红」，根因每次都是绕过或缩水的门禁清单，而非代码本身。因此门禁链必须不可绕过 —— `verify:ci` 定为唯一基础链，Release 复用它并追加 dist 清理与产物核对，不再维护第二份命令表（否决「Release 维护独立缩水清单」的理由是两处漂移）。几何门禁强制进 CI/Release，跨 DPI 像素基线默认只跑单档：runner 行为无法本地验证，多档会引入「未测量」退出把 `verify:ci` 打红。宿主 Node 地板取 22.13+（CI 主 job 固定 22.13.0，保留 Node 22 稳定 lane）。来源：campaign 归档升格（REF-001）。

## 决定

### 2026-09-26 19:40:00 工程口径:Node 地板、唯一验证入口、依赖钉死(ADR-010)
- 决策:宿主 Node 统一 22.13+(CI 主 job 固定 22.13.0,保留 Node 22 稳定 lane);发布不可绕过门禁 —— `verify:ci` 为唯一基础链(build → typecheck → lint → 验收段(带覆盖率插桩,只跑一遍见 ADR-016)→ fixture drift → smoke → geometry),`verify:release` 复用它并追加 dist 清理与产物核对;几何门禁强制进入 CI/Release,跨 DPI 像素基线**默认单档**,多档须先经一次 lane 实跑;依赖按批准范围钉死,范围内 patch/minor 由人工裁决
- 理由:连续四次「本机绿、远端红」的根因都是绕过或缩水的门禁清单;单源入口让 Release 不再维护第二份命令表
- 备选:Release 维护独立缩水清单(两处漂移);默认多档像素基线(runner 行为无法本地验证,「未测量」退出会把 `verify:ci` 打红)
- 代价:门禁链较长;跨 DPI 多档能力默认关闭
- 验证:`npm run check:contract`(+ selftest)
- 来源:campaign 归档升格(REF-001)
- 关联:`package.json` 脚本
