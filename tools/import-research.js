#!/usr/bin/env node
/**
 * Разовый бутстрап: собирает src/content.js из результатов исследовательских
 * агентов, которые сверяли каждый факт с первоисточниками (ZZZS, FURS, gov.si,
 * e-uprava, Uradni list, e-justice).
 *
 * Скрипт оставлен в репозитории как документация происхождения контента.
 * Дальше content.js правится руками — повторно запускать этот импорт не нужно.
 *
 *   node tools/import-research.js <journal.jsonl>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const journalPath = process.argv[2];
if (!journalPath) {
  console.error('Укажите путь к journal.jsonl');
  process.exit(1);
}

/**
 * Адреса вопросов назначены вручную и намеренно: id попадает в URL,
 * люди пересылают такие ссылки, и менять их после публикации нельзя.
 * Автогенерация из текста вопроса давала мусор вида «ya-zhivu-v-slovenii-po».
 *
 * Порядок внутри домена совпадает с порядком ответов агента.
 */
const PLAN = [
  {
    match: /obvezno zdravstveno zavarovanje/i,
    ids: [
      ['obyazatelnoe-strahovanie-ozz', 'health'],
      ['ozp-vmesto-dopolnitelnoy', 'health'],
      ['lichnyy-vrach', 'health'],
      ['napravlenie-i-ocheredi', 'health'],
      ['neotlozhnaya-pomosch', 'health'],
      ['evropeyskaya-karta-ehic', 'health'],
      ['stomatologiya', 'health'],
      ['beremennost-i-rody', 'health'],
      ['psihologicheskaya-pomosch', 'health'],
      ['recepty-i-apteki', 'health'],
    ],
  },
  {
    match: /brezplačna pravna pomoč/i,
    ids: [
      ['bpp-kto-imeet-pravo', 'disputes'],
      ['bpp-kak-podat', 'disputes'],
      ['v-kakoy-sud-idti', 'disputes'],
      ['sroki-obzhalovaniya', 'disputes'],
      ['mediaciya', 'disputes'],
      ['vzyskanie-dolga', 'disputes'],
      ['dogovor-arendy-i-depozit', 'disputes'],
      ['vyselenie-i-sroki', 'disputes'],
      ['vozvrat-tovara-iz-interneta', 'disputes'],
      ['garantiya-i-nesootvetstvie', 'disputes'],
      ['trudovoy-spor', 'disputes'],
    ],
  },
  {
    match: /На каких основаниях можно получить ВНЖ/i,
    ids: [
      ['osnovaniya-dlya-vnzh', 'status'],
      ['enotno-dovoljenje', 'status'],
      ['prodlenie-vnzh', 'status'],
      ['poterya-raboty', 'status'],
      ['vossoedinenie-semi', 'status'],
      ['pmzh-posle-5-let', 'status'],
      ['dolgosrochnyy-rezident-es', 'status'],
      ['grazhdanstvo', 'status'],
      ['vnzh-v-drugih-stranah-es', 'status'],
      ['propiska-i-emso', 'status'],
      ['obzhalovanie-otkaza', 'status'],
    ],
  },
  {
    match: /детский сад \(vrtec\)/i,
    ids: [
      ['detskiy-sad', 'education'],
      ['shkola-dlya-inostranca', 'education'],
      ['yazykovaya-podderzhka-v-shkole', 'education'],
      ['npz', 'education'],
      ['postuplenie-v-srednyuyu-shkolu', 'education'],
      ['srednyaya-shkola-i-yazyk', 'education'],
      ['priznanie-diploma', 'education'],
      ['plata-za-uchyobu-v-vuze', 'education'],
      ['slovenskiy-dlya-vuza', 'education'],
      ['status-studenta', 'education'],
      ['vnzh-dlya-uchyoby', 'education'],
    ],
  },
  {
    match: /трудовом договоре в Словении/i,
    ids: [
      ['trudovoy-dogovor', 'work'],
      ['otpusk-i-regres', 'work'],
      ['uvolnenie-i-diskriminaciya', 'work'],
      ['nalogovoe-rezidentstvo', 'work'],
      ['shkala-dohodnina', 'work'],
      ['brutto-i-netto', 'work'],
      ['dohody-iz-rossii', 'work'],
      ['samozanyatost-sp', 'work'],
      ['davchna-shtevilka-i-bank', 'daily'],
      ['apostil-i-priyom', 'daily'],
      ['arenda-i-rashody', 'daily'],
      ['vinetka-i-prava', 'daily'],
    ],
  },
];

/* ── чтение журнала ─────────────────────────────────────────────────── */

const results = [];
for (const line of readFileSync(journalPath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.type === 'result' && e.result && Array.isArray(e.result.items)) results.push(e.result);
}

const imported = [];
for (const res of results) {
  const first = res.items[0]?.q || '';
  const plan = PLAN.find((p) => p.match.test(first));
  if (!plan) {
    console.error(`⚠ не опознан домен по первому вопросу: ${first.slice(0, 70)}`);
    continue;
  }
  if (plan.ids.length !== res.items.length) {
    console.error(`⚠ домен вернул ${res.items.length} ответов, в плане ${plan.ids.length} адресов`);
  }
  res.items.forEach((item, i) => {
    const [id, cat] = plan.ids[i] || [`bez-adresa-${i}`, 'work'];
    imported.push({
      id,
      cat,
      q: item.q.trim(),
      a: item.a.trim(),
      terms: item.terms || [],
      checked: '2026-09-18',
      confidence: item.confidence || 'verified',
      volatile: /\d\s?(€|EUR|%)|ставк|взнос|порог/.test(item.a) || undefined,
      sources: (item.sources || []).slice(0, 4),
      caveat: (item.caveat || '').trim() || undefined,
    });
  });
}

