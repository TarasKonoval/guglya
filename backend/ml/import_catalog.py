"""Load data/catalog.csv (brands + products) and data/outfits.json into Postgres.

Usage (from repo root):  python backend/ml/import_catalog.py data/catalog.csv data/outfits.json
Outfit items reference products by product_url. Re-running is safe (upserts).
"""
import csv
import json
import os
import sys

import psycopg


def main(catalog_csv: str, outfits_json: str | None) -> None:
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        with open(catalog_csv, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                brand_id = conn.execute(
                    """insert into brands (name, site_url) values (%s, %s)
                       on conflict (name) do update set site_url = excluded.site_url returning id""",
                    (row["brand"], row["brand_site"]),
                ).fetchone()[0]
                conn.execute(
                    """insert into products (brand_id, title, category, color, price_uah, image_url, product_url)
                       values (%s, %s, %s, %s, %s, %s, %s)
                       on conflict (product_url) do update set title = excluded.title, color = excluded.color,
                         price_uah = excluded.price_uah, image_url = excluded.image_url, in_stock = true""",
                    (brand_id, row["title"], row["category"], row["color"] or None,
                     int(row["price_uah"]), row["image_url"], row["product_url"]),
                )
        if outfits_json:
            for o in json.load(open(outfits_json, encoding="utf-8")):
                oid = conn.execute(
                    """insert into outfits (title, season, cover_image_url) values (%s, %s, %s)
                       on conflict (title) do update set season = excluded.season,
                         cover_image_url = excluded.cover_image_url returning id""",
                    (o["title"], o["season"], o["cover_image_url"]),
                ).fetchone()[0]
                for slot, url in o["items"].items():
                    conn.execute(
                        """insert into outfit_items (outfit_id, slot, product_id)
                           select %s, %s, id from products where product_url = %s
                           on conflict (outfit_id, slot) do update set product_id = excluded.product_id""",
                        (oid, slot, url),
                    )
    print("Imported.")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
