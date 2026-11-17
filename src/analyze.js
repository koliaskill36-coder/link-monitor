// Розбір HTML сторінки-донора: чи є там наш лінк і чи він ще чогось вартий для SEO.

import * as cheerio from "cheerio";
import { normalizeUrl, hostKey, toUrl } from "./url.js";

const BAD_REL = ["nofollow", "sponsored", "ugc"];
const CHALLENGE_TITLE = /just a moment|attention required|checking your browser|ddos-guard|verify you are human|access denied|captcha|капч/i;
const CHALLENGE_BODY = /cf-chl-|challenge-platform|cf_chl_opt|__cf_chl_|ddos-guard\.net\/check/i;

const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

// Сторінка-заглушка антибота (Cloudflare, DDoS-Guard, капча) замість справжньої.
// Звичайна форма коментарів з reCAPTCHA сюди НЕ потрапляє: дивимось на заголовок
// маленької/помилкової сторінки і на специфічні маркери челенджу, а не на слово «captcha» в коді.
export function looksLikeChallenge(status, html = "", headers) {
  if (headers?.get?.("cf-mitigated") === "challenge") return true;
  if (CHALLENGE_BODY.test(html.slice(0, 50_000))) return true;
  const title = /<title[^>]*>([\s\S]{0,200}?)<\/title>/i.exec(html)?.[1] ?? "";
  return CHALLENGE_TITLE.test(title) && (status >= 400 || html.length < 30_000);
}

export function analyzeHtml(html, { pageUrl, target, anchor = "", headers, status = 200 }) {
  const $ = cheerio.load(html);
  const base = toUrl($("base[href]").attr("href") || "", pageUrl)?.href || pageUrl;

  // noindex/nofollow на всю сторінку: meta robots або HTTP-заголовок X-Robots-Tag
  const robotsParts = [headers?.get?.("x-robots-tag") || ""];
  $("meta").each((_, el) => {
    const name = ($(el).attr("name") || "").toLowerCase();
    if (name === "robots" || name === "googlebot") robotsParts.push($(el).attr("content") || "");
  });
  const robots = robotsParts.join(",").toLowerCase();
  const pageNoindex = /\b(noindex|none)\b/.test(robots);
  const pageNofollow = /\b(nofollow|none)\b/.test(robots);

  const targetNorm = normalizeUrl(target);
  const targetHost = hostKey(target);
  const hits = []; // лінки саме на нашу сторінку
  const sameSite = []; // лінки на інші сторінки нашого сайту

  $("a[href]").each((_, el) => {
    const a = $(el);
    const abs = toUrl(a.attr("href"), base);
    if (!abs) return;
    const link = {
      href: abs.href,
      text: clean(a.text()) || clean(a.find("img[alt]").attr("alt")),
      rel: clean(a.attr("rel")).split(" ").filter(Boolean),
    };
    if (normalizeUrl(abs.href) === targetNorm) hits.push(link);
    else if (hostKey(abs.href) === targetHost) sameSite.push(link);
  });

  const notes = [];
  const canonical = $('link[rel="canonical"]').attr("href");
  if (canonical) {
    const c = normalizeUrl(canonical, base);
    if (c && c !== normalizeUrl(pageUrl)) notes.push(`canonical → ${toUrl(canonical, base).href}`);
  }
  if (pageNofollow) notes.push("meta robots nofollow на всю сторінку");

  if (!hits.length) {
    // Лінка нема. Але спершу перевіряємо, чи нам взагалі показали справжню сторінку.
    if (looksLikeChallenge(status, html, headers)) return { status: "BLOCKED", notes: ["замість сторінки віддали капчу/антибот"] };
    if (sameSite.length) {
      const s = sameSite[0];
      return { status: "URL_CHANGED", foundHref: s.href, anchorFound: s.text, rel: s.rel.join(" "), notes: [`тепер веде на ${s.href}`, ...notes] };
    }
    return { status: "MISSING", notes };
  }

  const isDofollow = (l) => !pageNofollow && !l.rel.some((r) => BAD_REL.includes(r));
  const want = clean(anchor);
  const score = (l) => (isDofollow(l) ? 2 : 0) + (!want || l.text === want ? 1 : 0);
  const best = hits.reduce((a, b) => (score(b) > score(a) ? b : a));
  if (hits.length > 1) notes.push(`посилань на ціль на сторінці: ${hits.length}`);

  let result = "OK";
  if (pageNoindex) result = "NOINDEX";
  else if (!isDofollow(best)) result = "NOFOLLOW";
  else if (want && best.text !== want) result = "ANCHOR_CHANGED";

  return { status: result, foundHref: best.href, anchorFound: best.text, rel: best.rel.join(" "), notes };
}
