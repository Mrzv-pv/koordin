/**
 * Google Analytics 4 — инициализация счётчика G-JLJNBJMGJ3 (ресурс koordin.eu).
 *
 * Почему отдельный файл, а не инлайн в <head>, как в сниппете от Google:
 * Content-Security-Policy сайта задан как `script-src 'self'`, и инлайновый
 * скрипт браузер просто не выполнит. Добавлять ради счётчика 'unsafe-inline'
 * — значит открыть XSS-вектор на всём сайте. Поэтому весь сниппет лежит
 * здесь, в обычном файле со своего домена, и он же подключает загрузчик
 * gtag.js (в CSP для него открыт ровно один домен —
 * www.googletagmanager.com).
 *
 * Загрузчик добавляется отсюда, а не отдельным тегом в разметке, ровно по
 * одной причине: на localhost не должно уходить вообще ничего. `npm run dev`
 * — это не посещения сайта, и в статистике им делать нечего.
 *
 * Порядок загрузки значения не имеет: dataLayer — очередь, и gtag.js
 * разбирает её при старте независимо от того, что выполнилось раньше.
 */
(function () {
  var host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('js', new Date());
  gtag('config', 'G-JLJNBJMGJ3');

  var loader = document.createElement('script');
  loader.async = true;
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=G-JLJNBJMGJ3';
  document.head.appendChild(loader);
})();
