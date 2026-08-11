# 状态速查

## 当前状态
- 2026-08-11:**smoke 遗留修复完成**(输出隔离:outputDir 强制 "" + afterConvert "none" 结束恢复,产物落 output/smoke 不再污染 Downloads/自动弹窗;命名描述化:g3/g4/merge-a/b → smoke-basic/smoke-pdf/smoke-merge-1/2,清理前缀收敛 smoke-;typecheck/build/smoke 全绿,设置文件恢复验证通过;小型豁免不 tag)
- 2026-08-11:**迭代 4「预览入口迁移」用户实测通过**(预览迁移到转换前:单文件态操作行 + 多文件态每行「预览」按钮,完成弹窗移除预览按钮;build/验收 20 段/smoke 全绿,0.22.0)
- 2026-08-11:**重构四步完成 + 测试缺口高/中补齐**(取消状态参数化、converter 抽取、smoke 独立瘦身、测试目录分层;验收 19 段 + smoke 全绿,0.21.0)
- 2026-08-10:**测试体系重组完成**(验收脚本按内容主题拆分 segments/*.test.js 去批次化、样例静态入仓 fixtures/、产物目录 output/{artifacts,smoke}、旧产物清理;typecheck/build/验收 11 段/smoke 全绿,0.20.0)
- 2026-08-09:**批次 9 用户实测通过**(公式编号 + 交叉引用,0.19.1 含 2 个实测修复),批次 9 关闭
- 2026-08-09:批次 8 用户实测通过(8a 静态目录 + 8b 题注编号,0.18.1),批次 8 关闭
- 2026-08-08 13:27:24:docs 文件名统一英文化(0.17.2,纯文档;archive/ 存档保留原名)
- 2026-08-08:批次 7「体验优化 + 流程简化」完成 + 3 个 bug 修复已提交(0.17.1,typecheck/build/smoke 全绿)
- 2026-08-02~08-06:批次 1-6 与 G1-G5 均已完成(用户实测通过:批次 1/2/3 与 G5),详见 CHANGELOG;验收产物见 `output/artifacts/`(按内容主题命名,无批次概念)

## 验证基线
- 已跑通:`npm run typecheck`、`npm run build`、`npx electron . --smoke`(启动 + docx/pdf 双链路 + 设置持久化/landscape 端到端 + 批量/合并端到端 + renderer 诊断)
- 验收脚本:`npm run test`(test/acceptance.mjs 自动发现 `segments/`(core 渲染)与 `main/`(主进程层)下 `*.test.js`,19 段:基础渲染/封面/合并/脚注/公式/公式编号/PDF 元数据/标题编号链接/排版/白名单/编码/TOC 与题注/任务列表/设置/页面设置/frontmatter/slug/外链图片下载/转换编排;新增测试=新建段文件零注册);main 侧行为(重名序号/输出目录/取消/批量导出)已有 `main/converter.test.js` 断言,smoke 保留必须 Electron 的断言(printToPDF 产物/书签/renderer diag/设置持久化往返)
- smoke 自清理 output/smoke 临时产物(批次 7 重名保护后旧产物不再被覆盖,断言会遇 (N) 序号变体;Windows 占用文件 EBUSY 容错跳过)
- 历史批次断言明细见 `docs/CHANGELOG.md` 对应版本条目(0.4.x~0.17.x)
- 打包:`npm run dist`(electron-builder NSIS);验证链:--dir → asar list → win-unpacked 启动存活 → 静默安装/卸载(退出码 0);打包版 `--smoke` 不可用(asar 内只读,output/smoke 写不进);镜像环境变量见开发者手册

## 铁律(勿回退)
> 项目级硬约束(技术栈/镜像/字体/分页符/依赖钉死)已全部迁至项目 `AGENTS.md`「硬约束」节,以彼处为准。

## 打开事项
- [ ] 测试缺口清单(24 项,按优先级分批补齐)见 `docs/ROADMAP.md`「测试缺口」节
- [ ] 批次 10 候选:8c Mermaid、题注/章节交叉引用(8b 补 label 机制)、公式编号开关、代码块语法高亮写 docx、模板导入(先导出侧)、批注、WPS 兼容矩阵