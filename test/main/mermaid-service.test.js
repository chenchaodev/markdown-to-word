/**
 * Mermaid 渲染服务验收(main 进程层;经 dist/main/mermaid-service.js,electron 环境):
 * 本迭代 mermaid 链路 main 侧真实断言兜底(渲染在隐藏 BrowserWindow + mermaid 11.16.1):
 * - renderMermaid("graph TD; A-->B") → 非 null(渲染成功)
 * - png 为 PNG 魔数(89 50 4E 47),width/height > 0(逻辑 1x 尺寸)
 * - svg 为完整 SVG 字符串(含 <svg 标签)
 * - 语法错误 → null(降级路径:页面内 parse 预检失败)
 * 说明:窗口懒创建、单例复用;本段结束后窗口仍在,由 acceptance 末尾 app.quit()
 * 触发清理(closed → 临时 HTML 删除)。
 */
import { renderMermaid } from "../../dist/main/mermaid-service.js";

function assert(cond, msg) {
  if (!cond) throw new Error(`mermaid-service 断言失败:${msg}`);
}

export async function run() {
  const result = await renderMermaid("graph TD; A-->B");
  assert(result, "renderMermaid 返回 null(渲染失败)");
  assert(
    result.png.length > 8 &&
      result.png[0] === 0x89 &&
      result.png[1] === 0x50 &&
      result.png[2] === 0x4e &&
      result.png[3] === 0x47,
    `png 魔数错误: ${result.png.subarray(0, 4).toString("hex")}`,
  );
  assert(result.width > 0 && result.height > 0, `尺寸异常: ${result.width}x${result.height}`);
  assert(result.svg.includes("<svg"), "svg 缺少 <svg 标签");

  // 降级路径:语法错误 → parse 预检失败 → null
  const bad = await renderMermaid("graph TD;\nA[unclosed");
  assert(bad === null, "语法错误应返回 null(降级)");

  console.log(
    `[ok] mermaid-service:真实渲染 ${result.width}x${result.height}(2x PNG ${result.png.length} bytes,svg ${result.svg.length} chars);语法错误降级 null`,
  );
}