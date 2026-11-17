// Локальний «сайт-донор» з усіма типовими поломками + тестовий проксі.
// Потрібен для тестів і для `npm run demo`: усе перевіряється без інтернету.

import http from "node:http";
import net from "node:net";

export const TARGET = "https://our-site.example/reviews/best-bonuses/";
export const TARGET_2 = "https://our-site.example/reviews/new-slots/";
export const ANCHOR = "найкращі бонуси";

const page = (body, head = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Стаття донора</title>${head}</head>` +
  `<body><article><p>Текст статті про ігри.</p>${body}</article></body></html>`;
const a = (attrs, text) => `<p>Деталі <a ${attrs}>${text}</a> у нашому огляді.</p>`;

// Кодуємо рядок у windows-1251 (Node вміє її декодувати, але не кодувати)
function cp1251(str) {
  const special = { Ё: 0xa8, ё: 0xb8, Є: 0xaa, є: 0xba, І: 0xb2, і: 0xb3, Ї: 0xaf, ї: 0xbf, Ґ: 0xa5, ґ: 0xb4 };
  return Buffer.from(
    [...str].map((ch) => {
      const c = ch.codePointAt(0);
      if (c < 0x80) return c;
      if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0;
      return special[ch] ?? 0x3f;
    }),
  );
}

function trackSockets(server) {
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return () => {
    for (const s of sockets) s.destroy();
    return new Promise((r) => server.close(r));
  };
}

export async function startFixtures() {
  const hits = [];
  let flaky = 0;
  const routes = {
    // www + utm + без слеша в кінці: має зматчитись із TARGET після нормалізації
    "/ok": () => [200, page(a(`href="https://www.our-site.example/reviews/best-bonuses?utm_source=outreach"`, "Найкращі бонуси"))],
    "/nofollow": () => [200, page(a(`href="${TARGET}" rel="nofollow sponsored"`, ANCHOR))],
    "/missing": () => [200, page("<p>Статтю переписали, нашого лінка більше нема.</p>")],
    "/changed": () => [200, page(a(`href="https://our-site.example/"`, "наш сайт"))],
    "/anchor": () => [200, page(a(`href="${TARGET}"`, "тут"))],
    "/noindex": () => [200, page(a(`href="${TARGET}"`, ANCHOR), `<meta name="robots" content="noindex, follow">`)],
    "/gone": () => [404, page("<h1>Not found</h1>")],
    "/flaky": () =>
      ++flaky % 2 === 1
        ? [429, "Too Many Requests", { "retry-after": "1" }]
        : [200, page(a(`href="${TARGET}"`, ANCHOR))],
    "/challenge": () => [
      503,
      `<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>`,
      { server: "cloudflare" },
    ],
    "/redirect": () => [301, "", { location: "/ok" }],
    "/cp1251": () => [
      200,
      cp1251(page(a(`href="${TARGET}"`, ANCHOR)).replace('charset="utf-8"', 'charset="windows-1251"')),
      { "content-type": "text/html" },
    ],
    "/two": () => [200, page(a(`href="${TARGET}"`, ANCHOR) + a(`href="${TARGET_2}" rel="ugc"`, "нові слоти"))],
    "/slow": () => null, // не відповідає ніколи → таймаут
  };

  const server = http.createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    hits.push({ path, at: Date.now() });
    const route = routes[path];
    if (!route) {
      res.writeHead(404);
      res.end("no route");
      return;
    }
    const out = route();
    if (!out) return;
    const [status, body, headers = {}] = out;
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  });
  const close = trackSockets(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${server.address().port}`, hits, close };
}

// Проксі вміє і звичайний forward (GET http://...), і тунель CONNECT (так ходить undici).
export async function startProxy() {
  let count = 0;
  const server = http.createServer((req, res) => {
    count++;
    const up = http.request(req.url, { method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    up.on("error", () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });
  server.on("connect", (req, socket, head) => {
    count++;
    const [host, port] = req.url.split(":");
    const up = net.connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  const close = trackSockets(server);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    get count() {
      return count;
    },
    close,
  };
}
