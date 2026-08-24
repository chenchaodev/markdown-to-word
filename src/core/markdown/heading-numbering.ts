/**
 * 标题章节编号计数单源(CORE-2):「h1 增 → 下级清零」计数器与章节号文本的
 * 纯函数,docx 预扫(prescan.ts)与 pdf 扫描(pdf/rules/xref.ts)共用,
 * 消除原三份人肉镜像(prescan / xref / template CSS counter)中最脆的两份 JS 计数。
 *
 * 章节号口径(DECIDE-1 用户裁决,2026-08-24 统一):无 h1 文档跳过前导零级 ——
 * h2 引用显示「1」(Word 口径;原 pdf 为「0.1」,已统一)。中间零级保留:
 * h1 后直接 h3 →「1.0.1」(与 Word numbering 引擎显示一致)。
 *
 * pdf 显示层(template.ts 的 CSS counter)无法复用 JS 函数(平台限制),
 * 但分支口径同源:!hasH1 时 ::before 省略 h1c 前缀(见 buildTemplateCss)。
 * 修改计数语义须同步 template.ts 两分支(注释互指)。
 */

/** 标题章节计数器(h1-h3;depth 4-6 不参与编号,与 docx numbering 只挂 h1-h3 一致) */
export interface HeadingCounters {
  h1: number;
  h2: number;
  h3: number;
}

/** 新建全零计数器(每次文档扫描一个实例) */
export function createHeadingCounters(): HeadingCounters {
  return { h1: 0, h2: 0, h3: 0 };
}

/**
 * 按标题深度递增计数器:h1 增 → h2/h3 清零;h2 增 → h3 清零。
 * depth 1-3 返回 true(已计数);其他深度返回 false(不计数)。
 */
export function bumpHeadingCounter(counters: HeadingCounters, depth: number): boolean {
  if (depth === 1) {
    counters.h1++;
    counters.h2 = 0;
    counters.h3 = 0;
    return true;
  }
  if (depth === 2) {
    counters.h2++;
    counters.h3 = 0;
    return true;
  }
  if (depth === 3) {
    counters.h3++;
    return true;
  }
  return false;
}

/**
 * 静态章节号文本 = 深度 1..depth 当前计数拼接;前导未出现的级(计数 0)跳过
 * (DECIDE-1 裁决口径:无 h1 时 h2 从「1」起),中间未出现的级保留 0
 * (h1 后直接 h3 →「1.0.1」,与 Word 引擎显示一致);全零(未计数)→ null。
 */
export function chapterNumberFromCounters(counters: HeadingCounters, depth: number): string | null {
  const parts: number[] = [];
  let started = false;
  for (let i = 1; i <= Math.min(depth, 3); i++) {
    const v = counters[(`h${i}`) as keyof HeadingCounters];
    if (!started && v === 0) continue;
    started = true;
    parts.push(v);
  }
  return parts.length > 0 ? parts.join(".") : null;
}
