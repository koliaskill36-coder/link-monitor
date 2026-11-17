// Налаштування: config/default.json → (опційно) свій JSON через --config → точкові перевизначення з коду.

import { readFileSync } from "node:fs";

const DEFAULT = new URL("../config/default.json", import.meta.url);

export function loadConfig(file, overrides = {}) {
  const base = JSON.parse(readFileSync(DEFAULT, "utf-8"));
  const extra = file ? JSON.parse(readFileSync(file, "utf-8")) : {};
  const set = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
  return { ...base, ...extra, ...set };
}
