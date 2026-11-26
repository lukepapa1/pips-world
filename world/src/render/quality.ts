export type Quality = "low" | "high";

const KEY = "pips-quality";

export function loadQuality(): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "low" || saved === "high") return saved;
  } catch {
    // Private browsing can block storage. Fall through to a screen-size default.
  }
  const shorter = Math.min(window.screen.width, window.screen.height);
  return shorter <= 820 ? "low" : "high";
}

export function saveQuality(quality: Quality): void {
  try {
    localStorage.setItem(KEY, quality);
  } catch {
    // Ignore. The toggle still applies for this page view.
  }
}
