"""Load the scraped brand catalog (data/database/products.json, built by data/database/merge.py) into Postgres.

Usage (from repo root):
  DATABASE_URL=... python backend/ml/import_brand_db.py [data/database/products.json]

Re-running is safe: brands upsert by name, products by product_url (the brand's product page). A product
keeps its embedding unless its photo changed. Products that disappeared from the file or are no longer
importable are marked out of stock (never deleted: clicks and outfits may point at them).
Popularity (Instagram followers) comes from data/database/brand_popularity.json when present.

Admin-hidden products stay hidden. Run backend/ml/embed.py, then backend/ml/classify_gender.py after an import.

Skipped: accessories (slot "other"), products without a (plausible) UAH price, products marked out of stock,
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
    if p.get("slot") not in ("hat", "top", "bottom", "shoes") or p.get("in_stock") is False:
        return None
    price, sale = p.get("price_uah"), p.get("sale_price_uah")
    if not price or price < MIN_PRICE or not p.get("photos") or RUSSIAN.search(p.get("name") or ""):
        return None
    on_sale = bool(sale) and MIN_PRICE <= sale < price
    kind = p.get("item_type")
    category = ("dress" if kind in DRESS_TYPES else
                "outer" if p["slot"] == "top" and kind in OUTER_TYPES else
                "jacket" if p["slot"] == "top" and kind in JACKET_TYPES else p["slot"])
    color = next((COLOR[c] for c in p.get("colors") or [] if c in COLOR), None)
    return (
        p["name"] or p.get("item_type") or "Річ", category, color, sale if on_sale else price,
        price if on_sale else None, p["photos"][0], p["photos"], p["source_url"],
        GENDER.get(p.get("gender")) or brand_gender(brand), p.get("item_type"), p.get("sizes") or None,
    )


def main() -> None:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DB_DIR / "products.json"
    data = json.loads(src.read_text(encoding="utf-8"))
    brands = {b["id"]: b for b in json.loads((DB_DIR / "brands.json").read_text(encoding="utf-8"))}
    pop_file = DB_DIR / "brand_popularity.json"
    popularity = json.loads(pop_file.read_text(encoding="utf-8")) if pop_file.exists() else {}

    by_brand: dict[str, list[tuple]] = {}
    skipped = 0
    for p in data["products"]:
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
                         category = excluded.category, color = excluded.color, price_uah = excluded.price_uah,
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
