// Демо без інтернету і без налаштувань: піднімає локальний «сайт-донор» з усіма поломками,
// проганяє монітор і показує, що прийшло б у Telegram.
// Запуск: npm run demo

import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { startFixtures, TARGET, TARGET_2, ANCHOR } from "../test/fixtures.js";
import { loadConfig } from "../src/config.js";
import { runMonitor } from "../src/run.js";
import { toCsv } from "../src/csv.js";

const dir = "data/demo";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const site = await startFixtures();
const pages = ["/ok", "/nofollow", "/missing", "/changed", "/anchor", "/noindex", "/gone", "/flaky", "/challenge", "/redirect", "/cp1251", "/slow"];
const outreachers = ["Оля", "Макс", "Іра"];
const rows = [
  ["donor_url", "target_url", "anchor", "outreacher", "price", "placed_at"],
  ...pages.map((p, i) => [site.base + p, TARGET, ANCHOR, outreachers[i % 3], `$${80 + i * 10}`, "2026-10-01"]),
  [`${site.base}/two`, TARGET, ANCHOR, "Оля", "$150", "2026-10-05"],
  [`${site.base}/two`, TARGET_2, "нові слоти", "Оля", "$60", "2026-10-05"],
];
const linksFile = `${dir}/links.csv`;
writeFileSync(linksFile, toCsv(rows));

const cfg = loadConfig(undefined, {
  linksFile,
  stateFile: `${dir}/state.json`,
  outDir: `${dir}/out`,
  proxiesFile: null,
  perHostDelayMs: 150,
  jitterMs: 0,
  timeoutMs: 1500,
  retries: 2,
  retryBaseMs: 300,
  confirmRuns: 1, // у демо алертимо одразу; у бою 2 запуски поспіль
});

try {
  await runMonitor(cfg, {
    notify: async (text) => console.log(`\n──────── так виглядав би алерт у Telegram ────────\n${text}\n──────────────────────────────────────────────────`),
  });
} finally {
  await site.close();
}