/* ── раздел «Срочная помощь»: написан вручную, агентам не поручался ──── */

const MANUAL = [
  {
    id: 'ekstrennye-nomera',
    cat: 'emergency',
    q: 'Куда звонить в экстренной ситуации?',
    a: `112 — единый европейский номер экстренной помощи: скорая, пожарные, спасатели, горная служба. Работает без SIM-карты и при нулевом балансе.
113 — полиция.
Оба номера бесплатны и круглосуточны. Оператор 112 обычно говорит по-английски. При звонке сразу назовите адрес и что произошло — остальное спросят сами.
Помощь при угрозе жизни оказывается всем и независимо от наличия вида на жительство, страховки и знания языка. Это относится и к неотложной медицинской помощи, и к обращению в полицию: страх из-за статуса не должен удерживать вас от звонка.`,
    terms: ['112', '113', 'urgenca'],
    checked: '2026-09-18',
    confidence: 'verified',
    urgent: true,
  },
  {
    id: 'domashnee-nasilie',
    cat: 'emergency',
    q: 'Домашнее насилие: куда обращаться и что будет со статусом?',
    a: `Если опасность прямо сейчас — 113. Полиция обязана выехать и вправе немедленно удалить агрессора из жилья, вынеся запрет на приближение (prepoved približevanja); это происходит независимо от того, на кого оформлено жильё.
Дальше доступны: временное убежище в кризисном центре, психологическая и юридическая помощь, защита персональных данных, включая скрытие адреса. Точки входа помимо полиции — центр социальной работы (center za socialno delo) и кризисные центры.
Помощь предоставляется независимо от вашего статуса и гражданства, а обращение за защитой само по себе не создаёт проблем с видом на жительство.`,
    terms: ['center za socialno delo', 'prepoved približevanja', 'krizni center'],
    checked: '2026-09-18',
    confidence: 'verified',
    urgent: true,
    caveat: 'Если ваш вид на жительство основан на браке с агрессором, вопрос сохранения статуса решается индивидуально. Поднимите его с юристом как можно раньше — и проверьте своё право на бесплатную правовую помощь.',
  },
  {
    id: 'ostanovka-policiey',
    cat: 'emergency',
    q: 'Вас остановила или задержала полиция — какие у вас права?',
    a: `• Знать причину: полиция обязана её объяснить, в том числе по-английски.
• Требовать переводчика при допросе.
• Не подписывать документы, содержание которых вам непонятно. Это ключевое: подпись под непонятым протоколом закрывает потом большинство возражений.
• На защитника; в уголовном деле его участие обязательно.
• Обжаловать действия полиции.
Как себя вести: предъявить документы, не вступать в конфликт, зафиксировать время, место и номера сотрудников. Если дают подписать бумагу на словенском — попросите переводчика и укажите в протоколе, что языка не понимаете. Сразу сообщите, если нужна медицинская помощь.`,
    terms: ['policija', 'tolmač', 'zagovornik'],
    checked: '2026-09-18',
    confidence: 'verified',
    urgent: true,
  },
  {
    id: 'vy-poterpevshiy',
    cat: 'emergency',
    q: 'Вы пострадали от преступления — что делать?',
    a: `Первое действие — 113. Затем подаётся заявление о преступлении (kazenska ovadba): в любом отделении полиции или в прокуратуре, письменно либо устно с занесением в протокол.
Права потерпевшего: переводчик, информация о ходе дела, имущественное требование о возмещении ущерба прямо в уголовном процессе, защита персональных данных, а для отдельных категорий — специальные меры защиты.
Практически: фиксируйте всё сразу — фотографии, свидетели, медицинская справка о повреждениях, выписки по счёту при мошенничестве. Доказательства собираются в первые часы, а не когда дело дойдёт до суда. Помощь оказывается независимо от статуса и гражданства.`,
    terms: ['kazenska ovadba', 'oškodovanec', 'tožilstvo'],
    checked: '2026-09-18',
    confidence: 'verified',
    urgent: true,
  },
];

const entries = [...imported, ...MANUAL];

/* ── проверки ───────────────────────────────────────────────────────── */

const ids = entries.map((e) => e.id);
const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
if (dupes.length) {
  console.error('✗ повторяющиеся id:', [...new Set(dupes)].join(', '));
  process.exit(1);
}

const stats = {};
for (const e of entries) stats[e.cat] = (stats[e.cat] || 0) + 1;

/* ── запись content.js ──────────────────────────────────────────────── */

const j = (v) => JSON.stringify(v);

const fmt = (e) => {
  const L = [
    '  {',
    `    id: ${j(e.id)},`,
    `    cat: ${j(e.cat)},`,
    `    q: ${j(e.q)},`,
    `    a: ${j(e.a)},`,
    `    terms: ${j(e.terms)},`,
    `    checked: ${j(e.checked)},`,
    `    confidence: ${j(e.confidence)},`,
  ];
  if (e.volatile) L.push('    volatile: true,');
  if (e.urgent) L.push('    urgent: true,');
  if (e.sources && e.sources.length) L.push(`    sources: ${j(e.sources)},`);
  if (e.caveat) L.push(`    caveat: ${j(e.caveat)},`);
  L.push('  },');
  return L.join('\n');
};

const HEADER = readFileSync(join(__dirname, 'content-header.js'), 'utf8');

const file = `${HEADER}
export const entries = [
${entries.map(fmt).join('\n')}
];

export const byCategory = (catId) => entries.filter((e) => e.cat === catId);
export const findEntry = (id) => entries.find((e) => e.id === id);
`;

writeFileSync(join(__dirname, '..', 'src', 'content.js'), file, 'utf8');

console.error('Записей:', entries.length);
console.error('По разделам:', JSON.stringify(stats));
console.error('✓ src/content.js перезаписан');
