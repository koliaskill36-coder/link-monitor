// Усі статуси в одному місці: що показуємо людині і що вважаємо проблемою.

export const LABEL = {
  OK: "живий, dofollow",
  ANCHOR_CHANGED: "змінили анкор",
  URL_CHANGED: "лінк веде на інший URL нашого сайту",
  NOFOLLOW: "лінк став nofollow / sponsored / ugc",
  NOINDEX: "сторінку закрили від індексу (noindex)",
  MISSING: "лінк зник зі сторінки",
  GONE: "сторінку-донор видалили (404/410)",
  BLOCKED: "сайт не пустив (капча / антибот / 403)",
  ERROR: "не відкрилось (таймаут / мережа / 5xx)",
};

export const ICON = {
  OK: "✅", ANCHOR_CHANGED: "🟡", URL_CHANGED: "🟡", NOFOLLOW: "🟠", NOINDEX: "🟠",
  MISSING: "🔴", GONE: "🔴", BLOCKED: "⛔", ERROR: "⚠️",
};

// Лінк точно зіпсований: про це треба сказати аутрічеру.
export const PROBLEM = new Set(["GONE", "MISSING", "NOINDEX", "NOFOLLOW", "URL_CHANGED", "ANCHOR_CHANGED"]);

// Ми НЕ знаємо, що з лінком (нас не пустили або сайт лежить). Це не «лінк зник».
export const UNKNOWN = new Set(["BLOCKED", "ERROR"]);
