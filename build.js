#!/usr/bin/env node
/**
 * Сборка статического сайта из src/content.js.
 *
 * Зачем сборка вообще нужна на сайте из пяти страниц: чтобы шапка, подвал и
 * скрипты существовали в одном экземпляре. В предыдущей версии сайта они были
 * скопированы в каждый файл и успели разойтись между копиями.
 *
 *   node build.js            — собрать в dist/
 *   node build.js --serve    — собрать и поднять локальный сервер
 */

import { mkdir, writeFile, copyFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { site, categories, entries, byCategory } from './src/content.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'dist');

/* ────────────────────────────── утилиты ────────────────────────────── */

const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const attr = (s = '') => esc(s).replace(/\n/g, ' ');

const plural = (n, [one, few, many]) => {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return few;
  return many;
};

const ruDate = (iso) => {
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y}`;
};

/* ────────────────────────────── иконки ────────────────────────────── */

const ic = {
  passport: '<path d="M5 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><circle cx="11" cy="10" r="3"/><path d="M8.5 16h5"/>',
  health: '<path d="M12 21s-7-4.5-7-9.5A4.5 4.5 0 0 1 12 8a4.5 4.5 0 0 1 7 3.5c0 5-7 9.5-7 9.5Z"/><path d="M12 11v4M10 13h4"/>',
  education: '<path d="M3 8.5 12 4l9 4.5-9 4.5-9-4.5Z"/><path d="M7 11v4.5c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5V11"/>',
  scales: '<path d="M12 4v16M7 20h10"/><path d="M12 7 5 9l-2 5a3.5 3.5 0 0 0 7 0L8 9"/><path d="m12 7 7 2 2 5a3.5 3.5 0 0 1-7 0l2-5"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M3 12h18"/>',
  stamp: '<path d="M9 3h6a2 2 0 0 1 2 2c0 2-1.5 3-1.5 5h-7C8.5 8 7 7 7 5a2 2 0 0 1 2-2Z"/><rect x="4" y="14" width="16" height="3" rx="1"/><path d="M5 20h14"/>',
  home: '<path d="m4 10 8-6 8 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-9Z"/><path d="M10 20v-6h4v6"/>',
  alert: '<path d="M12 3 2.5 19.5h19L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  telegram: '<path d="M21 4 3 11l5 2 2 6 3-4 5 4 3-15Z"/><path d="m8 13 9-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
};

const icon = (name, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[name] || ''}</svg>`;

/* ────────────────────────────── каркас ────────────────────────────── */

const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1f5d4c"/><path d="M16 7v18M11 25h10" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M16 10 9 12l-2 5a3.4 3.4 0 0 0 6.8 0l-2-5M16 10l7 2 2 5a3.4 3.4 0 0 1-6.8 0l2-5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg>`
  );

const nav = (current) => {
  const links = [
    ['wiki.html', 'Библиотека вопросов'],
    ['about.html', 'О проекте'],
    ['contacts.html', 'Контакты'],
  ];
  return links
    .map(([href, label]) =>
      `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${esc(label)}</a>`
    )
    .join('\n          ');
};

const layout = ({ title, description, current, canonical, body, bodyClass = '' }) => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}">
<link rel="canonical" href="${site.url}/${canonical}">
<link rel="icon" href="${FAVICON}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(site.name)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${site.url}/${canonical}">
<meta property="og:locale" content="ru_RU">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap">
<link rel="stylesheet" href="assets/styles.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">Перейти к содержимому</a>

<header class="site-header">
  <div class="shell site-header__row">
    <a class="brand" href="index.html">
      <span class="brand__mark" aria-hidden="true">П</span>
      <span class="brand__text">${esc(site.name)}<small>${esc(site.tagline)}</small></span>
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Открыть меню">${icon('menu')}</button>
    <nav class="nav" id="site-nav" aria-label="Основная навигация">
      ${nav(current)}
    </nav>
    <button class="theme-toggle" type="button" aria-label="Переключить тему">
      <span class="sun">${icon('sun', 18)}</span><span class="moon">${icon('moon', 18)}</span>
    </button>
  </div>
