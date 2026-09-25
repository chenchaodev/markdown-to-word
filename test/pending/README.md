# 阶段 3 历史测试副本

阶段 3 的红测试契约已迁入自动发现目录并完成实现：

- `test/segments/core-resources.test.js`：取消/deadline/KaTeX 资源预算；
- `test/segments/pdf-postprocess.test.js`：图片请求预算、超时、取消和 warning 顺序；
- `test/main/input-budget.test.js`、`image-request-budget.test.js`、`merge-cancel.test.js`：输入/合并/取消压力契约。

本目录保留的同名文件是阶段 3 实施前的历史副本，不参与 `test/acceptance.mjs`，不再作为待实现红测试或阶段完成证据。后续清理时以已接入 `test/segments/` / `test/main/` 的版本为准。
