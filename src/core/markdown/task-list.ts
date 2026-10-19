/**
 * 任务列表 checkbox → 字符替换(双管线共用)。
 *
 * 从 pdf/render.ts 原样搬出:插件(@mdit/plugin-tasklist,label 默认开)实际输出形态:
 *   <input type="checkbox" class="task-list-item-checkbox" id="task-item-N"
 *          checked="checked" disabled="disabled"><label class="task-list-item-label"
 *          for="task-item-N"> 文本</label>
 * - 属性顺序 type 在前、含 id、布尔属性序列化为 ="…" → 不能用「class 在前 + 裸布尔
 *   属性」正则,改为以 class 定位 input、\schecked 判断选中态;
 * - input 移除后 label 的 for 悬空(指向已删除的 id),属多余结构一并解包(保留文本);
 *   label 文本自带前导空格,故字符后不加空格,输出形如「☑ 已完成」。
 *
 * 为什么替换而不是保留 checkbox:Chromium 打印 checkbox 有 bug(pdf 侧),且
 * Word/WPS 粘贴时 checkbox 形态不稳定;☐/☑ 字符在两条链路上都稳定。
 */
export function replaceTaskCheckboxes(html: string): string {
  return html
    .replace(/<input[^>]*class="task-list-item-checkbox"[^>]*>/g, (tag) =>
      /\schecked/.test(tag) ? "☑" : "☐",
    )
    .replace(/<label[^>]*class="task-list-item-label"[^>]*>([\s\S]*?)<\/label>/g, "$1");
}
