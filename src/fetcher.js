// Завантаження сторінки-донора «обережно»:
//  - ліміт запитів на домен (пауза + випадковий розкид), щоб не ловити бан;
//  - 429 → чекаємо стільки, скільки просить Retry-After (або експоненційно);
//  - капча/антибот → пробуємо інший проксі; без проксі повтор з того ж IP не має сенсу;
//  - таймаут, обрив, 5xx → повтор з паузою;
//  - не читаємо більше maxBytes (захист від гігантських сторінок);
//  - правильне кодування (windows-1251 на старих укр/ру сайтах).

import { fetch, Agent } from "undici";
import { hostKey } from "./url.js";
import { looksLikeChallenge } from "./analyze.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HostLimiter {
  constructor({ delayMs = 3000, jitterMs = 0 } = {}) {
    this.delayMs = delayMs;
    this.jitterMs = jitterMs;
    this.nextAt = new Map(); // домен → коли можна наступний запит
  }

  async wait(host) {
    const now = Date.now();
    const at = Math.max(now, this.nextAt.get(host) ?? 0);
    // слот займаємо одразу, до sleep — щоб два паралельні виклики не стрельнули разом
    this.nextAt.set(host, at + this.delayMs + Math.random() * this.jitterMs);
    if (at > now) await sleep(at - now);
  }

  pushBack(host, ms) {
    this.nextAt.set(host, Math.max(this.nextAt.get(host) ?? 0, Date.now() + ms));
  }
}

export function parseRetryAfter(value) {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

const backoff = (attempt, base) => Math.min(30_000, base * 2 ** (attempt - 1)) + Math.random() * (base / 2);

async function readLimited(res, maxBytes) {
  if (!res.body) return { buf: Buffer.alloc(0), truncated: false };
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) {
      chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
      return { buf: Buffer.concat(chunks), truncated: true }; // вихід з циклу закриває потік
    }
    chunks.push(chunk);
  }
  return { buf: Buffer.concat(chunks), truncated: false };
}

function decodeBody(buf, contentType) {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType || "")?.[1];
  if (!charset) charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(buf.subarray(0, 4096).toString("latin1"))?.[1];
  try {
    return new TextDecoder(charset || "utf-8").decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

function errReason(e, timeoutMs) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `таймаут ${timeoutMs / 1000} с`;
  const code = e?.cause?.code || e?.code;
  const known = {
    ENOTFOUND: "домен не знайдено (DNS)",
    ECONNREFUSED: "зʼєднання відхилено",
    ECONNRESET: "зʼєднання обірвали",
    UND_ERR_CONNECT_TIMEOUT: "таймаут зʼєднання",
    UND_ERR_SOCKET: "сокет закрили",
    CERT_HAS_EXPIRED: "SSL-сертифікат прострочений",
  };
  return known[code] || code || e?.cause?.message || e?.message || "невідома помилка";
}

export function createFetcher(cfg, { pool, limiter, log = () => {} }) {
  const direct = new Agent({ connect: { timeout: cfg.timeoutMs } });
  const headers = {
    "user-agent": cfg.userAgent,
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9,uk;q=0.8",
  };
  const maxAttempts = (cfg.retries ?? 2) + 1;

  async function fetchPage(url) {
    const host = hostKey(url);
    let last = { kind: "error", reason: "не було жодної спроби", attempts: 0 };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let proxy;
      try {
        proxy = pool.next();
      } catch (e) {
        return { kind: "error", reason: e.message, attempts: attempt - 1 };
      }
      const via = proxy ? ` (проксі ${proxy.label})` : "";
      await limiter.wait(host);

      try {
        const res = await fetch(url, {
          headers,
          redirect: "follow",
          dispatcher: proxy?.agent ?? direct,
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        const { buf, truncated } = await readLimited(res, cfg.maxBytes);
        const html = decodeBody(buf, res.headers.get("content-type"));

        if (res.status === 429) {
          const ra = parseRetryAfter(res.headers.get("retry-after"));
          pool.fail(proxy, "429");
          if (ra != null && ra > cfg.maxRetryAfterMs) {
            return { kind: "blocked", reason: `429, просять зачекати ${Math.round(ra / 1000)} с`, attempts: attempt };
          }
          const wait = ra ?? backoff(attempt, cfg.retryBaseMs);
          limiter.pushBack(host, wait);
          last = { kind: "blocked", reason: "429 Too Many Requests", attempts: attempt };
          log(`   ↻ ${url}: 429${via}, чекаю ${(wait / 1000).toFixed(1)} с`);
          continue;
        }

        if (looksLikeChallenge(res.status, html, res.headers)) {
          pool.fail(proxy, "капча/антибот");
          last = { kind: "blocked", reason: `антибот/капча (HTTP ${res.status})`, attempts: attempt };
          if (!pool.size) return last;
          log(`   ↻ ${url}: капча${via}, пробую інший проксі`);
          continue;
        }

        if (res.status >= 500) {
          last = { kind: "error", reason: `HTTP ${res.status}`, attempts: attempt };
          limiter.pushBack(host, backoff(attempt, cfg.retryBaseMs));
          log(`   ↻ ${url}: HTTP ${res.status}${via}, повторю`);
          continue;
        }

        pool.ok(proxy);
        return {
          kind: "page",
          status: res.status,
          finalUrl: res.url || url,
          redirected: res.redirected,
          headers: res.headers,
          html,
          truncated,
          attempts: attempt,
        };
      } catch (e) {
        const reason = errReason(e, cfg.timeoutMs);
        pool.fail(proxy, reason);
        last = { kind: "error", reason, attempts: attempt };
        log(`   ↻ ${url}: ${reason}${via}`);
        limiter.pushBack(host, backoff(attempt, cfg.retryBaseMs));
      }
    }
    return last;
  }

  return { fetchPage, close: () => direct.close() };
}
