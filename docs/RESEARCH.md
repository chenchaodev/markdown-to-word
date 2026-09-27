# 研究结论

> 只记录「换会话仍会用上、且别处查不到」的坑/勿回退事实/库事实。已实施且细节见 CHANGELOG 的条目不再重复;选型见 [ADR.md](ADR.md)。原文存档:docs/archive/。
> **路径迁移注记(2026-08-24)**:目录结构重组(2026-08-23,提交 6f3d72a~9909d74)前历史条目「关联」字段中的扁平路径已失效——对照关系:`src/settings.ts`→`src/main/persist/settings.ts`、`src/index.ts`→`src/main/`(拆 windows/ipc/menu/converter/persist/services)、`src/renderer.ts`→`src/renderer/renderer.ts`+六功能域、`src/core/{i18n-dict}.ts`→`src/core/i18n/`、core 根级散文件→`pipeline/markdown/image/settings/util/` 子域。时间戳记录按规约不改写原文。
> **分节注记(2026-09-26)**:条目按技术主题分组、组内时间倒序;一条未删未合并,只做分组与压缩,压缩处保留结论/关键数值/验证方式 + `docs/archive/` 原文链接。
> **条目级外迁注记(2026-09-27)**:条目正文按技术主题域拆到 `research/`,一个域一个文件,**整块原样搬移、禁改写**;本文件只留索引与上述规则注记。写新条目 = 在对应域文件里追加,并把该域行与速查行同步进本文件。超限 → 整份域文件移入 `archive/`,本文件留一行指针。

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
