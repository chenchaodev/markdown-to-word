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

  // Read version from query string
  const version = new URLSearchParams(location.search).get("v") ?? "";
  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = version;

  // Also set version into meta row
  const metaVersionEl = document.getElementById("meta-version");
  if (metaVersionEl) metaVersionEl.textContent = version || "—";

  // Set license link href
  const licenseLink = document.querySelector<HTMLAnchorElement>(
    ".meta-value a[href]",
  );
  if (licenseLink && !licenseLink.getAttribute("href")) {
    licenseLink.href = LICENSE_URL;
  }

  // Wire click handlers: primary button → open GitHub in external browser
  const primaryBtn = document.querySelector<HTMLButtonElement>(".btn-primary");
  if (primaryBtn) {
    primaryBtn.addEventListener("click", () => {
      window.aboutApi.openExternal(REPO_URL);
    });
  }

  // Wire repo link → open GitHub in external browser (prevent default navigation)
  const repoLink = document.querySelector<HTMLAnchorElement>(".about-repo a");
  if (repoLink) {
    repoLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.aboutApi.openExternal(REPO_URL);
    });
  }

  // Wire license link → open license page in external browser
  if (licenseLink) {
    licenseLink.addEventListener("click", (e) => {
      e.preventDefault();
      window.aboutApi.openExternal(LICENSE_URL);
    });
  }
});

export {};
