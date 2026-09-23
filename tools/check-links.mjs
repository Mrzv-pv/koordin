#!/usr/bin/env node
/**
 * Проверка всех ссылок на источники из src/content.js.
 *
 * Справочник держится на том, что каждое утверждение можно проверить по
 * первоисточнику. Ссылка, которая перестала открываться, обесценивает ответ,
 * а заметить это вручную на сотне ссылок невозможно.
 *
 *   node tools/check-links.mjs           — проверить все
 *   node tools/check-links.mjs --slow    — последовательно, если сайт режет частоту
 */

import { site, entries } from '../src/content.js';

const slow = process.argv.includes('--slow');

const all = [];
for (const e of entries) {
  for (const u of e.sources || []) all.push({ id: e.id, url: u });
}

const uniq = [...new Map(all.map((x) => [x.url, x])).values()];
console.log(`Ссылок всего: ${all.length}, уникальных: ${uniq.length}\n`);

/* Государственные сайты часто отбивают запросы без браузерного заголовка:
   без него gov.si отдаёт таймаут, хотя страница жива. */
const HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  'accept-language': 'sl,ru;q=0.9,en;q=0.8',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(url, method) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    return await fetch(url, { method, redirect: 'follow', signal: ctrl.signal, headers: HEADERS });
  } finally {
    clearTimeout(t);
  }
}

/* Мягкий 404: сайт отдаёт 200 и страницу «не найдено». Так вело себя
   консульство РФ в Словении — ссылка числилась рабочей, а вела в никуда.
   По одному коду ответа это не поймать, поэтому смотрим заголовок страницы. */
const NOT_FOUND = /(страниц\w* не найден|не найдена|page not found|error 404|napaka 404|stran ne obstaja|stran ni bila najdena|ni mogoče najti|ne najdemo)/i;

const titleOf = (html) => {
  const t = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const h = /<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i.exec(html);
  const strip = (x) => (x ? x[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
  return `${strip(t)} ${strip(h)}`.trim();
};

/* Ссылка на конкретную страницу, которую молча увели выше по дереву, тоже
   мертва: читатель не найдёт того, ради чего шёл. Ловим и увод на главную,
   и увод в родительский раздел — так страница СФР про акт о личной явке
   отдавала общий раздел «проживающим за рубежом», и по коду ответа это
   было не видно. Проверяем, что конечный путь — строгий предок исходного. */
const droppedUp = (asked, landed) => {
  try {
    const a = new URL(asked), b = new URL(landed);
    if (a.hostname !== b.hostname) return false;
    const strip = (x) => x.pathname.replace(/\/+$/, '');
    const from = strip(a), to = strip(b);
    if (from.length <= 1 || to.length >= from.length) return false;
    if (b.search) return false;
    return to === '' || from.startsWith(`${to}/`);
  } catch { return false; }
};

/* gov.si режет частоту: при параллельных запросах отдаёт 503 и таймауты,
   хотя страницы живы. Поэтому мало потоков и повтор с паузой — иначе
   проверялка поднимает ложную тревогу и ей перестают верить. */
async function probe({ id, url }, attempt = 1) {
  try {
    const r = await once(url, 'GET');
    if ([429, 503].includes(r.status) && attempt < 3) {
      await sleep(3000 * attempt);
      return probe({ id, url }, attempt + 1);
    }
    if (!r.ok) return { id, url, status: r.status, ok: false };

    const type = r.headers.get('content-type') || '';
    if (!/html/i.test(type)) return { id, url, status: r.status, ok: true };

    const html = (await r.text()).slice(0, 200000);
    const head = titleOf(html);
    if (NOT_FOUND.test(head)) {
      return { id, url, status: r.status, ok: false, error: `мягкий 404: «${head.slice(0, 60)}»` };
    }
    if (droppedUp(url, r.url)) {
      return { id, url, status: r.status, ok: false, error: `увело выше: ${r.url}` };
    }
    return { id, url, status: r.status, ok: true };
  } catch (err) {
    if (attempt < 3) {
      await sleep(3000 * attempt);
      return probe({ id, url }, attempt + 1);
    }
    return { id, url, status: 0, ok: false, error: err.name === 'AbortError' ? 'таймаут' : err.message.slice(0, 60) };
  }
}

const results = [];
if (slow) {
  for (const x of uniq) results.push(await probe(x));
} else {
  const CHUNK = 3;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    results.push(...(await Promise.all(uniq.slice(i, i + CHUNK).map((x) => probe(x)))));
    await sleep(400);
  }
}

const bad = results.filter((r) => !r.ok);
const byHost = {};
for (const r of results) {
  let h = r.url;
  try { h = new URL(r.url).hostname.replace(/^www\./, ''); } catch {}
  byHost[h] = (byHost[h] || 0) + 1;
}

console.log('Источники по доменам:');
Object.entries(byHost).sort((a, b) => b[1] - a[1]).forEach(([h, n]) => console.log(`  ${String(n).padStart(3)}  ${h}`));

if (bad.length) {
  console.log(`\n✗ Не открылись: ${bad.length}`);
  for (const b of bad) console.log(`  [${b.status || b.error}] ${b.id}\n       ${b.url}`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ Все ${uniq.length} ссылок открываются`);
}
