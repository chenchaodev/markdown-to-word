# 状态速查

## 当前状态
- 2026-08-09:**批次 9「公式编号 + 交叉引用」进行中**(8d 承接;D3=免更新路线延续、D4=语法已拍板;规划见路线图批次 9,清单见 docs/ACCEPTANCE.md)
- 2026-08-09:**批次 8 用户实测通过**(8a 静态目录 + 8b 题注编号,0.18.1),批次 8 关闭
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
- [ ] **批次 9 进行中**(2026-08-09 开工):公式编号 + 交叉引用(display 公式自动编号 + `{#eq:label}` 锚点 + `[式](#eq:label)` 静态引用),D3/D4 已拍板;实现前置验证:remark-math 标记行解析、markdown-it katex token 结构
- [ ] 批次 9 之后候选:8c Mermaid、题注/章节交叉引用(8b 补 label 机制)、公式编号开关、代码块语法高亮写 docx、模板导入(先导出侧)、批注、WPS 兼容矩阵