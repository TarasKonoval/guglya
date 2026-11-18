# data/database — каталог товарів українських брендів

Сирі каталоги брендів для Ґуґлі: звідси беремо речі для образів і альтернатив. Дані зібрано з публічних сторінок
брендів (ціни, назви, посилання, URL фото — самі фото не завантажуємо). Купівля завжди відбувається на сайті бренду.

## Файли

| файл | що це |
|---|---|
| `brands.json` | перелік брендів одягу/взуття (51), з якими працює `scrape.mjs` / `merge.py` |
| `<slug>/products.json` | база одного бренду (схема нижче) |
| `<slug>/bags_hats.json` | сумки, рюкзаки, головні убори бренду, у якого вже є база одягу (`gepur`, `kachorovska`) |
| `products.json` | зведена база брендів одягу (результат `merge.py`) |
| `categories.json` | словник: розділ → `slot` і перелік `item_types` |
| `REPORT.md` | звіт останнього збору брендів сумок/аксесуарів |

## Інструменти

```bash
cd data/database && npm install          # playwright, cheerio
```

- `scraper.js` — збирач одного сайту, запускається в браузері (консоль); логіка для брендів одягу.
- `scrape.mjs` — те саме з терміналу: відкриває сайт у Chrome через Playwright і виконує `scraper.js` на сторінці.
  `node scrape.mjs --out E:\guglya\raw [--only a,b] [--skip c,d] [--force]` → `guglya_<id>.json`.
- `merge.py` — зводить `guglya_*.json` у `products.json`, `<slug>/products.json`, доповнює `categories.json`.
  `python merge.py E:\guglya\raw`
- `scrape_brands.mjs` — бренди сумок і аксесуарів (+ сумки/головні убори великих брендів). Конфіг брендів — у файлі.
  `node scrape_brands.mjs [--only poelle,juna] [--limit 300]`, `node scrape_brands.mjs --report` — лише звіт і словник.
  Порядок методів: Shopify `/products.json` → Tilda → sitemap/сторінки категорій + JSON-LD → мікророзмітка/HTML.
  Дотримується `robots.txt`, пауза 1–2 с між запитами до сайту, звичайний User-Agent. Капчу й Cloudflare-перевірки
  не обходить: бренд зупиняється, причина йде у звіт. Для кожного бренду перевіряє 3 випадкові товари на сайті.

## Схема `<slug>/products.json`

```json
{
  "_meta": { "brand": "...", "site": "...", "extracted_at": "YYYY-MM-DD", "count": 0, "method": "products.json|sitemap|json-ld|html" },
  "products": [
    {
      "id": "<slug>-<slug товару латиницею>",
      "brand": "...",
      "name": "назва як на сайті",
      "source_url": "пряма URL товару без трекінгових параметрів",
      "gender": "male|female|unisex",
      "category": "розділ меню",
      "item_type": "конкретний тип",
      "slot": "hat|top|bottom|shoes|bag|other",
      "colors": ["українською, з малої"],
      "sizes": ["як на сайті"],
      "price_uah": 0,
      "sale_price_uah": null,
      "in_stock": true,
      "photos": ["до 3 URL оригінальних фото бренду"],
      "description": null,
      "care": null,
      "collections": []
    }
  ]
}
```

Правила:
- Якщо поле не знайдено — `null`. Нічого не вигадуємо.
- `price_uah` — звичайна ціна; якщо діє знижка, `sale_price_uah` — ціна зі знижкою.
- `gender` — з розділів меню «Чоловікам/Жінкам» (обидва → `unisex`; без розділів і явно унісекс → `unisex`; неясно → `null`).
- Колірні варіанти одного товару — один запис зі списком `colors`.
- Пропускаємо товари без назви, ціни, URL або фото, подарункові сертифікати, службові сторінки, дитячі товари.
- `_meta` може містити службові поля збирача: `scope`, `discovery`, `candidates`, `checked`, `skipped`, `issues`, `verified`, `note`.

## slot

| slot | що сюди входить |
|---|---|
| `hat` | головні убори |
| `top` | верх, верхній одяг, сукні, комплекти |
| `bottom` | штани, спідниці, шорти |
| `shoes` | взуття |
| `bag` | сумки, рюкзаки |
| `other` | аксесуари, прикраси, білизна тощо |

Категорії (розділи) та їхні типи — у `categories.json`. Нові розділи з меню бренду додаються туди дослівно з призначеним slot.
