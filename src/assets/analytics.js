/**
 * Google Analytics 4 (ресурс koordin.eu, G-JLJNBJMGJ3) + баннер согласия.
 *
 * Главный принцип: до явного согласия НИЧЕГО не загружается и не ставится.
 * Загрузчик gtag.js добавляется в документ только после нажатия «Принять».
 * У посетителя, который отказался или ещё не ответил, не появляется ни одной
 * куки Google и не уходит ни одного запроса на его серверы.
 *
 * Почему не Consent Mode с параметром denied: он всё равно грузит gtag.js и
 * отправляет обезличенные сигналы. Для сайта, куда приходят с вопросами
 * о миграционном статусе, честнее не грузить вовсе.
 *
 * Почему отдельный файл, а не инлайн в <head>, как в сниппете Google:
 * CSP сайта задан как script-src 'self' + www.googletagmanager.com,
 * и инлайновый скрипт браузер не выполнит. Добавлять ради счётчика
 * 'unsafe-inline' — значит открыть XSS-вектор на всём сайте.
 *
 * На localhost не уходит ничего и баннер не показывается: npm run dev —
 * это не посещения сайта.
 */
(function () {
  'use strict';

  var GA_ID = 'G-JLJNBJMGJ3';
  var KEY = 'koordin-consent'; // 'granted' | 'denied'

  var host = window.location.hostname;
  var isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

  /* ---------------------------------------------- хранилище решения */

  function readChoice() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'granted' || v === 'denied' ? v : null;
    } catch (e) {
      /* приватный режим или заблокированное хранилище: считаем, что ответа нет,
         и ничего не грузим. Отсутствие согласия — это отказ, а не «спросим потом». */
      return null;
    }
  }

  function saveChoice(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  /* ---------------------------------------------- запуск счётчика */

  var started = false;

  function startAnalytics() {
    if (started || isLocal) return;
    started = true;

    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;

    gtag('js', new Date());
    gtag('config', GA_ID);

    var loader = document.createElement('script');
    loader.async = true;
    loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(loader);
  }

  /* ---------------------------------------------- баннер */

  var banner = null;
  var lastFocus = null;

  function closeBanner() {
    if (!banner) return;
    banner.remove();
    banner = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function decide(value) {
    saveChoice(value);
    if (value === 'granted') startAnalytics();
    closeBanner();
  }

  function buildBanner() {
    var el = document.createElement('div');
    el.className = 'consent';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-labelledby', 'consent-title');

    var title = document.createElement('h2');
    title.id = 'consent-title';
    title.className = 'consent__title';
    title.textContent = 'Аналитика посещений';

    var text = document.createElement('p');
    text.className = 'consent__text';
    text.textContent =
      'Мы хотим считать посещения через Google Analytics, чтобы понимать, какие вопросы читают. ' +
      'Это ставит куки и передаёт данные в Google. Без вашего согласия ничего из этого не происходит — ' +
      'сайт полностью работает и так.';

    var more = document.createElement('a');
    more.className = 'consent__more';
    more.href = 'privacy.html';
    more.textContent = 'Что именно собирается';

    var row = document.createElement('div');
    row.className = 'consent__row';

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'consent__btn';
    no.textContent = 'Отклонить';
    no.addEventListener('click', function () { decide('denied'); });

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'consent__btn';
    yes.textContent = 'Принять';
    yes.addEventListener('click', function () { decide('granted'); });

    /* Обе кнопки одинаковые по виду и размеру, «Отклонить» стоит первой.
       Залитая «Принять» рядом с контурной «Отклонить» — это подталкивание:
       согласие, полученное так, не считается свободным. Рекомендованного
       ответа здесь быть не должно. */
    row.appendChild(no);
    row.appendChild(yes);

    el.appendChild(title);
    el.appendChild(text);
    el.appendChild(more);
    el.appendChild(row);

    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') decide('denied');
    });

    return el;
  }

  /* isLocal здесь намеренно не проверяется: вызванный руками баннер нужен,
     чтобы его можно было посмотреть и починить при разработке. Аналитика
     на localhost всё равно не запустится — это проверяется в startAnalytics. */
  function showBanner() {
    if (banner) return;
    lastFocus = document.activeElement;
    banner = buildBanner();
    document.body.appendChild(banner);
    var first = banner.querySelector('button');
    if (first) first.focus();
  }

  /* ---------------------------------------------- решение можно изменить */

  window.koordinConsent = {
    open: showBanner,
    status: readChoice,
    revoke: function () {
      saveChoice('denied');
      /* счётчик мог успеть запуститься в этой вкладке — гасим его куки */
      try {
        document.cookie.split(';').forEach(function (c) {
          var name = c.split('=')[0].trim();
          if (name.indexOf('_ga') === 0) {
            document.cookie = name + '=; Max-Age=0; path=/';
            document.cookie = name + '=; Max-Age=0; path=/; domain=.' + location.hostname;
          }
        });
      } catch (e) {}
    },
  };

  function init() {
    var link = document.querySelector('[data-consent-open]');
    if (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        showBanner();
      });
    }

    if (isLocal) return;

    var choice = readChoice();
    if (choice === 'granted') startAnalytics();
    else if (choice === null) showBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