</header>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="shell">
    <div class="site-footer__cols">
      <div>
        <h3>Разделы</h3>
        <ul>
          ${categories
            .slice(0, 5)
            .map((c) => `<li><a href="wiki.html#${c.id}">${esc(c.title)}</a></li>`)
            .join('\n          ')}
        </ul>
      </div>
      <div>
        <h3>Сайт</h3>
        <ul>
          <li><a href="wiki.html">Библиотека вопросов</a></li>
          <li><a href="about.html">О проекте</a></li>
          <li><a href="contacts.html">Контакты</a></li>
        </ul>
      </div>
      <div>
        <h3>Связаться</h3>
        <ul>
          <li><a href="mailto:${site.email}">${esc(site.email)}</a></li>
          <li><a href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться на консультацию</a></li>
        </ul>
      </div>
      <div>
        <h3>Адрес</h3>
        <address>${esc(site.address)}</address>
      </div>
    </div>
    <div class="site-footer__base">
      <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
      <span>Обновлено ${ruDate(site.updated)}</span>
      <span>${entries.length} ${plural(entries.length, ['вопрос', 'вопроса', 'вопросов'])} в библиотеке</span>
    </div>
  </div>
</footer>

<script src="assets/site.js" defer></script>
</body>
</html>
`;

/* ────────────────────────────── блоки ────────────────────────────── */

const disclaimerBlock = () => `
      <div class="disclaimer">
        ${icon('info', 18)}
        <p style="margin:0"><b>Это справочная информация, а не юридическая консультация.</b> ${esc(
          site.disclaimer.split('. ').slice(1).join('. ')
        )}</p>
      </div>`;

const urgentStrip = () => `
      <div class="urgent-strip">
        <span class="urgent-strip__label">${icon('alert', 18)} Срочная помощь</span>
        <span class="urgent-strip__nums">
          <span><b>112</b> — скорая, пожарные, спасатели</span>
          <span><b>113</b> — полиция</span>
        </span>
        <a href="wiki.html#emergency">Что делать в кризисной ситуации →</a>
      </div>`;

const entryHtml = (e) => {
  // Поисковый индекс намеренно НЕ дублируется в data-атрибут: это удваивало
  // вес страницы (425 КБ против 285 КБ). Строку для поиска site.js собирает
  // из уже отрисованного текста вопроса, ответа и терминов при загрузке.
  const terms = (e.terms || []).length
    ? `\n            <div class="entry__meta">${e.terms
        .map((t) => `<span class="term">${esc(t)}</span>`)
        .join('')}</div>`
    : '';

  const caveat = e.caveat
    ? `\n            <div class="caveat">${icon('info', 17)}<p style="margin:0">${esc(e.caveat)}</p></div>`
    : '';

  const related = (e.related || []).length
    ? `\n            <p class="related"><span>Смотрите также:</span> ${e.related
        .map((id) => {
          const t = entries.find((x) => x.id === id);
          return t ? `<a href="#${t.id}">${esc(t.q)}</a>` : '';
        })
        .filter(Boolean)
        .join(', ')}</p>`
    : '';

  const sources = (e.sources || []).length
    ? `<span class="srcs">Источники: ${e.sources
        .map((u, i) => {
          let host = u;
          try { host = new URL(u).hostname.replace(/^www\./, ''); } catch (err) {}
          return `<a href="${attr(u)}" rel="noopener noreferrer" target="_blank">${esc(host)}</a>`;
        })
        .join(' ')}</span>`
    : '';

  return `
          <details class="entry${e.urgent ? ' is-urgent' : ''}" id="${e.id}">
            <summary><span class="q">${esc(e.q)}</span></summary>
            <div class="entry__body">
              <p class="entry__answer">${esc(e.a)}</p>${terms}${caveat}${related}
              <div class="entry__foot">
                <span class="checked${e.confidence === 'partly-verified' ? ' is-partial' : ''}">${
                  e.confidence === 'partly-verified'
                    ? `Сверено частично · ${ruDate(e.checked)}`
                    : `Проверено ${ruDate(e.checked)}`
                }</span>
                ${e.volatile ? '<span class="volatile">Сумма или ставка — меняется ежегодно</span>' : ''}
                ${sources}
                <button class="copy-link" type="button" data-id="${e.id}">Ссылка на вопрос</button>
              </div>
            </div>
          </details>`;
};

/* ────────────────────────────── страницы ────────────────────────────── */

const pageIndex = () => {
  const body = `
  <section class="hero">
    <div class="shell hero__inner">
      <span class="hero__eyebrow">${icon('scales', 15)} Словения · для граждан России</span>
      <h1>Библиотека ответов на юридические вопросы</h1>
      <p class="lead">Здесь собрано то, что приходится выяснять каждому, кто живёт в Словении по виду на жительство: как устроено медицинское страхование, что делать при потере работы, как признать диплом, куда идти со спором и на какую бесплатную помощь вы имеете право.</p>
      <form class="search" action="wiki.html" method="get" role="search">
        <span class="search__icon">${icon('search', 19)}</span>
        <label class="skip" for="home-search">Поиск по библиотеке</label>
        <input id="home-search" name="q" type="search" placeholder="Например: депозит, диплом, личный врач, ВНЖ" autocomplete="off">
      </form>
    </div>
  </section>

  <section class="section">
    <div class="shell">
      ${urgentStrip()}
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="shell">
      <div class="section__head">
        <h2>Разделы библиотеки</h2>
        <p>${entries.length} ${plural(entries.length, ['вопрос', 'вопроса', 'вопросов'])} с указанием органа, куда обращаться, и даты последней проверки факта.</p>
      </div>
      <div class="cat-grid">
        ${categories
          .map((c) => {
            const n = byCategory(c.id).length;
            return `<a class="cat-card" href="wiki.html#${c.id}">
          <span class="cat-card__top"><span class="cat-card__icon">${icon(c.icon, 19)}</span><h3>${esc(c.title)}</h3></span>
          <p>${esc(c.blurb)}</p>
          <span class="cat-card__count">${n} ${plural(n, ['вопрос', 'вопроса', 'вопросов'])}</span>
        </a>`;
          })
          .join('\n        ')}
      </div>
    </div>
  </section>

  <section class="section" style="padding-top:0">
    <div class="shell">
      <div class="section__head">
        <h2>Нужен разбор вашей ситуации</h2>
        <p>Библиотека отвечает на типовые вопросы. Когда дело касается конкретных документов и сроков, лучше поговорить.</p>
      </div>
      <div class="contact-grid">
        <div class="contact-card">
          <span class="contact-card__icon">${icon('calendar', 19)}</span>
          <h3>Онлайн-консультация</h3>
          <p>Выберите удобное время в календаре — встреча пройдёт по видеосвязи.</p>
          <div class="btn-row"><a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться</a></div>
        </div>
        <div class="contact-card">
          <span class="contact-card__icon">${icon('mail', 19)}</span>
          <h3>Письмо</h3>
          <p>Опишите ситуацию и приложите документы — так разбор будет предметнее.</p>
          <a class="value" href="mailto:${site.email}">${esc(site.email)}</a>
        </div>
        <div class="contact-card">
          <span class="contact-card__icon">${icon('pin', 19)}</span>
          <h3>Адрес</h3>
          <p>Приём по предварительной договорённости.</p>
          <span class="value">${esc(site.address)}</span>
        </div>
      </div>
      ${disclaimerBlock()}
    </div>
  </section>
