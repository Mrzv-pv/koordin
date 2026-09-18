#!/usr/bin/env node
/**
 * Сборка статического сайта из src/content.js.
 *
 * Зачем сборка на сайте из пяти страниц: чтобы шапка, подвал и <head>
 * существовали в одном экземпляре. В предыдущей версии сайта они были
 * скопированы в каждый файл и успели разойтись между копиями.
 *
 *   node build.js            — собрать в dist/
 *   node build.js --serve    — собрать и поднять локальный сервер
 */

import { mkdir, writeFile, cp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
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

const nQuestions = (n) => `${n} ${plural(n, ['вопрос', 'вопроса', 'вопросов'])}`;

const ruDate = (iso) => {
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y}`;
};

const pad2 = (n) => String(n).padStart(2, '0');

/* ────────────────────────────── иконки ──────────────────────────────
   Набор намеренно минимальный: иконки нужны только там, где они несут
   смысл (поиск, закрыть, предупреждение), а не как украшение к заголовкам. */

const ic = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};

const icon = (name, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic[name] || ''}</svg>`;

/* ────────────────────────────── каркас ────────────────────────────── */

const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#8c2f39"/><path d="M8 8h16M8 8v16M8 24h16" stroke="#f5f4f0" stroke-width="2.2" fill="none" stroke-linecap="square"/><path d="M13 16h8" stroke="#f5f4f0" stroke-width="2.2" stroke-linecap="square"/></svg>`
  );

const NAV_LINKS = [
  ['wiki.html', 'Библиотека'],
  ['about.html', 'О проекте'],
  ['contacts.html', 'Контакты'],
];

const layout = ({ title, description, current, canonical, body, head = '' }) => `<!DOCTYPE html>
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&family=Alegreya+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="assets/styles.css">
${head}</head>
<body>
<a class="skip" href="#main">Перейти к содержимому</a>

<header class="site-header">
  <div class="shell site-header__row">
    <a class="brand" href="index.html"><b>${esc(site.name)}</b><span>${esc(site.tagline)}</span></a>
    <button class="icon-btn nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Меню">${icon('menu')}</button>
    <nav class="nav" id="site-nav" aria-label="Основная навигация">
      ${NAV_LINKS.map(([href, label]) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('\n      ')}
    </nav>
    <a class="header-cta" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться</a>
    <button class="icon-btn theme-toggle" type="button" aria-label="Переключить тему"><span class="sun">${icon('sun', 17)}</span><span class="moon">${icon('moon', 17)}</span></button>
  </div>
</header>

<main id="main">
${body}
</main>

<footer class="site-footer">
  <div class="shell">
    <div class="site-footer__cols">
      <div>
        <h3>Разделы библиотеки</h3>
        <ul>
          ${categories.slice(0, 4).map((c) => `<li><a href="wiki.html#${c.id}">${esc(c.title)}</a></li>`).join('\n          ')}
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
        <h3>Консультация</h3>
        <ul>
          <li><a href="${site.calendly}" rel="noopener noreferrer" target="_blank">Выбрать время</a></li>
          <li><a href="mailto:${site.email}">${esc(site.email)}</a></li>
        </ul>
      </div>
      <div>
        <h3>Адрес</h3>
        <address>${esc(site.address)}<br>Приём по договорённости</address>
      </div>
    </div>
    <div class="site-footer__base">
      <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
      <span>Библиотека обновлена ${ruDate(site.updated)}</span>
      <span>${nQuestions(entries.length)}</span>
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
        ${icon('info', 17)}
        <p style="margin:0"><b>Справочная информация, а не индивидуальная консультация.</b> ${esc(
          site.disclaimer.split('. ').slice(1).join('. ')
        )}</p>
      </div>`;

const urgentBand = () => `
      <div class="urgent">
        <span class="urgent__l">Если помощь нужна прямо сейчас</span>
        <span class="urgent__n">
          <span><b>112</b>скорая, пожарные, спасатели</span>
          <span><b>113</b>полиция</span>
        </span>
        <a href="wiki.html#emergency">Что делать в кризисной ситуации ${icon('arrow', 15)}</a>
      </div>`;

