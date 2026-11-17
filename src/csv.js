// Мінімальний CSV без залежностей: лапки, коми/переноси всередині лапок, BOM від Excel.
// Роздільник визначаємо сам: укр. Excel зберігає CSV через «;», Google Sheets — через «,».

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  return (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
}

export function parseCsv(text) {
  const s = text.replace(/^﻿/, "");
  const delim = detectDelimiter(s);
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); rows.push(row);
      row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function toCsv(rows, delim = ",") {
  const esc = (v) => {
    const s = String(v ?? "");
    return /["\r\n]/.test(s) || s.includes(delim) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(delim)).join("\r\n") + "\r\n";
}
