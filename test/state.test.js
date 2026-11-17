import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRun } from "../src/state.js";
import { formatAlerts, chunk, moneyAtRisk } from "../src/alerts.js";

const link = { donor_url: "https://donor.example/p", target_url: "https://our.example/x", outreacher: "Оля", price: "$120" };
const at = (status) => [{ ...link, status, notes: [] }];

function sequence(statuses, opts = { confirmRuns: 2, unknownAlertAfter: 3 }) {
  let state = {};
  return statuses.map((s) => {
    const r = applyRun(state, at(s), opts);
    state = r.state;
    return r.alerts.map((a) => `${a.type}:${a.result.status}`).join(",");
  });
}

test("новий живий лінк — тиша", () => {
  assert.deepEqual(sequence(["OK", "OK"]), ["", ""]);
});

test("проблема алертиться лише після 2 запусків поспіль і один раз", () => {
  assert.deepEqual(sequence(["OK", "MISSING", "MISSING", "MISSING"]), ["", "", "problem:MISSING", ""]);
});

test("разовий глюк не алертиться", () => {
  assert.deepEqual(sequence(["OK", "MISSING", "OK", "OK"]), ["", "", "", ""]);
});

test("відновлення теж повідомляємо", () => {
  assert.deepEqual(sequence(["OK", "NOFOLLOW", "NOFOLLOW", "OK", "OK"]), ["", "", "problem:NOFOLLOW", "", "recovered:OK"]);
});

test("BLOCKED/ERROR не ламають відомий статус і не плутаються з «лінк зник»", () => {
  assert.deepEqual(sequence(["OK", "BLOCKED", "ERROR", "BLOCKED", "BLOCKED", "OK"]), ["", "", "", "unknown:BLOCKED", "", ""]);
});

test("лінк, якого більше нема у файлі, зникає зі стану", () => {
  const { state } = applyRun({ "old → key": { status: "OK" } }, at("OK"));
  assert.equal(Object.keys(state).length, 1);
  assert.ok(!state["old → key"]);
});

test("текст алерту: що сталось, хто аутрічер, ціна; довгий текст ріжеться під Telegram", () => {
  const text = formatAlerts([{ type: "problem", from: "OK", result: { ...link, status: "MISSING", notes: [] } }]);
  assert.match(text, /лінк зник/);
  assert.match(text, /Оля · ціна \$120/);
  const parts = chunk("рядок\n".repeat(2000), 4000);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 4000));
});

test("гроші під ризиком: одна валюта сумується, різні — ні", () => {
  assert.equal(moneyAtRisk([{ price: "$120" }, { price: "$80" }, { price: "" }]), "$200");
  assert.equal(moneyAtRisk([{ price: "1 500 грн" }, { price: "500 грн" }]), "2000 грн");
  assert.equal(moneyAtRisk([{ price: "$120" }, { price: "€80" }]), "");
});

test("в алерті найгірше першим", () => {
  const mk = (status) => ({ type: "problem", result: { ...link, status, notes: [] } });
  const text = formatAlerts([mk("ANCHOR_CHANGED"), mk("MISSING")]);
  assert.ok(text.indexOf("лінк зник") < text.indexOf("змінили анкор"));
});
