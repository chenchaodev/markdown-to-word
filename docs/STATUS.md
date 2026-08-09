# 状态速查

## 当前状态
- 2026-08-09:**批次 8 开发完成待实测**(8a TOC 静态目录 + 8b 图/表题注编号已提交,typecheck/build/验收脚本 9 段/smoke 全绿;清单见 docs/ACCEPTANCE.md)
- 2026-08-09:批次 7 GUI 实测全部通过(24 项清单 + 3 个修复复测),批次 7 关闭
- 2026-08-08 13:27:24:docs 文件名统一英文化(0.17.2,纯文档;archive/ 存档保留原名)
- 2026-08-08:批次 7「体验优化 + 流程简化」完成 + 3 个 bug 修复已提交(0.17.1,typecheck/build/smoke 全绿)
- 2026-08-02~08-06:批次 1-6 与 G1-G5 均已完成(用户实测通过:批次 1/2/3 与 G5),详见 CHANGELOG;各批验收产物见 `output/批次N验收/`

## 验证基线
- 已跑通:`npm run typecheck`、`npm run build`、`npx electron . --smoke`(启动 + docx/pdf 双链路 + 设置持久化/landscape 端到端 + 批量/合并端到端 + renderer 诊断)
- 验收脚本:`scripts/make-batch4-sample.mjs` 9 段断言(编码预检/脚注/页眉页脚/书签/编号/白名单/公式/TOC 与题注);main 侧行为(重名序号/输出目录/取消/批量导出一致)走 smoke + GUI 实测清单(脚本无法触达 main IPC 层)
- smoke 自清理 output 产物(批次 7 重名保护后旧产物不再被覆盖,断言会遇 (N) 序号变体;Windows 占用文件 EBUSY 容错跳过)
- 历史批次断言明细见 `docs/CHANGELOG.md` 对应版本条目(0.4.x~0.17.x)
- 打包:`npm run dist`(electron-builder NSIS);验证链:--dir → asar list → win-unpacked 启动存活 → 静默安装/卸载(退出码 0);打包版 `--smoke` 不可用(asar 内只读,output/ 写不进);镜像环境变量见开发者手册

## 铁律(勿回退)
> 项目级硬约束(技术栈/镜像/字体/分页符/依赖钉死)已全部迁至项目 `AGENTS.md`「硬约束」节,以彼处为准。

## 打开事项
- [ ] **批次 8 待用户实测**(2026-08-09 完成开发):Word/WPS 打开 08-TOC与题注测试.docx 确认目录直接可见(免更新域)、题注编号与样式;修改正文后右键「更新域」目录是否刷新;PDF 题注编号与正文一致;通过后批次 8 关闭
- [ ] 批次 8 之后候选:8c Mermaid、8d 公式编号、代码块语法高亮写 docx、模板导入(先导出侧)、批注、WPS 兼容矩阵