const entryHtml = (e) => {
  // Поисковый индекс намеренно не дублируется в data-атрибут: это удваивало вес
  // страницы. site.js собирает строку для поиска из отрисованного текста.
  const terms = (e.terms || []).length
    ? `\n            <div class="entry__meta">${e.terms.map((t) => `<span class="term">${esc(t)}</span>`).join('')}</div>`
    : '';

  const caveat = e.caveat
    ? `\n            <div class="caveat">${icon('info', 16)}<p style="margin:0">${esc(e.caveat)}</p></div>`
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
        .map((u) => {
          let host = u;
          try { host = new URL(u).hostname.replace(/^www\./, ''); } catch { /* оставляем как есть */ }
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

/* ────────────────────────────── главная ────────────────────────────── */

const pageIndex = () => {
  const c = site.consultation;

  const body = `
  <section class="hero hero--photo">
    <div class="hero__bg" aria-hidden="true">
      <img src="assets/img/justice-1400.jpg" width="1400" height="933" alt="" fetchpriority="high" decoding="async">
    </div>
    <div class="shell hero__grid">
      <div>
        <p class="label">Словения · консультация на русском языке</p>
        <h1>Юридическая помощь тем, кто <em>живёт в Словении</em></h1>
        <p class="hero__lead">Онлайн-консультация: разбираем ваши документы, сроки и варианты — и вы уходите с понятным планом действий. А типовые вопросы уже разобраны в открытой библиотеке.</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться на консультацию</a>
          <a class="btn btn--outline" href="wiki.html">Открыть библиотеку ${icon('arrow', 17)}</a>
        </div>
        <dl class="hero__facts">
          <div><dt>Формат</dt><dd>${esc(c.format)}</dd></div>
          <div><dt>Язык</dt><dd>${esc(c.language)}</dd></div>
          <div><dt>В библиотеке</dt><dd>${nQuestions(entries.length)}</dd></div>
        </dl>
      </div>

      <div class="slip">
        <div class="slip__head"><b>Онлайн-консультация</b><span>запись</span></div>
        <div class="slip__body">
          <dl>
            ${c.slip.map((row) => `<div><dt>${esc(row[0])}</dt><dd>${esc(row[1])}</dd></div>`).join('\n            ')}
          </dl>
          <p class="slip__note">${esc(c.note)}</p>
        </div>
        <div class="slip__foot">
          <a class="btn btn--primary btn--block" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Выбрать время</a>
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="shell section">
      <div class="section__head">
        <h2>Как проходит консультация</h2>
        <p>Без лишних шагов: от письма до плана действий.</p>
      </div>
      <ol class="steps">
        ${c.steps
          .map(
            (s, i) => `<li>
          <span class="n">${pad2(i + 1)}</span>
          <h3>${esc(s[0])}</h3>
          <p>${esc(s[1])}</p>
        </li>`
          )
          .join('\n        ')}
      </ol>
    </div>
  </section>

  <section class="band band--tint">
    <div class="shell section">
      <div class="section__head">
        <h2>С чем обращаются</h2>
        <p>Прежде чем записываться, посмотрите библиотеку: возможно, ваш вопрос уже разобран.</p>
        <a class="more" href="wiki.html">Вся библиотека ${icon('arrow', 15)}</a>
      </div>
      <div class="index-list">
        ${categories
          .map((cat, i) => {
            const n = byCategory(cat.id).length;
            return `<a class="index-row" href="wiki.html#${cat.id}">
          <span class="index-row__n">${pad2(i + 1)}</span>
          <span class="index-row__title">${esc(cat.title)}</span>
          <span class="index-row__ex">${esc(cat.blurb)}</span>
          <span class="index-row__n2">${nQuestions(n)}</span>
        </a>`;
          })
          .join('\n        ')}
      </div>
    </div>
  </section>

  <section class="figure-band">
    <img src="assets/img/consult-1400.jpg" width="1400" height="884" alt="" loading="lazy" decoding="async">
    <div class="figure-band__overlay">
      <div class="shell">
        <p>Справочник открыт и бесплатен. Консультация нужна там, где важны <em>ваши</em> документы и сроки.</p>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="shell section">
      <div class="cols">
        <div>
          <div class="section__head"><h2>Что вы получите</h2></div>
          <ul class="checklist">
            ${c.outcomes.map((o) => `<li>${o}</li>`).join('\n            ')}
          </ul>
        </div>
        <div>
          <div class="section__head"><h2>Если на юриста нет денег</h2></div>
          <p style="margin:0 0 16px;color:var(--ink-2);font-size:16.5px;line-height:1.55">В Словении работает государственная программа бесплатной правовой помощи. Иностранцы с видом на жительство — временным или постоянным — имеют на неё право <b>наравне с гражданами</b>: она оплачивает адвоката, судебные расходы и работу переводчика.</p>
          <p style="margin:0 0 20px;color:var(--ink-2);font-size:16.5px;line-height:1.55">Условие — имущественный тест. Об этом стоит знать до того, как отказаться от защиты своих прав из-за денег.</p>
          <a class="btn btn--outline" href="wiki.html#bpp-kto-imeet-pravo">Условия и куда подавать ${icon('arrow', 17)}</a>
        </div>
      </div>
    </div>
  </section>

  <section class="band">
    <div class="shell">
      ${urgentBand()}
    </div>
  </section>

  <section>
    <div class="shell section">
      <div class="cols">
        <div>
          <div class="section__head"><h2>Написать до записи</h2></div>
          <p style="margin:0 0 20px;color:var(--ink-2);font-size:16.5px;line-height:1.55">Если у вас на руках решение государственного органа, напишите сразу и укажите дату вручения: сроки обжалования в Словении считаются днями, а не месяцами.</p>
          <dl class="contact-lines">
            <div><dt>Почта</dt><dd><a href="mailto:${site.email}">${esc(site.email)}</a></dd></div>
            <div><dt>Telegram</dt><dd><a href="${site.telegram}" rel="noopener noreferrer" target="_blank">@SloveniaLegal_bot</a></dd></div>
            <div><dt>Адрес</dt><dd>${esc(site.address)}</dd></div>
          </dl>
        </div>
        <div>
          <div class="section__head"><h2>Что приложить к письму</h2></div>
          <ul class="checklist">
            ${c.attach.map((o) => `<li>${o}</li>`).join('\n            ')}
          </ul>
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
    // герой — LCP-элемент, поэтому браузер узнаёт о картинке до разбора разметки
    head: '<link rel="preload" as="image" href="assets/img/justice-1400.jpg" fetchpriority="high">\n',
  });
};

/* ────────────────────────────── библиотека ────────────────────────────── */

const pageWiki = () => {
  const blocks = categories
    .map((c) => {
      const items = byCategory(c.id);
      return `
        <section class="cat-block" id="${c.id}" aria-labelledby="h-${c.id}">
          <div class="cat-block__head">
            <h2 id="h-${c.id}">${esc(c.title)}</h2>
            <span class="n">${nQuestions(items.length)}</span>
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
            .map((c) => `<li><a href="#${c.id}">${esc(c.short)}<span class="n">${byCategory(c.id).length}</span></a></li>`)
            .join('\n          ')}
        </ul>
      </nav>
    </aside>

    <div class="wiki__main">
      <div class="wiki__searchbar">
        <div class="search">
          <span class="search__icon">${icon('search', 18)}</span>
          <label class="skip" for="wiki-search">Поиск по библиотеке</label>
          <input id="wiki-search" type="search" placeholder="Поиск по ${entries.length} вопросам — нажмите «/»" autocomplete="off">
          <button class="search__clear" type="button" aria-label="Очистить поиск" hidden>${icon('close', 17)}</button>
        </div>
        <p class="wiki__status" id="wiki-status" role="status" aria-live="polite"></p>
      </div>

      ${blocks}

      <div class="no-results" id="wiki-empty" hidden>
        <strong>Ничего не нашлось</strong>
        <p style="margin:0">Попробуйте другое слово или напишите нам — <a href="mailto:${site.email}">${esc(site.email)}</a>. Вопросы читателей пополняют библиотеку.</p>
      </div>

      <div class="wiki-cta">
        <div>
          <h2>Ваш случай сложнее типового?</h2>
          <p>На консультации разберём ваши документы и сроки и скажем, что делать дальше.</p>
        </div>
        <a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться на консультацию</a>
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
    head: `<script type="application/ld+json">${structuredData()}</script>\n`,
  });
};

