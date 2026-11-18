"""Load the scraped brand catalog (data/database/products.json, built by data/database/merge.py) into Postgres.

Usage (from repo root):
  DATABASE_URL=... python backend/ml/import_brand_db.py [data/database/products.json] [--only id1,id2]

--only: import just these brands (others are not touched at all, e.g. while a teammate imports theirs).

Re-running is safe: brands upsert by name, products by product_url (the brand's product page). A product
keeps its embedding unless its photo changed. Products that disappeared from the file or are no longer
importable are marked out of stock (never deleted: clicks and outfits may point at them).
Popularity (Instagram followers) comes from data/database/brand_popularity.json when present.

Admin-hidden products stay hidden. Run backend/ml/embed.py, then backend/ml/classify_gender.py after an import.

Skipped: accessories (slot "other") except bags and scarves, products without a (plausible) UAH price, products marked out of stock,
Russian product names.
"""
import json
import os
import re
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[2]
DB_DIR = ROOT / "data" / "database"

# merge.py colour names -> the site's colour keys (frontend COLORS)
COLOR = {
    "чорний": "black", "графіт": "grey", "сірий": "grey", "меланж": "grey", "срібний": "grey",
    "білий": "white", "молочний": "white", "кремовий": "white",
    "бежевий": "beige", "пісочний": "beige",
    "коричневий": "brown", "шоколадний": "brown",
    "синій": "blue", "блакитний": "blue", "темно-синій": "blue",
    "зелений": "green", "оливковий": "green", "хакі": "green", "мʼятний": "green",
    "червоний": "red", "бордовий": "burgundy",
    "рожевий": "pink", "лавандовий": "purple", "фіолетовий": "purple",
    "жовтий": "yellow", "золотий": "yellow", "помаранчевий": "orange", "теракотовий": "orange",
}
# The colour named in the title wins over the scraped colour list (which can list every variant, e.g. Solmar's
# "Светр зі швами, Soft Grey" came as green). The earliest colour word in the title is the item's colour.
TITLE_COLORS = [
    (r"чорн|black", "black"),
    (r"біл(ий|а|е|і|ого|ої|ому|ій|их)|white|молочн|milk|ivory|ecru|екрю|кремов|cream", "white"),
    (r"сір(ий|а|е|і|ого|ої|ому|ій|их)|grey|gray|графіт|graphite|антрацит|меланж|melange", "grey"),
    (r"беж|beige|пісочн|\bsand|camel|кемел", "beige"),
    (r"корич|brown|шоколад|chocolate|мокко|mocha|coffee", "brown"),
    (r"син(ій|я|є|і|ього|ьої|ьому|іх)|\bblue|navy|блакит", "blue"),
    (r"зелен|green|олив|olive|хакі|khaki|\bmoss|м.ятн|\bmint|смарагд|emerald", "green"),
    (r"червон|\bred\b", "red"),
    (r"бордо|burgundy|марсал|вишнев|cherry|\bwine", "burgundy"),
    (r"рожев|\bpink", "pink"),
    (r"фіолет|purple|лаванд|lavender|бузков|lilac|лілов", "purple"),
    (r"жовт|yellow|гірчичн|mustard", "yellow"),
    (r"помаран|orange|теракот|terracotta", "orange"),
]
TITLE_COLOR_RE = [(re.compile(rx, re.I), key) for rx, key in TITLE_COLORS]


def title_color(name: str) -> str | None:
    hits = [(m.start(), key) for rx, key in TITLE_COLOR_RE for m in [rx.search(name)] if m]
    return min(hits)[1] if hits else None


# Bags (slot "bag", data/database convention). Older scrapes put them into "other" as "Сумка" or untyped:
# the title decides, and gives the kind of bag (used to keep alternatives within the same kind).
BAG_KINDS = [
    (re.compile(r"рюкзак|backpack", re.I), "Рюкзак"),
    (re.compile(r"шопер|tote|торба", re.I), "Шопер"),
    (re.compile(r"клатч|clutch", re.I), "Клатч"),
    (re.compile(r"кросбоді|crossbody|бананк|поясн|belt bag|слінг|sling", re.I), "Кросбоді"),
    (re.compile(r"сумк|\bbag\b|багет|хобо|hobo", re.I), "Сумка"),
]
SCARF_HINT = re.compile(r"шарф|хустк|снуд|палантин|scarf|twilly|твіллі|прикрас|сереж|браслет|кольє|окуляр|парасол", re.I)
# also not bags, in a bag brand's untyped accessories
NOT_BAG_BRAND = re.compile(r"органайзер|бальзам|крем|догляд|ремн|ремін|пасок|пояс|анклет|топсайдер|шнурк|набір|сертифікат|"
                           r"брелок|чохол|кошельок|візитниц|паспорт|ключ|підвіс|charm|strap|ремінець|cardholder|card holder|wallet", re.I)
