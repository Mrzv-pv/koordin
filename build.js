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
import { createHash } from 'node:crypto';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { site, categories as allCategories, entries, byCategory, consultants } from './src/content.js';

/* Раздел без записей не показываем: пустая строка в навигации выглядит
   поломкой, а не «скоро будет». Наполнится — появится сам. */
const categories = allCategories.filter((c) => byCategory(c.id).length > 0);

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
const nAnswers = (n) => `${n} ${plural(n, ['ответ', 'ответа', 'ответов'])}`;

/* Дата обновления жила в content.js строкой и отставала: в карте сайта стояло
   18 сентября, когда ответы правились 23-го, и краулер получал сигнал «ничего
   не менялось». Берём самую свежую дату сверки — она обновляется сама вместе
   с ответами. */
const UPDATED = entries.map((e) => e.checked).filter(Boolean).sort().pop() || site.updated;

/* Число ответов в описании сайта не должно устаревать: оно жило в content.js
   строкой и полгода обещало 59 ответов, когда их было 134. Подставляем при
   сборке. После «из» нужен родительный падеж — там всегда «ответов». */
const DESCRIPTION = site.description.replace('{N}', String(entries.length));

const ruDate = (iso) => {
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${months[m - 1]} ${y}`;
};

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Имена таблицы стилей и скрипта содержат хеш их содержимого.
 *
 * Зачем: ассеты отдаются с длинным сроком кеша, и при неизменном имени
 * посетитель после выкатки получал новый HTML со старым CSS — вёрстка
 * разъезжалась до истечения кеша. Хеш в имени делает это невозможным:
 * новый HTML ссылается на новый файл, старый остаётся лежать в кеше.
 */
const ASSET = { css: 'assets/styles.css', js: 'assets/site.js', analytics: 'assets/analytics.js' };
const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8);

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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse"><stop stop-color="#12345c"/><stop offset=".55" stop-color="#2079b0"/><stop offset="1" stop-color="#57c8dc"/></linearGradient></defs><rect width="32" height="32" fill="url(#g)"/><path d="M10 6.5v19" stroke="#fff" stroke-width="3.4" stroke-linecap="square"/><path d="M22.5 6.5 12.6 16l9.9 9.5" stroke="#fff" stroke-width="3.4" stroke-linejoin="miter" stroke-linecap="square" fill="none"/></svg>`
  );

const NAV_LINKS = [
  ['wiki.html', 'Библиотека'],
  ['about.html', 'О проекте'],
  ['contacts.html', 'Контакты'],
];

/* Картинка для превью ссылки. Без неё репост в мессенджер выглядит голой
   строкой текста, а справочник чаще всего и пересылают ссылкой. Берём ту же
   фотографию, что и на первом экране: она уже лежит в assets и закеширована. */
const OG_IMAGE = `${site.url}/assets/img/justice-1400.jpg`;

const layout = ({ title, description, current, canonical, body, head = '', robots = '' }) => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${attr(description)}">
${robots ? `<meta name="robots" content="${attr(robots)}">\n` : ''}<link rel="canonical" href="${site.url}/${canonical}">
<link rel="icon" href="${FAVICON}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${attr(site.name)}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${site.url}/${canonical}">
<meta property="og:locale" content="ru_RU">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1400">
<meta property="og:image:height" content="933">
<meta property="og:image:alt" content="${attr(site.name)} — ${attr(site.tagline)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${OG_IMAGE}">
<script type="application/ld+json">${orgGraph()}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,700;1,400&family=Alegreya+Sans:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="${ASSET.css}">
<script src="${ASSET.analytics}" defer></script>
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
        <ul>
          <li><a href="privacy.html">Данные и cookies</a></li>
          <li><a href="#" data-consent-open>Настроить аналитику</a></li>
        </ul>
      </div>
    </div>
    <div class="site-footer__base">
      <span>© ${new Date().getFullYear()} ${esc(site.name)}</span>
      <span>Библиотека обновлена ${ruDate(UPDATED)}</span>
      <span>${nQuestions(entries.length)}</span>
    </div>
  </div>
</footer>

