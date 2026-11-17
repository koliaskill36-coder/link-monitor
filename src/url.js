// Нормалізація URL, щоб порівнювати посилання «по суті».
// Не важливі: http/https, www, слеш у кінці, utm-мітки, #якір, порядок параметрів, %-кодування кирилиці.
// Важливі (лишаємо): шлях і змістовні параметри, наприклад ?ref= у партнерських лінках.

const TRACKING = /^(utm_\w+|gclid|fbclid|yclid|_ga|mc_cid|mc_eid)$/i;

export function toUrl(raw, base) {
  try {
    return new URL(String(raw ?? "").trim(), base);
  } catch {
    return null;
  }
}

export function hostKey(raw) {
  const u = toUrl(raw);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : "";
}

export function normalizeUrl(raw, base) {
  const u = toUrl(raw, base);
  if (!u || !/^https?:$/.test(u.protocol)) return null; // mailto:, javascript:, tel: — не наші лінки
  let path = u.pathname.replace(/\/+$/, "") || "/";
  try {
    path = decodeURI(path);
  } catch {
    // криве %-кодування — порівнюємо як є
  }
  const params = [...u.searchParams]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = new URLSearchParams(params).toString();
  return hostKey(u.href) + path + (query ? `?${query}` : "");
}
