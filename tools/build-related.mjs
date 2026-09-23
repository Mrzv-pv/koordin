#!/usr/bin/env node
/**
 * Пересчёт поля `related` — «Смотрите также» под ответом.
 *
 * Связи считаются по совпадению лексики вопроса, краткого ответа, пунктов
 * и терминов, но вес каждого слова делится на его частоту по всей библиотеке.
 * Без этой поправки пары лепятся по словам «договор», «документ»,
 * «свидетельство», которые есть в половине ответов, и «признание диплома»
 * встаёт рядом с «домашним насилием».
 *
 *   node tools/build-related.mjs            — показать, что получится
 *   node tools/build-related.mjs --json     — выдать JSON с оценками
 *
 * Записывать в content.js скрипт не умеет намеренно: связи стоит глазами
 * просмотреть, а поставленные вручную — не затирать.
 */

import { entries } from '../src/content.js';

const STOP = new Set(('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно всю между это вопрос ответ нужно можно какие какое каких свой своего своих также если это эти этих такие нужны документы документ').split(' '));

const stem = (w) => (w.length > 6 ? w.slice(0, w.length - 3) : w.length > 4 ? w.slice(0, w.length - 2) : w);
const words = (s) => (s || '').toLowerCase().match(/[a-zа-яё]{3,}/g) || [];

const bag = (e) => {
  const m = new Map();
  const add = (list, w) => list.forEach((x) => { const k = stem(x); if (!STOP.has(x)) m.set(k, (m.get(k) || 0) + w); });
  add(words(e.q), 3);
  add(words(e.lead), 2);
  add((e.terms || []).flatMap((t) => words(typeof t === 'string' ? t : t.t + ' ' + t.d)), 4);
  add(words((e.points || []).join(' ')), 1);
  return m;
};

const hosts = (e) => new Set((e.sources || []).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }));

const B0 = new Map(entries.map((e) => [e.id, bag(e)]));

/* Без поправки на частотность связи лепятся по словам вроде «договор»,
   «документ» или «свидетельство», которые есть в половине ответов: так
   «признание диплома» оказывалось рядом с «домашним насилием». Редкое общее
   слово (enotno dovoljenje, nadomestilo) говорит о родстве куда больше
   частого, поэтому взвешиваем по обратной частоте документа. */
const df = new Map();
for (const m of B0.values()) for (const k of m.keys()) df.set(k, (df.get(k) || 0) + 1);
const N = entries.length;
const idf = (k) => Math.log(N / (1 + (df.get(k) || 0)));
const B = new Map([...B0].map(([id, m]) => {
  const w = new Map();
  for (const [k, v] of m) { const s = v * idf(k); if (s > 0) w.set(k, s); }
  return [id, w];
}));
const H = new Map(entries.map((e) => [e.id, hosts(e)]));
const norm = new Map(entries.map((e) => [e.id, Math.sqrt([...B.get(e.id).values()].reduce((s, v) => s + v * v, 0))]));

const score = (a, b) => {
  const ba = B.get(a.id), bb = B.get(b.id);
  let dot = 0;
  for (const [k, v] of ba) if (bb.has(k)) dot += v * bb.get(k);
  let s = dot / (norm.get(a.id) * norm.get(b.id) || 1);
  const sharedHosts = [...H.get(a.id)].filter((h) => H.get(b.id).has(h) && /gov\.si|zzzs|furs|ajpes|zpiz|ess\.gov|mid\.ru|kdmid/.test(h)).length;
  s += sharedHosts * 0.04;
  if (a.cat !== b.cat) s *= 1.15;          // связи между разделами ценнее
  if (b.urgent) s *= 1.1;
  return s;
};

/* Порог: ниже него связь скорее случайна, чем полезна. Лучше оставить
   ответ без «Смотрите также», чем отправить читателя не туда. */
const THRESHOLD = 0.22;
const MAX = 3;

const out = {};
for (const a of entries) {
  out[a.id] = entries
    .filter((b) => b.id !== a.id)
    .map((b) => ({ id: b.id, cat: b.cat, q: b.q, s: score(a, b) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, 4);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out));
} else {
  let linked = 0, links = 0;
  for (const e of entries) {
    const picks = out[e.id].filter((r) => r.s >= THRESHOLD).slice(0, MAX);
    if (!picks.length) continue;
    linked += 1;
    links += picks.length;
    console.log(`\n${e.id}`);
    for (const r of picks) console.log(`  ${r.s.toFixed(2)}  [${r.cat}] ${r.q.slice(0, 66)}`);
  }
  console.log(`\nСвязей: ${links} у ${linked} записей из ${entries.length} (порог ${THRESHOLD}).`);
}