NOT_BAG = re.compile(r"піал|чашк|горнят|кружк|посуд|свічк|аромат|гаман|wallet|картхолдер|кардхолдер|чохол|косметичк|ключниц|обкладинк|ремінь|брелок", re.I)


def bag_kind(p: dict, brand: dict | None = None) -> str | None:
    """'Рюкзак' / 'Шопер' / ... if this product is a bag, else None."""
    name = p.get("name") or ""
    if p.get("slot") not in ("bag", "other") or NOT_BAG.search(name):
        return None
    # the scraped item_type of accessories is unreliable (a backpack typed "Ремінь"): the title decides
    hit = next((kind for rx, kind in BAG_KINDS if rx.search(name)), None)
    # bag brands name their bags by model ("Джудіт", "Ніна"): their accessories are bags unless the title says otherwise
    if (not hit and (brand or {}).get("kind") == "bags" and p.get("slot") == "other" and not p.get("item_type")
            and not SCARF_HINT.search(name) and not NOT_BAG_BRAND.search(name)):
        hit = "Сумка"
    return hit or ("Сумка" if p.get("slot") == "bag" else None)


# Scarves (slot "scarf", migration 010): older scrapes put them into "other" ("Шарф", "Хустка"); the title decides
# and gives the kind. Bandanas, hair scarves and pocket squares are not outfit scarves.
SCARF_KINDS = [
    (re.compile(r"снуд|snood|хомут", re.I), "Снуд"),
    (re.compile(r"палантин|\bstole", re.I), "Палантин"),
    (re.compile(r"хустк|косинк|kerchief|\bshawl", re.I), "Хустка"),
    (re.compile(r"шарф|scarf|бактус", re.I), "Шарф"),
]
NOT_SCARF = re.compile(r"бандан|для волосся|пов.язк|резинк|паше|нагрудн|маск|брелок|кольє|чокер|visor|козир|сережк|браслет", re.I)


def scarf_kind(p: dict, brand: dict | None = None) -> str | None:
    """'Шарф' / 'Снуд' / 'Хустка' / 'Палантин' if this product is a scarf, else None."""
    name = re.sub(re.escape(p.get("brand") or ""), " ", p.get("name") or "", flags=re.I)  # "My Scarf" is a brand
    if p.get("slot") not in ("scarf", "other") or NOT_SCARF.search(name):
        return None
    hit = next((kind for rx, kind in SCARF_KINDS if rx.search(name)), None)
    # scarf brands name their scarves by print ("Passion"): their scraped type is enough
    if not hit and (brand or {}).get("kind") == "scarves" and p.get("item_type") in ("Шарф", "Хустка"):
        hit = p["item_type"]
    return hit or ("Шарф" if p.get("slot") == "scarf" else None)


# One piece that replaces top + bottom in an outfit
DRESS_TYPES = {"Сукня", "Комплект", "Комбінезон", "Спортивний костюм", "Класичний костюм"}
# The layer worn over a top or a dress/suit ("outer" slot); keep in sync with migration 006
OUTER_TYPES = {"Пальто", "Куртка", "Бомбер", "Пуховик", "Тренч", "Шуба", "Парка", "Вітрівка", "Дублянка", "Косуха"}
JACKET_TYPES = {"Піджак"}  # "jacket" slot (migration 007)
MIN_PRICE = 100  # below this the scraper misread the price (e.g. "8 990" -> 8)
# Russian product names never go on the site (scrape the Ukrainian version of the brand's site instead)
RUSSIAN = re.compile(r"[ыэъё]|\b(мужск|женск|платье|юбк|рубашк|свитер|джинсы|шорты|брюки\s+(с|из)\b)|\bв\s+цвете\b|\bс\s+(принтом|карманами|воротником)", re.I)
GENDER = {"female": "women", "male": "men", "unisex": "unisex"}
AUDIENCE = {"Жінкам": "women", "Жінкам (зараз)": "women", "Чоловікам": "men"}


def brand_gender(b: dict) -> str:
    return GENDER.get(b.get("default_gender")) or AUDIENCE.get(b.get("audience")) or "unisex"