/* ────────────────────────────── прочие страницы ────────────────────────────── */

const pageAbout = () => {
  const body = `
  <div class="shell">
    <figure class="page-figure">
      <img src="assets/img/justice-800.jpg" width="800" height="533" alt="Бронзовая статуя Фемиды с весами" loading="lazy" decoding="async">
    </figure>
  </div>
  <div class="shell prose" style="padding-top:36px">
    <h1>О проекте</h1>
    <p>Это практика юридической помощи для граждан России, живущих в Словении, и открытый справочник при ней. Консультации ведутся на русском языке онлайн; справочник доступен всем и бесплатно.</p>

    <h2>Зачем справочник, если есть консультация</h2>
    <p>Значительная часть вопросов типовая: как прикрепиться к врачу, что происходит со статусом при потере работы, в какой срок обжаловать решение. На такие вопросы честнее ответить один раз и открыто, чем продавать ответ. Консультация нужна там, где важны обстоятельства вашего дела: конкретные документы, даты и сроки.</p>

    <h2>Как устроены ответы</h2>
    <p>Каждый ответ называет учреждение, в которое нужно обратиться, и словенский термин, который вы увидите на бланке, — половина трудностей начинается там, где человек не знает, как называется то, что он ищет.</p>
    <p>У каждого ответа стоит <strong>дата проверки</strong>. Суммы и ставки, пересматриваемые ежегодно, помечены отдельно — им не стоит верить на слово через год после указанной даты. Где ответ зависит от вашего статуса, стоит пометка: обобщение в таких местах вредит больше, чем помогает.</p>
    <p>Факты сверены с первоисточниками — ZZZS, FURS, порталом eUprava, текстами законов и официальным вестником Uradni list. Ссылки стоят прямо под ответом. Там, где сверена основная норма, но детали зависят от практики учреждения, ответ помечен как «сверено частично»: умалчивать об этом в справочнике, по которому люди принимают решения, нельзя.</p>

    <h2>Чего здесь нет</h2>
    <p>Здесь нет советов, как обойти требование или ускорить процедуру в обход порядка. Для человека с видом на жительство цена такой ошибки несопоставима с выигрышем.</p>
    <p>И здесь нет обещаний результата. Решение о виде на жительство или гражданстве принимает государственный орган, и выполнение формальных условий не делает его автоматическим.</p>

    <h2>Если вы нашли неточность</h2>
    <p>Законы меняются, и часть информации устаревает молча. Если на практике всё оказалось иначе, напишите на <a href="mailto:${site.email}">${esc(site.email)}</a> — это самый полезный вид обратной связи, особенно со ссылкой на первоисточник.</p>

    ${disclaimerBlock()}
  </div>
`;
  return layout({
    title: `О проекте — ${site.name}`,
    description: 'Практика юридической помощи для россиян в Словении и открытый справочник при ней: как устроены ответы, откуда факты и чего в справочнике сознательно нет.',
    current: 'about.html',
    canonical: 'about.html',
    body,
  });
};

