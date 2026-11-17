// Прогін усіх посилань.
//  - Групуємо по домену-донору: один домен = одна черга (ліміт запитів працює природно),
//    різні домени йдуть паралельно (concurrency).
//  - Одна сторінка-донор завантажується ОДИН раз, навіть якщо на ній кілька наших лінків.
//  - Помилка на одному лінку не валить весь прогін.

import { hostKey, normalizeUrl } from "./url.js";
import { analyzeHtml } from "./analyze.js";
import { ICON } from "./statuses.js";

async function checkOne(link, getPage) {
  const page = await getPage(link.donor_url);
  const base = { httpStatus: page.status ?? "", finalUrl: page.finalUrl ?? "", attempts: page.attempts ?? 0 };

  if (page.kind === "blocked") return { ...base, status: "BLOCKED", notes: [page.reason] };
  if (page.kind === "error") return { ...base, status: "ERROR", notes: [page.reason] };
  if (page.status === 404 || page.status === 410) return { ...base, status: "GONE", notes: [] };
  if (page.status === 401 || page.status === 403) return { ...base, status: "BLOCKED", notes: [`HTTP ${page.status}`] };
  if (page.status >= 400) return { ...base, status: "ERROR", notes: [`HTTP ${page.status}`] };

  const a = analyzeHtml(page.html, {
    pageUrl: page.finalUrl,
    target: link.target_url,
    anchor: link.anchor,
    headers: page.headers,
    status: page.status,
  });
  const notes = [...a.notes];
  if (page.redirected) notes.unshift(`редірект → ${page.finalUrl}`);
  if (page.truncated) notes.push("сторінку обрізано по maxBytes");
  return { ...base, ...a, notes };
}

export async function runChecks(links, { fetcher, concurrency = 4, log = () => {} }) {
  const byHost = new Map();
  for (const l of links) {
    const h = hostKey(l.donor_url);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(l);
  }

  const pages = new Map();
  const getPage = (url) => {
    const k = normalizeUrl(url);
    if (!pages.has(k)) pages.set(k, fetcher.fetchPage(url));
    return pages.get(k);
  };

  const queue = [...byHost.values()];
  const results = [];

  async function worker() {
    while (queue.length) {
      const group = queue.shift();
      for (const link of group) {
        let r;
        try {
          r = await checkOne(link, getPage);
        } catch (e) {
          r = { status: "ERROR", notes: [`збій перевірки: ${e.message}`] };
        }
        const row = { ...link, ...r, checkedAt: new Date().toISOString() };
        results.push(row);
        const why = row.status !== "OK" && row.notes?.[0] ? `  (${row.notes[0]})` : "";
        log(`${ICON[row.status] ?? "•"} ${row.status.padEnd(14)} ${link.donor_url}${why}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results.sort((a, b) => a._row - b._row); // порядок як у вхідному файлі
}