`;
  return layout({
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    current: 'index.html',
    canonical: '',
    body,
  });
};

const pageWiki = () => {
  const blocks = categories
    .map((c) => {
      const items = byCategory(c.id);
      return `
        <section class="cat-block" id="${c.id}" aria-labelledby="h-${c.id}">
          <div class="cat-block__head">
            <h2 id="h-${c.id}">${esc(c.title)}</h2>
            <span class="n">${items.length} ${plural(items.length, ['вопрос', 'вопроса', 'вопросов'])}</span>
          </div>
          <p class="cat-block__blurb">${esc(c.blurb)}</p>
          ${items.map(entryHtml).join('\n')}
        </section>`;
    })
    .join('\n');

  const body = `
  <div class="shell wiki">
    <aside class="sidebar">
      <h2>Разделы</h2>
      <nav aria-label="Разделы библиотеки">
        <ul>
          ${categories
            .map(
              (c) =>
                `<li><a href="#${c.id}">${esc(c.short)}<span class="n">${byCategory(c.id).length}</span></a></li>`
            )
            .join('\n          ')}
        </ul>
      </nav>
    </aside>

    <div class="wiki__main">
      <div class="wiki__searchbar">
        <div class="search">
          <span class="search__icon">${icon('search', 19)}</span>
          <label class="skip" for="wiki-search">Поиск по библиотеке</label>
          <input id="wiki-search" type="search" placeholder="Поиск по ${entries.length} вопросам — нажмите «/»" autocomplete="off">
          <button class="search__clear" type="button" aria-label="Очистить поиск" hidden>${icon('close', 17)}</button>
        </div>
        <p class="wiki__status" id="wiki-status" role="status" aria-live="polite"></p>
      </div>

      ${blocks}

      <div class="no-results" id="wiki-empty" hidden>
        <strong>Ничего не нашлось</strong>
        <p>Попробуйте другое слово или напишите нам — <a href="mailto:${site.email}">${esc(site.email)}</a>. Вопросы читателей пополняют библиотеку.</p>
      </div>

      ${disclaimerBlock()}
    </div>
  </div>