const pageContacts = () => {
  const c = site.consultation;
  const mapQ = encodeURIComponent(site.addressMapQuery);
  const body = `
  <section class="hero">
    <div class="shell hero__grid">
      <div>
        <p class="label">Связаться</p>
        <h1>Запись на консультацию</h1>
        <p class="hero__lead">Выберите время в календаре или напишите письмо — для разбора ситуации почта удобнее: можно приложить документы.</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Выбрать время</a>
          <a class="btn btn--outline" href="mailto:${site.email}">Написать письмо</a>
        </div>
        <dl class="contact-lines" style="margin-top:32px">
          <div><dt>Почта</dt><dd><a href="mailto:${site.email}">${esc(site.email)}</a></dd></div>
          <div><dt>Telegram</dt><dd><a href="${site.telegram}" rel="noopener noreferrer" target="_blank">@SloveniaLegal_bot</a></dd></div>
          <div><dt>Адрес</dt><dd><a href="https://www.openstreetmap.org/search?query=${mapQ}" rel="noopener noreferrer" target="_blank">${esc(site.address)}</a><br><span style="color:var(--ink-3);font-size:15px">Приём по предварительной договорённости</span></dd></div>
        </dl>
      </div>

      <div class="slip">
        <div class="slip__head"><b>Онлайн-консультация</b><span>запись</span></div>
        <div class="slip__body">
          <dl>
            ${c.slip.map((row) => `<div><dt>${esc(row[0])}</dt><dd>${esc(row[1])}</dd></div>`).join('\n            ')}
          </dl>
          <p class="slip__note">${esc(c.note)}</p>
        </div>
        <div class="slip__foot">
          <a class="btn btn--primary btn--block" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Выбрать время</a>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="shell section">
      <div class="cols">
        <div>
          <div class="section__head"><h2>Что приложить к письму</h2></div>
          <ul class="checklist">
            ${c.attach.map((o) => `<li>${o}</li>`).join('\n            ')}
          </ul>
        </div>
        <div>
          <div class="section__head"><h2>Про сроки</h2></div>
          <p style="margin:0 0 16px;color:var(--ink-2);font-size:16.5px;line-height:1.55">Если у вас на руках решение государственного органа, которое вы хотите оспорить, напишите <b>сразу</b> и укажите дату его вручения. Сроки обжалования в Словении короткие и считаются днями: по административным решениям это обычно 15 дней, а по некоторым видам разрешений жалоба не подаётся вовсе — остаётся только иск в суд.</p>
          <a class="btn btn--outline" href="wiki.html#sroki-obzhalovaniya">Сроки обжалования ${icon('arrow', 17)}</a>
        </div>
      </div>
      ${urgentBand()}
    </div>
  </section>
`;
  return layout({
    title: `Контакты и запись — ${site.name}`,
    description: `Запись на онлайн-консультацию, почта ${site.email}, адрес ${site.address}.`,
    current: 'contacts.html',
    canonical: 'contacts.html',
    body,
  });
};