<script src="${ASSET.js}" defer></script>
</body>
</html>
`;

/* ────────────────────────────── блоки ────────────────────────────── */

const disclaimerBlock = () => `
      <div class="disclaimer">
        ${icon('info', 17)}
        <p><b>Справочная информация, а не индивидуальная консультация.</b> ${esc(
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

/**
 * Читаемое имя источника вместо голого хоста.
 *
 * «zavezanec.zzzs.si» ничего не говорит человеку, «ZZZS» говорит сразу.
 * Неизвестные хосты показываются как есть — это лучше, чем врать названием.
 */
const SOURCE_NAMES = [
  [/(^|\.)zzzs\.si$/, 'ZZZS'],
  [/(^|\.)fu\.gov\.si$|durs\.si$/, 'FURS'],
  [/^e-uprava\.gov\.si$/, 'eUprava'],
  [/^spot\.gov\.si$/, 'SPOT'],
  [/^podatki\.gov\.si$/, 'Открытые данные'],
  [/^esamonarocanje\.gov\.si$/, 'eNaročanje'],
  [/(^|\.)ess\.gov\.si$/, 'ZRSZ'],
  [/(^|\.)si-trust\.gov\.si$/, 'SI-TRUST'],
  [/(^|\.)gov\.si$/, 'gov.si'],
  [/(^|\.)uradni-list\.si$/, 'Uradni list'],
  [/(^|\.)sodisce\.si$|^nasodiscu\.si$|^iskalniksodneprakse\.si$|^sodnapraksa\.si$/, 'Суды Словении'],
  [/(^|\.)zpiz\.si$/, 'ZPIZ'],
  [/(^|\.)ajpes\.si$/, 'AJPES'],
  [/(^|\.)policija\.si$/, 'Полиция Словении'],
  [/(^|\.)dars\.si$/, 'DARS'],
  [/(^|\.)ip-rs\.si$/, 'Информационный уполномоченный'],
  [/(^|\.)e-justice\.europa\.eu$/, 'e-Justice, ЕС'],
  [/(^|\.)eur-lex\.europa\.eu$/, 'EUR-Lex'],
  [/(^|\.)europa\.eu$/, 'Евросоюз'],
  [/(^|\.)kdmid\.ru$/, 'МИД России'],
  [/(^|\.)nalog\.gov\.ru$/, 'ФНС России'],
  [/(^|\.)government\.ru$|(^|\.)pravo\.gov\.ru$|(^|\.)kremlin\.ru$/, 'Официальные акты РФ'],
  [/(^|\.)sfr\.gov\.ru$|(^|\.)pfr\.gov\.ru$/, 'СФР России'],
  [/(^|\.)pisrs\.si$/, 'PIS RS'],
  /* Неофициальные сводки: текст там часто отстаёт от действующей редакции,
     поэтому ярлык должен отличаться от официального PIS RS. */
  [/(^|\.)zakonodaja\.com$|(^|\.)racunovodstvo\.net$/, 'Сводка закона'],
  [/(^|\.)ezdrav\.si$|^zvem\.ezdrav\.si$/, 'zVEM'],
  [/(^|\.)uni-lj\.si$|(^|\.)evs\.gov\.si$/, 'Вузы Словении'],
  [/(^|\.)zadusevnozdravje\.si$|(^|\.)nijz\.si$/, 'NIJZ'],
  [/(^|\.)epc\.si$/, 'Европейский потребительский центр'],
  [/^slovenia\.mid\.ru$/, 'Посольство России в Словении'],
  [/(^|\.)hcch\.net$/, 'Гаагская конференция'],
  [/(^|\.)stat\.si$/, 'SURS'],
  [/(^|\.)bsi\.si$/, 'Банк Словении'],
  [/(^|\.)rtvslo\.si$/, 'RTV Slovenija'],
  [/(^|\.)notar-z\.si$/, 'Нотариальная палата Словении'],
  [/(^|\.)varuh-rs\.si$/, 'Омбудсмен Словении'],
  [/(^|\.)infotujci\.si$/, 'InfoTujci'],
  [/(^|\.)ric\.si$/, 'RIC'],
  [/(^|\.)srips-rs\.si$/, 'Стипендиальный фонд'],
  [/(^|\.)centerslo\.si$|(^|\.)cene-stupar\.si$/, 'Курсы словенского'],
  [/(^|\.)zsss\.si$/, 'Профсоюзы Словении'],
  [/(^|\.)zbs-giz\.si$/, 'Банковская ассоциация'],
  [/(^|\.)gzs\.si$/, 'Торговая палата Словении'],
  [/(^|\.)zdaj\.net$/, 'NIJZ'],
  [/(^|\.)ssom\.si$|(^|\.)seps\.si$|(^|\.)studentska-prehrana\.si$/, 'Студенческие службы'],
  [/^xn--90aivcdt6dxbc\.xn--p1ai$/, 'объясняем.рф'],
  [/(^|\.)akos-rs\.si$/, 'AKOS'],
  [/(^|\.)notariat\.ru$/, 'Нотариальная палата России'],
  [/(^|\.)mid\.ru$/, 'Посольство России в Словении'],
];

const sourceName = (url) => {
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* оставляем как есть */ }
  const hit = SOURCE_NAMES.find(([re]) => re.test(host));
  return hit ? hit[1] : host;
};

/* Текст ответа для Schema.org. Полный ответ уже есть в разметке страницы,
   поэтому в JSON-LD кладём только суть — краткий ответ и пункты, с потолком
   по длине. Иначе граф дублирует всю страницу целиком: на 134 записях это
   треть веса wiki.html. Обрезаем по границе предложения, чтобы фрагмент
   оставался связным и совпадал с началом видимого текста. */
const ANSWER_MAX = 700;
/* Подпись для «Смотрите также». Целый вопрос в роли ссылки не читается:
   три подряд превращаются в абзац. Вопросы у нас построены одинаково — суть
   стоит до двоеточия или тире, дальше идут уточнения, — поэтому берём голову
   фразы, а целиком вопрос оставляем в подсказке. */
const shortQ = (q) => {
  const head = q.split(/[:—?(]/)[0].trim().replace(/[,\s]+$/, '');
  if (head.length >= 14 && head.length <= 58) return head;
  if (head.length > 58) {
    const cut = head.slice(0, 58);
    return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
  }
  const full = q.replace(/\?$/, '');
  if (full.length <= 58) return full;
  const cut = full.slice(0, 58);
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
};

const answerText = (e) => {
  const full = [e.lead, ...(e.points || [])].filter(Boolean).join(' ');
  if (full.length <= ANSWER_MAX) return full;
  const cut = full.slice(0, ANSWER_MAX);
  const dot = cut.lastIndexOf('. ');
  const semi = cut.lastIndexOf('; ');
  /* Точка предпочтительнее: обрыв на точке с запятой выглядит в выдаче
     оборванным посреди перечисления. Если резать пришлось по ней —
     закрываем фразу точкой. */
  if (dot > ANSWER_MAX / 2) return cut.slice(0, dot + 1);
  if (semi > ANSWER_MAX / 2) return `${cut.slice(0, semi)}.`;
  return `${cut.trimEnd()}…`;
};

const entryHtml = (e) => {
  const points = (e.points || []).length
    ? `\n            <ul class="entry__points">${e.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : '';
  const next = (e.next || []).length
    ? `\n            <div class="entry__next"><h4>Что делать</h4><ol>${e.next
        .map((x) => `<li>${esc(x)}</li>`)
        .join('')}</ol></div>`
    : '';
  // Поисковый индекс намеренно не дублируется в data-атрибут: это удваивало вес
  // страницы. site.js собирает строку для поиска из отрисованного текста.
  const terms = (e.terms || []).length
    ? `\n            <div class="entry__meta">${e.terms.map((t) => `<span class="term">${esc(t)}</span>`).join('')}</div>`
    : '';

  const caveat = e.caveat
    ? `\n            <div class="caveat">${icon('info', 16)}<p>${esc(e.caveat)}</p></div>`
    : '';

  const related = (e.related || []).length
    ? `\n            <p class="related"><span>Смотрите также:</span> ${e.related
        .map((id) => {
          const t = entries.find((x) => x.id === id);
          return t ? `<a href="#${t.id}" title="${esc(t.q)}">${esc(shortQ(t.q))}</a>` : '';
        })
        .filter(Boolean)
        .join(' ')}</p>`
    : '';

  /* Раньше здесь отбрасывались все ссылки с повторяющимся ярлыком — мол,
     два зеркала одного закона подряд это шум. Но на одном ведомстве лежат
     разные страницы: три ссылки на FURS — это три разных разъяснения, а не
     дубли. Так из виду пропадала треть источников: у «обжалования отказа»
     читателю показывали одну ссылку из четырёх. Теперь убираем только
     буквальные повторы URL, а одинаковые ярлыки нумеруем — ссылки остаются
     различимыми и все доступны. */
  const seenUrl = new Set();
  const srcList = (e.sources || []).filter((u) => {
    if (seenUrl.has(u)) return false;
    seenUrl.add(u);
    return true;
  });
  /* Повторять имя ведомства у каждой ссылки — «Посольство России в Словении 1,
     Посольство России в Словении 2» — нечитаемо. Собираем ссылки одного
     источника рядом: первая несёт название, остальные — просто номера.
     Рядом стоящие цифры однозначно относятся к предыдущему названию. */
  const groups = [];
  srcList.forEach((u) => {
    const n = sourceName(u);
    const g = groups.find((x) => x.name === n);
    if (g) g.urls.push(u);
    else groups.push({ name: n, urls: [u] });
  });
  const link = (u, text) =>
    `<a href="${attr(u)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>`;
  const sources = srcList.length
    ? `\n            <p class="entry__sources"><span>Источники:</span> ${groups
        .map((g) =>
          g.urls.length === 1
            ? link(g.urls[0], g.name)
            : `<span class="src-group">${g.urls
                .map((u, i) => link(u, i === 0 ? g.name : String(i + 1)))
                .join('')}</span>`
        )
        .join('')}</p>`
    : '';

  return `
          <details class="entry${e.urgent ? ' is-urgent' : ''}" id="${e.id}">
            <summary><span class="q">${esc(e.q)}</span></summary>
            <div class="entry__body">
              <p class="entry__lead">${esc(e.lead)}</p>${points}${next}${terms}${caveat}${sources}${related}
              <div class="entry__foot">
                <span class="checked${e.confidence === 'partly-verified' ? ' is-partial' : ''}">${
                  e.confidence === 'partly-verified'
                    ? `Сверено частично · ${ruDate(e.checked)}`
                    : `Проверено ${ruDate(e.checked)}`
                }</span>
                ${e.volatile ? '<span class="volatile">Сумма или ставка — меняется ежегодно</span>' : ''}
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
        <p class="hero__lead">Бесплатная онлайн-консультация: разбираем ваши документы, сроки и варианты — и вы уходите с понятным планом действий. А типовые вопросы уже разобраны в открытой библиотеке.</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться на консультацию</a>
          <a class="btn btn--outline" href="wiki.html">Открыть библиотеку ${icon('arrow', 17)}</a>
        </div>
        <p class="hero__terms"><b>${esc(c.price)}</b><span>${esc(c.duration)}</span><span>по видеосвязи</span></p>
        <p class="hero__who">Консультируют ${consultants
          .slice(0, 3)
          .map((p) => `<b>${esc(p.name)}</b> — ${esc(p.focus.toLowerCase())}`)
          .join(', ')}. <a href="about.html#kto">Кто мы</a></p>
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
          <div class="section__head"><h2>Что входит в консультацию</h2></div>
          <ul class="checklist">
            ${c.includes.map((o) => `<li>${esc(o)}</li>`).join('\n            ')}
          </ul>
          <p class="col-text">${esc(c.outcome)}</p>
        </div>
        <div>
          <div class="section__head"><h2>Если на юриста нет денег</h2></div>
          <p class="col-text">В Словении работает государственная программа бесплатной правовой помощи. Иностранцы с видом на жительство — временным или постоянным — имеют на неё право <b>наравне с гражданами</b>: она оплачивает адвоката, судебные расходы и работу переводчика.</p>
          <p class="col-text">Условие — имущественный тест. Об этом стоит знать до того, как отказаться от защиты своих прав из-за денег.</p>
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
          <p class="col-text">Если у вас на руках решение государственного органа, напишите сразу и укажите дату вручения: сроки обжалования в Словении считаются днями, а не месяцами.</p>
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
    title: site.fullName,
    description: DESCRIPTION,
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
      <div class="wiki__intro">
        <h1>Библиотека вопросов о жизни в Словении</h1>
        <p>${nAnswers(entries.length)} со ссылками на первоисточники и датой проверки. Если вашего случая здесь нет — <a href="${site.calendly}" rel="noopener noreferrer" target="_blank">разберём на бесплатной консультации</a>.</p>
      </div>
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
        <p>Попробуйте другое слово или напишите нам — <a href="mailto:${site.email}">${esc(site.email)}</a>. Вопросы читателей пополняют библиотеку.</p>
      </div>

      <div class="wiki-cta">
        <div>
          <h2>Ваш случай сложнее типового?</h2>
          <p>На бесплатной консультации разберём ваши документы и сроки и скажем, что делать дальше. 30 минут по видеосвязи.</p>
        </div>
        <a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Записаться на консультацию</a>
      </div>

      ${disclaimerBlock()}
    </div>
  </div>
`;
  return layout({
    title: `Библиотека вопросов о жизни в Словении — ${site.name}`,
    description: `${nAnswers(entries.length)} на юридические и бытовые вопросы для россиян с ВНЖ в Словении: ${categories.map((c) => c.short.toLowerCase()).join(', ')}.`,
    current: 'wiki.html',
    canonical: 'wiki.html',
    body,
    head: `<script type="application/ld+json">${faqGraph()}</script>\n`,
  });
};

/* ────────────────────────────── прочие страницы ────────────────────────────── */

const pageAbout = () => {
  const body = `
  <div class="shell prose">
    <h1>О проекте</h1>
    <p>Это практика юридической помощи для граждан России, живущих в Словении, и открытый справочник при ней. <strong>Консультации бесплатные</strong> — 30 минут по видеосвязи на русском языке. Справочник тоже открыт и бесплатен.</p>

    <h2>Зачем справочник, если есть консультация</h2>
    <p>Значительная часть вопросов типовая: как прикрепиться к врачу, что происходит со статусом при потере работы, в какой срок обжаловать решение. На такие вопросы честнее ответить один раз и открыто. Консультация нужна там, где важны обстоятельства вашего дела: конкретные документы, даты и сроки — и тогда получасового разговора хватает, чтобы понять, что делать.</p>

    <h2>Как устроены ответы</h2>
    <p>Каждый ответ называет учреждение, в которое нужно обратиться, и словенский термин, который вы увидите на бланке, — половина трудностей начинается там, где человек не знает, как называется то, что он ищет.</p>
    <p>У каждого ответа стоит <strong>дата проверки</strong>. Суммы и ставки, пересматриваемые ежегодно, помечены отдельно — им не стоит верить на слово через год после указанной даты. Где ответ зависит от вашего статуса, стоит пометка: обобщение в таких местах вредит больше, чем помогает.</p>
    <p>Факты сверены с первоисточниками — ZZZS, FURS, порталом eUprava, текстами законов и официальным вестником Uradni list. Ссылки стоят прямо под ответом. Там, где сверена основная норма, но детали зависят от практики учреждения, ответ помечен как «сверено частично»: умалчивать об этом в справочнике, по которому люди принимают решения, нельзя.</p>

    <h2 id="kto">Кто консультирует</h2>
    <p>Консультирует не «фонд» в общем смысле, а несколько человек с разной специализацией — вопрос сразу попадает к тому, кто им занимается:</p>
    <ul class="people">
      ${consultants
        .map(
          (p) => `<li>
        <b>${esc(p.name)}</b><span class="people__role">${esc(p.role)}</span>
        <span class="people__focus">${esc(p.focus)}</span>
      </li>`
        )
        .join('\n      ')}
    </ul>
    <p>Если вопрос выходит за рамки консультации и нужно представительство в словенских инстанциях, подключаются словенские юристы.</p>
    <p>Мы не публикуем фотографии и перечни дипломов. Проверить нас можно иначе и, пожалуй, честнее: вся библиотека открыта, у каждого ответа стоит дата сверки и ссылка на первоисточник — видно, как мы работаем с фактами, ещё до того, как вы напишете.</p>

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
        <p class="hero__lead">Консультация бесплатная, 30 минут по видеосвязи. Выберите время в календаре или напишите письмо — для разбора ситуации почта удобнее: можно приложить документы.</p>
        <div class="hero__actions">
          <a class="btn btn--primary" href="${site.calendly}" rel="noopener noreferrer" target="_blank">Выбрать время</a>
          <a class="btn btn--outline" href="mailto:${site.email}">Написать письмо</a>
        </div>
        <dl class="contact-lines contact-lines--spaced">
          <div><dt>Почта</dt><dd><a href="mailto:${site.email}">${esc(site.email)}</a></dd></div>
          <div><dt>Telegram</dt><dd><a href="${site.telegram}" rel="noopener noreferrer" target="_blank">@SloveniaLegal_bot</a></dd></div>
          <div><dt>Адрес</dt><dd><a href="https://www.openstreetmap.org/search?query=${mapQ}" rel="noopener noreferrer" target="_blank">${esc(site.address)}</a><br><span class="muted">Приём по предварительной договорённости</span></dd></div>
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
          <p class="col-text">Если у вас на руках решение государственного органа, которое вы хотите оспорить, напишите <b>сразу</b> и укажите дату его вручения. Сроки обжалования в Словении короткие и считаются днями: по административным решениям это обычно 15 дней, а по некоторым видам разрешений жалоба не подаётся вовсе — остаётся только иск в суд.</p>
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

const pagePrivacy = () => {
  const body = `
  <div class="shell prose">
    <h1>Данные и cookies</h1>
    <p>Коротко: сайт можно читать целиком, ничего о себе не сообщая. Данные появляются только тогда, когда вы сами пишете нам или соглашаетесь на аналитику.</p>

    <h2>Кто обрабатывает</h2>
    <p>${esc(site.fullName)}, ${esc(site.address)}. Связь по любому вопросу о данных — <a href="mailto:${site.email}">${esc(site.email)}</a>.</p>

    <h2>Аналитика — только с вашего согласия</h2>
    <p>Мы используем Google Analytics 4, чтобы видеть, какие вопросы читают и откуда приходят люди. Пока вы не нажали «Принять», скрипт Google <strong>не загружается вообще</strong>: ни одной куки не ставится и ни одного запроса на серверы Google не уходит.</p>
    <p>Если вы согласились, Google Analytics ставит куки <code>_ga</code> и <code>_ga_*</code> и получает: обезличенный идентификатор браузера, адреса открытых страниц, источник перехода, примерное местоположение по IP-адресу (точный IP GA4 не сохраняет), тип устройства и браузера. Имя, почта и содержание ваших писем туда не передаются.</p>
    <p>Решение хранится у вас в браузере (<code>localStorage</code>, ключ <code>koordin-consent</code>) и никуда не отправляется. Передумать можно в любой момент — <a href="#" data-consent-open>настроить аналитику</a>.</p>

    <h2>Письма и запись на консультацию</h2>
    <p>Когда вы пишете на почту, мы видим то, что вы отправили: адрес, текст, вложения. Мы просим прикладывать документы, и это осознанный выбор — без них разбор превращается в гадание. Присылайте только то, что нужно для вопроса.</p>
    <p>Запись на консультацию идёт через Calendly: имя, почта и выбранное время попадают в их систему. Это внешний сервис, и его политика — на стороне Calendly.</p>

    <h2>Шрифты</h2>
    <p>Начертания Alegreya загружаются с Google Fonts, и при этом Google видит IP-адрес посетителя. Это происходит до всякого согласия, потому что без шрифтов страница не отрисуется. Если для вас это важно, шрифты можно перенести на наш сервер — напишите, сделаем.</p>

    <h2>Чего мы не делаем</h2>
    <ul>
      <li>Не продаём и не передаём данные третьим лицам, кроме перечисленных выше сервисов.</li>
      <li>Не ставим рекламных пикселей и не строим профили для рекламы.</li>
      <li>Не просим регистрацию, пароли и документы через формы на сайте.</li>
    </ul>

    <h2>Ваши права</h2>
    <p>По GDPR вы вправе запросить, какие ваши данные у нас есть, исправить их, потребовать удаления, ограничить обработку и отозвать согласие. Напишите на <a href="mailto:${site.email}">${esc(site.email)}</a> — ответим. Если ответ вас не устроит, жалобу можно подать словенскому надзорному органу по защите данных (Informacijski pooblaščenec, ip-rs.si).</p>

    ${disclaimerBlock()}
  </div>
`;
  return layout({
    title: `Данные и cookies — ${site.name}`,
    description: 'Что сайт собирает, что делает Google Analytics и только с согласия, куда идут письма и запись на консультацию, как отозвать согласие.',
    current: 'privacy.html',
    canonical: 'privacy.html',
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
    robots: 'noindex, follow',
    body,
  });
};

/* ────────────────────────────── служебные файлы ────────────────────────────── */

const sitemap = () => {
  const urls = ['', 'wiki.html', 'about.html', 'contacts.html', 'privacy.html'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${site.url}/${u}</loc>\n    <lastmod>${UPDATED}</lastmod>\n  </url>`).join('\n')}
</urlset>
`;
};

const robots = () => `User-agent: *
Allow: /

Sitemap: ${site.url}/sitemap.xml
`;

/** Разметка Schema.org. Разнесена на две части намеренно: кто мы такие —
 *  на каждой странице (главная и есть та, куда в первую очередь приходит
 *  поиск, а раньше разметка стояла только в библиотеке), а перечень вопросов
 *  и ответов — только там, где эти вопросы действительно есть. */
const ORG = {
  '@type': ['Organization', 'LegalService'],
  '@id': `${site.url}/#org`,
  name: site.name,
  description: DESCRIPTION,
  url: site.url,
  email: site.email,
  image: OG_IMAGE,
  availableLanguage: ['ru'],
  areaServed: { '@type': 'Country', name: 'Slovenia' },
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'C. na Brdo 85',
    postalCode: '1000',
    addressLocality: 'Ljubljana',
    addressCountry: 'SI',
  },
};

