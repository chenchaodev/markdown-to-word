# 研究结论

> 只记录「换会话仍会用上、且别处查不到」的坑/勿回退事实/库事实。已实施且细节见 CHANGELOG 的条目不再重复;选型见 [ADR.md](ADR.md)。原文存档:docs/archive/。
> **路径迁移注记(2026-08-24)**:目录结构重组(2026-08-23,提交 6f3d72a~9909d74)前历史条目「关联」字段中的扁平路径已失效——对照关系:`src/settings.ts`→`src/main/persist/settings.ts`、`src/index.ts`→`src/main/`(拆 windows/ipc/menu/converter/persist/services)、`src/renderer.ts`→`src/renderer/renderer.ts`+六功能域、`src/core/{i18n-dict}.ts`→`src/core/i18n/`、core 根级散文件→`pipeline/markdown/image/settings/util/` 子域。时间戳记录按规约不改写原文。
> **分节注记(2026-09-26)**:条目按技术主题分组、组内时间倒序;一条未删未合并,只做分组与压缩,压缩处保留结论/关键数值/验证方式 + `docs/archive/` 原文链接。
> **条目级外迁注记(2026-09-27)**:条目正文按主题域拆到 `research/`,一域一文件,**整块原样搬移、禁改写**;本文件只留索引、规则注记与「最近记录」;超限 → 整份域文件移入 `archive/`,本文件留一行指针。

## 主题域索引

| 主题域 | 一句话摘要 | 位置 |
|---|---|---|
| docx 生成与域 | MathSum 的 `m:e` 必须装被加数否则 WPS 显方框;域 API 只走 TableOfContents/SimpleField | [research/docx-生成与域.md](research/docx-生成与域.md) |
| PDF 管线 | printToPDF 静默页边距与 A4 陷阱;书签靠自研 pdf-lib 注入而非原生名称树 | [research/PDF-管线.md](research/PDF-管线.md) |
| 双管线能力与契约口径 | 内置预设携带完整交付链、图片校验四步顺序、测试段隔离;两路线必须二选一 | [research/双管线能力与契约口径.md](research/双管线能力与契约口径.md) |
| 依赖与工具链 | 依赖钉死清单;TS7 有语法错即跳过语义诊断须双编译器交叉 | [research/依赖与工具链.md](research/依赖与工具链.md) |
| Electron 主进程与安全 | fire-and-forget 写必须 drain;`app.quit()` 不吃退出码须 `app.exit` | [research/Electron-主进程与安全.md](research/Electron-主进程与安全.md) |
| 渲染层与 UI | 目录带页码取混合路线;中文 eastAsia 排版是全赛道短板 | [research/渲染层与-UI.md](research/渲染层与-UI.md) |
| 代码结构与架构 | 三层分离已收敛;契约重复是主要技术债并已逐项归位 | [research/代码结构与架构.md](research/代码结构与架构.md) |
| 测试与门禁 | win32 子进程退出码高位值是 NTSTATUS 异常码;覆盖率跨环境有 ±0.01pp 抖动 | [research/测试与门禁.md](research/测试与门禁.md) |
| 供应链与发布 | asar 头按目录分层嵌套不可子串搜;审计三态不可谎报「无漏洞」 | [research/供应链与发布.md](research/供应链与发布.md) |

## 最近记录

> **挑选规则**:按条目 `### YYYY-MM-DD HH:mm:ss` 标题的时间戳取**最近 10 条**,同时间戳按域文件名字典序;**脚本从 `research/*.md` 抽取,标题行与 `**结论**` 整段逐字摘录,不手工重打、不改写**;其余字段(理由、来源/验证)只留在域文件。
> **维护**:新条目落地时**在对应域文件追加**,并把该条同步进本节;本节只留最近 10 条,更早的以 `research/` 域文件为准。

### 2026-09-27 08:48:38 层向门禁的覆盖与已知盲区
- **结论**:`scripts/check-import-boundary.mjs` 现有 **8 条**层向规则 —— `core-no-host` / `core-no-upward` / `renderer-no-main` / `preload-no-main` / `main-no-renderer` / `smoke-no-outside-src` / `renderer-foundation-no-feature-dep` / `core-pdf-no-fs`。**已知盲区**:`resolveLayer` 返回的是**顶层**目录,故 `layer:` 形态表达不了 renderer **内部**的边(内部路径首段恒为 `renderer`);要约束内部方向只能用相对说明符前缀,故另加了 `prefix:` 形态并把它从单前缀放宽为逗号列表。另:`builtin:` 形态是必需的 —— `classifySpecifier` 把 `node:*` 归为 `kind: 'builtin'` 而非 `'bare'`,`bare:` 匹配不到,而我们需要**按能力**区分(`core/pdf` 里 `node:path`/`node:url` 纯字符串运算可放行,`node:fs` 真 IO 要禁)

