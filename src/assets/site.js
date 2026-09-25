/* Правовая вики — клиентская логика.
   Без зависимостей. Контент уже в HTML: JS только фильтрует то, что отрисовано,
   поэтому страница остаётся читаемой и индексируемой при отключённом скрипте. */

(function () {
  'use strict';

  /* ------------------------------------------------ тема */

  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('wiki-theme');
    if (saved === 'dark' || saved === 'light') root.setAttribute('data-theme', saved);
  } catch (e) { /* приватный режим — просто идём по системной теме */ }

  var themeBtn = document.querySelector('.theme-toggle');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var explicit = root.getAttribute('data-theme');
      var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = explicit ? explicit === 'dark' : systemDark;
      var next = isDark ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      themeBtn.setAttribute('aria-label', next === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
      try { localStorage.setItem('wiki-theme', next); } catch (e) {}
    });
  }

  /* ------------------------------------------------ мобильное меню */

  var navBtn = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');
  if (navBtn && nav) {
    var setNav = function (open) {
      nav.hidden = !open;
      navBtn.setAttribute('aria-expanded', String(open));
    };
    // на десктопе меню всегда видно; hidden ставим только когда кнопка на экране
    var mq = window.matchMedia('(max-width: 860px)');
    var sync = function () { setNav(!mq.matches ? true : false); };
    sync();
    mq.addEventListener('change', sync);
    navBtn.addEventListener('click', function () { setNav(nav.hidden); });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A' && mq.matches) setNav(false);
    });
  }

  /* ------------------------------------------------ шапка на узком экране */

  /* На телефоне шапка, лента разделов и строка поиска вместе занимали
     221 пиксель — 39% экрана 320×568. Прячем шапку, пока читатель идёт вниз,
     и возвращаем, как только он двинулся вверх: так под текст остаётся почти
     на четверть экрана больше, а доступ к шапке — один короткий жест. */
  var narrow = window.matchMedia('(max-width: 960px)');
  var headerHidden = false;
  var lastY = window.scrollY;
  var holdUntil = 0;

  var setHeaderHidden = function (v) {
    if (v === headerHidden) return;
    headerHidden = v;
    document.body.classList.toggle('is-header-hidden', v);
  };

  /* Переход по ссылке на раздел или вопрос — это прыжок, а не жест читателя.
     Шапку показываем и ненадолго запрещаем её прятать: иначе прокрутка,
     вызванная прыжком, тут же считалась бы движением вниз, шапка уезжала,
     прилипшие панели меняли высоту и цель уползала из-под пальца. */
  var showHeader = function () {
    holdUntil = Date.now() + 600;
    setHeaderHidden(false);
  };

  window.addEventListener(
    'scroll',
    function () {
      var y = window.scrollY;
      if (!narrow.matches) {
        setHeaderHidden(false);
      } else if (Date.now() < holdUntil) {
        /* пауза после прыжка */
      } else if (y < 140) {
        setHeaderHidden(false);
      } else if (y > lastY + 6) {
        setHeaderHidden(true);
      } else if (y < lastY - 6) {
        setHeaderHidden(false);
      }
      lastY = y;
    },
    { passive: true }
  );
  narrow.addEventListener('change', function () { setHeaderHidden(false); });

  /* ------------------------------------------------ копирование ссылки на вопрос */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.copy-link') : null;
    if (!btn) return;
    var id = btn.getAttribute('data-id');
    var url = location.origin + location.pathname + '#' + id;
    var done = function () {
      var prev = btn.textContent;
      btn.textContent = 'Ссылка скопирована';
      btn.classList.add('is-done');
      /* Подпись самой кнопки меняется молча: смену имени элемента программы
         чтения не объявляют. Пишем в отдельную живую область. */
      var live = document.getElementById('a11y-live');
      if (live) {
        live.textContent = 'Ссылка на вопрос скопирована';
        setTimeout(function () { live.textContent = ''; }, 2000);
      }
      setTimeout(function () { btn.textContent = prev; btn.classList.remove('is-done'); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { location.hash = id; });
    } else {
      location.hash = id;
    }
  });

  /* ------------------------------------------------ раскрытие по прямой ссылке */

  /* Раскрыть мало — надо ещё довести до нужного места. Браузер пытается
     прыгнуть к фрагменту до того, как скрипт раскроет ответ, и промахивается:
     человек по присланной ссылке оказывается в начале списка из 134 вопросов
     и не понимает, куда попал. Кнопка «Ссылка на вопрос» ради этого и
     существует, так что прокручиваем сами — после раскрытия и на следующем
     кадре, когда высота ответа уже посчитана.
     scroll-margin-top у .entry уводит цель из-под прилипшей шапки. */
  /* Подсветка раздела живёт ниже по файлу и пересчитывается по прокрутке.
     Но переход по ссылке на раздел — это как раз момент, когда ждать
     события прокрутки нельзя: прыжок мгновенный, событий может не быть
     вовсе. Поэтому оставляем сюда крючок и дёргаем его сразу после
     перехода. */
  var afterJump = null;

  var openFromHash = function (scroll) {
    var id = location.hash.replace('#', '');
    if (!id) return;
    var el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'DETAILS') {
      el.open = true;
      var block = el.closest('.cat-block');
      if (block) block.hidden = false;
    }
    if (scroll === false) return;
    /* behavior: 'instant', а не плавно: плавную прокрутку, начатую во время
       загрузки, браузер обрывает — и человек остаётся в начале списка.
       Из requestAnimationFrame тоже нельзя: в фоновой вкладке кадры не
       рисуются и колбэк не выполнится. */
    showHeader();
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    if (afterJump) afterJump();
  };

  /* При загрузке ждём шрифты: без них высоты ответов другие, и прокрутка
     уезжает на пару экранов. Если шрифты не отдались, всё равно прокручиваем. */
  if (location.hash) {
    /* Браузер восстанавливает прежнюю позицию прокрутки уже после того, как
       скрипт отработал, и затирает наш переход к ответу. На странице, открытой
       по ссылке на конкретный вопрос, восстанавливать нечего — отключаем. */
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    openFromHash();
    /* Шрифты меняют высоту ответов, и первая прокрутка уезжает на пару
       экранов. Наводимся ещё раз, когда они догрузятся и когда догрузится
       остальное: до этого момента высоты ещё не окончательные. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { openFromHash(); }, function () {});
    }
    window.addEventListener('load', function () { openFromHash(); });
  }
  window.addEventListener('hashchange', function () { openFromHash(); });

  /* ------------------------------------------------ поиск по вики */

  var input = document.getElementById('wiki-search');
  if (!input) return;

  var entries = Array.prototype.slice.call(document.querySelectorAll('.entry'));
  var blocks = Array.prototype.slice.call(document.querySelectorAll('.cat-block'));
  var status = document.getElementById('wiki-status');
  var empty = document.getElementById('wiki-empty');
  var clearBtn = document.querySelector('.search__clear');
  var sidebarLinks = Array.prototype.slice.call(document.querySelectorAll('.sidebar a'));

  // Индекс строим один раз из уже отрисованного текста — вопрос, ответ и
  // словенские термины. В разметку он не дублируется: это экономит ~140 КБ,
  // а служебные подписи (даты сверки, ссылки на источники) в поиск не попадают.
  var index = entries.map(function (el) {
    var parts = [];
    var summary = el.querySelector('summary');
    var lead = el.querySelector('.entry__lead');
    var caveat = el.querySelector('.caveat');
    if (summary) parts.push(summary.textContent);
    if (lead) parts.push(lead.textContent);
    var pts = el.querySelector('.entry__points');
    if (pts) parts.push(pts.textContent);
    var nxt = el.querySelector('.entry__next');
    if (nxt) parts.push(nxt.textContent);
    if (caveat) parts.push(caveat.textContent);
    Array.prototype.forEach.call(el.querySelectorAll('.term'), function (t) {
      parts.push(t.textContent);
    });
    return { el: el, text: parts.join(' ').toLowerCase().replace(/ё/g, 'е') };
  });

  var normalize = function (s) {
    return s.toLowerCase().replace(/ё/g, 'е').trim();
  };

  /* Русская морфология: пользователь ищет «бесплатная помощь», а в тексте
     стоит «бесплатной юридической помощи». Точное совпадение подстроки такое
     не находит, поэтому отрезаем у слова окончание и ищем по основе.
     Полноценный стеммер здесь избыточен — двух отрезанных букв хватает,
     чтобы покрыть падежи и род, не порождая ложных совпадений. */
  var stem = function (w) {
    if (w.length > 7) return w.slice(0, w.length - 3);
    if (w.length > 5) return w.slice(0, w.length - 2);
    if (w.length > 4) return w.slice(0, w.length - 1);
    return w;
  };

  var apply = function (raw) {
    var q = normalize(raw);
    if (clearBtn) clearBtn.hidden = !raw;

    if (!q) {
      index.forEach(function (it) { it.el.hidden = false; });
      blocks.forEach(function (b) { b.hidden = false; updateCount(b); });
      if (status) status.textContent = '';
      if (empty) empty.hidden = true;
      return;
    }

    // все слова запроса должны встретиться — так «внж работа» сузит выдачу
    var words = q.split(/\s+/).filter(Boolean).map(stem);
    var hits = 0;

    index.forEach(function (it) {
      var ok = words.every(function (w) { return it.text.indexOf(w) !== -1; });
      it.el.hidden = !ok;
      if (ok) hits++;
    });

    blocks.forEach(function (b) {
      var visible = b.querySelectorAll('.entry:not([hidden])').length;
      b.hidden = visible === 0;
      updateCount(b);
    });

    if (status) {
      status.innerHTML = hits
        ? 'Найдено: <mark>' + hits + '</mark> ' + plural(hits, ['вопрос', 'вопроса', 'вопросов'])
        : '';
    }
    if (empty) empty.hidden = hits !== 0;
  };

  var updateCount = function (block) {
    var badge = block.querySelector('.cat-block__head .n');
    if (!badge) return;
    var n = block.querySelectorAll('.entry:not([hidden])').length;
    badge.textContent = n + ' ' + plural(n, ['вопрос', 'вопроса', 'вопросов']);
  };

  function plural(n, forms) {
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
    return forms[2];
  }

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { apply(input.value); }, 90);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { input.value = ''; apply(''); }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      apply('');
      input.focus();
    });
  }

  // «/» ставит курсор в поиск — привычно тем, кто пользуется документацией
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== input && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });

  // запрос из адресной строки: wiki.html?q=депозит — чтобы поиск с главной работал
  var params = new URLSearchParams(location.search);
  var initial = params.get('q');
  if (initial) { input.value = initial; apply(initial); }

  /* ------------------------------------------------ подсветка раздела при прокрутке */

  /* Раньше подсветку ставил IntersectionObserver с полосой
     «-150px сверху, -70% снизу». У него две беды.
     Первая: активный раздел только НАЗНАЧАЛСЯ по событию «появился» и
     никогда не пересчитывался. События приходят и от раздела, который
     уезжает, и от следующего, побеждает последнее — подсветка садилась
     на соседа. При проверке она ошибалась 12 раз из 12 при движении вниз.
     Вторая: высота полосы равна 0.3 × высота окна − 150 пикселей. При
     окне ниже 500 пикселей полоса схлопывается, и подсветка перестаёт
     работать вообще — молча, без единой ошибки в консоли.
     Считаем напрямую: активен последний раздел, чей верх уже прошёл
     под шапку. Это не зависит ни от высоты окна, ни от порядка событий. */
  if (blocks.length) {
    var setActive = function (id) {
      sidebarLinks.forEach(function (a) {
        a.classList.toggle('is-active', a.getAttribute('href') === '#' + id);
      });
    };

    /* Линия отсчёта должна совпадать с тем местом, куда раздел реально
       встаёт при переходе по ссылке. Браузер складывает scroll-padding-top
       документа и scroll-margin-top самого раздела: 84 + 150 = 234 пикселя
       на широком экране, 185 + 190 — на узком. Линия по нижнему краю строки
       поиска (176) оказывалась выше этой точки, и подсветка стабильно
       отставала на один раздел. Берём обе величины из живых стилей, чтобы
       не разъехаться при правке вёрстки. */
    var px = function (v) { return parseFloat(v) || 0; };
    var refLine = function (block) {
      return (
        px(getComputedStyle(document.documentElement).scrollPaddingTop) +
        px(getComputedStyle(block).scrollMarginTop) +
        8
      );
    };

    var currentBlock = null;
    var pick = function () {
      var visible = blocks.filter(function (b) { return !b.hidden; });
      if (!visible.length) return;
      var best = visible[0];
      visible.forEach(function (b) {
        if (b.getBoundingClientRect().top <= refLine(b)) best = b;
      });
      /* У последнего раздела может не хватить высоты, чтобы его верх дошёл
         до линии, — у «Срочной помощи» всего четыре вопроса. Докрутив
         страницу до конца, подсвечиваем именно его. */
      var atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) best = visible[visible.length - 1];
      if (best !== currentBlock) {
        currentBlock = best;
        setActive(best.id);
      }
    };

    /* Пересчёт откладываем до кадра, но не полагаемся на него одного:
       в фоновой вкладке кадры не рисуются, колбэк не приходит, флаг очереди
       остаётся поднятым — и подсветка умирает насовсем, уже без всякого
       фона. Поэтому дублируем таймером: кто сработает первым, тот и считает. */
    var queued = false;
    var run = function () {
      if (!queued) return;
      queued = false;
      pick();
    };
    var onScroll = function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(run);
      setTimeout(run, 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    /* Поиск прячет разделы — после фильтрации набор видимых другой. */
    input.addEventListener('input', onScroll);
    /* Клик по разделу в боковом меню. Полагаться на hashchange нельзя:
       если читатель уже стоит на этом разделе — например, пришёл по ссылке
       или нажал тот же пункт второй раз, — адрес не меняется, события нет
       и ничего не происходит. Поэтому прокручиваем сами и сразу считаем
       подсветку, не дожидаясь события прокрутки. */
    afterJump = pick;
    sidebarLinks.forEach(function (a) {
      a.addEventListener('click', function () {
        var target = document.querySelector(a.getAttribute('href'));
        if (!target) return;
        showHeader();
        setTimeout(function () {
          target.scrollIntoView({ block: 'start', behavior: 'instant' });
          pick();
        }, 0);
      });
    });
    pick();
  }
})();
