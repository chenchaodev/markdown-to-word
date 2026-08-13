# 验收样例

由 `test/tools/gen-fixtures.mjs` 从测试段命名导出自动生成(勿手改),
供 GUI 人工实测直接拖入。重新生成:`npm run gen:fixtures`;校验:`npm run check:fixtures`。

| 文件 | 功能/场景 | 对应测试段 |
| --- | --- | --- |
| cross-ref.md | 题注/章节交叉引用测试(批次 10 功能 2,docx + pdf 双格式): | test/segments/cross-ref.test.js |
| eq-numbering.md | 公式编号 + 交叉引用测试(原 make-batch4-sample.mjs 段 10): | test/segments/eq-numbering.test.js |
| mermaid-js.md | Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c): | test/segments/mermaid.test.js |
| mermaid.md | Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c): | test/segments/mermaid.test.js |
| mermaid-special.md | Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c): | test/segments/mermaid.test.js |
| toc-caption.md | TOC 静态目录 + 图/表题注编号测试(原 make-batch4-sample.mjs 段 9): | test/segments/toc-caption.test.js |
