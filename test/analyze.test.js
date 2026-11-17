import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHtml, looksLikeChallenge } from "../src/analyze.js";

const T = "https://our-site.example/reviews/best/";
const P = "https://donor.example/post";
const run = (body, opts = {}) => analyzeHtml(`<html><head>${opts.head || ""}</head><body>${body}</body></html>`, { pageUrl: P, target: T, anchor: "кращі бонуси", ...opts });

test("живий dofollow лінк з правильним анкором → OK", () => {
  const r = run(`<a href="${T}">Кращі   бонуси</a>`);
  assert.equal(r.status, "OK");
  assert.equal(r.anchorFound, "кращі бонуси");
});

test("nofollow / sponsored / ugc → NOFOLLOW", () => {
  for (const rel of ["nofollow", "sponsored", "UGC noopener"]) {
    assert.equal(run(`<a href="${T}" rel="${rel}">кращі бонуси</a>`).status, "NOFOLLOW", rel);
  }
});

test("лінка нема → MISSING; лінк на іншу сторінку нашого сайту → URL_CHANGED", () => {
  assert.equal(run(`<a href="https://other.example/">x</a>`).status, "MISSING");
  const r = run(`<a href="https://our-site.example/">головна</a>`);
  assert.equal(r.status, "URL_CHANGED");
  assert.match(r.notes[0], /our-site\.example/);
});

test("анкор змінили → ANCHOR_CHANGED; без очікуваного анкора не перевіряємо", () => {
  assert.equal(run(`<a href="${T}">тут</a>`).status, "ANCHOR_CHANGED");
  assert.equal(run(`<a href="${T}">тут</a>`, { anchor: "" }).status, "OK");
});

test("noindex через meta robots або X-Robots-Tag → NOINDEX", () => {
  assert.equal(run(`<a href="${T}">кращі бонуси</a>`, { head: `<meta name="ROBOTS" content="noindex">` }).status, "NOINDEX");
  const headers = new Headers({ "x-robots-tag": "googlebot: noindex" });
  assert.equal(run(`<a href="${T}">кращі бонуси</a>`, { headers }).status, "NOINDEX");
});

test("відносний лінк з <base>, анкор-картинка через alt", () => {
  const r = run(`<a href="reviews/best"><img src="b.png" alt="Кращі бонуси"></a>`, { head: `<base href="https://our-site.example/">` });
  assert.equal(r.status, "OK");
});

test("два лінки на ціль: беремо найкращий (dofollow)", () => {
  const r = run(`<a href="${T}" rel="nofollow">кращі бонуси</a><a href="${T}">кращі бонуси</a>`);
  assert.equal(r.status, "OK");
  assert.match(r.notes.join(), /2/);
});

test("капча замість сторінки → BLOCKED, а не «лінк зник»", () => {
  const html = `<html><head><title>Just a moment...</title></head><body><div class="cf-chl-x"></div></body></html>`;
  assert.equal(analyzeHtml(html, { pageUrl: P, target: T, status: 503 }).status, "BLOCKED");
});

test("звичайна сторінка з reCAPTCHA у формі коментарів — НЕ капча", () => {
  const form = `<form><div class="g-recaptcha" data-sitekey="x"></div></form>`;
  assert.equal(run(`<a href="${T}">кращі бонуси</a>${form}`).status, "OK");
  assert.equal(run(form).status, "MISSING");
  assert.equal(looksLikeChallenge(200, `<html><title>Огляд казино</title>${form}</html>`), false);
});
