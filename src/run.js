// Один повний запуск: прочитати лінки → перевірити → звіт → порівняти зі станом → алерт → зберегти стан.

import { loadLinks } from "./links.js";
import { ProxyPool, loadProxyList } from "./proxies.js";
import { HostLimiter, createFetcher } from "./fetcher.js";
import { runChecks } from "./monitor.js";
import { writeReport, summarize } from "./report.js";
import { loadState, saveState, applyRun } from "./state.js";
import { formatAlerts, sendTelegram } from "./alerts.js";
import { hostKey } from "./url.js";

export async function runMonitor(cfg, { log = console.log, notify } = {}) {
  const { links, invalid } = loadLinks(cfg.linksFile);
  for (const x of invalid) log(`⚠️ рядок ${x.line} пропущено: ${x.reason}`);
  if (!links.length) throw new Error("Нема жодного валідного посилання для перевірки");

  const proxyList = loadProxyList({ file: cfg.proxiesFile, env: process.env.PROXIES, list: cfg.proxies });
  const pool = new ProxyPool(proxyList, { maxFails: cfg.proxyMaxFails, log });
  const limiter = new HostLimiter({ delayMs: cfg.perHostDelayMs, jitterMs: cfg.jitterMs });
  const fetcher = createFetcher(cfg, { pool, limiter, log });
  const hosts = new Set(links.map((l) => hostKey(l.donor_url))).size;
  log(`Перевіряю ${links.length} посилань на ${hosts} доменах · ${pool.size ? `проксі: ${pool.size}` : "без проксі"}\n`);

  const t0 = Date.now();
  try {
    const results = await runChecks(links, { fetcher, concurrency: cfg.concurrency, log });
    const reportPath = writeReport(results, cfg.outDir);
    log(`\n${summarize(results)}\nЗвіт: ${reportPath} · ${((Date.now() - t0) / 1000).toFixed(1)} с`);

    const { state, alerts } = applyRun(loadState(cfg.stateFile, log), results, cfg);
    let stateSaved = true;
    if (alerts.length) {
      const send =
        notify ??
        ((text) => sendTelegram(text, { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID, log }));
      try {
        await send(formatAlerts(alerts));
        log(`Алертів: ${alerts.length}`);
      } catch (e) {
        // Якщо зберегти стан після невдалої відправки, алерт загубиться назавжди.
        stateSaved = false;
        log(`⚠️ Алерт не відправився (${e.message}). Стан не зберігаю, наступний запуск надішле ще раз.`);
      }
    } else {
      log("Змін нема, Telegram мовчить.");
    }
    if (stateSaved) saveState(cfg.stateFile, state);
    return { results, alerts, reportPath, stateSaved };
  } finally {
    await Promise.allSettled([fetcher.close(), pool.close()]);
  }
}