`;
  return layout({
    title: `Библиотека вопросов — ${site.name}`,
    description: `${entries.length} ответов на юридические и бытовые вопросы для россиян с ВНЖ в Словении: ${categories.map((c) => c.short.toLowerCase()).join(', ')}.`,
    current: 'wiki.html',
    canonical: 'wiki.html',
    body,
  });
};

const pageAbout = () => {
  const body = `
  <div class="shell prose">
    <h1>О проекте</h1>
    <p>Это справочник для граждан России, постоянно живущих в Словении. Он собран из вопросов, которые люди задают снова и снова: как работает медицинская страховка, что будет со статусом при потере работы, как записать ребёнка в школу, куда идти со спором об аренде и на какую помощь можно рассчитывать, когда денег на адвоката нет.</p>

    <h2>Как устроены ответы</h2>
    <p>Каждый ответ называет конкретное учреждение, в которое нужно обратиться, и словенский термин, который вы увидите на бланке, — потому что половина трудностей начинается там, где человек не знает, как называется то, что он ищет.</p>
    <p>У каждого ответа стоит <strong>дата проверки</strong>. Суммы и ставки, которые пересматриваются ежегодно, дополнительно помечены — им особенно стоит не верить на слово через год после указанной даты. Там, где ответ зависит от вашего конкретного статуса, стоит отдельная пометка: обобщение в таких местах вредит больше, чем помогает.</p>
    <p>Ключевые числовые факты — размеры взносов, налоговые ступени, имущественные пороги — сверены с первоисточниками: ZZZS, FURS, порталом eUprava, официальным вестником Uradni list. Ссылки на источники стоят прямо под ответом.</p>

    <h2>Чего здесь нет</h2>
    <p>Здесь нет индивидуальных консультаций. Справочник описывает, как устроено правило, но не может учесть обстоятельства вашего дела, а в миграционных и семейных вопросах именно обстоятельства определяют исход.</p>
    <p>Здесь также нет советов, как обойти требование или ускорить процедуру в обход порядка. Цена такой ошибки для человека с видом на жительство несопоставима с выигрышем.</p>

    <h2>Если вы нашли неточность</h2>
    <p>Законы меняются, и часть информации устаревает молча. Если вы столкнулись с тем, что на практике всё иначе, напишите на <a href="mailto:${site.email}">${esc(site.email)}</a> — это самый полезный вид обратной связи. Особенно ценны письма со ссылкой на первоисточник.</p>

    ${disclaimerBlock()}
  </div>
