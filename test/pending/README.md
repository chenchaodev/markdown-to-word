# 待实现测试草稿

这里的测试属于后续阶段的红测试契约，尚未对应生产实现，不参与 `test/acceptance.mjs` 自动发现。

- `core-resources.test.js`：阶段 3 取消/deadline/KaTeX 资源预算。
- `pdf-postprocess.test.js`：阶段 3 图片请求预算、超时、取消和 warning 顺序。

阶段 3 开始时，先将测试移回 `test/segments/` 对应位置，再实现生产代码；不得把本目录文件当作阶段完成证据。