### 2026-09-27 08:48:38 PDF 侧 override 注册顺序的真实机制(修正一处流传的错误描述)
- **结论**:`src/core/pdf/render.ts` 的四条 `md.core.ruler.push` 用的是**互异**规则名(`caption_recognize` / `eq_numbering` / `figure_recognize` / `xref_recognize`),因此它们**按 push 先后依次执行,不存在「后注册覆盖先注册」**。真实不变量是:**label 登记类规则必须先于 `xref_recognize` 注册**(xref 靠解析 `[...](#eq:label)` 定位目标,而 label 由 caption/figure/equation 三条在渲染期登记)。`html_whitelist` 走 `md.inline.ruler.before`,属 inline 阶段,不参与该顺序关系。若哪天两条用了同名,语义会静默翻转成「后者覆盖前者」

### 2026-09-27 08:48:38 双管线状态传播模型相反
- **结论**:docx 侧 ctx 逐块下传,PDF 侧走 `override*Rule` 顺序注册;「同一语义两端行为一致」**无机制保证**,只靠差异矩阵锁定(`dual-pipeline-matrix` 21 行 × `must()`,当前口径「必须一致 12 / 允许不同 9」)

### 2026-09-27 08:48:38 renderer 实际中心 hub 是 `state/utils.ts` 而非 store
- **结论**:`src/renderer/state/` 名为 state,实为 **DOM 工具箱**(`utils.ts` 18 导出),被 `convert/` / `settings/` / `ui/` / `wizard/` 共 14 处全量导入;真正的 store 与纯函数只占同目录另两文件

### 2026-09-27 08:48:38 覆盖率分母排除 `dist/renderer/**` 整层,且该层数字**取不到**
- **结论**:`test:coverage` 排除整层 `dist/renderer/**`(30 个文件),而它是层向越界风险最高的一层。**追加事实**:c8 的 `--exclude` 在**数据收集阶段**就经 `entryFilter` 把该层滤掉(见 `c8/lib/report.js` 的 `shouldInstrument`),故主产物 `coverage-summary.json` 里该层条目是 **0 个** —— 不是「数字为 0」而是**数字不存在**,没有任何工具能把它「暴露出来」。要真拿到需另跑一遍纳入该层的 c8(独立 reports-dir、不带 `--check-coverage`),代价是 CI 每次多一遍 Electron 全量跑

### 2026-09-27 08:48:38 测试深导入 `dist/**` 内部产物的耦合面
- **结论**:40+ 处测试直导内部模块路径(如 `dist/core/pipeline/precheck.js`),任何文件移动都要改测试 import,而**断言内容可零变化**。REF-025 #07 实测:把策略从 `pipeline/precheck.ts` 迁到 `markdown/image-path-policy.ts` 一个文件,就牵动 30+ 个测试文件的导入与调用点(含 101 处调用改名)

### 2026-09-27 08:48:38 错误归一的「单源」只到导出函数层
- **结论**:#17 把 `errorMessage` 的实现上提到 `core/util/error-message.ts` 后,`main/ipc/logic.ts` 与 `renderer/state/pure.ts` 两份**重复定义**已消;但全库仍有 6 处表达式层内联(未走该单源)

### 2026-09-27 08:48:38 c8 的覆盖率数字会因文件拆分而漂移
- **结论**:按文件 `pct` 求平均会让大小文件等权,数字随文件拆分而漂移;正确聚合是逐文件 `sum(covered)/sum(total)` 后再算百分比。本仓四项基线(statements/branches/functions/lines)在阶段 3 后为 93.07/89.07/93.59/93.07,与上一轮的 93.06/89.08/93.59/93.06 相比 statements/lines +0.01、branch −0.01,落在**跨环境抖动**的 ±0.01pp 内

### 2026-09-26 23:35:00 win32 上「子进程退出码」大于 0x7fffffff 时它是 NTSTATUS 异常码
- **结论**:Windows 上进程被异常终止时,父进程拿到的「退出码」不是退出码,而是 **NTSTATUS 异常码**:判据是值 `> 0x7fffffff`(32 位高位置 1);`0xC0000005` = `STATUS_ACCESS_VIOLATION`(3221225477,访问冲突)、`0xC0000409` = `STATUS_STACK_BUFFER_OVERRUN`、`0xC0000374` = `STATUS_HEAP_CORRUPTION`、`0xC0000135/0138/0139/0142` = DLL 缺失/导出序号缺失/入口点缺失/DLL 初始化失败。`0x7fffffff` 及以下仍是普通退出码(0–255)。只印十进制等于丢掉唯一线索 —— 2026-09-26 那次 runner-only 失败就是这样:两轮复发各只拿到「实际 3221225477」一个数字,无法判断是段自身崩了还是宿主被外部终止。已加 `describeChildExitCode()` 标注(未收录的高位值只标「疑似异常终止」而不猜)

### 2026-09-26 23:20:00 「等固定时长」不是同步:fire-and-forget 写必须用 drain(勿回退)
- **结论**:① 迁移写是 **`void` fire-and-forget**(`void writeSettingsJson.enqueue(...)`),**外部无法通过「等够久」确认落盘** —— 放弃等待后写仍可能**迟到落盘并覆盖等待期的新写入**;真实故障:等 100ms 到点放弃 → 下一小节覆写 → 上一小节结果迟到落盘盖掉它 → 读到陈旧内容判红。② **正解是 drain**:写入器暴露 `drain()`(队尾空事务),resolve 即代表此前所有写(含重试)已结算;单次写失败不截断队列,故有失败写时同样 resolve;测试 `await` 它取代固定预算轮询,**退出路径也必须 drain**(否则未落盘的写随进程丢掉 = 真实产品缺口)。③ **rename 重试是放大效应非成因**:重试把「快速失败」变成「可能百毫秒后成功落盘」,**扩大**迟到覆盖窗口;根因仍是同步方式本身不成立。

