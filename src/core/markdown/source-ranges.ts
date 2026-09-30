/**
 * 源码区间契约与合并:渲染前变换侧(markdown/ai-cleanup.ts)与预检侧
 * (pipeline/precheck.ts)共用这一份「半开区间 + 合并」的定义。
 *
 * 只承载**两侧真正逐字相同**的东西:区间类型与合并循环,以及合并结果上的
 * offset 查询。节点→区间的收集、masking 策略、切行口径两侧刻意不同(反斜杠
 * 转义在 AI 清理侧是保护对象、在预检侧恰是被检信号),故不归位 —— 决定与理由
 * 见 docs/adr/adr-025-区间判据不合并.md。
 *
 * 本模块不得引入任何 node:* 内建:core 侧内建白名单是逐文件的
 * (gates/repo/check-import-boundary.mjs 的 CORE_NODE_BUILTIN_FILES),新文件不在名单内。
 */

/** 源码字节区间(半开):取自 mdast 节点的权威 position 或按字符推算的下标。 */
export interface SourceRange {
  start: number;
  end: number;
}

/** 合并后区间的查询面:offset 是否落在任一区间内。 */
export interface SourceRangeQuery {
  contains: (offset: number) => boolean;
}

/**
 * 丢弃空区间(退化成点的区间不携带源码)后合并重叠/相邻区间。
 * 相邻也并:并集与逐段切片对消费者等价,并起来少一轮遍历。
 * 排序比较器按 start 后 end,保证同 start 时短的在前(被长的吸收)。
 */
export function mergeSourceRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

/**
 * 把**已合并**的区间包成 offset 查询器。合并结果有序且互不重叠,故二分定位
 * 「最后一个 start ≤ offset 的区间」再比一次 end 即可,不必线性扫全表。
 * 入参须是 mergeSourceRanges 的产物(未合并的数组会给出错判)。
 */
export function createSourceRangeQuery(merged: readonly SourceRange[]): SourceRangeQuery {
  return {
    contains(offset: number): boolean {
      let low = 0;
      let high = merged.length - 1;
      let hit = -1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (merged[mid]!.start <= offset) {
          hit = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      const range = hit < 0 ? undefined : merged[hit];
      return range !== undefined && offset < range.end;
    },
  };
}