const page404 = () => {
  const body = `
  <div class="shell prose">
    <h1>Такой страницы нет</h1>
    <p>Возможно, ссылка устарела или в адресе опечатка. Вот куда можно пойти дальше:</p>
    <ul>
      <li><a href="wiki.html">Библиотека вопросов</a> — поиск по всем ${entries.length} ответам</li>
      <li><a href="index.html">Главная страница</a></li>
      <li><a href="contacts.html">Запись на консультацию</a></li>
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

/* ────────────────────────────── служебные файлы ────────────────────────────── */

const sitemap = () => {
  const urls = ['', 'wiki.html', 'about.html', 'contacts.html'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${site.url}/${u}</loc>\n    <lastmod>${site.updated}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
};

const robots = () => `User-agent: *
Allow: /

Sitemap: ${site.url}/sitemap.xml
`;

/** Разметка Schema.org: для справочника из вопросов и ответов это главный
 *  источник понимания структуры поисковыми и ответными системами. */
const structuredData = () =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['Organization', 'LegalService'],
        '@id': `${site.url}/#org`,
        name: site.name,
        description: site.description,
        url: site.url,
        email: site.email,
        availableLanguage: ['ru'],
        areaServed: { '@type': 'Country', name: 'Slovenia' },
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
  });

/* Конфигурация Vercel (заголовки, редиректы, команда сборки) лежит в vercel.json
   в КОРНЕ репозитория, а не генерируется в dist: при деплое из Git Vercel читает
   её только из корня, а копия внутри dist просто отдавалась бы как статический
   файл по адресу /vercel.json. */

/* ────────────────────────────── запуск ────────────────────────────── */

async function build() {
  if (existsSync(OUT)) await rm(OUT, { recursive: true });
  await mkdir(join(OUT, 'assets'), { recursive: true });

  const files = [
    ['index.html', pageIndex()],
    ['wiki.html', pageWiki()],
    ['about.html', pageAbout()],
    ['contacts.html', pageContacts()],
    ['404.html', page404()],
    ['sitemap.xml', sitemap()],
    ['robots.txt', robots()],
  ];

  for (const [name, content] of files) await writeFile(join(OUT, name), content, 'utf8');

  // рекурсивно — в assets есть подпапка img
  await cp(join(__dirname, 'src', 'assets'), join(OUT, 'assets'), { recursive: true });

  console.log('✓ Собрано в dist/');
  console.log(`  страниц: ${files.filter(([n]) => n.endsWith('.html')).length}, вопросов: ${entries.length}`);
  console.log(`  ${categories.map((c) => `${c.short}: ${byCategory(c.id).length}`).join(', ')}`);

  // проверки целостности
  const ids = entries.map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) console.warn(`  ⚠ повторяющиеся id: ${[...new Set(dupes)].join(', ')}`);

  const badRelated = entries.flatMap((e) =>
    (e.related || []).filter((r) => !ids.includes(r)).map((r) => `${e.id} → ${r}`)
  );
  if (badRelated.length) console.warn(`  ⚠ ссылки related в никуда: ${badRelated.join(', ')}`);

  const badCats = entries.filter((e) => !categories.some((c) => c.id === e.cat));
  if (badCats.length) console.warn(`  ⚠ неизвестная категория: ${badCats.map((e) => e.id).join(', ')}`);

  // ссылки вида wiki.html#id со страниц сайта должны существовать
  const html = files.filter(([n]) => n.endsWith('.html')).map(([, c]) => c).join('');
  // только настоящие ссылки: идентификатор @id внутри JSON-LD ссылкой не является
  const anchors = [...html.matchAll(/href="wiki\.html#([a-z0-9-]+)"/g)].map((m) => m[1]);
  const known = new Set([...ids, ...categories.map((c) => c.id)]);
  const badAnchors = [...new Set(anchors.filter((a) => !known.has(a)))];
  if (badAnchors.length) console.warn(`  ⚠ ссылки на несуществующие якоря: ${badAnchors.join(', ')}`);

  if (!dupes.length && !badRelated.length && !badCats.length && !badAnchors.length) {
    console.log('  ✓ проверка ссылок, якорей и категорий пройдена');
  }
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
