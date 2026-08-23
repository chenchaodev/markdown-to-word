/**
 * 事件域·转换入口与进度订阅(批③自 events.ts 按域拆出,行为零变化):
 * - 转换按钮:单文件 convertBtn / 批量 batchBtn / 合并 mergeBtn / 取消 cancelBtn;
 * - 快捷键:Ctrl+Enter 主转换(单文件/批量)、Ctrl+O 追加文件(openDialog 属
 *   selection 域,经 import 复用);
 * - 进度订阅(B12):convert:progress 带 mode 标识直接与 state.mode 比对归属,
 *   迟到事件(mode 已复位)忽略;批量走 convert:batchProgress;print 阶段取消
 *   按钮置灰;窗口 unload 时退订两个订阅(主进程侧 IPC 通道卫生)。
 * 与原单文件 bindEvents 的差异仅为本域监听集中注册;document 上两个 keydown
 * (本域快捷键 / dialogs-events 的 Esc)互不重叠,顺序无行为影响。
 */
import { batchBtn, cancelBtn, convertBtn, mergeBtn } from "../../dom/refs.js";
import { state } from "../../state/state.js";
import { STAGE_PERCENT, baseName, setError, setProgress, setStatus, stageText } from "../../state/utils.js";
import { runBatch, runConvert, runMerge } from "../convert-flow.js";
import { openDialog } from "./selection.js";
import { t } from "../../../core/i18n.js";

/* ---------- 本域事件绑定(index 组合入口逐域调用) ---------- */
export function bindConvertActionsEvents(): void {
  // 转换按钮:单文件(docx / pdf 均已支持)
  convertBtn.addEventListener("click", () => {
    const filePath = state.selectedFiles[0];
    if (!filePath) {
      setError(t("file.selectFirst"));
      return;
    }
    void runConvert(filePath, state.selectedFormat);
  });

  // 批量转换按钮(≥2 个文件时可见)
  batchBtn.addEventListener("click", () => {
    if (state.selectedFiles.length < 2) return;
    void runBatch();
  });

  // 合并转换按钮(≥2 个文件时可见)
  mergeBtn.addEventListener("click", () => {
    if (state.selectedFiles.length < 2) return;
    void runMerge();
  });

  // 批次 7:取消当前转换(单文件 / 批量 / 合并;主进程在检查点终止并返回 canceled)
  cancelBtn.addEventListener("click", () => {
    if (state.mode === null) return;
    cancelBtn.disabled = true; // 防重复点击;转换结束后 hideProgress 隐藏整块
    setStatus(t("convert.canceling"));
    window.api.convertCancel().catch(() => {
      cancelBtn.disabled = false;
      setStatus(t("convert.cancelFailed"));
    });
  });

  // 进度订阅:单文件/合并走 convert:progress;批量走 convert:batchProgress。
  // B12:payload 带 mode 标识,直接与 state.mode 比对做归属判定(不再按调用
  // 上下文硬编码模式清单),转换结束后的迟到事件(mode 已复位为 null)直接忽略。
  // 单文件/合并只有阶段键(无百分比),按 STAGE_PERCENT 映射近似进度。
  // B9:pdf 链路细分 parse/inline/mermaid/katex/print 阶段键;print(printToPDF)
  // 不可中断 → 取消按钮置灰,防无效点击。
  state.unsubscribeProgress = window.api.onConvertProgress((info) => {
    if (info.mode !== state.mode) return;
    const text = stageText(info.stage, t);
    if (text !== info.stage) setStatus(text); // 未知阶段原样兜底,不覆盖状态栏
    const percent = STAGE_PERCENT[info.stage];
    if (percent !== undefined) setProgress(percent);
    if (info.stage === "print") cancelBtn.disabled = true;
  });

  state.unsubscribeBatchProgress = window.api.onBatchProgress((info) => {
    if (state.mode !== "batch") return;
    const text = t("convert.batch.progress", {
      index: info.index,
      total: info.total,
      file: baseName(info.file),
      stage: stageText(info.stage, t),
    });
    setStatus(text);
    // 批量进度:已完成 (index-1)/total 个文件 + 当前文件阶段权重 /total
    const base = ((info.index - 1) / info.total) * 100;
    const step = (STAGE_PERCENT[info.stage] ?? 0) / info.total;
    setProgress(base + step);
  });

  // 批次 7:快捷键 Ctrl+Enter 触发主转换(单文件/批量),Ctrl+O 添加文件
  document.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "enter") {
      event.preventDefault();
      if (state.mode !== null) return;
      if (state.selectedFiles.length === 1) {
        void runConvert(state.selectedFiles[0]!, state.selectedFormat); // 上行已守卫 length === 1
      } else if (state.selectedFiles.length >= 2) {
        void runBatch();
      }
    } else if (key === "o") {
      event.preventDefault();
      void openDialog(true);
    }
  });

  // 窗口关闭时取消进度订阅。生命周期说明(B8 卫生项):unload 后整个 renderer
  // JS 上下文随页面销毁——本模块注册的 DOM 监听(document/dropZone/multiList 等)
  // 与 IPC 订阅一并消亡,不存在跨页泄漏;此处显式退订仅为主进程侧 IPC 通道卫生,
  // 不补其他监听清理(补清理与页面销毁语义等价,无行为差异)。
  window.addEventListener("unload", () => {
    state.unsubscribeProgress?.();
    state.unsubscribeBatchProgress?.();
  });
}