`;
  return layout({
    title: `О проекте — ${site.name}`,
    description: 'Как устроен справочник, откуда берутся факты, как отмечается их актуальность и чего в справочнике сознательно нет.',
    current: 'about.html',
    canonical: 'about.html',
    body,
  });
};

const pageContacts = () => {
  const mapQ = encodeURIComponent(site.addressMapQuery);
  const body = `
  <div class="shell" style="padding-block:44px 72px">
    <div class="section__head">
      <h1 style="font-size:clamp(28px,4.6vw,38px);line-height:1.15;letter-spacing:-.025em;font-weight:600;margin:0 0 10px">Контакты</h1>
      <p>Напишите письмо или сразу выберите время для разговора. Для разбора ситуации почта удобнее: можно приложить документы.</p>
    </div>

    <div class="contact-grid" style="margin-bottom:14px">
      <div class="contact-card">
        <span class="contact-card__icon">${icon('calendar', 19)}</span>
        <h3>Онлайн-консультация</h3>
        <p>Свободные слоты видны в календаре. Встреча проходит по видеосвязи.</p>
        <div class="btn-row"><a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Выбрать время</a></div>
      </div>

      <div class="contact-card">
        <span class="contact-card__icon">${icon('mail', 19)}</span>
        <h3>Электронная почта</h3>
        <p>Опишите ситуацию, укажите ваш статус в Словении и приложите сканы документов, если они есть.</p>
        <a class="value" href="mailto:${site.email}">${esc(site.email)}</a>
      </div>

      <div class="contact-card">
        <span class="contact-card__icon">${icon('telegram', 19)}</span>
        <h3>Telegram-бот</h3>
        <p>Быстрые вопросы и навигация по справочнику.</p>
        <a class="value" href="${site.telegram}" rel="noopener noreferrer" target="_blank">@SloveniaLegal_bot</a>
      </div>

      <div class="contact-card">
        <span class="contact-card__icon">${icon('pin', 19)}</span>
        <h3>Адрес</h3>
        <p>Приём по предварительной договорённости — заранее согласуйте время по почте.</p>
        <a class="value" href="https://www.openstreetmap.org/search?query=${mapQ}" rel="noopener noreferrer" target="_blank">${esc(site.address)}</a>
      </div>
    </div>

    <div class="disclaimer">
      ${icon('info', 18)}
      <p style="margin:0"><b>Про сроки.</b> Если у вас на руках решение государственного органа, которое вы хотите оспорить, напишите сразу и укажите дату его вручения: сроки обжалования в Словении короткие и считаются днями, а не месяцами.</p>
    </div>
  </div>
`;
  return layout({
    title: `Контакты — ${site.name}`,
    description: `Связаться: ${site.email}, запись на онлайн-консультацию, адрес ${site.address}.`,
    current: 'contacts.html',
    canonical: 'contacts.html',
    body,
  });
};

const page404 = () => {
  const body = `
  <div class="shell prose" style="padding-block:72px">
    <h1>Такой страницы нет</h1>
    <p>Возможно, ссылка устарела или в адресе опечатка. Вот куда можно пойти дальше:</p>
    <ul>
      <li><a href="wiki.html">Библиотека вопросов</a> — поиск по всем ${entries.length} ответам</li>
      <li><a href="index.html">Главная страница</a></li>
      <li><a href="contacts.html">Контакты</a></li>
    </ul>
    <p>Если вы пришли по ссылке с другого сайта и она не работает, напишите на <a href="mailto:${site.email}">${esc(site.email)}</a> — поправим.</p>
  </div>
`;
  return layout({
    title: `Страница не найдена — ${site.name}`,
    description: 'Страница не найдена.',
    current: '',
    canonical: '404.html',
    body,
  });
};

const sitemap = () => {
  const urls = ['', 'wiki.html', 'about.html', 'contacts.html'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) => `  <url>
    <loc>${site.url}/${u}</loc>
    <lastmod>${site.updated}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>
`;
};

const robots = () => `User-agent: *
Allow: /

