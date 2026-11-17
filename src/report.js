// CSV-звіт кожного запуску (відкривається в Excel і Google Sheets) + короткий підсумок у консоль.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCsv } from "./csv.js";
import { LABEL, ICON } from "./statuses.js";

const COLUMNS = [
  ["checked_at", (r) => r.checkedAt],
  ["status", (r) => r.status],
  ["що_сталось", (r) => LABEL[r.status]],
  ["donor_url", (r) => r.donor_url],
  ["target_url", (r) => r.target_url],
  ["anchor_expected", (r) => r.anchor],
  ["anchor_found", (r) => r.anchorFound],
  ["rel", (r) => r.rel],
  ["http", (r) => r.httpStatus],
  ["final_url", (r) => r.finalUrl],
  ["attempts", (r) => r.attempts],
  ["outreacher", (r) => r.outreacher],
  ["price", (r) => r.price],
  ["placed_at", (r) => r.placed_at],
  ["notes", (r) => (r.notes || []).join("; ")],
];

export function writeReport(results, outDir, now = new Date()) {
  mkdirSync(outDir, { recursive: true });
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = join(outDir, `report-${stamp}.csv`);
  const rows = [COLUMNS.map(([h]) => h), ...results.map((r) => COLUMNS.map(([, get]) => get(r) ?? ""))];
  // BOM + «;» — щоб Excel з укр. локаллю одразу відкрив кирилицю по колонках
  writeFileSync(file, "﻿" + toCsv(rows, ";"));
  return file;
}

export function summarize(results) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return Object.keys(LABEL)
    .filter((s) => counts[s])
    .map((s) => `${ICON[s]} ${s}: ${counts[s]}`)
    .join("   ");
}
