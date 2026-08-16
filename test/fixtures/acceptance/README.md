# 验收样例

由 `test/tools/gen-fixtures.mjs` 从测试段命名导出自动生成(勿手改),
供 GUI 人工实测直接拖入。重新生成:`npm run gen:fixtures`;校验:`npm run check:fixtures`。

| 文件 | 功能/场景 | 对应测试段 |
| --- | --- | --- |
| basic-render.md | 基础渲染段:全要素中英混排样例 → docx + pdf。 | test/segments/basic-render.test.js |
| comments.md | 批注验收(批次 11):行内 `[锚定文本]{批注=内容}` → docx 批注。 | test/segments/comments.test.js |
| cover.md | 封面页测试(双格式,新段): | test/segments/cover.test.js |
| cross-ref.md | 题注/章节交叉引用测试(批次 10 功能 2,docx + pdf 双格式): | test/segments/cross-ref.test.js |
| eq-numbering.md | 公式编号 + 交叉引用测试(原 make-batch4-sample.mjs 段 10): | test/segments/eq-numbering.test.js |
| footnotes.md | 脚注 + 页眉页脚验收(原 make-batch4-sample.mjs 段 2,补页眉/页脚内容断言): | test/segments/footnotes.test.js |
| formula-degrade.md | 公式测试(原 make-batch4-sample.mjs 段 7): | test/segments/formula.test.js |
| formula.md | 公式测试(原 make-batch4-sample.mjs 段 7): | test/segments/formula.test.js |
| heading-links.md | 标题编号 + 内部/外部链接验收(原 make-batch4-sample.mjs 段 3,补 h4-h6/外链 rels): | test/segments/heading-links.test.js |
| merge.md | 合并段:FIXTURES_DIR/manual 全部 .md(含 chapters/ 子目录)→ 合并 → PDF → 书签注入 + 元数据。 | test/segments/merge.test.js |
| mermaid-js.md | Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c): | test/segments/mermaid.test.js |
| mermaid.md | Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c): | test/segments/mermaid.test.js |
| mermaid-special.md | Mermaid 渲染 core 层契约测试(批次 10 功能 1,8c): | test/segments/mermaid.test.js |
| page-setup.md | 页面设置验收(中优先级缺口:非 A4 纸张 + 边距值): | test/segments/page-setup.test.js |
| page-setup-pagebreak.md | 页面设置验收(中优先级缺口:非 A4 纸张 + 边距值): | test/segments/page-setup.test.js |
| pdf-bookmarks.md | PDF 书签端到端(R8 批 4 A2;smoke 书签断言的独立化 + buildBookmarkTree 层级直测): | test/segments/pdf-bookmarks.test.js |
| pdf-meta.md | PDF 章节编号 + 元数据验收(原 make-batch4-sample.mjs 段 4,独立化): | test/segments/pdf-meta.test.js |
| raw-html-cross.md | 内联格式白名单测试(原 make-batch4-sample.mjs 段 6): | test/segments/raw-html.test.js |
| raw-html.md | 内联格式白名单测试(原 make-batch4-sample.mjs 段 6): | test/segments/raw-html.test.js |
| task-list.md | 任务列表验收(GFM task list): | test/segments/task-list.test.js |
| toc-caption.md | TOC 静态目录 + 图/表题注编号测试(原 make-batch4-sample.mjs 段 9): | test/segments/toc-caption.test.js |
| typography.md | 排版设置验收(原 make-batch4-sample.mjs 段 5): | test/segments/typography.test.js |
