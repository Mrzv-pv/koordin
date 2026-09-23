#!/usr/bin/env node
/**
 * Применение правок фактчекинга к src/content.js.
 *
 * Правка приходит как {id, field, to}: field — это "lead", "caveat",
 * "points[2]" или "next[0]". Менять объект и переписывать файл целиком
 * нельзя: content.js написан руками, в нём комментарии и свой перенос
 * строк, а сериализация всё это сотрёт. Поэтому правим текст точечно —
 * находим нужный строковый литерал внутри блока записи и заменяем его.
 *
 *   node tools/apply-fixes.mjs fixes.json           — показать, что изменится
 *   node tools/apply-fixes.mjs fixes.json --write   — записать
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [file, ...flags] = process.argv.slice(2);
const write = flags.includes('--write');
if (!file) { console.error('нужен файл с правками'); process.exit(1); }

const P = new URL('../src/content.js', import.meta.url).pathname;
let src = readFileSync(P, 'utf8');
const fixes = JSON.parse(readFileSync(file, 'utf8'));

/* Границы записи: от её `id: "..."` до `id:` следующей. Внутри блока
   искать безопасно — одинаковые формулировки в разных ответах не мешают. */
const blockOf = (id) => {
  const start = src.indexOf(`    id: "${id}",`);
  if (start < 0) return null;
  const next = src.indexOf('\n    id: "', start + 10);
  return [start, next < 0 ? src.length : next];
};

/* Разбор массива строковых литералов с учётом экранирования: наивный
   split по запятой рвётся на любой запятой внутри текста, а их там полно. */
const literals = (arr) => {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    if (arr[i] !== '"') { i += 1; continue; }
    const s = i;
    i += 1;
    while (i < arr.length && arr[i] !== '"') i += arr[i] === '\\' ? 2 : 1;
    out.push([s, i + 1]);
    i += 1;
  }
  return out;
};

const enc = (s) => JSON.stringify(s);

let applied = 0;
const failed = [];

for (const f of fixes) {
  const b = blockOf(f.id);
  if (!b) { failed.push(`${f.id}: записи нет`); continue; }
  const block = src.slice(b[0], b[1]);
  const m = /^(lead|caveat|q)$|^(points|next|sources)\[(\d+)\]$/.exec(f.field.trim());
  if (!m) { failed.push(`${f.id}: не понял поле «${f.field}»`); continue; }

  let from, to;
  if (m[1]) {
    const key = new RegExp(`(^|\\s)${m[1]}: "`, 'm').exec(block);
    if (!key) { failed.push(`${f.id}: нет поля ${m[1]}`); continue; }
    const quote = key.index + key[0].length - 1;   // индекс открывающей кавычки
    const [s, e] = literals(block.slice(quote))[0];
    from = block.slice(quote + s, quote + e);
    to = enc(f.to);
  } else {
    const key = new RegExp(`${m[2]}: \\[`).exec(block);
    if (!key) { failed.push(`${f.id}: нет массива ${m[2]}`); continue; }
    const arrStart = key.index + key[0].length;
    const arrEnd = block.indexOf('],', arrStart);
    const arr = block.slice(arrStart, arrEnd);
    const lits = literals(arr);
    const idx = Number(m[3]);
    if (!lits[idx]) { failed.push(`${f.id}: в ${m[2]} нет элемента ${idx}`); continue; }
    from = arr.slice(lits[idx][0], lits[idx][1]);
    to = enc(f.to);
  }

  if (from === to) { failed.push(`${f.id} ${f.field}: текст уже такой`); continue; }
  const at = src.indexOf(from, b[0]);
  if (at < 0 || at >= b[1]) { failed.push(`${f.id} ${f.field}: не нашёл в блоке`); continue; }
  src = src.slice(0, at) + to + src.slice(at + from.length);
  applied += 1;
  if (!write) console.log(`\n${f.id} · ${f.field}\n  было:  ${from.slice(0, 110)}\n  стало: ${to.slice(0, 110)}`);
}

if (write) { writeFileSync(P, src); console.log(`Записано правок: ${applied}`); }
else console.log(`\nПрименится правок: ${applied}`);
if (failed.length) { console.log(`\nНе применились (${failed.length}):`); failed.forEach((x) => console.log('  ·', x)); }
