import { setLanguage, applyStaticTexts, isLanguage } from "../core/i18n.js";

declare global {
  interface Window {
    aboutApi: {
      openExternal(url: string): void;
    };
  }
}

const REPO_URL = "https://github.com/chenchaodev/markdown-to-word";
const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";
const MANUAL_URL =
  "https://github.com/chenchaodev/markdown-to-word/blob/main/docs/USER-GUIDE.md";

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
  if (versionEl) versionEl.textContent = version ? `v${version}` : "";

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
});

export {};
