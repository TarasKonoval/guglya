"""Load a catalog CSV (brands + products) and an outfits JSON into Postgres. Re-running is safe (upserts).

Usage (from repo root):
  python backend/ml/import_catalog.py data/catalog.csv data/outfits.json            # real catalog
  python backend/ml/import_catalog.py --demo data/demo/catalog.csv data/demo/outfits.json
  python backend/ml/import_catalog.py --purge-demo                                  # hide all demo data

CSV columns: brand, brand_site, title, category, color, price_uah, image_url, product_url, in_stock
Outfits JSON: [{title, season, cover_image_url, style_tag, items: {slot: product_url}}]; hat is optional.
Demo products use product_url "/demo/<uuid>" and get that uuid as their id, so links stay stable.
--purge-demo unpublishes demo outfits and marks demo products out of stock instead of deleting them,
so clicks/events collected on the demo stay available for the report.
"""
import argparse
import csv
import json
import os
import re

import psycopg

DEMO_URL = re.compile(r"^/demo/([0-9a-f-]{36})$")


def truthy(v: str | None) -> bool:
    return (v or "true").strip().lower() in ("1", "true", "yes", "так")


def import_catalog(conn, catalog_csv: str, demo: bool) -> None:
    with open(catalog_csv, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            brand_id = conn.execute(
                """insert into brands (name, site_url, is_demo) values (%s, %s, %s)
                   on conflict (name) do update set site_url = excluded.site_url, is_demo = excluded.is_demo
                   returning id""",
                (row["brand"], row["brand_site"], demo),
            ).fetchone()[0]
            m = DEMO_URL.match(row["product_url"])
            conn.execute(
                """insert into products (id, brand_id, title, category, color, price_uah, image_url, product_url,
                                         in_stock, is_demo)
                   values (coalesce(%s::uuid, gen_random_uuid()), %s, %s, %s, %s, %s, %s, %s, %s, %s)
                   on conflict (product_url) do update set brand_id = excluded.brand_id, title = excluded.title,
                     category = excluded.category, color = excluded.color, price_uah = excluded.price_uah,
                     in_stock = excluded.in_stock, is_demo = excluded.is_demo,
                     image_url = excluded.image_url,
                     -- a new photo needs a new embedding
                     embedding = case when products.image_url = excluded.image_url then products.embedding end""",
                (m.group(1) if m else None, brand_id, row["title"], row["category"], row["color"] or None,
                 int(row["price_uah"]), row["image_url"], row["product_url"], truthy(row.get("in_stock")), demo),
            )


def import_outfits(conn, outfits_json: str) -> None:
    with open(outfits_json, encoding="utf-8") as f:
        outfits = json.load(f)
    for order, o in enumerate(outfits):
        oid = conn.execute(
            """insert into outfits (title, season, cover_image_url, style_tag, sort_order, is_published)
               values (%s, %s, %s, %s, %s, true)
               on conflict (title) do update set season = excluded.season, cover_image_url = excluded.cover_image_url,
                 style_tag = excluded.style_tag, sort_order = excluded.sort_order, is_published = true
               returning id""",
            (o["title"], o.get("season", "autumn"), o.get("cover_image_url"), o.get("style_tag"), order),
        ).fetchone()[0]
        conn.execute("delete from outfit_items where outfit_id = %s", (oid,))
        for slot, url in o["items"].items():
            n = conn.execute(
                """insert into outfit_items (outfit_id, slot, product_id)
                   select %s, %s, id from products where product_url = %s""",
                (oid, slot, url),
            ).rowcount
            if not n:
                raise SystemExit(f"Outfit {o['title']!r}: no product with product_url {url}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("catalog_csv", nargs="?")
    ap.add_argument("outfits_json", nargs="?")
    ap.add_argument("--demo", action="store_true", help="mark imported brands/products as demo data")
    ap.add_argument("--purge-demo", action="store_true", help="hide all demo outfits and products")
    args = ap.parse_args()

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        if args.purge_demo:
            n_out = conn.execute(
                """update outfits set is_published = false where id in (
                     select oi.outfit_id from outfit_items oi join products p on p.id = oi.product_id
                     where p.is_demo)"""
            ).rowcount
            n_prod = conn.execute("update products set in_stock = false where is_demo").rowcount
            print(f"Demo hidden: {n_out} outfits unpublished, {n_prod} products out of stock.")
        if args.catalog_csv:
            import_catalog(conn, args.catalog_csv, args.demo)
        if args.outfits_json:
            import_outfits(conn, args.outfits_json)
    print("Done.")


if __name__ == "__main__":
    main()
