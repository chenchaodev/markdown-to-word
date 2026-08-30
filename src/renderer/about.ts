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

document.addEventListener("DOMContentLoaded", async () => {
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
  if (versionEl) versionEl.textContent = version ? `v${version}` : "";

  // Update status row (under version badge)
  const statusEl = document.getElementById("updateStatus");
  const retryBtn = document.getElementById("updateRetry");
  async function renderUpdateStatus() {
    if (!statusEl) return;
    statusEl.textContent = t("about.updateChecking");
    statusEl.className = "update-status update-status--checking";
    if (retryBtn) retryBtn.hidden = true;
    try {
      const res = await window.aboutApi.checkUpdate();
      if (res.status === "available" && res.latest && res.url) {
        statusEl.textContent = t("about.updateAvailable", {
          latest: `v${res.latest}`,
          current: `v${res.current}`,
        });
        statusEl.className = "update-status update-status--available";
        if (retryBtn) {
          retryBtn.hidden = false;
          retryBtn.onclick = () => {
            window.aboutApi.openExternal(res.url!);
          };
        }
      } else if (res.status === "latest") {
        statusEl.textContent = t("about.updateLatest");
        statusEl.className = "update-status update-status--latest";
      } else {
        statusEl.textContent = t("about.updateError");
        statusEl.className = "update-status update-status--error";
        if (retryBtn) retryBtn.hidden = false;
      }
    } catch {
      statusEl.textContent = t("about.updateError");
      statusEl.className = "update-status update-status--error";
      if (retryBtn) retryBtn.hidden = false;
    }
  }
  await renderUpdateStatus();

  // Primary action → open user manual in external browser
  const manualBtn = document.getElementById("aboutOpenBtn");
  if (manualBtn) {
    manualBtn.addEventListener("click", () => {
      window.aboutApi.openExternal(MANUAL_URL);
    });
  }

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
