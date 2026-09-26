import { setLanguage, applyStaticTexts, isLanguage, t } from "../core/i18n.js";

declare global {
  interface Window {
    aboutApi: {
      openExternal(url: string): void;
      checkUpdate(): Promise<{
        status: "latest" | "available" | "error";
        current: string;
        latest?: string;
        url?: string;
      }>;
    };
  }
}

const REPO_URL = "https://github.com/chenchaodev/markdown-to-word";
const AUTHOR_URL = "https://github.com/chenchaodev";
const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";
const MANUAL_URL =
  "https://github.com/chenchaodev/markdown-to-word/blob/master/docs/USER-GUIDE.md";

document.addEventListener("DOMContentLoaded", () => {
  // i18n: read persisted language, set, and apply static texts
  try {
    const value = localStorage.getItem("m2w.language");
    if (value && isLanguage(value)) {
      setLanguage(value);
    } else {
      setLanguage("zh");
    }
  } catch {
    setLanguage("zh");
  }
  applyStaticTexts();

  // Read version from query string → badge next to wordmark
  const version = new URLSearchParams(location.search).get("v") ?? "";
  const versionEl = document.getElementById("version");
  if (versionEl) {
    versionEl.textContent = version ? `v${version}` : "";
    // 徽标只显示版本号,含义靠 title 补全;与主窗标题栏 .tb-ver 用同一条字典键,
    // 同一份数据在两处的说明口径不分叉
    versionEl.title = version ? t("app.versionTitle", { version }) : "";
  }

  // Update status row (under version badge)
  const statusEl = document.getElementById("updateStatus");
  const textEl = document.getElementById("updateText");
  const retryBtn = document.getElementById("updateRetry");
  async function renderUpdateStatus() {
    if (!statusEl || !textEl) return;
    textEl.textContent = t("about.updateChecking");
    statusEl.className = "update-status update-status--checking";
    if (retryBtn) retryBtn.hidden = true;
    try {
      const res = await window.aboutApi.checkUpdate();
      if (res.status === "available" && res.latest && res.url) {
        textEl.textContent = t("about.updateAvailable", {
          latest: `v${res.latest}`,
          current: `v${res.current}`,
        });
        statusEl.className = "update-status update-status--available";
        if (retryBtn) {
          retryBtn.textContent = t("about.downloadUpdate");
          retryBtn.hidden = false;
          retryBtn.onclick = () => {
            window.aboutApi.openExternal(res.url!);
          };
        }
      } else if (res.status === "latest") {
        textEl.textContent = t("about.updateLatest");
        statusEl.className = "update-status update-status--latest";
      } else {
        textEl.textContent = t("about.updateError");
        statusEl.className = "update-status update-status--error";
        if (retryBtn) {
          retryBtn.textContent = t("about.checkUpdate");
          retryBtn.hidden = false;
        }
      }
    } catch {
      textEl.textContent = t("about.updateError");
      statusEl.className = "update-status update-status--error";
      if (retryBtn) {
        retryBtn.textContent = t("about.checkUpdate");
        retryBtn.hidden = false;
      }
    }
  }
  void renderUpdateStatus();

  // Primary action → open user manual in external browser
  const manualBtn = document.getElementById("aboutOpenBtn");
  if (manualBtn) {
    manualBtn.addEventListener("click", () => {
      window.aboutApi.openExternal(MANUAL_URL);
    });
  }

  // 初始焦点:落在「查看使用手册」——本页唯一的主动作(许可 / 仓库 / 作者都是
  // 外链,信息性质)。不落焦时键盘用户的起点是文档根,得先 Tab 过整张信息卡
  // 才够得到动作钮。落焦后 Shift+Tab 可原路退回三条外链,顺序与视觉一致。
  // 焦点环走既有 :focus-visible(朱砂描边),无新增样式。
  manualBtn?.focus();

  // Repo link → open in external browser (suppress in-page navigation)
  const repoLink = document.getElementById("repoLink");
  if (repoLink) {
    repoLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.aboutApi.openExternal(REPO_URL);
    });
  }

  // License link → open in external browser
  const licenseLink = document.querySelector<HTMLAnchorElement>(
    ".about-meta .meta-value a[href]",
  );
  if (licenseLink) {
    licenseLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.aboutApi.openExternal(LICENSE_URL);
    });
  }

  // Author link → open GitHub profile in external browser
  const authorLink = document.getElementById("authorLink");
  if (authorLink) {
    authorLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.aboutApi.openExternal(AUTHOR_URL);
    });
  }
});

export {};