## 主题域子条目速查

> 各域条目标题取首个分句(原标题一字未改,仅此处缩写便于速查);**完整标题与条目正文在落点文件**。跨文档的小节名引用按本节标题解析。

### docx 生成与域(子条目:docx MathSum 的 m · docx 域 API 调研结论(@librarian · docx 标题编号 + 内部链接(已验证 · docx 页眉页脚 + 页码(已验证 · G1 实测事实(docx 9.x + remark 管线)→ [research/docx-生成与域.md](research/docx-生成与域.md)

### PDF 管线(子条目:书签实现 + 「点击不跳转」修复(已验证 · G4 实测事实(printToPDF 管线)→ [research/PDF-管线.md](research/PDF-管线.md)

### 双管线能力与契约口径(子条目:决策口径统一(supersede 台账 · mermaid 集成方案调研结论(@librarian + @ex… · 管线勘察(TOC/题注编号现状事实) · 公式链路(@librarian + 实测 · 脚注(已验证) · 批量/合并(已验证) · spike 与实测(已验证 · docx/pdf 排版控制(已验证)→ [research/双管线能力与契约口径.md](research/双管线能力与契约口径.md)

### 依赖与工具链(子条目:TS7 native 有语法错误时跳过全程序语义诊断(勿回退) · eslint `maximumDefaultProjectFile… · 裸跑 build 不回收已删源输出 · E5 双配置 typecheck 的 CI 顺序依赖(3.11.8… · 审计整改记录(依赖钉死策略清单) · 文档加密调研(已明确不做) · 模板导入方案选型 · 双方向探索方案 · B10a 工程基建两坑)→ [research/依赖与工具链.md](research/依赖与工具链.md)

### Electron 主进程与安全(子条目:「等固定时长」不是同步 · Windows `rename` 覆盖被读句柄占用的目标必 EPE… · 显式落盘顺序 · Electron 门禁入口的三条失败路径(与直觉相反 · Windows/Electron 三条易踩实测事实 · 修复期踩坑(已验证 · 体验优化(已验证)→ [research/Electron-主进程与安全.md](research/Electron-主进程与安全.md)

### 渲染层与 UI(子条目:功能开发技术路线调研(目录带页码) · 功能候选调研与迭代排期(2.0.0 后新阶段) · 竞品功能矩阵二轮调研 · 功能扩展调研要点 · 易用性调研要点)→ [research/渲染层与-UI.md](research/渲染层与-UI.md)

### 代码结构与架构(子条目:目录结构评审(P1/P2 已落地) · 目录结构优化方案(已实施) · src 架构审查(H1-H3 已落地) · 全库质量审计(已全量闭环) · 四路代码分析盘点(已闭环))→ [research/代码结构与架构.md](research/代码结构与架构.md)

### 测试与门禁(子条目:win32 上「子进程退出码」大于 0x7fffffff 时它是 … · 测量验收时踩的两个坑 · 覆盖率四指标有 ±0.01pp 的环境间抖动 · c8 + Electron · 测试框架的「选择面」与「发现面」是两个语义 · renderer 测试段的元素 stub 契约(易致假红) · 代码/测试/文档组织形式审计(缺口已全闭) · 测试覆盖盘点结论 · 验收样例生成方案(拍板) · `pathToFileURL` 把 8.3 短路径的 `~` 编码… · 测试段同进程连跑两遍的迟到覆盖(本批主因) · 门禁探针里再跑一次真 c8 会静默少算覆盖率 · 覆盖率阈值棘轮 · 跨 DPI 几何采样用 `--force-device-scale…)→ [research/测试与门禁.md](research/测试与门禁.md)

### 供应链与发布(子条目:asar 归档格式两个反直觉事实(勿回退) · G5 打包坑(electron-builder · Windows 本地打包踩坑(长路径) · `npm audit --omit=dev` 在刻意不装依赖的 j… · CI 注入的 `PSModulePath` 污染使签名核对探测不可用 · npmmirror 的 `npm audit` 端点实测 404 · 包元数据缺 `license` 时的取值纪律 · 自写 prerelease 版本比较器 · NSIS 按用户模式与非交互安装 · 层向门禁的覆盖与已知盲区 · PDF 侧 override 注册顺序的真实机制(修正一处流传的错… · 双管线状态传播模型相反 · renderer 实际中心 hub 是 `state/utils.… · 覆盖率分母排除 `dist/renderer/**` 整层 · 测试深导入 `dist/**` 内部产物的耦合面 · 错误归一的「单源」只到导出函数层 · c8 的覆盖率数字会因文件拆分而漂移)→ [research/供应链与发布.md](research/供应链与发布.md)
