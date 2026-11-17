// Читаємо список розміщених посилань з CSV (вивантаження з Google Sheets / CRM аутрічерів).
// Обовʼязкові колонки: donor_url, target_url. Решта за бажанням: anchor, outreacher, price, placed_at.

import { readFileSync, existsSync } from "node:fs";
import { parseCsv } from "./csv.js";
import { normalizeUrl } from "./url.js";
import { linkKey } from "./state.js";

const withScheme = (u) => (u && !/^[a-z][a-z0-9+.-]*:\/\//i.test(u) ? `https://${u}` : u);

export function loadLinks(file) {
  if (!existsSync(file)) {
    throw new Error(`Нема файлу з посиланнями: ${file}. Скопіюй data/links.example.csv у data/links.csv і заповни.`);
  }
  const [header = [], ...body] = parseCsv(readFileSync(file, "utf-8"));
  const cols = header.map((h) => h.trim().toLowerCase());
  for (const need of ["donor_url", "target_url"]) {
    if (!cols.includes(need)) throw new Error(`У ${file} нема колонки «${need}». Потрібні: donor_url, target_url.`);
  }

  const links = [];
  const invalid = [];
  const seen = new Set();
  body.forEach((cells, i) => {
    const row = Object.fromEntries(cols.map((c, j) => [c, (cells[j] ?? "").trim()]));
    row.donor_url = withScheme(row.donor_url);
    row.target_url = withScheme(row.target_url);
    const line = i + 2;
    if (!normalizeUrl(row.donor_url) || !normalizeUrl(row.target_url)) {
      invalid.push({ line, reason: "кривий donor_url або target_url" });
      return;
    }
    const key = linkKey(row);
    if (seen.has(key)) {
      invalid.push({ line, reason: "дубль: така пара донор → ціль уже є" });
      return;
    }
    seen.add(key);
    links.push({ anchor: "", ...row, _row: links.length });
  });
  return { links, invalid };
}