const orgGraph = () => JSON.stringify({ '@context': 'https://schema.org', '@graph': [ORG] });

const faqGraph = () =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        '@id': `${site.url}/wiki.html#faq`,
        inLanguage: 'ru',
        isPartOf: { '@id': `${site.url}/#org` },
        mainEntity: entries.map((e) => ({
          '@type': 'Question',
          name: e.q,
          acceptedAnswer: { '@type': 'Answer', text: answerText(e) },
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

  // хеши считаем до генерации страниц: имена попадают в разметку
  const cssRaw = await readFile(join(__dirname, 'src', 'assets', 'styles.css'));
  const jsRaw = await readFile(join(__dirname, 'src', 'assets', 'site.js'));
  const gaRaw = await readFile(join(__dirname, 'src', 'assets', 'analytics.js'));
  ASSET.css = `assets/styles.${hash8(cssRaw)}.css`;
  ASSET.js = `assets/site.${hash8(jsRaw)}.js`;
  ASSET.analytics = `assets/analytics.${hash8(gaRaw)}.js`;
  await writeFile(join(OUT, ASSET.css), cssRaw);
  await writeFile(join(OUT, ASSET.js), jsRaw);
  await writeFile(join(OUT, ASSET.analytics), gaRaw);

  const files = [
    ['index.html', pageIndex()],
    ['wiki.html', pageWiki()],
    ['about.html', pageAbout()],
    ['contacts.html', pageContacts()],
    ['privacy.html', pagePrivacy()],
    ['404.html', page404()],
    ['sitemap.xml', sitemap()],
    ['robots.txt', robots()],
  ];

  for (const [name, content] of files) await writeFile(join(OUT, name), content, 'utf8');

  await cp(join(__dirname, 'src', 'assets', 'img'), join(OUT, 'assets', 'img'), { recursive: true });

  console.log('✓ Собрано в dist/');
  console.log(`  страниц: ${files.filter(([n]) => n.endsWith('.html')).length}, вопросов: ${entries.length}`);
  console.log(`  ${categories.map((c) => `${c.short}: ${byCategory(c.id).length}`).join(', ')}`);
  console.log(`  ассеты: ${ASSET.css}, ${ASSET.js}, ${ASSET.analytics}`);

  // проверки целостности
  let warnings = 0;
  const ids = entries.map((e) => e.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) { warnings += 1; console.warn(`  ⚠ повторяющиеся id: ${[...new Set(dupes)].join(', ')}`); }

  const badRelated = entries.flatMap((e) =>
    (e.related || []).filter((r) => !ids.includes(r)).map((r) => `${e.id} → ${r}`)
  );
  if (badRelated.length) { warnings += 1; console.warn(`  ⚠ ссылки related в никуда: ${badRelated.join(', ')}`); }

  /* Консульские сайты КД МИД сделаны по одному шаблону, и ссылка на чужой
     город выглядит правдоподобно: текст похож, страница живая. Но порядок
     записи и местные требования у каждой миссии свои, а читатель здесь —
     в Любляне. Дважды такие ссылки заезжали незамеченными, поэтому проверяем
     на сборке. Центральные сервисы КД МИД юрисдикции не имеют и разрешены. */
  const KDMID_OK = new Set([
    'kdmid.ru', 'www.kdmid.ru', 'id.kdmid.ru', 'reentry.kdmid.ru',
    'sos.kdmid.ru', 'consreg.kdmid.ru', 'ljubljana.kdmid.ru',
  ]);
  const foreignMissions = entries.flatMap((e) =>
    (e.sources || [])
      .filter((u) => {
        try { const h = new URL(u).hostname; return h.endsWith('kdmid.ru') && !KDMID_OK.has(h); } catch { return false; }
      })
      .map((u) => `${e.id} → ${new URL(u).hostname}`)
  );
  if (foreignMissions.length) {
    console.error(`  ✗ ссылки на консульства других стран: ${foreignMissions.join(', ')}`);
    process.exitCode = 1;
  }

  /* Одна и та же ссылка дважды в одном ответе — след ручной правки. */
  const dupSources = entries
    .filter((e) => new Set(e.sources || []).size !== (e.sources || []).length)
    .map((e) => e.id);
  if (dupSources.length) {
    console.error(`  ✗ повторяющиеся источники: ${dupSources.join(', ')}`);
    process.exitCode = 1;
  }

  const badCats = entries.filter((e) => !categories.some((c) => c.id === e.cat));
  if (badCats.length) { warnings += 1; console.warn(`  ⚠ неизвестная категория: ${badCats.map((e) => e.id).join(', ')}`); }

  // ссылки вида wiki.html#id со страниц сайта должны существовать
  const html = files.filter(([n]) => n.endsWith('.html')).map(([, c]) => c).join('');
  // только настоящие ссылки: идентификатор @id внутри JSON-LD ссылкой не является
  const anchors = [...html.matchAll(/href="wiki\.html#([a-z0-9-]+)"/g)].map((m) => m[1]);
  const known = new Set([...ids, ...categories.map((c) => c.id)]);
  const badAnchors = [...new Set(anchors.filter((a) => !known.has(a)))];
  if (badAnchors.length) { warnings += 1; console.warn(`  ⚠ ссылки на несуществующие якоря: ${badAnchors.join(', ')}`); }

  // Инлайновые атрибуты style запрещены: политика CSP на продакшене
  // (style-src 'self', без unsafe-inline) вырезает их молча, и вёрстка
  // разъезжается только на живом сайте, а локально выглядит правильно.
  const inlineStyles = files
    .filter(([n]) => n.endsWith('.html'))
    .map(([n, c]) => [n, (c.match(/ style="/g) || []).length])
    .filter(([, n]) => n > 0);
  if (inlineStyles.length) {
    console.error(`  ✗ инлайновые style запрещены (их удалит CSP): ${inlineStyles.map(([n, c]) => `${n}: ${c}`).join(', ')}`);
    process.exitCode = 1;
  }

  /* Условие успеха перечисляло проверки поимённо, и добавленная проверка
     в него не попала: сборка ругалась на ошибку и тут же печатала «пройдено».
     Считаем замечания там же, где их выводим, — тогда новая проверка
     учитывается сама. */
  if (warnings === 0 && !process.exitCode) {
    console.log('  ✓ проверки пройдены: ссылки, якоря, категории, источники, отсутствие инлайновых стилей');
  } else {
    console.log(`  — проверки завершились с замечаниями: ${warnings + (process.exitCode ? 1 : 0)}`);
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
