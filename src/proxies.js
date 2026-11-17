// Пул проксі з ротацією. Проксі, що падає N разів поспіль, вимикаємо до кінця запуску.
// Логін/пароль проксі ніколи не потрапляє в логи: показуємо лише host:port.

import { ProxyAgent } from "undici";
import { readFileSync, existsSync } from "node:fs";

export function loadProxyList({ file, env, list = [] } = {}) {
  const fromEnv = String(env || "").split(/[\s,]+/);
  const fromFile = file && existsSync(file) ? readFileSync(file, "utf-8").split(/\r?\n/) : [];
  return [...list, ...fromEnv, ...fromFile].map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
}

function mask(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port}`;
  } catch {
    return "proxy";
  }
}

export class ProxyPool {
  constructor(urls = [], { maxFails = 3, log = () => {} } = {}) {
    this.items = urls.map((url) => ({ label: mask(url), agent: new ProxyAgent(url), fails: 0, dead: false }));
    this.maxFails = maxFails;
    this.log = log;
    this.i = 0;
  }

  get size() {
    return this.items.length;
  }

  // null = проксі не задані, йдемо напряму
  next() {
    if (!this.items.length) return null;
    const alive = this.items.filter((p) => !p.dead);
    if (!alive.length) throw new Error("усі проксі вимкнені після помилок");
    return alive[this.i++ % alive.length];
  }

  fail(p, reason) {
    if (!p) return;
    p.fails++;
    if (p.fails >= this.maxFails && !p.dead) {
      p.dead = true;
      this.log(`⚠️ проксі ${p.label} вимкнено: ${reason}`);
    }
  }

  ok(p) {
    if (p) p.fails = 0;
  }

  async close() {
    await Promise.allSettled(this.items.map((p) => p.agent.close()));
  }
}
