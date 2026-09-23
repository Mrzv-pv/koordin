#!/usr/bin/env node
/**
 * Добавляет новые записи в src/content.js из JSON-файла.
 *
 * Проверяет перед вставкой: формат id, уникальность, существование раздела,
 * непустые обязательные поля и наличие хотя бы одного источника. Запись,
 * не прошедшую проверку, не вставляет и называет причину — молча портить
 * справочник нельзя.
 *
 *   node tools/merge-entries.mjs /путь/к/entries.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, '..', 'src', 'content.js');

const src = process.argv[2];
if (!src) { console.error('Укажите путь к JSON с записями'); process.exit(1); }

const { entries, categories } = await import('../src/content.js');
const incoming = JSON.parse(readFileSync(src, 'utf8'));

const known = new Set(entries.map((e) => e.id));
const cats = new Set(categories.map((c) => c.id));
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const good = [];
const bad = [];

for (const e of incoming) {
  const why = [];
  if (!e.id || !SLUG.test(e.id)) why.push('id не слаг: ' + e.id);
  if (known.has(e.id)) why.push('id уже занят');
  if (!cats.has(e.cat)) why.push('нет такого раздела: ' + e.cat);
  if (!e.q || !e.lead) why.push('пустой вопрос или lead');
  if (!(e.sources || []).length) why.push('нет источников');
  if (!e.checked) e.checked = '2026-09-23';
  if (why.length) { bad.push({ id: e.id, why }); continue; }
  known.add(e.id);
  good.push(e);
}

const j = (v) => JSON.stringify(v);
const fmt = (e) => {
  const L = ['  {', `    id: ${j(e.id)},`, `    cat: ${j(e.cat)},`, `    q: ${j(e.q)},`, `    lead: ${j(e.lead)},`];
  if (e.points?.length) L.push(`    points: ${j(e.points)},`);
  if (e.next?.length) L.push(`    next: ${j(e.next)},`);
  L.push(`    terms: ${j(e.terms || [])},`);
  L.push(`    checked: ${j(e.checked)},`);
  L.push(`    confidence: ${j(e.confidence || 'partly-verified')},`);
  if (e.volatile) L.push('    volatile: true,');
  if (e.urgent) L.push('    urgent: true,');
  if (e.sources?.length) L.push(`    sources: ${j(e.sources)},`);
  if (e.caveat) L.push(`    caveat: ${j(e.caveat)},`);
  if (e.related?.length) L.push(`    related: ${j(e.related)},`);
  L.push('  },');
  return L.join('\n');
};

const text = readFileSync(FILE, 'utf8');
const end = text.lastIndexOf('\n];');
if (end < 0) { console.error('не нашёл конец массива entries'); process.exit(1); }

const out = text.slice(0, end) + '\n' + good.map(fmt).join('\n') + text.slice(end);
writeFileSync(FILE, out, 'utf8');

console.log(`Добавлено: ${good.length}`);
if (bad.length) {
  console.log(`Отклонено: ${bad.length}`);
  for (const b of bad) console.log(`  ${b.id}: ${b.why.join('; ')}`);
}
