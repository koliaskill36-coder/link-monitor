// Інтеграційні тести: справжні HTTP-запити до локального «донора» і через локальний проксі.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFixtures, startProxy, TARGET, TARGET_2, ANCHOR } from "./fixtures.js";
import { runChecks } from "../src/monitor.js";
import { createFetcher, HostLimiter, parseRetryAfter } from "../src/fetcher.js";
import { ProxyPool } from "../src/proxies.js";
import { loadConfig } from "../src/config.js";
import { runMonitor } from "../src/run.js";

let site;
before(async () => (site = await startFixtures()));
after(async () => site.close());

const cfg = loadConfig(undefined, {
  perHostDelayMs: 30, jitterMs: 0, timeoutMs: 700, retries: 2, retryBaseMs: 50,
  proxiesFile: null, confirmRuns: 1,
});

async function check(links, { pool = new ProxyPool([]), overrides = {} } = {}) {
  const c = { ...cfg, ...overrides };
  const fetcher = createFetcher(c, { pool, limiter: new HostLimiter({ delayMs: c.perHostDelayMs }) });
  try {
    return await runChecks(links.map((l, i) => ({ anchor: ANCHOR, ...l, _row: i })), { fetcher, concurrency: 4 });
  } finally {
    await fetcher.close();
    await pool.close();
  }
}

test("усі типові поломки розпізнаються правильно", async () => {
  const routes = {
    "/ok": "OK", "/nofollow": "NOFOLLOW", "/missing": "MISSING", "/changed": "URL_CHANGED",
    "/anchor": "ANCHOR_CHANGED", "/noindex": "NOINDEX", "/gone": "GONE", "/flaky": "OK",
    "/challenge": "BLOCKED", "/redirect": "OK", "/cp1251": "OK", "/slow": "ERROR",
  };
  const results = await check(Object.keys(routes).map((p) => ({ donor_url: site.base + p, target_url: TARGET })));
  const got = Object.fromEntries(results.map((r) => [new URL(r.donor_url).pathname, r]));

  for (const [path, want] of Object.entries(routes)) assert.equal(got[path].status, want, path);
  assert.equal(got["/flaky"].attempts, 2, "429 → дочекались Retry-After і повторили");
  assert.equal(got["/challenge"].attempts, 1, "без проксі капчу не довбемо повторами");
  assert.equal(got["/slow"].attempts, 3, "таймаут → 3 спроби");
  assert.match(got["/slow"].notes[0], /таймаут/);
  assert.match(got["/redirect"].notes[0], /редірект/);
  assert.equal(got["/cp1251"].anchorFound, ANCHOR, "windows-1251 розкодовано правильно");
});

test("одна сторінка з кількома нашими лінками завантажується один раз", async () => {
  const before = site.hits.filter((h) => h.path === "/two").length;
  const results = await check([
    { donor_url: `${site.base}/two`, target_url: TARGET },
    { donor_url: `${site.base}/two`, target_url: TARGET_2, anchor: "нові слоти" },
  ]);
  assert.deepEqual(results.map((r) => r.status), ["OK", "NOFOLLOW"]);
  assert.equal(site.hits.filter((h) => h.path === "/two").length - before, 1);
});

test("ліміт запитів на домен: пауза між запитами не менша за perHostDelayMs", async () => {
  const start = Date.now();
  await check(["/ok", "/missing", "/anchor"].map((p) => ({ donor_url: site.base + p, target_url: TARGET })), {
    overrides: { perHostDelayMs: 250 },
  });
  const times = site.hits.filter((h) => h.at >= start).map((h) => h.at);
  assert.equal(times.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 240, `пауза ${times[i] - times[i - 1]} мс`);
});

test("мертвий проксі вимикається, запит іде через живий", async () => {
  const proxy = await startProxy();
  try {
    const pool = new ProxyPool(["http://user:secret@127.0.0.1:1", proxy.url], { maxFails: 1 });
    const results = await check([{ donor_url: `${site.base}/ok`, target_url: TARGET }], { pool, overrides: { timeoutMs: 5000 } });
    assert.equal(results[0].status, "OK");
    assert.equal(results[0].attempts, 2);
    assert.ok(pool.items[0].dead, "мертвий проксі вимкнено");
    assert.ok(proxy.count >= 1, "трафік пішов через живий проксі");
    assert.ok(!pool.items[0].label.includes("secret"), "пароль проксі не світиться в логах");
  } finally {
    await proxy.close();
  }
});

test("Retry-After: секунди і дата", () => {
  assert.equal(parseRetryAfter("5"), 5000);
  const ms = parseRetryAfter(new Date(Date.now() + 10_000).toUTCString());
  assert.ok(ms > 8000 && ms <= 10_000);
  assert.equal(parseRetryAfter("сміття"), null);
});

test("алерт не губиться: якщо Telegram впав, стан не зберігається і алерт прийде наступного разу", async () => {
  const dir = mkdtempSync(join(tmpdir(), "link-monitor-"));
  const linksFile = join(dir, "links.csv");
  writeFileSync(linksFile, `donor_url,target_url,anchor\n${site.base}/ok,${TARGET},${ANCHOR}\n${site.base}/missing,${TARGET},${ANCHOR}\n`);
  const c = { ...cfg, linksFile, stateFile: join(dir, "state.json"), outDir: join(dir, "out") };
  const quiet = () => {};

  const r1 = await runMonitor(c, { log: quiet, notify: async () => { throw new Error("Telegram 502"); } });
  assert.equal(r1.alerts.length, 1);
  assert.equal(r1.stateSaved, false);
  assert.ok(!existsSync(c.stateFile));

  const sent = [];
  const r2 = await runMonitor(c, { log: quiet, notify: async (t) => sent.push(t) });
  assert.equal(r2.alerts.length, 1, "той самий алерт прийшов повторно");
  assert.match(sent[0], /лінк зник/);

  const r3 = await runMonitor(c, { log: quiet, notify: async (t) => sent.push(t) });
  assert.equal(r3.alerts.length, 0, "вдруге про те саме не спамимо");
});
