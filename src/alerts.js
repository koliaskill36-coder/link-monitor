// Текст алерту і відправка в Telegram (чистий fetch до Bot API, без бібліотек).

import { LABEL, ICON } from "./statuses.js";

const SECTIONS = [
  ["problem", "🔴 Проблеми з посиланнями"],
  ["recovered", "🟢 Відновились"],
  ["unknown", "⚪ Не вдається перевірити кілька запусків поспіль, глянь руками"],
];

// Найгірше — першим: лінк зник важливіше, ніж змінений анкор.
const SEVERITY = ["GONE", "MISSING", "NOINDEX", "NOFOLLOW", "URL_CHANGED", "ANCHOR_CHANGED", "BLOCKED", "ERROR", "OK"];

// «$120», «120 грн», «€80» → скільки грошей під ризиком. Різні валюти не додаємо.
export function moneyAtRisk(results) {
  const parsed = results
    .map((r) => /^\s*([^\d\s.,]*)\s*([\d\s.,]+?)\s*([^\d\s.,]*)\s*$/.exec(r.price || ""))
    .filter(Boolean)
    .map((m) => ({ cur: (m[1] || m[3]).trim(), sum: Number(m[2].replace(/\s/g, "").replace(",", ".")) }))
    .filter((p) => p.sum > 0);
  if (!parsed.length || new Set(parsed.map((p) => p.cur)).size > 1) return "";
  const total = parsed.reduce((s, p) => s + p.sum, 0);
  const cur = parsed[0].cur;
  return /^[$€£₴]$/.test(cur) ? `${cur}${total}` : `${total} ${cur}`.trim();
}

export function formatAlerts(alerts) {
  const out = [];
  for (const [type, title] of SECTIONS) {
    const list = alerts
      .filter((a) => a.type === type)
      .sort((a, b) => SEVERITY.indexOf(a.result.status) - SEVERITY.indexOf(b.result.status));
    if (!list.length) continue;
    const risk = type === "problem" ? moneyAtRisk(list.map((a) => a.result)) : "";
    out.push(`${title}: ${list.length}${risk ? ` · під ризиком ${risk}` : ""}`);
    for (const { result: r, from } of list) {
      const was = type === "problem" && from && from !== "OK" ? ` (було: ${LABEL[from]})` : "";
      out.push("", `${ICON[r.status]} ${LABEL[r.status]}${was}`);
      out.push(`донор: ${r.donor_url}`, `ціль: ${r.target_url}`);
      if (r.anchorFound && r.status !== "OK") out.push(`зараз: «${r.anchorFound}»${r.rel ? `, rel="${r.rel}"` : ""}`);
      if (r.notes?.length) out.push(`деталі: ${r.notes.join("; ")}`);
      const who = [r.outreacher, r.price && `ціна ${r.price}`, r.placed_at && `розміщено ${r.placed_at}`].filter(Boolean);
      if (who.length) out.push(who.join(" · "));
    }
    out.push("");
  }
  return out.join("\n").trim();
}

// Telegram приймає до 4096 символів — ріжемо по рядках із запасом.
export function chunk(text, max = 4000) {
  const parts = [];
  let cur = "";
  for (const raw of text.split("\n")) {
    const line = raw.slice(0, max);
    if (cur && cur.length + 1 + line.length > max) {
      parts.push(cur);
      cur = line;
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) parts.push(cur);
  return parts;
}

export async function sendTelegram(text, { token, chatId, log = console.log }) {
  if (!token || !chatId) {
    log(`\n[Telegram не налаштовано, алерт у консоль]\n${text}\n`);
    return;
  }
  for (const part of chunk(text)) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: part, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}
