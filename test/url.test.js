import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUrl, hostKey } from "../src/url.js";
import { parseCsv, toCsv } from "../src/csv.js";

test("однаковий лінк у різних записах дає однаковий ключ", () => {
  const variants = [
    "https://www.Our-Site.example/reviews/best/?utm_source=x&utm_medium=y#top",
    "http://our-site.example/reviews/best",
    "https://our-site.example/reviews/best/",
  ];
  for (const v of variants) assert.equal(normalizeUrl(v), "our-site.example/reviews/best");
});

test("змістовні параметри лишаються і сортуються", () => {
  assert.equal(normalizeUrl("https://a.com/x?ref=12&b=2&a=1&gclid=zzz"), "a.com/x?a=1&b=2&ref=12");
});

test("кирилиця в шляху: закодована = незакодована", () => {
  assert.equal(normalizeUrl("https://a.com/%D0%BE%D0%B3%D0%BB%D1%8F%D0%B4"), normalizeUrl("https://a.com/огляд"));
});

test("не-веб посилання і сміття ігноруються", () => {
  assert.equal(normalizeUrl("mailto:me@a.com"), null);
  assert.equal(normalizeUrl("javascript:void(0)"), null);
  assert.equal(normalizeUrl("не урл"), null);
  assert.equal(hostKey("https://WWW.a.com/x"), "a.com");
});

test("CSV: лапки, коми всередині, «;» з укр. Excel, BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\n"x, y","he said ""hi"""\n'), [["a", "b"], ["x, y", 'he said "hi"']]);
  assert.deepEqual(parseCsv("a;b\r\n1;2\r\n"), [["a", "b"], ["1", "2"]]);
  const rows = [["a;b", 'q"'], ["1", "2"]];
  assert.deepEqual(parseCsv(toCsv(rows, ";")), rows);
});
