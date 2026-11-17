// Запуск: npm start
// Опції: --links=data/links.csv  --config=config/my.json
// Секрети (.env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, PROXIES

import { loadConfig } from "./config.js";
import { runMonitor } from "./run.js";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, ...v] = a.slice(2).split("=");
      return [k, v.join("=") || undefined];
    }),
);

try {
  const cfg = loadConfig(args.config, { linksFile: args.links });
  await runMonitor(cfg);
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
}
