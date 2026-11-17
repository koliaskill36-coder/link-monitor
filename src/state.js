// Памʼять між запусками: щоб писати в Telegram тільки про ЗМІНИ, а не про всі 500 лінків щодня.
// Правила:
//  - новий живий лінк → тиша;
//  - проблема → алерт лише після confirmRuns запусків поспіль (разовий глюк сайту не смикає людей);
//  - BLOCKED/ERROR ≠ «лінк зник»: останній відомий статус не чіпаємо,
//    а після unknownAlertAfter невдач поспіль просимо перевірити руками;
//  - стан пишемо атомарно (tmp + rename), щоб обрив посеред запису не зламав файл.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname } from "node:path";
import { normalizeUrl } from "./url.js";
import { UNKNOWN } from "./statuses.js";

export const linkKey = (l) => `${normalizeUrl(l.donor_url)} → ${normalizeUrl(l.target_url)}`;

export function loadState(file, log = () => {}) {
  if (!file || !existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    copyFileSync(file, `${file}.broken`);
    log(`⚠️ стан ${file} пошкоджений (${e.message}), копія в .broken, починаю з нуля`);
    return {};
  }
}

export function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, file);
}

export function applyRun(prev, results, { confirmRuns = 2, unknownAlertAfter = 3, now = new Date().toISOString() } = {}) {
  const state = {};
  const alerts = [];

  for (const r of results) {
    const key = linkKey(r);
    const s = { status: null, streak: 0, alerted: null, unknownStreak: 0, ...prev[key] };
    state[key] = s; // лінків, яких більше нема у файлі, у новому стані теж нема
    s.donor = r.donor_url;
    s.target = r.target_url;
    s.lastCheckedAt = now;

    if (UNKNOWN.has(r.status)) {
      s.unknownStreak++;
      s.lastUnknown = r.status;
      if (s.unknownStreak === unknownAlertAfter) alerts.push({ type: "unknown", result: r, times: s.unknownStreak });
      continue;
    }

    s.unknownStreak = 0;
    if (r.status === s.status) s.streak++;
    else {
      s.status = r.status;
      s.streak = 1;
    }
    if (r.status === "OK") s.lastOkAt = now;

    if (s.status === s.alerted) continue;
    if (s.alerted === null && s.status === "OK") {
      s.alerted = "OK"; // новий живий лінк — без шуму
      continue;
    }
    if (s.streak < confirmRuns) continue;

    alerts.push({ type: s.status === "OK" ? "recovered" : "problem", result: r, from: s.alerted });
    s.alerted = s.status;
  }

  return { state, alerts };
}