def to_row(p: dict, brand: dict) -> tuple | None:
    # brands.json "exclude": a title pattern for what isn't for the site (Bistfor / M-Tac: tactical gear)
    if brand.get("exclude") and re.search(brand["exclude"], p.get("name") or "", re.I):
        return None
    bag = bag_kind(p, brand)
    scarf = None if bag else scarf_kind(p, brand)
    if (p.get("slot") not in ("hat", "top", "bottom", "shoes") and not bag and not scarf) or p.get("in_stock") is False:
        return None
    price, sale = p.get("price_uah"), p.get("sale_price_uah")
    if not price or price < MIN_PRICE or not p.get("photos") or RUSSIAN.search(p.get("name") or ""):
        return None
    on_sale = bool(sale) and MIN_PRICE <= sale < price
    kind = bag or scarf or p.get("item_type")
    category = ("bag" if bag else "scarf" if scarf else "dress" if kind in DRESS_TYPES else
                "outer" if p["slot"] == "top" and kind in OUTER_TYPES else
                "jacket" if p["slot"] == "top" and kind in JACKET_TYPES else p["slot"])
    color = title_color(p.get("name") or "") or next((COLOR[c] for c in p.get("colors") or [] if c in COLOR), None)
    return (
        p["name"] or p.get("item_type") or "Річ", category, color, sale if on_sale else price,
        price if on_sale else None, p["photos"][0], p["photos"], p["source_url"],
        GENDER.get(p.get("gender")) or brand_gender(brand), kind, p.get("sizes") or None,
    )


def main() -> None:
    args = sys.argv[1:]
    only = set(args[args.index("--only") + 1].split(",")) if "--only" in args else None
    files = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or args[i - 1] != "--only")]
    src = Path(files[0]) if files else DB_DIR / "products.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    brands = {b["id"]: b for b in json.loads((DB_DIR / "brands.json").read_text(encoding="utf-8"))}
    pop_file = DB_DIR / "brand_popularity.json"
    popularity = json.loads(pop_file.read_text(encoding="utf-8")) if pop_file.exists() else {}

    by_brand: dict[str, list[tuple]] = {}
    skipped = 0
    for p in data["products"]:
        if only is not None and p["brand_id"] not in only:
            continue
        row = to_row(p, brands.get(p["brand_id"], {}))
        if row:
            by_brand.setdefault(p["brand_id"], []).append(row)
        else:
            skipped += 1

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        for slug, rows in by_brand.items():
            b = brands.get(slug, {})
            brand_id = conn.execute(
                """insert into brands (name, slug, site_url, instagram, segment, instagram_followers)
                   values (%s, %s, %s, %s, %s, %s)
                   on conflict (name) do update set slug = excluded.slug, site_url = excluded.site_url,
                     instagram = coalesce(excluded.instagram, brands.instagram), segment = excluded.segment,
                     instagram_followers = coalesce(excluded.instagram_followers, brands.instagram_followers)
                   returning id""",
                (b.get("name") or slug, slug, b.get("site"), b.get("instagram") or popularity.get(slug, {}).get("instagram"),
                 b.get("segment"), popularity.get(slug, {}).get("instagram_followers")),
            ).fetchone()[0]
            with conn.cursor() as cur:
                cur.executemany(
                    """insert into products (brand_id, title, category, color, price_uah, old_price_uah, image_url,
                                             photos, product_url, gender, item_type, sizes, in_stock, is_demo)
                       values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true, false)
                       on conflict (product_url) do update set brand_id = excluded.brand_id, title = excluded.title,
                         category = excluded.category, color = coalesce(excluded.color, products.color), price_uah = excluded.price_uah,
                         old_price_uah = excluded.old_price_uah, photos = excluded.photos,
                         -- "unisex" means the scrape didn't say: keep what classify_gender.py found
                         gender = case when excluded.gender = 'unisex' then products.gender else excluded.gender end,
                         item_type = excluded.item_type, sizes = excluded.sizes, in_stock = not products.is_hidden,
                         image_url = excluded.image_url,
                         -- a new photo needs a new embedding
                         embedding = case when products.image_url = excluded.image_url then products.embedding end""",
                    [(brand_id, *r) for r in rows],
                )
            # gone from this brand's scrape -> out of stock
            conn.execute(
                "update products set in_stock = false where brand_id = %s and not (product_url = any(%s))",
                (brand_id, [r[7] for r in rows]),
            )
            conn.commit()
            print(f"{slug:18} {len(rows):5} products")
    print(f"Imported {sum(map(len, by_brand.values()))} products from {len(by_brand)} brands, skipped {skipped}.")


if __name__ == "__main__":
    main()
