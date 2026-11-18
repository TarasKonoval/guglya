#!/usr/bin/env node
/*
 * Ґуґля — збирач каталогів брендів сумок/аксесуарів (і сумок та головних уборів у великих одягових брендів).
 * Пише data/database/<slug>/products.json (для брендів, у яких уже є база одягу, — <slug>/bags_hats.json).
 *
 *   cd data/database && npm install
 *   node scrape_brands.mjs                 # усі бренди з BRANDS нижче
 *   node scrape_brands.mjs --only poelle,juna
 *   node scrape_brands.mjs --report        # лише перебудувати REPORT.md і categories.json з наявних файлів
 *
 * Порядок методів: Shopify /products.json → Tilda (статичні картки) → sitemap/сторінки категорій + JSON-LD →
 * мікророзмітка/HTML. Дотримується robots.txt, пауза 1–2 с між запитами до одного сайту, звичайний User-Agent.
 * Якщо сайт показує Cloudflare-перевірку/капчу або блокує — бренд зупиняється, причина пишеться у звіт.
 */
import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const flag = (k) => args.includes('--' + k);
const ONLY = (opt('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = +opt('limit', 300);
const PARALLEL = +opt('parallel', 6);
const TODAY = new Date().toISOString().slice(0, 10);
const UA_FALLBACK = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

// ---------------------------------------------------------------- бренди
// scope: all — усі товари; bags_hats — лише сумки, рюкзаки, головні убори.
// out: файл у data/database/<id>/ (bags_hats.json там, де вже є база одягу, щоб її не чіпати).
const BRANDS = [
  { id: 'poelle', name: 'Poelle', site: 'https://poelle.ua', scope: 'all', engine: 'shopify' },
  { id: 'pryanik', name: 'Pryanik', site: 'https://pryanik.in.ua', scope: 'all', engine: 'tilda', listingsFromSitemap: ['https://pryanik.in.ua/sitemap.xml'] },
  { id: 'verbena', name: 'Verbena', site: 'https://verbena.com.ua', scope: 'all', engine: 'shopify' },
  {
    id: 'juna', name: 'Juna', site: 'https://www.juna.com.ua', scope: 'all', engine: 'pages',
    listings: ['bagety', 'klatchi', 'krosbodi', 'na-pleche', 'hobo', 'shoppery'].map((s) => 'https://www.juna.com.ua/sumky/' + s)
      .concat(['https://www.juna.com.ua/sumky', 'https://www.juna.com.ua/aksesuary']),
    productRe: /^https:\/\/www\.juna\.com\.ua\/[a-z0-9-]+$/, inSitemap: 'https://www.juna.com.ua/sitemap.xml',
    productCheck: '.section__product__price', priceSel: '.section__product__price', oldPriceSel: '.section__product__price-old, .section__product__old-price',
    photoSel: '.section__product__main__slide img',
  },
  { id: 'vikele', name: 'Vikele', site: 'https://ua.vikele.com', scope: 'all', engine: 'shopify' },
  {
    id: 'bagllet', name: 'Bagllet', site: 'https://bagllet.com', scope: 'all', engine: 'pages',
    sitemaps: ['https://bagllet.com/product-sitemap.xml'], productRe: /\/product\/[^/]+\/?$/,
  },
  { id: 'nukot', name: 'Nukot', site: 'https://nukot.com.ua', scope: 'all', engine: 'shopify' },
  { id: 'vis', name: 'VIS', site: 'https://visbags.com', scope: 'all', engine: 'pages', sitemaps: ['https://visbags.com/sitemap.xml'], productRe: /./ },
  {
    id: 'estro', name: 'Estro', site: 'https://estro.ua', scope: 'bags_hats', engine: 'pages',
    listingsFromSitemapRe: ['https://estro.ua/sitemap.xml', /\/catalog\/(zhinochi-sumky|cholovichi-sumky|pliazhna-sumka|[^?]*holovni-ubory)/],
    productRe: /^https:\/\/estro\.ua\/product\/[^/?#]+$/,
  },
  {
    id: 'gepur', name: 'Gepur', site: 'https://gepur.com/uk', scope: 'bags_hats', engine: 'pages', out: 'bags_hats.json',
    listings: ['https://gepur.com/uk/catalog/sumki', 'https://gepur.com/uk/catalog/shapki', 'https://gepur.com/uk/catalog/golovnye-ubory-1618575605', 'https://gepur.com/uk/catalog/sumki-klatchi-koshelki'],
    productRe: /^https:\/\/gepur\.com\/uk\/product\/[^/?#]+$/,
    siteGender: { value: 'female', evidence: /жіноч\S* одяг|одяг для жінок|для жінок/i },
  },
  {
    id: 'harvest', name: 'Harvest', site: 'https://harvest-clothing.com.ua', scope: 'bags_hats', engine: 'pages',
    sitemaps: ['https://harvest-clothing.com.ua/sitemap.xml'],
    productRe: /harvest-clothing\.com\.ua\/(bags|backpacks)\/(?!kids)[^?#]+\/[^/?#]+$|harvest-clothing\.com\.ua\/accessories\/[^?#]*(shap|kepk|panam|beanie|cap|hat|bucket)[^?#]*$/,
  },
  { id: 'huru', name: 'HURU', site: 'https://huru.rocks/uk-ua', scope: 'bags_hats', engine: 'shopify', locale: '/uk-ua', presentment: true },
  {
    id: 'kachorovska', name: 'Kachorovska', site: 'https://kachorovska.com', scope: 'bags_hats', engine: 'pages', browser: true, out: 'bags_hats.json',
    listings: ['https://kachorovska.com/wsumki', 'https://kachorovska.com/accessories/caps', 'https://kachorovska.com/accessories'],
    productRe: /^https:\/\/kachorovska\.com\/(wsumki|accessories)\/[^/?#]+$/,
  },
  { id: 'okryk', name: 'Okryk', site: 'https://okrykbrand.com/uk', scope: 'all', engine: 'shopify', locale: '/uk' },
  { id: 'niksense', name: 'Nik Sense', site: 'https://niksense.store', scope: 'all', engine: 'shopify' },
  {
    id: 'sambag', name: 'Sambag', site: 'https://sambag.com.ua', scope: 'all', engine: 'pages',
    sitemaps: ['https://sambag.com.ua/sitemap.xml'], productRe: /^https:\/\/sambag\.com\.ua\/[^/?#]+\/[^/?#]+$/,
  },
  { id: 'manoylo', name: 'Manoylo', site: 'https://www.instagram.com/manoylo.brand/', scope: 'all', engine: 'none', note: 'Instagram only — попросити в бренду фід або каталог' },
];

// ---------------------------------------------------------------- словники
const OUT = 'Верхній одяг', TOP = 'Верх', KNIT = 'Светри / Гольфи / Джемпери', TEE = 'Футболки / Майки / Поло / Топи',
  BODY = 'Боді / Лонгсліви', BOT = 'Низ', SET = 'Комплекти', DRESS = 'Сукні', SHOES = 'Взуття', ACC = 'Аксесуари',
  UND = 'Нижня білизна', SWIM = 'Купальники', ETNO = 'Вишиванки', BAGS = 'Сумки', PACKS = 'Рюкзаки', HATS = 'Головні убори';
const R = (s) => new RegExp(s, 'i');
const B = '(^|[\\s\\-«"(/|,.])', E = '($|[\\s\\-»")/|,.])';
// Нові правила (сумки, головні убори, аксесуари) стоять першими; далі — правила одягу з scraper.js.
const RULES = [
  [R('дитяч|kids'), null, null, null],
  [R('подарунков\\S* (сертиф|карт)|сертифікат|gift ?card|e-gift'), null, null, null],
  [R('брелок|брелоки|bag charm|\\bcharms?\\b|підвіск\\S* на сумк'), ACC, 'Брелок', 'other'],
  [R('косметичк|cosmetic bag|beauty bag|несесер'), ACC, 'Косметичка', 'other'],
  [R('ключниц|key ?holder|key ?case'), ACC, 'Ключниця', 'other'],
  [R('обкладинк\\S* на паспорт|passport'), ACC, 'Обкладинка на паспорт', 'other'],
  [R('чохол|чехол|\\bcase\\b|laptop ?sleeve|ноутбук'), ACC, 'Чохол', 'other'],
  [R('органайзер|organizer|packing cube'), ACC, 'Органайзер', 'other'],
  [R('ремін\\S* для сумк|ремінц\\S* для сумк|плечов\\S* ремін|\\bstrap\\b|ручк\\S* для сумк'), ACC, 'Ремінь для сумки', 'other'],
  [R('рюкзак|backpack|\\bpack\\b|bckpck'), PACKS, 'Рюкзак', 'bag'],
  [R('бананк|поясн\\S* сумк|сумк\\S* на пояс|belt ?bag|waist ?bag|fanny|bum ?bag|\\bwaist\\b'), BAGS, 'Бананка', 'bag'],
  [R('слінг|\\bsling'), BAGS, 'Слінг', 'bag'],
  [R('шопер|shopper'), BAGS, 'Шопер', 'bag'],
  [R('тоут|\\btote'), BAGS, 'Тоут', 'bag'],
  [R('кросбод|кросс?-?боді|crossbody|cross-body|cross body'), BAGS, 'Кросбоді', 'bag'],
  [R('багет|baguette'), BAGS, 'Багет', 'bag'],
  [R('клатч|clutch'), BAGS, 'Клатч', 'bag'],
  [R('портфел|briefcase|сетчел|satchel'), BAGS, 'Портфель', 'bag'],
  [R('сумк\\S*-мішок|сумка мішок|мішок|bucket ?bag|\\bhobo|хобо'), BAGS, 'Сумка-мішок', 'bag'],
  [R('на плече|через плече|shoulder'), BAGS, 'Сумка на плече', 'bag'],
  [R('балаклав|balaclava'), HATS, 'Балаклава', 'hat'],
  [R('капор'), HATS, 'Капор', 'hat'],
  [R('капюшон|\\bhood\\b'), HATS, 'Капюшон', 'hat'],
  [R(B + 'берет' + E + '|beret'), HATS, 'Берет', 'hat'],
  [R('панам|bucket ?hat'), HATS, 'Панама', 'hat'],
  [R('кепк|бейсболк|\\bcaps?\\b|cap\\b'), HATS, 'Кепка', 'hat'],
  [R('капелюх|шляп|fedora|\\bhats?\\b'), HATS, 'Капелюх', 'hat'],
  [R('чепчик|чепець'), HATS, 'Чепчик', 'hat'],
  [R(B + 'біні' + E + '|beanie'), HATS, 'Біні', 'hat'],
  [R('шапк|шапоч'), HATS, 'Шапка', 'hat'],
  [R('гаман|кошел|портмоне|wallet|purse'), ACC, 'Гаманець', 'other'],
  [R('кардхолдер|картхолдер|візитниц|card ?holder|cardholder|card case'), ACC, 'Кардхолдер', 'other'],
  [R('сумк|сумоч|саквояж|месенджер|messenger|планшет|weekender|\\bbags?\\b|\\bpouch'), BAGS, 'Сумка', 'bag'],
  [R('ремін|ремен|пояс|\\bbelt'), ACC, 'Ремінь', 'other'],
  [R('шарф|снуд|палантин|scarf'), ACC, 'Шарф', 'other'],
  [R('хустк|хустин|платок|бандан|shawl|kerchief'), ACC, 'Хустка', 'other'],
  [R('рукавиц|рукавич|перчат|gloves|mittens'), ACC, 'Рукавички', 'other'],
  [R('парасол|umbrella'), ACC, 'Парасоля', 'other'],
  [R('окуляр|glasses'), ACC, 'Окуляри', 'other'],
  [R('шкарпет|носк|socks'), ACC, 'Шкарпетки', 'other'],
  [R('прикрас|сереж|намист|браслет|каблучк|кулон|брошк|кольє|jewel|earring|necklace|bracelet|\\bring\\b'), ACC, 'Прикраси', 'other'],
  [R('вишиван|вышиван'), ETNO, 'Вишиванка', 'top'],
  [R('піжам|пижам|халат'), UND, 'Піжама / Халат', 'other'],
  [R('купальн|swimsuit|swimwear|бікіні|bikini'), SWIM, 'Купальник', 'other'],
  [R('пухов|puffer'), OUT, 'Пуховик', 'top'],
  [R('тренч|trench'), OUT, 'Тренч', 'top'],
  [R('пальт|\\bcoat\\b'), OUT, 'Пальто', 'top'],
  [R('бомбер|bomber'), OUT, 'Бомбер', 'top'],
  [R('куртк|анорак|\\bjacket'), OUT, 'Куртка', 'top'],
  [R('комбінезон|jumpsuit'), SET, 'Комбінезон', 'top'],
  [R('комплект|костюм|\\bset\\b'), SET, 'Комплект', 'top'],
  [R('сукн|сукон|плаття|сарафан|\\bdress'), DRESS, 'Сукня', 'top'],
  [R('піджак|жакет|блейзер|blazer'), TOP, 'Піджак', 'top'],
  [R('жилет|\\bvest\\b|gilet'), TOP, 'Жилет', 'top'],
  [R('кардиган|cardigan'), KNIT, 'Кардиган', 'top'],
  [R('гольф|водолаз|turtleneck'), KNIT, 'Гольф', 'top'],
  [R('джемпер|jumper'), KNIT, 'Джемпер', 'top'],
  [R('светр|свитер|sweater|пуловер|pullover'), KNIT, 'Светр', 'top'],
  [R('худі|hoodie'), TOP, 'Худі', 'top'],
  [R('світшот|sweatshirt|кофт'), TOP, 'Світшот', 'top'],
  [R('лонгслів|longsleeve|long sleeve'), BODY, 'Лонгслів', 'top'],
  [R(B + 'боді' + E + '|' + B + 'body' + E + '|bodysuit'), BODY, 'Боді', 'top'],
  [R('футболк|t-?shirt|' + B + 'tee' + E), TEE, 'Футболка', 'top'],
  [R(B + 'поло' + E + '|\\bpolo\\b'), TEE, 'Поло', 'top'],
  [R('майк|\\btank\\b'), TEE, 'Майка', 'top'],
  [R('корсет|corset'), TEE, 'Корсет', 'top'],
  [R(B + 'топ' + E + '|\\btop\\b'), TEE, 'Топ', 'top'],
  [R('блуз|blouse'), TOP, 'Блуза', 'top'],
  [R('сорочк|\\bshirt'), TOP, 'Сорочка', 'top'],
  [R('спідниц|skirt'), BOT, 'Спідниця', 'bottom'],
  [R('джинс|jeans'), BOT, 'Джинси', 'bottom'],
  [R('шорт|shorts'), BOT, 'Шорти', 'bottom'],
  [R('легінс|leggings'), BOT, 'Легінси', 'bottom'],
  [R('брюк|штан|\\bpants|trousers|кюлот|палаццо'), BOT, 'Брюки', 'bottom'],
  [R('кросів|sneaker|trainer'), SHOES, 'Кросівки', 'shoes'],
  [R('лофер|loafer'), SHOES, 'Лофери', 'shoes'],
  [R('чобіт|чоботи'), SHOES, 'Чоботи', 'shoes'],
  [R('челсі|черевик|ботильйон|\\bboots?\\b'), SHOES, 'Черевики', 'shoes'],
  [R('мюлі|\\bmules'), SHOES, 'Мюлі', 'shoes'],
  [R('сандал|босоніж|sandal'), SHOES, 'Сандалі', 'shoes'],
  [R('туфл|балетк|ballet|pumps'), SHOES, 'Туфлі', 'shoes'],
  [R('взутт|shoes'), SHOES, 'Взуття', 'shoes'],
];
// Словник для categories.json (розділ 6 ТЗ) — додається до наявного.
const DICT = [
  { category: BAGS, slot: 'bag', item_types: ['Шопер', 'Тоут', 'Кросбоді', 'Багет', 'Сумка на плече', 'Клатч', 'Портфель', 'Сумка-мішок', 'Бананка', 'Слінг', 'Сумка'] },
  { category: PACKS, slot: 'bag', item_types: ['Рюкзак'] },
  { category: HATS, slot: 'hat', item_types: ['Шапка', 'Біні', 'Балаклава', 'Капор', 'Капюшон', 'Берет', 'Панама', 'Кепка', 'Капелюх', 'Чепчик'] },
  { category: ACC, slot: 'other', item_types: ['Гаманець', 'Кардхолдер', 'Ремінь', 'Шарф', 'Хустка', 'Рукавички', 'Брелок', 'Косметичка', 'Ключниця', 'Обкладинка на паспорт', 'Чохол', 'Органайзер', 'Ремінь для сумки', 'Парасоля'] },
];

const COLORS = [
  [R('чорн|черн|black|noir|nero'), 'чорний'], [R('графіт|графит|graphite|антрацит|anthracite'), 'графіт'],
  [R('біл(ий|а|е|і)|бел(ый|ая|ое)|\\bwhite'), 'білий'], [R('\\bсір|сер(ый|ая|ое)|\\bgr[ae]y\\b'), 'сірий'],
  [R('меланж|melange'), 'меланж'], [R('беж|beige'), 'бежевий'], [R('пісоч|песоч|\\bsand'), 'пісочний'],
  [R('шоколад|chocolate|\\bchoco\\b'), 'шоколадний'], [R('корич|brown|мокко|mocha'), 'коричневий'],
  [R('молоч|\\bmilk|ivory|айворі|екрю|ecru'), 'молочний'], [R('кремов|cream'), 'кремовий'],
  [R('блакит|голуб|light ?blue|sky ?blue'), 'блакитний'], [R('темно-син|navy'), 'темно-синій'],
  [R('син(ій|я|є|і|ього)|\\bblue'), 'синій'], [R('олив|olive'), 'оливковий'], [R('хакі|хаки|khaki'), 'хакі'],
  [R('м.ятн|\\bmint'), 'мʼятний'], [R('зелен|green'), 'зелений'], [R('бордо|burgundy|bordeaux|марсал|вишн|cherry|\\bwine'), 'бордовий'],
  [R('червон|красн|\\bred\\b'), 'червоний'], [R('рожев|розов|\\bpink'), 'рожевий'], [R('лаванд|lavender|бузк|lilac'), 'лавандовий'],
  [R('фіолет|фиолет|purple|violet'), 'фіолетовий'], [R('жовт|желт|yellow'), 'жовтий'],
  [R('помаран|оранж|orange'), 'помаранчевий'], [R('теракот|terracotta'), 'теракотовий'],
  [R('золот|\\bgold'), 'золотий'], [R('срібл|серебр|silver'), 'срібний'], [R('карамел|caramel'), 'карамельний'],
  [R('коньяч|cognac'), 'коньячний'], [R('кемел|camel'), 'кемел'], [R('гірчичн|mustard'), 'гірчичний'],
  [R('руд(ий|а|е)'), 'рудий'], [R('нюд|\\bnude'), 'нюдовий'], [R('тауп|taupe'), 'тауп'],
];
const FEM = R('жіноч|жінк|женск|для неї|\\bwomen|\\bwoman|\\bwomens|zhinoch|zhinkam|\\/women\\b');
const MAL = R('чоловіч|чоловік|мужск|для нього|\\bmen\\b|\\bman\\b|\\bmens\\b|cholovi|\\/men\\b|\\/mens\\b');
const UNI = R('унісекс|унисекс|unisex|uniseks');
const SEO = R('купити|купить|інтернет-магазин|интернет-магазин|✅|➡|►|❤|⭐|доставк\\S* по україні');

// ---------------------------------------------------------------- утиліти
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => cheerio.load('<b>' + String(s || '').replace(/<br\s*\/?>/gi, ' ') + '</b>').text().replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (v == null) return null;
  let s = String(v).replace(/[\s\u00a0\u202f]/g, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(s) && !/\.\d{3}\./.test(s) && s.split('.').length === 2 && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? Math.round(n) : null;
};
const uniq = (a) => [...new Set(a.filter((x) => x != null && x !== ''))];
const TR = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ё: 'e', ы: 'y', э: 'e', ъ: '' };
const slugify = (s) => String(s || '').toLowerCase().split('').map((c) => (c in TR ? TR[c] : c)).join('')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const lastSeg = (u) => { try { const p = new URL(u).pathname.split('/').filter(Boolean); return decodeURIComponent(p[p.length - 1] || ''); } catch { return ''; } };
const stripUrl = (u) => { try { const x = new URL(u); x.search = ''; if (!/#!\/tproduct/.test(x.hash)) x.hash = ''; return x.href; } catch { return u; } };
const classify = (...texts) => {
  for (const t of texts) {
    if (!t) continue;
    for (const [re, category, item_type, slot] of RULES) if (re.test(t)) return category ? { category, item_type, slot } : { skip: true };
  }
  return null;
};
const colorsFrom = (vals) => uniq(vals.flatMap((v) => {
  const s = String(v || '').trim(); if (!s) return [];
  const hit = COLORS.filter(([re]) => re.test(s)).map(([, n]) => n);
  if (hit.length) return hit.slice(0, 2);
  return /^[а-яіїєґʼ'’ -]{3,30}$/i.test(s) ? [s.toLowerCase()] : []; // українська назва кольору як є (напр. «топлене масло»)
}));
const genderFrom = (txt) => {
  if (UNI.test(txt)) return 'unisex';
  const f = FEM.test(txt), m = MAL.test(txt.replace(/women|woman|womens/gi, ''));
  return f && m ? 'unisex' : f ? 'female' : m ? 'male' : null;
};
const careFrom = (text) => {
  const m = String(text || '').match(/(Догляд за виробом|Догляд за річчю|Рекомендації (?:з|по) догляду|Догляд|Уход за изделием)\s*:?\s*(.{25,450}?)(?=\s*(Доставка|Оплата|Повернення|Обмін|Розмір|Характеристики|Склад|Матеріал|Опис|$))/i);
  return m && !/[{}"\\]/.test(m[2]) ? m[2].trim() : null;
};
// Сторінка-перевірка (Cloudflare challenge / капча) замість контенту.
const isChallenge = (status, html) => {
  const head = String(html || '').slice(0, 20000);
  if (/<title>\s*(just a moment|attention required|трохи зачекайте|один момент|подождите)/i.test(head)) return true;
  return (status === 403 || status === 503) && /cf-chl-|challenges\.cloudflare\.com|captcha/i.test(head);
};

class Blocked extends Error {}
class RateLimited extends Blocked {}

// ---------------------------------------------------------------- robots.txt
function parseRobots(txt) {
  const rules = []; let delay = 0; let agents = [], inRules = false, mine = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const m = line.match(/^([\w-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (inRules) { agents = []; inRules = false; } agents.push(v.toLowerCase()); mine = agents.includes('*'); continue; }
    inRules = true;
    if (!mine) continue;
    if ((k === 'allow' || k === 'disallow') && v) rules.push({ allow: k === 'allow', len: v.length, re: new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')) });
    if (k === 'crawl-delay') delay = Math.max(delay, +v || 0);
  }
  return {
    delay,
    allowed(u) {
      let p; try { const x = new URL(u); p = x.pathname + x.search; } catch { return true; }
      let best = null;
      for (const r of rules) if (r.re.test(p) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
      return !best || best.allow;
    },
  };
}

// ---------------------------------------------------------------- завантаження
let browserP = null;
async function browser() {
  if (!browserP) browserP = import('playwright').then(({ chromium }) => chromium.launch({ channel: 'chrome', headless: true }));
  return browserP;
}

class Fetcher {
  constructor(cfg) {
    this.cfg = cfg; this.origin = new URL(cfg.site).origin; this.last = 0; this.n = 0;
    this.skippedRobots = []; this.notes = [];
  }
  async init() {
    let txt = '';
    try { const r = await this.raw(this.origin + '/robots.txt'); if (r.status === 200 && !/<html/i.test(r.text.slice(0, 500))) txt = r.text; } catch {}
    this.robots = parseRobots(txt);
    this.minDelay = Math.max(1000, this.robots.delay * 1000);
    if (this.cfg.browser) {
      const b = await browser();
      this.ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${b.version()} Safari/537.36`;
      this.ctx = await b.newContext({ locale: 'uk-UA', userAgent: this.ua });
      await this.ctx.route('**/*', (r) => (['image', 'media', 'font'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
      this.page = await this.ctx.newPage();
    }
  }
  async close() { if (this.ctx) await this.ctx.close().catch(() => {}); }
  async throttle() {
    const wait = this.last + this.minDelay + Math.random() * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now(); this.n++;
  }
  async raw(u) {
    const r = await fetch(u, { headers: { 'user-agent': this.ua || UA_FALLBACK, 'accept-language': 'uk-UA,uk;q=0.9,en;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: r.status, text: await r.text(), url: r.url, retryAfter: +r.headers.get('retry-after') || 0 };
  }
  async get(u, { json = false } = {}) {
    if (!this.robots.allowed(u)) { this.skippedRobots.push(u); throw new Error('robots.txt disallows ' + u); }
    for (let a = 0; ; a++) {
      await this.throttle();
      let r;
      if (this.page) {
        const resp = await this.page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
        r = { status: resp ? resp.status() : 0, text: await this.page.content(), url: this.page.url() };
      } else r = await this.raw(u);
      if (isChallenge(r.status, r.text)) throw new Blocked(`захист від ботів (HTTP ${r.status}, Cloudflare/капча) на ${u}`);
      if (r.status === 429 && a < 6) { const s = Math.max(r.retryAfter || 60, 30); log(this.cfg.id, `429, чекаю ${s} с (Retry-After)`); await sleep(s * 1000 + Math.random() * 3000); continue; }
      if (r.status >= 500 && a < 3) { await sleep(10000 * (a + 1)); continue; }
      if (r.status === 429) throw new RateLimited('HTTP 429 (rate limit) навіть після пауз за Retry-After');
      if (r.status >= 400) throw new Error(`HTTP ${r.status} ${u}`);
      if (json) return JSON.parse(this.page ? cheerio.load(r.text)('body').text() : r.text);
      return r;
    }
  }
}

// ---------------------------------------------------------------- розбір сторінки товару
function ldItems($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, s) => {
    const t = $(s).text();
    let j; try { j = JSON.parse(t); } catch { try { j = JSON.parse(t.replace(/[\u0000-\u001f]+/g, ' ').replace(/,\s*([}\]])/g, '$1')); } catch { return; } }
    const walk = (x) => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); out.push(x); if (x['@graph']) walk(x['@graph']); };
    walk(j);
  });
  return out;
}
const isT = (o, t) => [].concat(o['@type'] || []).includes(t);
const meta = ($, k) => $(`meta[property="${k}"],meta[name="${k}"],meta[itemprop="${k}"]`).first().attr('content') || null;

function parsePage(html, url, cfg) {
  const $ = cheerio.load(html);
  const items = ldItems($);
  const prods = items.filter((o) => isT(o, 'Product') || isT(o, 'ProductGroup'));
  const P = prods.find((o) => o.url && stripUrl(o.url) === stripUrl(url)) || prods.find((o) => o.offers && !(o.offers.offerCount > 3)) || null;
  const ogType = meta($, 'og:type') || '';
  const isProduct = cfg.productCheck ? $(cfg.productCheck).length > 0
    : !!(P || /product/i.test(ogType) || $('[itemtype*="schema.org/Product"]').length || meta($, 'product:price:amount'));
  if (!isProduct) return null;
  let via = P ? 'json-ld' : 'html';
  let name = null, price = null, old = null, currency = null, inStock = null, photos = [], description = null, sizes = [], colors = [];
  if (P) {
    name = clean(P.name);
    const offs = []; const add = (x) => [].concat(x || []).forEach((o) => { if (o) { offs.push(o); if (o.offers) add(o.offers); } });
    add(P.offers);
    [].concat(P.hasVariant || []).forEach((v) => { add(v.offers); if (v.size) sizes.push(v.size); if (v.color) colors.push(v.color); });
    const ps = offs.map((o) => num(o.price ?? o.lowPrice)).filter(Boolean);
    price = ps.length ? Math.min(...ps) : null;
    currency = (offs.find((o) => o.priceCurrency) || {}).priceCurrency || null;
    if (offs.some((o) => o.availability)) inStock = offs.some((o) => /InStock|PreOrder|LimitedAvailability|OnlineOnly/i.test(o.availability || ''));
    [].concat(P.image || []).forEach((i) => photos.push(typeof i === 'string' ? i : i && (i.url || i.contentUrl)));
    if (P.description) description = clean(P.description);
    if (P.color) colors.push(P.color);
    if (P.size) sizes.push(...[].concat(P.size));
  }
  // мікророзмітка
  const ip = $('[itemprop="price"]').first();
  if (!price && ip.length) { price = num(ip.attr('content') || ip.text()); if (price) via = 'html'; }
  if (!currency) currency = $('[itemprop="priceCurrency"]').first().attr('content') || null;
  if (inStock == null) { const av = $('[itemprop="availability"]').first(); if (av.length) inStock = /InStock|PreOrder/i.test(av.attr('href') || av.attr('content') || ''); }
  if (!price) price = num(meta($, 'product:price:amount') || meta($, 'og:price:amount'));
  if (!currency) currency = meta($, 'product:price:currency') || meta($, 'og:price:currency');
  // HTML
  const box = $(cfg.productBox || 'main').first().length ? $(cfg.productBox || 'main').first() : $('body');
  if (!price) {
    const sel = cfg.priceSel || '[class*="price"]';
    box.find(sel).each((_, e) => {
      if (price) return;
      const c = ($(e).attr('class') || '');
      if (!cfg.priceSel && /old|compare|regular|before|was|cross|del/i.test(c)) return;
      const t = $(e).clone().children('del,s,[class*="old"]').remove().end().text().replace(/\s+/g, ' ').trim();
      if (!/\d/.test(t) || t.length > 60) return;
      const v = num((t.match(/\d[\d\s\u00a0]*(?:[.,]\d{1,3})*/) || [])[0]);
      if (v && v >= 50) { price = v; if (/₴|грн|uah/i.test(t)) currency = 'UAH'; }
    });
  }
  {
    const sel = cfg.oldPriceSel || '[class*="old"][class*="price"],[class*="price"] [class*="old"],[class*="price-old"],[class*="price_old"],[class*="compare"][class*="price"],[class*="price"] del,[class*="price"] s,[class*="regular-price"]';
    const v = num(($(sel).first().text().match(/\d[\d\s\u00a0]*(?:[.,]\d{1,3})*/) || [])[0]);
    if (v && price && v > price && v < price * 6) old = v;
  }
  if (!name) name = clean($('h1').first().text()) || clean((meta($, 'og:title') || '').split(/\s+[|–—]\s+/)[0]);
  if (!price || !name) return null;
  if (!currency && /₴|грн/i.test(box.text())) currency = 'UAH';
  // фото
  const og = meta($, 'og:image'); if (og) photos.push(og);
  if (photos.filter(Boolean).length < 3) {
    (cfg.photoSel ? $(cfg.photoSel) : box.find('img')).each((_, e) => {
      const s = $(e).attr('data-zoom-image') || $(e).attr('data-large') || $(e).attr('data-src') || $(e).attr('data-original') || $(e).attr('src') || '';
      if (/\.(jpe?g|png|webp)(\?|$)/i.test(s) && !/logo|icon|sprite|placeholder|loader|banner|payment|flag|svg/i.test(s)) photos.push(s);
    });
  }
  photos = uniq(photos.map((s) => { try { return new URL(s, url).href; } catch { return null; } })).slice(0, 3);
  // наявність з тексту, якщо розмітки немає
  if (inStock == null) {
    const t = box.text();
    if (/немає в наявності|нема в наявності|нет в наличии|out of stock|sold out|розпродано|закінчився/i.test(t) && !/в наявності(?! немає)/i.test(t.replace(/немає в наявності|нема в наявності/gi, ''))) inStock = false;
    else if (/\bв наявності|є в наявності|in stock/i.test(t)) inStock = true;
  }
  if (!description || description.length < 30 || SEO.test(description)) {
    description = null;
    const d = $('[itemprop="description"]').first().text() || $('[class*="product-description"],[class*="product__description"],[class*="description"],[id*="description"],[class*="opys"]').first().text();
    const dt = clean(d);
    if (dt && dt.length > 30 && !SEO.test(dt)) description = dt;
  }
  const crumbs = [];
  const bl = items.find((o) => isT(o, 'BreadcrumbList'));
  if (bl && bl.itemListElement) [].concat(bl.itemListElement).forEach((e) => crumbs.push(clean((e.item && e.item.name) || e.name)));
  if (!crumbs.length) $('[class*="breadcrumb"] a,[class*="breadcrumb"] span[itemprop="name"],[itemtype*="BreadcrumbList"] [itemprop="name"]').each((_, a) => crumbs.push(clean($(a).attr('content') || $(a).text())));
  $('script,style,noscript').remove();
  return {
    name, price, old, currency, inStock, photos, description, care: careFrom(clean($('body').text())), via,
    sizes: uniq(sizes.map((s) => String(s).trim())), colors, crumbs: uniq(crumbs).filter((c) => !/^(головна|home|главная)$/i.test(c)),
  };
}

// ---------------------------------------------------------------- запис
function makeRecord(cfg, o) {
  // o: name, url, price, old, currency, inStock, photos, description, care, sizes, colors, labels[], typeHint, slugHint
  if (!o.name || !o.url || !o.price || !(o.photos || []).length) return { skip: 'no name/price/url/photo' };
  if (o.currency && !/UAH|грн|₴/i.test(o.currency)) return { skip: 'currency ' + o.currency };
  const labels = uniq(o.labels || []);
  const cls = classify(o.name, o.typeHint, labels.join(' | '));
  if (cls && cls.skip) return { skip: 'gift card / kids' };
  let category, item_type, slot;
  if (cls) ({ category, item_type, slot } = cls);
  else {
    const lab = labels.find((l) => l && l.length < 40 && !/^(головна|home|каталог|catalog|всі|all|new|sale|новинки|bestsellers?)/i.test(l));
    category = lab || null; item_type = null; slot = 'other';
  }
  let price = o.price, sale = null;
  if (o.old && o.old > o.price) { price = o.old; sale = o.price; }
  const gTxt = [o.name, labels.join(' | '), o.genderHint || '', decodeURIComponent(o.url)].join(' | ');
  const sizes = uniq((o.sizes || []).map((s) => String(s).trim())).filter((s) => !/^default title$/i.test(s));
  const fromName = COLORS.filter(([re]) => re.test(o.name)).map(([, n]) => n).slice(0, 2);
  return {
    rec: {
      id: cfg.id + '-' + (slugify(o.slugHint || lastSeg(o.url)) || slugify(o.name)),
      brand: cfg.name,
      name: o.name,
      source_url: o.url,
      gender: genderFrom(gTxt) || (cfg.siteGenderOk ? cfg.siteGender.value : null),
      category, item_type, slot,
      colors: (() => { const c = colorsFrom(o.colors || []); return c.length ? c : fromName; })(),
      sizes: sizes.length ? sizes : null,
      price_uah: price,
      sale_price_uah: sale,
      in_stock: o.inStock == null ? null : !!o.inStock,
      photos: uniq(o.photos).slice(0, 3),
      description: o.description ? clean(o.description).slice(0, 1500) || null : null,
      care: o.care ? clean(o.care).slice(0, 500) : null,
      collections: uniq(labels.filter((l) => /new|новинк|sale|розпрод|знижк|bestseller|хіт|колекц|collection|black friday|осінь|зима|fw|ss\d/i.test(l) && l.length < 40)).slice(0, 5),
    },
  };
}

// Обʼєднати колірні варіанти одного товару в один запис.
const COLOR_WORD = new RegExp(COLORS.map(([re]) => re.source).join('|'), 'i');
function baseName(n) {
  return n.split(/(\s+|,|\/|\(|\))/).filter((w) => !COLOR_WORD.test(w)).join('').replace(/[\s,/()–—-]+$/g, '').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
}
function mergeVariants(list) {
  const groups = new Map(), order = [];
  const key = (r) => [baseName(r.name).toLowerCase(), r.price_uah, r.sale_price_uah, r.item_type].join('|');
  for (const r of list) { const k = key(r); if (!groups.has(k)) { groups.set(k, []); order.push(k); } groups.get(k).push(r); }
  // другий прохід: однакові опис і ціна, назви відрізняються лише «хвостом» (фірмова назва кольору)
  const singles = order.filter((k) => groups.get(k).length === 1);
  const byDesc = new Map();
  for (const k of singles) {
    const r = groups.get(k)[0]; if (!r.description || r.description.length < 60) continue;
    const words = r.name.split(/\s+/);
    if (words.length < 2) continue;
    const dk = [r.description.slice(0, 300), r.price_uah, r.sale_price_uah, r.item_type, words[0].toLowerCase()].join('|');
    (byDesc.get(dk) || byDesc.set(dk, []).get(dk)).push(k);
  }
  for (const ks of byDesc.values()) {
    if (ks.length < 2) continue;
    const recs = ks.map((k) => groups.get(k)[0]);
    const ws = recs.map((r) => r.name.split(/\s+/));
    let n = 0; while (ws.every((w) => w[n] && w[n].toLowerCase() === ws[0][n].toLowerCase())) n++;
    if (!n || ws.some((w) => w.length - n > 3)) continue; // різниця має бути коротким хвостом
    recs.forEach((r, i) => { r._tailColor = ws[i].slice(n).join(' '); r._prefix = ws[0].slice(0, n).join(' ').replace(/[\s,–—-]+$/, ''); });
    groups.set(ks[0], recs); ks.slice(1).forEach((k) => groups.delete(k));
  }
  const out = [];
  for (const k of order) {
    const g = groups.get(k); if (!g) continue;
    if (g.length === 1) { delete g[0]._tailColor; delete g[0]._prefix; out.push(g[0]); continue; }
    const main = g.find((r) => r.in_stock) || g[0];
    const names = uniq(g.map((r) => r.name));
    const m = { ...main };
    m.name = names.length === 1 ? names[0] : (g[0]._prefix || baseName(main.name) || main.name);
    m.colors = uniq(g.flatMap((r) => (r.colors.length ? r.colors : colorsFrom([r._tailColor]))));
    m.photos = uniq([...main.photos.slice(0, 1), ...g.filter((r) => r !== main).map((r) => r.photos[0]), ...main.photos.slice(1)]).slice(0, 3);
    m.in_stock = g.some((r) => r.in_stock) ? true : g.every((r) => r.in_stock === false) ? false : null;
    m.sizes = uniq(g.flatMap((r) => r.sizes || [])); if (!m.sizes.length) m.sizes = null;
    m.collections = uniq(g.flatMap((r) => r.collections)).slice(0, 5);
    m.gender = uniq(g.map((r) => r.gender)).length === 1 ? main.gender : g.some((r) => r.gender === 'female') && g.some((r) => r.gender === 'male') ? 'unisex' : main.gender || g.find((r) => r.gender)?.gender || null;
    delete m._tailColor; delete m._prefix;
    m._variants = g.length;
    out.push(m);
  }
  return out;
}

function finalize(cfg, recs) {
  let list = recs;
  if (cfg.scope === 'bags_hats') list = list.filter((r) => r.slot === 'bag' || r.slot === 'hat');
  list = mergeVariants(list);
  const pr = (r) => (r.slot === 'bag' || r.slot === 'hat' ? 0 : r.category === ACC ? 1 : 2);
  list = list.map((r, i) => [r, i]).sort((a, b) => (a[0].in_stock === false) - (b[0].in_stock === false) || pr(a[0]) - pr(b[0]) || a[1] - b[1]).map((x) => x[0]).slice(0, LIMIT);
  const seen = new Map();
  for (const r of list) { const n = seen.get(r.id) || 0; seen.set(r.id, n + 1); if (n) r.id = r.id + '-' + (n + 1); }
  return list;
}

// ---------------------------------------------------------------- рушії
async function shopify(F, cfg, st) {
  const loc = cfg.locale || '';
  const all = [];
  for (let p = 1; p <= 40; p++) {
    const j = await F.get(`${F.origin}/products.json?limit=250&page=${p}`, { json: true });
    if (!j.products || !j.products.length) break;
    all.push(...j.products);
    if (j.products.length < 250) break;
  }
  st.candidates = all.length;
  const labels = {};
  try {
    const cols = [];
    for (let p = 1; p <= 4; p++) { const j = await F.get(`${F.origin}/collections.json?limit=250&page=${p}`, { json: true }); cols.push(...(j.collections || [])); if ((j.collections || []).length < 250) break; }
    // підписи з колекцій потрібні для статі й розділу меню; беремо найкорисніші, щоб не впиратися в ліміт Shopify
    const score = (c) => (FEM.test(c.title) || MAL.test(c.title) || UNI.test(c.title) ? 0 : 1);
    const useful = cols.filter((c) => c.products_count !== 0 && !/^(home ?page|all|всі товари|test|frontpage)/i.test(c.title))
      .sort((a, b) => score(a) - score(b)).slice(0, 30);
    for (const c of useful) {
      for (let p = 1; p <= 6; p++) {
        let j; try { j = await F.get(`${F.origin}/collections/${c.handle}/products.json?limit=250&page=${p}`, { json: true }); } catch (e) { if (e instanceof RateLimited) throw e; if (e instanceof Blocked) throw e; break; }
        (j.products || []).forEach((pr) => (labels[pr.handle] = labels[pr.handle] || []).push(c.title));
        if (!j.products || j.products.length < 250) break;
      }
    }
  } catch (e) {
    if (e instanceof Blocked && !(e instanceof RateLimited)) throw e;
    st.issues.push('колекції зібрано не повністю (' + e.message.slice(0, 80) + ') — частина gender/category може бути null');
  }
  const recs = [];
  for (const p of all) {
    st.checked++;
    const opt = (re) => { const o = (p.options || []).find((x) => re.test(x.name)); return o ? o.values : []; };
    const vars = p.variants || [];
    let prices = vars.map((v) => num(v.price)).filter(Boolean), olds = vars.map((v) => num(v.compare_at_price)).filter(Boolean);
    let inStock = vars.some((v) => v.available !== false);
    const body = p.body_html || '';
    const base = {
      name: clean(p.title), url: `${F.origin}${loc}/products/${p.handle}`, slugHint: p.handle,
      labels: labels[p.handle] || [], typeHint: [p.product_type, Array.isArray(p.tags) ? p.tags.join(' ') : p.tags].join(' | '),
      genderHint: [p.product_type, Array.isArray(p.tags) ? p.tags.join(' ') : p.tags].join(' '),
      currency: 'UAH', photos: (p.images || []).map((i) => i.src.split('?')[0]),
      description: clean(body), care: careFrom(clean(body)),
      sizes: opt(/розмір|размер|size/i), colors: opt(/колір|колір|цвет|colou?r/i),
    };
    if (cfg.presentment) {
      // базова валюта магазину не UAH: беремо ціну, яку бачить покупець в Україні
      const pre = classify(base.name, base.typeHint, base.labels.join(' | '));
      if (cfg.scope === 'bags_hats' && !(pre && (pre.slot === 'bag' || pre.slot === 'hat'))) continue;
      const j = await F.get(`${F.origin}${loc}/products/${p.handle}.js`, { json: true });
      prices = (j.variants || []).map((v) => v.price / 100).filter(Boolean);
      olds = (j.variants || []).map((v) => (v.compare_at_price || 0) / 100).filter(Boolean);
      inStock = (j.variants || []).some((v) => v.available);
    }
    const r = makeRecord(cfg, { ...base, price: prices.length ? Math.min(...prices) : null, old: olds.length ? Math.max(...olds) : null, inStock });
    if (r.rec) recs.push(r.rec); else st.skipped[r.skip] = (st.skipped[r.skip] || 0) + 1;
  }
  st.method = 'products.json'; st.discovery = 'products.json + collections';
  return recs;
}

async function sitemapLocs(F, urls, depth = 0) {
  const out = [];
  for (const u of urls) {
    let x; try { x = (await F.get(u)).text; } catch (e) { if (e instanceof Blocked) throw e; continue; }
    const locs = [...x.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(x) && depth < 2) out.push(...(await sitemapLocs(F, locs.filter((l) => !/image|video|post|page-|blog|news|portfolio|gallery/i.test(l)), depth + 1)));
    else out.push(...locs);
  }
  return uniq(out);
}

async function crawlListings(F, cfg, seeds, st) {
  const found = new Map(); // url -> labels
  const seedSet = new Set(seeds.map((s) => stripUrl(s)));
  for (const seed of seeds) {
    let label = null, prevNew = -1;
    for (let p = 1; p <= 40; p++) {
      const u = p === 1 ? seed : seed + (seed.includes('?') ? '&' : '?') + 'page=' + p;
      let r; try { r = await F.get(u); } catch (e) { if (e instanceof Blocked) throw e; if (p === 1) st.issues.push('категорія недоступна: ' + seed); break; }
      if (p > 1 && stripUrl(r.url) === stripUrl(seed)) break; // редирект на першу сторінку
      const $ = cheerio.load(r.text);
      if (!label) label = clean($('h1').first().text()) || decodeURIComponent(new URL(seed).pathname);
      let fresh = 0;
      $('a[href]').each((_, a) => {
        let h; try { h = stripUrl(new URL($(a).attr('href'), r.url).href); } catch { return; }
        if (!cfg.productRe.test(h) || seedSet.has(h)) return;
        if (!found.has(h)) { found.set(h, []); fresh++; }
        const labs = found.get(h); const full = label + ' ' + decodeURIComponent(new URL(seed).pathname);
        if (!labs.includes(full)) labs.push(full);
      });
      if (fresh === 0 || (prevNew === 0)) break;
      prevNew = fresh;
    }
  }
  return found;
}

async function pages(F, cfg, st) {
  let cand = new Map();
  if (cfg.listingsFromSitemapRe) {
    const [sm, re] = cfg.listingsFromSitemapRe;
    cfg.listings = (await sitemapLocs(F, [sm])).filter((u) => re.test(u) && !/\?/.test(u));
  }
  if (cfg.listings) { cand = await crawlListings(F, cfg, cfg.listings, st); st.discovery = 'сторінки категорій (' + cfg.listings.length + ')'; }
  if (cfg.sitemaps) {
    const locs = (await sitemapLocs(F, cfg.sitemaps)).map(stripUrl).filter((u) => cfg.productRe.test(u) && u.startsWith(F.origin));
    for (const u of locs) if (!cand.has(u)) cand.set(u, []);
    st.discovery = st.discovery ? st.discovery + ' + sitemap' : 'sitemap';
  }
  if (cfg.inSitemap) {
    const ok = new Set((await sitemapLocs(F, [cfg.inSitemap])).map(stripUrl));
    for (const u of [...cand.keys()]) if (!ok.has(u)) cand.delete(u);
  }
  if (cfg.siteGender) {
    try { const h = (await F.get(cfg.site)).text; cfg.siteGenderOk = cfg.siteGender.evidence.test(cheerio.load(h)('title,meta[name="description"],h1').text() + ' ' + (cheerio.load(h)('meta[name="description"]').attr('content') || '')); } catch (e) { if (e instanceof Blocked) throw e; }
    if (!cfg.siteGenderOk) st.issues.push('стать не підтверджена текстом сайту — gender = null, якщо не видно з розділу');
  }
  const urls = [...cand.keys()];
  st.candidates = urls.length;
  const recs = []; const vias = {};
  const need = Math.ceil(LIMIT * 1.6);
  for (const u of urls) {
    if (recs.length >= need) break;
    if (cfg.scope === 'bags_hats' && cand.get(u).length === 0) {
      // з sitemap без підпису — відкидаємо очевидно не наші за URL
      const c = classify(decodeURIComponent(u).replace(/[-_/]/g, ' '));
      if (c && !c.skip && !(c.slot === 'bag' || c.slot === 'hat') && !/bags|backpacks/.test(u)) continue;
    }
    st.checked++;
    let r; try { r = await F.get(u); } catch (e) { if (e instanceof Blocked) throw e; st.errors++; continue; }
    const p = parsePage(r.text, stripUrl(r.url), cfg);
    if (!p) { st.skipped['не сторінка товару'] = (st.skipped['не сторінка товару'] || 0) + 1; continue; }
    vias[p.via] = (vias[p.via] || 0) + 1;
    const m = makeRecord(cfg, { ...p, url: stripUrl(r.url), labels: [...cand.get(u), ...p.crumbs] });
    if (m.rec) recs.push(m.rec); else st.skipped[m.skip] = (st.skipped[m.skip] || 0) + 1;
    if (st.checked % 50 === 0) log(cfg.id, `checked ${st.checked}/${urls.length}, records ${recs.length}`);
  }
  st.method = (vias['json-ld'] || 0) >= (vias.html || 0) ? 'json-ld' : 'html';
  return recs;
}

async function tilda(F, cfg, st) {
  const locs = (await sitemapLocs(F, cfg.listingsFromSitemap)).filter((u) => u.startsWith(F.origin) && new URL(u).pathname.length > 1);
  const recs = []; const seen = new Set();
  for (const u of locs) {
    let r; try { r = await F.get(u); } catch (e) { if (e instanceof Blocked) throw e; continue; }
    st.checked++;
    const $ = cheerio.load(r.text);
    const pageLabel = clean($('meta[property="og:title"]').attr('content') || $('title').text());
    $('.js-product[data-product-lid]').each((_, el) => {
      const c = $(el); const lid = c.attr('data-product-lid');
      const recid = (c.closest('[id^="rec"]').attr('id') || '').replace(/^rec/, '');
      if (!lid || seen.has(lid)) return;
      const name = clean(c.find('.js-product-name').first().text());
      const price = num(c.find('.js-product-price').first().text());
      const old = num(c.find('[field^="li_price_old"]').first().text());
      const img = c.find('[data-original]').first().attr('data-original') || c.find('img').first().attr('src');
      const descr = clean(c.find('.js-product-descr,[field^="li_descr"]').first().text());
      if (!name) return;
      seen.add(lid);
      const m = makeRecord(cfg, {
        name, price, old, currency: 'UAH', inStock: null, photos: img ? [img] : [], description: descr || null,
        url: `${stripUrl(u)}#!/tproduct/${recid}-${lid}`, slugHint: slugify(name) + '-' + lid.slice(-5), labels: [pageLabel],
      });
      if (m.rec) recs.push(m.rec); else st.skipped[m.skip] = (st.skipped[m.skip] || 0) + 1;
    });
  }
  st.candidates = seen.size; st.method = 'html'; st.discovery = 'sitemap → сторінки категорій Tilda (статичні картки)';
  if (recs.length) st.issues.push('Tilda-картки не містять наявності — in_stock = null; 1 фото на товар');
  return recs;
}

// ---------------------------------------------------------------- перевірка 3 випадкових товарів
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, ' ').trim();
const sameName = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b || a.includes(b) || b.includes(a)) return true; const wa = new Set(a.split(' ')), wb = b.split(' '); return wb.filter((w) => wa.has(w)).length / Math.max(wa.size, wb.length) >= 0.6; };

async function verify(F, cfg, list, st) {
  const pick = [...list].sort(() => Math.random() - 0.5).slice(0, 3);
  const out = [];
  for (const rec of pick) {
    const v = { id: rec.id, url: rec.source_url, ok: true, fixed: [] };
    try {
      let page;
      if (cfg.engine === 'tilda') {
        const [u, frag] = rec.source_url.split('#!/tproduct/'); const lid = frag.split('-').pop();
        const $ = cheerio.load((await F.get(u)).text); const c = $(`.js-product[data-product-lid="${lid}"]`).first();
        page = c.length ? { name: clean(c.find('.js-product-name').first().text()), price: num(c.find('.js-product-price').first().text()), old: num(c.find('[field^="li_price_old"]').first().text()), inStock: null } : null;
      } else if (cfg.engine === 'shopify') {
        const j = await F.get(rec.source_url.replace(/\/products\//, '/products/') + '.js', { json: true });
        const ps = j.variants.map((x) => x.price / 100), os = j.variants.map((x) => (x.compare_at_price || 0) / 100).filter(Boolean);
        page = { name: j.title, price: Math.min(...ps), old: os.length ? Math.max(...os) : null, inStock: j.variants.some((x) => x.available) };
      } else {
        const r = await F.get(rec.source_url); page = parsePage(r.text, rec.source_url, cfg);
      }
      if (!page) { v.ok = false; v.note = 'сторінка не розпізнана при перевірці'; out.push(v); continue; }
      const cur = rec.sale_price_uah ?? rec.price_uah;
      const pagePrice = page.old && page.old > page.price ? [page.old, page.price] : [page.price, null];
      if (!sameName(rec.name, page.name)) {
        v.ok = false;
        if (!rec._variants) { v.fixed.push(`назва «${rec.name}» → «${page.name}»`); rec.name = page.name; } else v.note = `обʼєднаний запис; на сторінці варіанта «${page.name}»`;
      }
      if (pagePrice[0] && (pagePrice[0] !== rec.price_uah || pagePrice[1] !== rec.sale_price_uah) && Math.round(page.price) !== cur) {
        v.ok = false; v.fixed.push(`ціна ${rec.price_uah}/${rec.sale_price_uah} → ${pagePrice[0]}/${pagePrice[1]}`);
        rec.price_uah = Math.round(pagePrice[0]); rec.sale_price_uah = pagePrice[1] != null ? Math.round(pagePrice[1]) : null;
      }
      if (page.inStock != null && rec.in_stock != null && page.inStock !== rec.in_stock && !rec._variants) {
        v.ok = false; v.fixed.push(`наявність ${rec.in_stock} → ${page.inStock}`); rec.in_stock = page.inStock;
      }
    } catch (e) { if (e instanceof Blocked) throw e; v.ok = false; v.note = 'помилка перевірки: ' + e.message.slice(0, 100); }
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- запуск
const log = (id, ...m) => console.log(new Date().toTimeString().slice(0, 8), id.padEnd(12), ...m);
const outPath = (cfg) => join(HERE, cfg.id, cfg.out || 'products.json');

async function runBrand(cfg) {
  const st = { candidates: 0, checked: 0, errors: 0, skipped: {}, issues: [], method: null, discovery: null };
  const doc = (products, extra = {}) => ({
    _meta: {
      brand: cfg.name, site: cfg.site, extracted_at: TODAY, count: products.length, method: st.method, scope: cfg.scope === 'bags_hats' ? 'лише сумки, рюкзаки, головні убори' : 'усі товари',
      discovery: st.discovery, candidates: st.candidates, checked: st.checked, skipped: st.skipped, issues: st.issues, ...extra,
    },
    products,
  });
  const save = (d) => { mkdirSync(join(HERE, cfg.id), { recursive: true }); writeFileSync(outPath(cfg), JSON.stringify(d, null, 2) + '\n', 'utf-8'); };
  if (cfg.engine === 'none') { st.method = null; save(doc([], { note: cfg.note })); log(cfg.id, 'stub:', cfg.note); return; }
  if (!cfg.out && existsSync(outPath(cfg)) && !flag('force') && !JSON.parse(readFileSync(outPath(cfg), 'utf-8'))._meta?.discovery) {
    log(cfg.id, 'SKIP: існує база, створена не цим скриптом'); return;
  }
  const F = new Fetcher(cfg);
  const t0 = Date.now();
  try {
    await F.init();
    if (!F.robots.allowed(cfg.site)) throw new Blocked('robots.txt забороняє сайт');
    const recs = cfg.engine === 'shopify' ? await shopify(F, cfg, st) : cfg.engine === 'tilda' ? await tilda(F, cfg, st) : await pages(F, cfg, st);
    const list = finalize(cfg, recs);
    const ver = await verify(F, cfg, list, st);
    list.forEach((r) => delete r._variants);
    if (F.skippedRobots.length) st.issues.push(`robots.txt: пропущено ${F.skippedRobots.length} URL (напр. ${new URL(F.skippedRobots[0]).pathname})`);
    if (!list.length) st.issues.push('не знайдено жодного товару');
    save(doc(list, { requests: F.n, minutes: +((Date.now() - t0) / 60000).toFixed(1), verified: ver }));
    log(cfg.id, `DONE ${list.length} (raw ${recs.length}, ${st.method}, ${F.n} req, ${((Date.now() - t0) / 60000).toFixed(1)} min) verify: ${ver.map((v) => (v.ok ? 'ok' : 'FIX ' + (v.fixed.join('; ') || v.note))).join(' | ')}`);
  } catch (e) {
    const blocked = e instanceof Blocked;
    st.issues.push((blocked ? 'ЗАБЛОКОВАНО: ' : 'ПОМИЛКА: ') + e.message);
    if (!cfg.out) save(doc([], { note: (blocked ? 'Не зібрано: ' : 'Помилка: ') + e.message }));
    else st.issues.push('файл не записано, щоб не чіпати наявну базу');
    log(cfg.id, blocked ? 'BLOCKED' : 'FAIL', e.message);
  } finally { await F.close(); }
}

// ---------------------------------------------------------------- звіт і словник
function report() {
  const rows = [], failed = [], catsSeen = new Map();
  for (const cfg of BRANDS) {
    const p = outPath(cfg);
    if (!existsSync(p)) { failed.push([cfg.id, 'файл не створено']); continue; }
    const d = JSON.parse(readFileSync(p, 'utf-8'));
    const m = d._meta, ps = d.products;
    const ids = new Set(ps.map((x) => x.id));
    const issues = [...(m.issues || [])];
    if (ids.size !== ps.length) issues.push('ДУБЛІКАТИ id');
    const ver = (m.verified || []);
    const fixes = ver.filter((v) => !v.ok);
    if (ver.length) issues.push(`перевірка 3 товарів: ${ver.length - fixes.length}/${ver.length} збіглися` + (fixes.length ? ' (' + fixes.map((v) => v.fixed.join(', ') || v.note).join('; ') + ')' : ''));
    const nullG = ps.filter((x) => !x.gender).length; if (nullG) issues.push(`gender = null у ${nullG}`);
    const nullS = ps.filter((x) => x.in_stock == null).length; if (nullS && cfg.engine !== 'tilda') issues.push(`in_stock = null у ${nullS}`);
    if (m.note && !ps.length) failed.push([cfg.id, m.note]);
    const file = cfg.id + '/' + (cfg.out || 'products.json');
    rows.push(`| ${cfg.name} (\`${file}\`) | ${ps.length} | ${m.method || '—'} | ${ps.filter((x) => x.slot === 'bag').length} | ${ps.filter((x) => x.slot === 'hat').length} | ${issues.join('; ').replace(/\|/g, '/') || '—'} |`);
    for (const x of ps) if (x.category) { const c = catsSeen.get(x.category) || { slot: {}, types: new Set() }; c.slot[x.slot] = (c.slot[x.slot] || 0) + 1; if (x.item_type) c.types.add(x.item_type); catsSeen.set(x.category, c); }
  }
  const md = `# Звіт: каталоги брендів сумок і аксесуарів

Згенеровано \`node data/database/scrape_brands.mjs --report\` · ${TODAY}

Методи: \`products.json\` — Shopify API магазину; \`json-ld\` — schema.org Product на сторінці товару; \`html\` — мікророзмітка/HTML.
Для Estro, Gepur, Harvest, HURU, Kachorovska зібрано лише сумки, рюкзаки та головні убори. Gepur і Kachorovska вже мали базу одягу,
тому їхні сумки/головні убори лежать в окремому файлі \`bags_hats.json\` (наявний \`products.json\` не змінено).
Перевірка: для кожного бренду 3 випадкові товари повторно відкрито на сайті й порівняно назву, ціну, наявність; розбіжності виправлено в записі.

| бренд | товарів | метод | сумок | головних уборів | проблеми |
|---|---|---|---|---|---|
${rows.join('\n')}

## Не вдалося зібрати
${failed.map(([id, why]) => `- **${id}** — ${why}`).join('\n') || '—'}
`;
  writeFileSync(join(HERE, 'REPORT.md'), md, 'utf-8');
  // categories.json: додати словник і нові розділи, нічого не видаляючи
  const cp = join(HERE, 'categories.json');
  const cats = existsSync(cp) ? JSON.parse(readFileSync(cp, 'utf-8')) : [];
  const byName = new Map(cats.map((c) => [c.category, c]));
  for (const d of DICT) { const c = byName.get(d.category); if (c) { c.item_types = uniq([...c.item_types, ...d.item_types]); if (d.category !== ACC) c.slot = d.slot; } else { const n = { ...d }; cats.push(n); byName.set(n.category, n); } }
  for (const [name, v] of catsSeen) {
    const slot = Object.entries(v.slot).sort((a, b) => b[1] - a[1])[0][0];
    const c = byName.get(name);
    if (c) c.item_types = uniq([...c.item_types, ...v.types]);
    else { const n = { category: name, slot, item_types: [...v.types] }; cats.push(n); byName.set(name, n); }
  }
  writeFileSync(cp, JSON.stringify(cats, null, 2) + '\n', 'utf-8');
  console.log('REPORT.md and categories.json updated');
}

async function main() {
  if (!flag('report')) {
    const todo = BRANDS.filter((b) => !ONLY.length || ONLY.includes(b.id));
    console.log('brands:', todo.map((b) => b.id).join(', '));
    // Shopify рахує ліміт на products.json по IP для всіх магазинів разом — ці бренди йдуть по черзі в одному потоці.
    const shop = todo.filter((b) => b.engine === 'shopify'), rest = todo.filter((b) => b.engine !== 'shopify');
    let i = 0;
    await Promise.all([
      (async () => { for (const b of shop) await runBrand(b); })(),
      ...Array.from({ length: Math.max(1, PARALLEL - 1) }, async () => { while (i < rest.length) await runBrand(rest[i++]); }),
    ]);
    if (browserP) await (await browserP).close();
  }
  report();
}
main().catch((e) => { console.error(e); process.exit(1); });
