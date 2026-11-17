/*
 * Ґуґля — універсальний збирач каталогу бренду.
 * Запускається в браузері на сайті бренду (консоль або Claude in Chrome):
 *   window.__cfg = { id: 'oslo', name: 'OSLO', gender: null, kind: 'clothes' };
 *   eval(await (await fetch('https://raw.githubusercontent.com/TarasKonoval/guglya/main/data/database/scraper.js')).text());
 * Стан: window.__g (status, found, checked, products). Наприкінці качає guglya_<id>.json.
 * Порядок: Shopify /products.json → sitemap + JSON-LD на сторінці товару → обхід меню.
 */
(() => {
  const CFG = window.__cfg || {};
  const LIMIT = CFG.limit || 300;
  const COLLECT = CFG.collect || 450;
  const MAX_CHECK = CFG.maxCheck || 1400;
  const G = (window.__g = {
    status: 'running', brand: CFG.name, mode: null, found: 0, checked: 0,
    candidates: 0, products: [], errors: [], started: Date.now(),
  });
  const ORIGIN = location.origin;
  const HOST = location.hostname.replace(/^www\./, '');

  // ---------- словник категорій: [regex, category, item_type, slot] ----------
  const OUT = 'Верхній одяг', TOP = 'Верх', KNIT = 'Светри / Гольфи / Джемпери',
    TEE = 'Футболки / Майки / Поло / Топи', BODY = 'Боді / Лонгсліви', BOT = 'Низ',
    SET = 'Комплекти', DRESS = 'Сукні', SHOES = 'Взуття', ACC = 'Аксесуари',
    UND = 'Нижня білизна', SWIM = 'Купальники', ETNO = 'Вишиванки';
  const B = '(^|[\\s\\-«"(/|,.])', E = '($|[\\s\\-»")/|,.])';
  const R = (s) => new RegExp(s, 'i');
  const RULES = [
    [R('вишиван|вышиван'), ETNO, 'Вишиванка', 'top'],
    [R('піжам|пижам|халат|нічн\\S* сорочк'), UND, 'Піжама / Халат', 'other'],
    [R('купальн|swimsuit|swimwear|бікіні|bikini'), SWIM, 'Купальник', 'other'],
    [R('пухов|puffer|down jacket'), OUT, 'Пуховик', 'top'],
    [R('тренч|trench'), OUT, 'Тренч', 'top'],
    [R('шуб[аиу]|fur coat'), OUT, 'Шуба', 'top'],
    [R('пальт|\\bcoat\\b|overcoat'), OUT, 'Пальто', 'top'],
    [R('косух|biker'), OUT, 'Косуха', 'top'],
    [R('дублян|дубленк|sheepskin'), OUT, 'Дублянка', 'top'],
    [R('бомбер|bomber'), OUT, 'Бомбер', 'top'],
    [R('вітрів|ветровк|windbreaker'), OUT, 'Вітрівка', 'top'],
    [R('парка|парки|parka'), OUT, 'Парка', 'top'],
    [R('куртк|анорак|\\bjacket'), OUT, 'Куртка', 'top'],
    [R('спортивн\\S* костюм|tracksuit|костюм на фліс'), SET, 'Спортивний костюм', 'top'],
    [R('класичн\\S* костюм|\\bsuit\\b|костюм-трійк|костюм-двійк'), SET, 'Класичний костюм', 'top'],
    [R('комбінезон|комбинезон|jumpsuit'), SET, 'Комбінезон', 'top'],
    [R('комплект|костюм|\\bset\\b'), SET, 'Комплект', 'top'],
    [R('сукн|сукон|плаття|платье|сарафан|\\bdress'), DRESS, 'Сукня', 'top'],
    [R('піджак|пиджак|жакет|блейзер|blazer'), TOP, 'Піджак', 'top'],
    [R('жилет|\\bvest\\b|gilet'), TOP, 'Жилет', 'top'],
    [R('кардиган|cardigan'), KNIT, 'Кардиган', 'top'],
    [R('гольф|водолаз|turtleneck'), KNIT, 'Гольф', 'top'],
    [R('джемпер|jumper'), KNIT, 'Джемпер', 'top'],
    [R('светр|свитер|sweater|пуловер|pullover|в.язан'), KNIT, 'Светр', 'top'],
    [R('худі|худи|hoodie'), TOP, 'Худі', 'top'],
    [R('світшот|свитшот|sweatshirt|кофт|олімпійк|фліск|флиск|fleece'), TOP, 'Світшот', 'top'],
    [R('лонгслів|лонгслив|longsleeve|long sleeve'), BODY, 'Лонгслів', 'top'],
    [R(B + 'боді' + E + '|' + B + 'body' + E + '|bodysuit'), BODY, 'Боді', 'top'],
    [R('футболк|t-?shirt|' + B + 'tee' + E), TEE, 'Футболка', 'top'],
    [R(B + 'поло' + E + '|\\bpolo\\b'), TEE, 'Поло', 'top'],
    [R('майк|\\btank\\b|борцівк'), TEE, 'Майка', 'top'],
    [R('корсет|corset'), TEE, 'Корсет', 'top'],
    [R(B + 'топ' + E + '|кроп-?топ|\\btop\\b|бюстьє'), TEE, 'Топ', 'top'],
    [R('блуз|blouse'), TOP, 'Блуза', 'top'],
    [R('сорочк|рубашк|\\bshirt'), TOP, 'Сорочка', 'top'],
    [R('спідниц|юбк|skirt'), BOT, 'Спідниця', 'bottom'],
    [R('джинс|jeans'), BOT, 'Джинси', 'bottom'],
    [R('шорт|shorts'), BOT, 'Шорти', 'bottom'],
    [R('легінс|лосин|leggings'), BOT, 'Легінси', 'bottom'],
    [R('спортивн\\S* штан|джогер|jogger|sweatpants'), BOT, 'Спортивні штани', 'bottom'],
    [R('чинос|чіноси|chino'), BOT, 'Чіноси', 'bottom'],
    [R('брюк|штан|\\bpants|trousers|кюлот|палац|палаццо'), BOT, 'Брюки', 'bottom'],
    [R('кросів|кроссов|sneaker|trainer'), SHOES, 'Кросівки', 'shoes'],
    [R('кеди|кеды|\\bkeds'), SHOES, 'Кеди', 'shoes'],
    [R('лофер|loafer'), SHOES, 'Лофери', 'shoes'],
    [R('чобіт|чоботи|сапог'), SHOES, 'Чоботи', 'shoes'],
    [R('челсі|челси|chelsea|черевик|ботин|ботильйон|\\bboots?\\b'), SHOES, 'Черевики', 'shoes'],
    [R('мюлі|мюли|\\bmules'), SHOES, 'Мюлі', 'shoes'],
    [R('сандал|босоніж|босонож'), SHOES, 'Сандалі', 'shoes'],
    [R('туфл|оксфорд|oxford|броги|brogue|дербі|derby|мокасин|балетк|сліпон|slip-on'), SHOES, 'Туфлі', 'shoes'],
    [R('шльоп|сланц|тапоч|капці'), SHOES, 'Капці', 'shoes'],
    [R('взутт|обув|shoes'), SHOES, 'Взуття', 'shoes'],
    [R('панам'), ACC, 'Панама', 'hat'],
    [R('капелюх|шляп|федора|fedora|канот'), ACC, 'Капелюх', 'hat'],
    [R('кепк|бейсболк|кашкет|картуз|\\bcaps?\\b'), ACC, 'Кепка', 'hat'],
    [R(B + 'берет' + E), ACC, 'Берет', 'hat'],
    [R('балаклав'), ACC, 'Балаклава', 'hat'],
    [R('шапк|beanie|біні|\\bhats?\\b'), ACC, 'Шапка', 'hat'],
    [R('шарф|снуд|scarf'), ACC, 'Шарф', 'other'],
    [R('хустк|бандан'), ACC, 'Хустка', 'other'],
    [R('рукавиц|рукавич|gloves'), ACC, 'Рукавички', 'other'],
    [R('ремін|ремен|\\bbelt'), ACC, 'Ремінь', 'other'],
    [R('сумк|шопер|рюкзак|клатч|\\bbag'), ACC, 'Сумка', 'other'],
    [R('гаман|wallet|картхолдер'), ACC, 'Гаманець', 'other'],
    [R('окуляр|glasses'), ACC, 'Окуляри', 'other'],
    [R('шкарпет|носк|socks'), ACC, 'Шкарпетки', 'other'],
    [R('прикрас|сереж|намист|браслет|каблучк|кулон|брошк|jewel'), ACC, 'Прикраси', 'other'],
    [R('трус|бюстгальт|бралет|lingerie'), UND, 'Білизна', 'other'],
  ];
  const SKIP = R('сертифікат|сертификат|gift ?card|подарунков\\S* карт|подарочн|e-gift');
  const PROMO = R('sale|new|bestseller|black ?friday|весь|всі|все товар|знижк|розпрод|акці|1\\+1|колекц|collection|новинк|популяр|головна|home|каталог|catalog|shop|магазин|рекоменд|уцінк|архів|outlet|ціною');

  const COLORS = [
    [R('чорн|черн|black'), 'чорний'], [R('графіт|графит|graphite|antracite|антрацит'), 'графіт'],
    [R('біл(ий|а|е|і)|бел(ый|ая|ое)|white'), 'білий'], [R('сір|сер(ый|ая|ое)|grey|gray'), 'сірий'],
    [R('меланж|melange'), 'меланж'], [R('беж|beige'), 'бежевий'], [R('пісоч|песоч|sand'), 'пісочний'],
    [R('шоколад|chocolate'), 'шоколадний'], [R('корич|brown|мокко|mocha|кава|coffee'), 'коричневий'],
    [R('молоч|milk|ivory|айворі|екрю|ecru'), 'молочний'], [R('кремов|cream'), 'кремовий'],
    [R('блакит|голуб|light blue|sky'), 'блакитний'], [R('темно-син|navy'), 'темно-синій'],
    [R('син(ій|я|є|і)|син(ий|яя)|blue'), 'синій'], [R('олив|olive'), 'оливковий'], [R('хакі|хаки|khaki'), 'хакі'],
    [R('м.ятн|mint'), 'мʼятний'], [R('зелен|green'), 'зелений'], [R('бордо|burgundy|марсал|вишн'), 'бордовий'],
    [R('червон|красн|\\bred\\b'), 'червоний'], [R('рожев|розов|pink'), 'рожевий'], [R('лаванд|lavender|бузк'), 'лавандовий'],
    [R('фіолет|фиолет|purple|violet'), 'фіолетовий'], [R('жовт|желт|yellow'), 'жовтий'],
    [R('помаран|оранж|orange'), 'помаранчевий'], [R('теракот|terracotta'), 'теракотовий'],
    [R('золот|gold'), 'золотий'], [R('срібл|серебр|silver'), 'срібний'],
  ];
  const SIZE_RE = /^(XXS|XS|S|M|L|XL|XXL|XXXL|[2-5]XL|XS\/S|S\/M|M\/L|L\/XL|XL\/XXL|ONE ?SIZE|ONESIZE|OS|UNI|\d{2}(?:[.,]5)?|\d{2}-\d{2}|\d{3}|[1-4]|0)$/i;
  const FEM = R('жіноч|жінк|женск|женщин|\\bwomen|\\bwoman|female|для неї|zhinoch|zhinkam|\\/women|\\/zhin');
  const MAL = R('чоловіч|чолові|мужск|мужчин|\\bmen\\b|\\bman\\b|\\bmale\\b|для нього|cholovi|\\/men\\b|\\/men\\/');
  const UNI = R('унісекс|унисекс|unisex');

  // ---------- утиліти ----------
  const clean = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const num = (v) => {
    if (v == null) return null;
    const s = String(v).replace(/[\s  ]/g, '').replace(/[^\d.,]/g, '');
    if (!s) return null;
    const n = parseFloat(/,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, ''));
    return isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const abs = (u) => { try { return new URL(u, ORIGIN).href; } catch (e) { return null; } };
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const sameHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') === HOST; } catch (e) { return false; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function get(u, type = 'text', tries = 5) {
    for (let a = 0; ; a++) {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 25000);
      try {
        const r = await fetch(u, { signal: c.signal, credentials: 'include' });
        if ((r.status === 429 || r.status >= 500) && a < tries) { await sleep(2000 * (a + 1) + Math.random() * 1500); continue; }
        if (!r.ok) throw new Error(r.status + ' ' + u);
        return type === 'json' ? await r.json() : await r.text();
      } catch (e) {
        if (e.name === 'AbortError' && a < 2) continue;
        throw e;
      } finally { clearTimeout(t); }
    }
  }
  async function pool(items, n, fn, stop) {
    let i = 0;
    const w = async () => {
      while (i < items.length && !(stop && stop())) {
        const it = items[i++];
        try { await fn(it); } catch (e) { if (G.errors.length < 40) G.errors.push(String(e).slice(0, 120)); }
      }
    };
    await Promise.all(Array.from({ length: n }, w));
  }
  const classify = (primary, secondary) => {
    for (const txt of [primary, secondary]) {
      if (!txt) continue;
      for (const [re, c, t, s] of RULES) if (re.test(txt)) return { category: c, item_type: t, slot: s };
    }
    return null;
  };
  const colorsFrom = (arr) => uniq(arr.flatMap((v) => {
    const s = String(v || ''); const hit = COLORS.filter(([re]) => re.test(s)).map(([, n]) => n);
    return hit.length ? hit.slice(0, 2) : [];
  }));
  const genderFrom = (txt) => {
    if (UNI.test(txt)) return 'unisex';
    const f = FEM.test(txt), m = MAL.test(txt.replace(/women|woman/gi, ''));
    if (f && m) return 'unisex';
    if (f) return 'female';
    if (m) return 'male';
    return CFG.gender || null;
  };
  const careFrom = (text) => {
    const m = text.match(/(Про догляд|Догляд за виробом|Догляд за річчю|Рекомендації (?:з|по) догляду|Догляд|Уход за изделием|Care)\s*:?\s*(.{15,450}?)(?=\s*(Доставка|Оплата|Повернення|Обмін|Розмірна сітка|Таблиця розмір|Опис|Характеристики|СУПУТНІ|Схожі|Вам також|Відгуки|Додати в кошик|$))/i);
    return m && !/[{}"\\]/.test(m[2]) ? m[2].trim() : null;
  };
  const slugOf = (u) => {
    try { const p = new URL(u).pathname.split('/').filter(Boolean); return decodeURIComponent(p[p.length - 1] || 'item').toLowerCase().replace(/\.html?$/, '').replace(/[^a-z0-9а-яіїєґ]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80); }
    catch (e) { return 'item'; }
  };

  function build(o) {
    // o: name, url, labels[], tags text, price, old, currency, inStock, photos, description, care, sizes, colors
    if (!o.name || SKIP.test(o.name) || SKIP.test(o.url)) return null;
    const labelsTxt = (o.labels || []).join(' | ');
    const cls = classify(o.name, [labelsTxt, o.extra].filter(Boolean).join(' | '));
    let category = cls && cls.category, item_type = cls && cls.item_type, slot = cls ? cls.slot : 'other';
    if (!cls) {
      const lab = (o.labels || []).find((l) => l && l.length < 40 && !PROMO.test(l));
      category = lab || null; item_type = null;
    }
    let price = o.price, sale = null;
    if (o.old && price && o.old > price && o.old < price * 6) { sale = price; price = o.old; }
    const uah = !o.currency || /UAH|грн|₴/i.test(o.currency);
    const rec = {
      id: (CFG.id || HOST) + '-' + slugOf(o.url),
      brand: CFG.name || HOST,
      name: o.name,
      source_url: o.url,
      gender: genderFrom([o.name, labelsTxt, o.extra, decodeURIComponent(o.url)].join(' | ')),
      category, item_type, slot,
      colors: uniq((o.colors && o.colors.length ? colorsFrom(o.colors) : []).concat(o.colors && o.colors.length ? [] : colorsFrom([o.name]))),
      sizes: uniq((o.sizes || []).map((s) => String(s).trim().toUpperCase()).filter((s) => SIZE_RE.test(s))),
      price_uah: uah ? price || null : null,
      sale_price_uah: uah ? sale : null,
      in_stock: o.inStock == null ? null : !!o.inStock,
      photos: uniq((o.photos || []).map(abs)).slice(0, 3),
      description: o.description ? clean(o.description).slice(0, 1500) : null,
      care: o.care ? clean(o.care).slice(0, 500) : null,
      collections: uniq((o.labels || []).filter((l) => l && PROMO.test(l) && l.length < 40 && !/^(головна|home|каталог|catalog|весь асортимент|всі товари|all|shop|магазин)/i.test(l.trim())).map((l) => l.replace(/\s+\/.*$/, ''))).slice(0, 5),
    };
    if (!uah && price) rec.price_foreign = { amount: price, sale: sale, currency: o.currency };
    if (!rec.photos.length || !(rec.price_uah || rec.price_foreign)) return null;
    return rec;
  }

  // ---------- Shopify ----------
  async function shopify() {
    const root = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
    let first;
    try { first = await get(root + 'products.json?limit=250&page=1', 'json'); } catch (e) { return false; }
    if (!first || !Array.isArray(first.products)) return false;
    G.mode = 'shopify';
    let all = first.products;
    for (let p = 2; p <= 12 && first.products.length === 250; p++) {
      const j = await get(root + 'products.json?limit=250&page=' + p, 'json').catch(() => null);
      if (!j || !j.products.length) break;
      all = all.concat(j.products);
      if (j.products.length < 250) break;
    }
    G.candidates = all.length;
    const labels = {};
    try {
      const cj = await get(root + 'collections.json?limit=250', 'json');
      const cols = (cj.collections || []).filter((c) => c.products_count !== 0).slice(0, 60);
      await pool(cols, 4, async (c) => {
        for (let p = 1; p <= 4; p++) {
          const j = await get(root + 'collections/' + c.handle + '/products.json?limit=250&page=' + p, 'json');
          (j.products || []).forEach((pr) => (labels[pr.handle] = labels[pr.handle] || []).push(c.title));
          if (!j.products || j.products.length < 250) break;
        }
      });
    } catch (e) { G.errors.push('collections: ' + e); }
    const cur = (window.Shopify && Shopify.currency && Shopify.currency.active) || null;
    for (const p of all) {
      G.checked++;
      const opt = (re) => { const o = (p.options || []).find((x) => re.test(x.name)); return o ? o.values : []; };
      const vars = p.variants || [];
      const prices = vars.map((v) => num(v.price)).filter(Boolean);
      const olds = vars.map((v) => num(v.compare_at_price)).filter(Boolean);
      const body = clean(p.body_html);
      const r = build({
        name: clean(p.title),
        url: ORIGIN + root.replace(/\/$/, '') + '/products/' + p.handle,
        labels: [p.product_type].concat(labels[p.handle] || []),
        extra: (Array.isArray(p.tags) ? p.tags.join(' ') : p.tags || ''),
        price: prices.length ? Math.min(...prices) : null,
        old: olds.length ? Math.max(...olds) : null,
        currency: cur,
        inStock: vars.some((v) => v.available !== false),
        photos: (p.images || []).map((i) => i.src),
        description: body,
        care: careFrom(body),
        sizes: opt(/розмір|размер|size/i),
        colors: opt(/колір|цвет|колiр|color|colour/i),
      });
      if (r) G.products.push(r);
    }
    G.found = G.products.length;
    return true;
  }

  // ---------- сторінка товару (generic) ----------
  function ldItems(doc) {
    const out = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const walk = (x) => {
          if (!x) return;
          if (Array.isArray(x)) return x.forEach(walk);
          if (typeof x !== 'object') return;
          out.push(x);
          if (x['@graph']) walk(x['@graph']);
        };
        walk(JSON.parse(s.textContent));
      } catch (e) {}
    });
    return out;
  }
  const isT = (o, t) => { const y = o['@type']; return Array.isArray(y) ? y.includes(t) : y === t; };
  const meta = (doc, k) => { const m = doc.querySelector(`meta[property="${k}"],meta[name="${k}"],meta[itemprop="${k}"]`); return m ? m.getAttribute('content') : null; };

  function parseProduct(html, url, menuLabels) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = ldItems(doc);
    const P = items.find((o) => isT(o, 'Product')) || items.find((o) => isT(o, 'ProductGroup'));
    const crumbs = [];
    const bl = items.find((o) => isT(o, 'BreadcrumbList'));
    if (bl && bl.itemListElement) [].concat(bl.itemListElement).forEach((e) => crumbs.push(clean((e.item && e.item.name) || e.name)));
    if (!crumbs.length) doc.querySelectorAll('[class*="breadcrumb" i] a,[class*="breadcrumb" i] span,nav[aria-label*="breadcrumb" i] a').forEach((a) => crumbs.push(clean(a.textContent)));
    doc.querySelectorAll('script,style,noscript,template,svg').forEach((e) => e.remove());
    const text = clean(doc.body ? doc.body.textContent : '');
    let name = P && clean(P.name) || clean((doc.querySelector('h1') || {}).textContent) || clean(meta(doc, 'og:title'));
    const ogType = meta(doc, 'og:type') || '';
    let price = null, currency = null, inStock = null, sizes = [], colors = [];
    if (P) {
      const offs = [];
      const addOffers = (x) => [].concat(x || []).forEach((o) => { if (!o) return; offs.push(o); if (o.offers) addOffers(o.offers); });
      addOffers(P.offers);
      [].concat(P.hasVariant || []).forEach((v) => { addOffers(v.offers); if (v.size) sizes.push(v.size); if (v.color) colors.push(v.color); });
      const ps = offs.map((o) => num(o.price != null ? o.price : o.lowPrice)).filter(Boolean);
      price = ps.length ? Math.min(...ps) : null;
      currency = (offs.find((o) => o.priceCurrency) || {}).priceCurrency || null;
      if (offs.length) inStock = offs.some((o) => /InStock|PreOrder|LimitedAvailability/i.test(o.availability || ''));
      if (P.color) colors.push(P.color);
      if (P.size) sizes.push(P.size);
    }
    if (!price) price = num(meta(doc, 'product:price:amount') || meta(doc, 'og:price:amount') || meta(doc, 'price'));
    if (!currency) currency = meta(doc, 'product:price:currency') || meta(doc, 'og:price:currency');
    // Wix
    const wixReg = text.match(/Звичайна ціна\s*([\d\s ]+(?:,\d{2})?)/), wixSale = text.match(/Ціна зі знижкою\s*([\d\s ]+(?:,\d{2})?)/);
    let old = null;
    if (wixReg) { const a = num(wixReg[1]); if (wixSale) { old = a; price = num(wixSale[1]) || price; } else price = price || a; }
    if (!old && price) {
      const el = doc.querySelector('[class*="old" i][class*="price" i],[class*="price" i] [class*="old" i],[class*="compare" i][class*="price" i],[class*="price" i] del,[class*="price" i] s,[class*="price--old" i],[class*="regular" i][class*="price" i]');
      const v = el && num(el.textContent);
      if (v && v > price) old = v;
    }
    if (!name || !price) return null;
    if (!P && !/product/i.test(ogType) && !wixReg && !meta(doc, 'product:price:amount')) return null;
    // розміри з DOM
    if (!sizes.length) {
      doc.querySelectorAll('[class*="size" i] label,[class*="size" i] button,[class*="size" i] option,[class*="size" i] span,[class*="size" i] li,[data-size],[class*="rozmir" i] *,[id*="size" i] option,select[name*="size" i] option, select[name*="rozm" i] option').forEach((e) => {
        const t = clean(e.getAttribute('data-size') || e.textContent);
        if (t && t.length <= 9) sizes.push(t);
      });
    }
    // розміри/кольори з JSON у сирому HTML (Wix, Horoshop тощо рендерять їх скриптом)
    const near = (re) => {
      const out = []; let m; const rx = new RegExp(re, 'gi'); let k = 0;
      while ((m = rx.exec(html)) && k++ < 6) {
        const chunk = html.slice(m.index, m.index + 2500);
        for (const q of chunk.matchAll(/"(?:value|description|title|name|label)"\s*:\s*"([^"]{1,20})"/g)) out.push(q[1]);
      }
      return out;
    };
    if (!sizes.length) sizes = near('"(?:Розмір|Размер|Size|SIZE|Розміри)"').filter((t) => SIZE_RE.test(t.trim()));
    if (!colors.length) colors = near('"(?:Колір|Цвет|Color|Colour|Колiр)"');
    if (!colors.length) {
      doc.querySelectorAll('[class*="color" i] [title],[class*="color" i] [aria-label],[class*="colour" i] [title]').forEach((e) => colors.push(e.getAttribute('title') || e.getAttribute('aria-label')));
    }
    const imgs = [];
    if (P && P.image) [].concat(P.image).forEach((i) => imgs.push(typeof i === 'string' ? i : i && (i.url || i.contentUrl)));
    doc.querySelectorAll('meta[property="og:image"]').forEach((m) => imgs.push(m.getAttribute('content')));
    const photos = imgs.filter(Boolean).map((s) => s.split('/v1/')[0]);
    let description = P && P.description ? P.description : null;
    const wixDesc = text.match(/Про товар\s*(.{20,1500}?)(?=\s*(Про догляд|Доставка|СУПУТНІ|$))/);
    if (wixDesc) description = description || wixDesc[1];
    if (!description) description = meta(doc, 'og:description') || meta(doc, 'description');
    const labels = crumbs.slice(1, -1).concat(menuLabels || []);
    return build({
      name, url, labels, extra: crumbs.join(' | '), price, old, currency, inStock, photos,
      description, care: careFrom(text), sizes, colors,
    });
  }

  // ---------- пошук URL товарів ----------
  const NOT_PRODUCT = /\/(blog|news|novyny|statti|article|page|pages|info|contacts?|kontakty|about|pro-nas|delivery|dostavka|oplata|payment|faq|policy|privacy|terms|cart|checkout|account|login|search|tag|tags|brand|brands|author|wishlist|compare)(\/|$)|\.(jpg|png|webp|pdf)$/i;
  async function sitemapUrls() {
    let maps = [];
    try { maps = [...(await get('/robots.txt')).matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]); } catch (e) {}
    maps.push(ORIGIN + '/sitemap.xml', ORIGIN + '/sitemap_index.xml', ORIGIN + '/sitemap-index.xml');
    const seen = new Set(), q = uniq(maps), prod = new Set(), other = new Set();
    let n = 0;
    while (q.length && n < 40) {
      const m = q.shift(); if (seen.has(m)) continue; seen.add(m); n++;
      let x; try { x = await get(m); } catch (e) { continue; }
      const locs = [...x.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map((a) => a[1].replace(/&amp;/g, '&'));
      if (/<sitemapindex/i.test(x)) {
        const p = locs.filter((l) => /product|tovar|goods|item|catalog|shop/i.test(l) && !/categor|collection|blog|post|page/i.test(l));
        const o = locs.filter((l) => !p.includes(l) && !/blog|post|news|author|tag|page|categor|collection|image|video/i.test(l));
        q.unshift(...p); q.push(...o);
      } else {
        const isProd = /product|tovar|goods|item/i.test(m) && !/categor/i.test(m);
        locs.filter(sameHost).forEach((l) => (isProd ? prod : other).add(l));
      }
    }
    return { prod: [...prod], other: [...other] };
  }
  function preferLang(urls) {
    const uk = urls.filter((u) => /\/(uk|ua|uk-ua)(\/|$)/i.test(new URL(u).pathname));
    const foreign = (u) => /\/(ru|en|ru-ua|en-us|pl|de)(\/|$)/i.test(new URL(u).pathname);
    if (uk.length > urls.length * 0.2) return uk;
    const rest = urls.filter((u) => !foreign(u));
    return rest.length ? rest : urls;
  }
  async function menuMap() {
    // обхід меню: сторінка категорії -> підписи для товарів на ній
    const map = {}, cats = [];
    let html; try { html = await get('/'); } catch (e) { return { map, cats }; }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const seen = new Set();
    const CATP = /\/(category|categories|collections?|catalog|katalog|kategori\w*|c|shop|women|men|zhinkam|cholovikam|zhinoche|cholovache|woman|man)(\/|$)/i;
    doc.querySelectorAll('a[href]').forEach((a) => {
      const u = abs(a.getAttribute('href')); const t = clean(a.textContent);
      if (!u || !sameHost(u) || NOT_PRODUCT.test(u) || seen.has(u) || !t || t.length > 40) return;
      const inNav = a.closest('header, nav, [class*="menu" i], [class*="nav" i]');
      if (!inNav && !CATP.test(new URL(u).pathname)) return;
      if (/\/(product|products|product-page|p)\//i.test(u)) return;
      const path = new URL(u).pathname; if (path === '/' || path.split('/').filter(Boolean).length > 4) return;
      seen.add(u); cats.push([u.split('#')[0], t]);
    });
    await pool(cats.slice(0, 70), 5, async ([u, t]) => {
      const h = await get(u); const d = new DOMParser().parseFromString(h, 'text/html');
      const label = t + ' ' + decodeURIComponent(new URL(u).pathname);
      d.querySelectorAll('a[href]').forEach((a) => {
        const pu = abs(a.getAttribute('href')); if (!pu || !sameHost(pu)) return;
        const k = pu.split(/[?#]/)[0]; (map[k] = map[k] || []).push(label);
      });
    });
    return { map, cats: cats.map((c) => c[0].split(/[?#]/)[0]) };
  }

  async function generic() {
    G.mode = 'generic';
    const [{ prod, other }, mm] = await Promise.all([sitemapUrls(), menuMap()]);
    const catSet = new Set(mm.cats);
    let cand = prod.length ? prod : other.filter((u) => !NOT_PRODUCT.test(u) && new URL(u).pathname.length > 2);
    if (!cand.length) cand = Object.keys(mm.map).filter((u) => !catSet.has(u) && !NOT_PRODUCT.test(u) && mm.map[u].length >= 1 && new URL(u).pathname.length > 3);
    else G.mode = prod.length ? 'sitemap-products' : 'sitemap';
    cand = uniq(preferLang(cand.map((u) => u.split('#')[0]))).filter((u) => !catSet.has(u.split('?')[0]));
    // перемішати, щоб не взяти лише одну категорію
    for (let i = cand.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [cand[i], cand[j]] = [cand[j], cand[i]]; }
    G.candidates = cand.length;
    await pool(cand.slice(0, MAX_CHECK), 4, async (u) => {
      G.checked++;
      const h = await get(u);
      const r = parseProduct(h, u.split('?')[0], (mm.map[u.split(/[?#]/)[0]] || []).slice(0, 6));
      if (r) { G.products.push(r); G.found = G.products.length; }
    }, () => G.products.length >= COLLECT);
  }

  // ---------- відбір 300 ----------
  function select(list) {
    const seen = new Set();
    list = list.filter((p) => { const k = p.source_url; if (seen.has(k)) return false; seen.add(k); return true; });
    const pr = { [OUT]: 1, [KNIT]: 2, [TOP]: 2, [SET]: 2, [DRESS]: 2, [BOT]: 2, [ETNO]: 2, [SHOES]: CFG.kind === 'shoes' ? 1 : 3, [TEE]: 3, [BODY]: 3, [ACC]: 5, [UND]: 6, [SWIM]: 6 };
    const capHat = CFG.kind === 'hats' ? LIMIT : 20, capOther = CFG.kind === 'hats' ? LIMIT : 30;
    const sorted = list.map((p, i) => [p, i]).sort((a, b) =>
      (a[0].in_stock === false) - (b[0].in_stock === false) ||
      (pr[a[0].category] || 4) - (pr[b[0].category] || 4) || a[1] - b[1]).map((x) => x[0]);
    const out = []; let h = 0, o = 0;
    for (const p of sorted) {
      if (out.length >= LIMIT) break;
      if (p.slot === 'hat') { if (h >= capHat) continue; h++; }
      if (p.slot === 'other') { if (o >= capOther) continue; o++; }
      out.push(p);
    }
    return out;
  }

  (async () => {
    try {
      if (!(await shopify())) await generic();
      const products = select(G.products);
      const doc = {
        _meta: {
          brand: CFG.name, brand_id: CFG.id, site: ORIGIN, extracted_at: new Date().toISOString().slice(0, 10),
          mode: G.mode, count: products.length, found: G.products.length, candidates: G.candidates, checked: G.checked,
          errors: G.errors.slice(0, 10),
        },
        products,
      };
      G.result = doc; G.count = products.length;
      if (CFG.download !== false) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
        a.download = 'guglya_' + (CFG.id || HOST) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
      }
      G.status = 'done';
    } catch (e) { G.status = 'error'; G.errors.push(String(e)); }
    G.ms = Date.now() - G.started;
  })();
})();
