"""Зводить файли guglya_<brand>.json (вихід scraper.js) в одну базу.

python3 data/database/merge.py <папка з guglya_*.json>

Пише:
  data/database/products.json        — уся база (бренди + товари)
  data/database/<brand>/products.json — товари одного бренду
  data/database/categories.json      — словник категорій, типів і слотів
"""
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
BRANDS = {b["id"]: b for b in json.loads((HERE / "brands.json").read_text(encoding="utf-8"))}

# Бренди без окремих чоловічих розділів (за нотатками в таблиці брендів):
# якщо стать не визначилась зі сторінки — ставимо жіночу.
MOSTLY_FEMALE = {"cher17", "onebyone", "solmar"}

COLORS = [
    (r"чорн|черн|black", "чорний"), (r"графіт|графит|graphite|антрацит", "графіт"),
    (r"біл(ий|а|е|і)|бел(ый|ая|ое)|white", "білий"), (r"сір|сер(ый|ая|ое)|grey|gray", "сірий"),
    (r"меланж|melange", "меланж"), (r"беж|beige", "бежевий"), (r"пісоч|песоч|sand", "пісочний"),
    (r"шоколад|chocolate", "шоколадний"), (r"корич|brown|мокко|mocha", "коричневий"),
    (r"молоч|milk|ivory|айворі|екрю|ecru", "молочний"), (r"кремов|cream", "кремовий"),
    (r"блакит|голуб|light blue", "блакитний"), (r"темно-син|navy", "темно-синій"),
    (r"син(ій|я|є|і)|blue", "синій"), (r"олив|olive", "оливковий"), (r"хакі|хаки|khaki", "хакі"),
    (r"м.ятн|mint", "мʼятний"), (r"зелен|green", "зелений"), (r"бордо|burgundy|марсал|вишн", "бордовий"),
    (r"червон|красн|\bred\b", "червоний"), (r"рожев|розов|pink", "рожевий"), (r"лаванд|lavender|бузк", "лавандовий"),
    (r"фіолет|фиолет|purple|violet", "фіолетовий"), (r"жовт|желт|yellow", "жовтий"),
    (r"помаран|оранж|orange", "помаранчевий"), (r"теракот|terracotta", "теракотовий"),
]
FIELDS = ["id", "brand", "brand_id", "name", "source_url", "gender", "category", "item_type", "slot",
          "colors", "sizes", "price_uah", "sale_price_uah", "in_stock", "photos", "description", "care", "collections"]


def colors_from(text):
    out = []
    for rx, name in COLORS:
        if re.search(rx, text or "", re.I) and name not in out:
            out.append(name)
    return out[:2]


def clean_product(p, brand_id):
    p = dict(p)
    p["brand_id"] = brand_id
    p["brand"] = BRANDS.get(brand_id, {}).get("name", p.get("brand"))
    name = re.split(r",\s*артикул|【|\s+[|–—]\s+|\s+-\s+купити", p.get("name") or "", flags=re.I)[0].strip()
    p["name"] = name
    cat = p.get("category")
    if cat and ("/" in cat or len(cat) > 40):
        cat = re.sub(r"\s+/.*$", "", cat).strip() or None
    p["category"] = cat
    if not p.get("colors"):
        p["colors"] = colors_from(name)
    care = (p.get("care") or "").strip()
    if len(care) < 25 or re.match(r"(Таблиц|Розмір|Размер)", care) or re.search(r'[{}"\\]', care):
        care = None
    p["care"] = care
    desc = (p.get("description") or "").strip()
    if not desc or re.search(r"купити в|❤️|⭐", desc):
        desc = desc if desc and not re.search(r"купити в|❤️|⭐", desc) else None
    p["description"] = desc
    if not p.get("gender") and brand_id in MOSTLY_FEMALE:
        p["gender"] = "female"
    return {k: p.get(k) for k in FIELDS} | ({"price_foreign": p["price_foreign"]} if p.get("price_foreign") else {})


def main(src):
    files = sorted(Path(src).glob("guglya_*.json"))
    best = {}
    for f in files:
        try:
            doc = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print("skip", f.name, e)
            continue
        bid = doc.get("_meta", {}).get("brand_id") or re.sub(r"^guglya_|\s*\(\d+\)$", "", f.stem)
        score = (len(doc.get("products", [])), sum(bool(p.get("sizes")) for p in doc.get("products", [])), f.stat().st_mtime)
        if bid not in best or score > best[bid][0]:
            best[bid] = (score, doc)

    all_products, per_brand, report = [], {}, []
    for bid, (_, doc) in sorted(best.items()):
        prods = [clean_product(p, bid) for p in doc.get("products", [])
                 if not re.search(r"дитяч|детск|для дівчин|для хлопчик|\bkids?\b|\bbaby\b|ясел|малюк", (p.get("name") or "") + " " + (p.get("source_url") or ""), re.I)]
        seen, uniq = set(), []
        for p in prods:
            if p["id"] in seen:
                continue
            seen.add(p["id"])
            uniq.append(p)
        per_brand[bid] = (doc.get("_meta", {}), uniq)
        all_products += uniq
        report.append((bid, len(uniq)))

    for bid, (meta, prods) in per_brand.items():
        d = HERE / bid
        d.mkdir(exist_ok=True)
        meta = {**meta, "brand_id": bid, "brand": BRANDS.get(bid, {}).get("name", meta.get("brand")), "count": len(prods)}
        (d / "products.json").write_text(json.dumps({"_meta": meta, "products": prods}, ensure_ascii=False, indent=2), encoding="utf-8")

    cats = defaultdict(lambda: {"slot": Counter(), "types": Counter()})
    for p in all_products:
        if p["category"]:
            cats[p["category"]]["slot"][p["slot"]] += 1
            if p["item_type"]:
                cats[p["category"]]["types"][p["item_type"]] += 1
    categories = [{"category": c, "slot": v["slot"].most_common(1)[0][0], "item_types": [t for t, _ in v["types"].most_common()]}
                  for c, v in sorted(cats.items(), key=lambda x: -sum(x[1]["slot"].values()))]
    # Не губимо записи, додані вручну або scrape_brands.mjs (сумки, головні убори тощо): лише доповнюємо.
    cat_path = HERE / "categories.json"
    if cat_path.exists():
        old = json.loads(cat_path.read_text(encoding="utf-8"))
        new = {c["category"]: c for c in categories}
        for c in old:
            if c["category"] in new:
                n = new[c["category"]]
                n["item_types"] += [t for t in c["item_types"] if t not in n["item_types"]]
                n["slot"] = c["slot"]
            else:
                categories.append(c)
    cat_path.write_text(json.dumps(categories, ensure_ascii=False, indent=2), encoding="utf-8")

    brands = [b | {"products_count": len(per_brand.get(b["id"], ({}, []))[1])} for b in BRANDS.values()]
    db = {
        "_meta": {"name": "Ґуґля — база товарів українських брендів", "built_on": date.today().isoformat(),
                  "brands_with_products": len(per_brand), "products_count": len(all_products)},
        "brands": brands,
        "products": all_products,
    }
    (HERE / "products.json").write_text(json.dumps(db, ensure_ascii=False, indent=2), encoding="utf-8")
    for bid, n in report:
        print(f"{bid:18} {n}")
    print("TOTAL", len(all_products), "brands", len(per_brand))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