Sitemap: ${site.url}/sitemap.xml
`;

/** Разметка Schema.org: у справочника из вопросов и ответов она даёт реальную
 *  видимость в поиске — именно по тем запросам, ради которых он и написан. */
const structuredData = () =>
  JSON.stringify(
    {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': `${site.url}/#org`,
          name: site.name,
          url: site.url,
          email: site.email,
          address: {
            '@type': 'PostalAddress',
            streetAddress: 'C. na Brdo 85',
            postalCode: '1000',
            addressLocality: 'Ljubljana',
            addressCountry: 'SI',
          },
        },
        {
          '@type': 'FAQPage',
          '@id': `${site.url}/wiki.html#faq`,
          inLanguage: 'ru',
          mainEntity: entries.map((e) => ({
            '@type': 'Question',
            name: e.q,
            acceptedAnswer: { '@type': 'Answer', text: e.a },
          })),
        },
      ],
    },
    null,
    1
  );

const vercelJson = () =>
  JSON.stringify(
    {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      cleanUrls: true,
      trailingSlash: false,
      headers: [
        {
          source: '/(.*)',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(), interest-cohort=()' },
            {
              key: 'Content-Security-Policy',
              value: [
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' https://fonts.googleapis.com",
                "font-src https://fonts.gstatic.com",
                "img-src 'self' data:",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self'",
              ].join('; '),
            },
          ],
        },
        {
          source: '/assets/(.*)',
          headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
        },
      ],
    },
    null,
    2
  );

/* ────────────────────────────── запуск ────────────────────────────── */

async function build() {
  if (existsSync(OUT)) await rm(OUT, { recursive: true });
  await mkdir(join(OUT, 'assets'), { recursive: true });

  // JSON-LD вклеиваем в wiki.html перед </head>
  const wikiHtml = pageWiki().replace(
    '</head>',
    `<script type="application/ld+json">${structuredData()}</script>\n</head>`
  );

  const files = [
    ['index.html', pageIndex()],
    ['wiki.html', wikiHtml],
    ['about.html', pageAbout()],
    ['contacts.html', pageContacts()],
    ['404.html', page404()],
    ['sitemap.xml', sitemap()],
    ['robots.txt', robots()],
    ['vercel.json', vercelJson()],
  ];

  for (const [name, content] of files) {
    await writeFile(join(OUT, name), content, 'utf8');
  }

  for (const asset of await readdir(join(__dirname, 'src', 'assets'))) {
    await copyFile(join(__dirname, 'src', 'assets', asset), join(OUT, 'assets', asset));
  }

  const counts = categories.map((c) => `${c.short}: ${byCategory(c.id).length}`).join(', ');
  console.log(`✓ Собрано в dist/`);
  console.log(`  страниц: ${files.filter(([n]) => n.endsWith('.html')).length}, вопросов: ${entries.length}`);
  console.log(`  ${counts}`);

  // простая проверка целостности: дубли id и битые внутренние ссылки
  const ids = entries.map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) console.warn(`  ⚠ повторяющиеся id: ${[...new Set(dupes)].join(', ')}`);

  const badRelated = entries.flatMap((e) =>
    (e.related || []).filter((r) => !ids.includes(r)).map((r) => `${e.id} → ${r}`)
  );
  if (badRelated.length) console.warn(`  ⚠ ссылки в related ведут в никуда: ${badRelated.join(', ')}`);

  const badCats = entries.filter((e) => !categories.some((c) => c.id === e.cat));
  if (badCats.length) console.warn(`  ⚠ неизвестная категория: ${badCats.map((e) => e.id).join(', ')}`);

  if (!dupes.length && !badRelated.length && !badCats.length) console.log('  ✓ проверка ссылок и категорий пройдена');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

async function serve(port = 4321) {
  createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    if (!extname(p)) p += '.html';
    try {
      const data = await readFile(join(OUT, p));
      res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      const notFound = await readFile(join(OUT, '404.html')).catch(() => 'Not found');
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(notFound);
    }
  }).listen(port, () => console.log(`\n→ http://localhost:${port}`));
}

await build();
if (process.argv.includes('--serve')) await serve();
