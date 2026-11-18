"""Proper names for products the scraper saved with a bad name: Russian (some sites put Russian into JSON-LD even
on their Ukrainian pages) or just the brand's name (Papaya). Opens each such product page and takes the name
from <title> / og:title. A trailing ", Розмір ..." is cut from every name.

python3 data/database/ua_names.py <папка>/guglya_<brand>.json [--lang-prefix /ua]

--lang-prefix inserts the site's Ukrainian path after the domain (Solmar: /ua). The file is rewritten in place;
products that still have a Russian name afterwards are dropped (import_brand_db.py would skip them anyway).
"""
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

RUSSIAN = re.compile(r"[ыэъё]|\b(мужск|женск|платье|юбк|рубашк|свитер|джинсы|шорты)|\bв\s+цвете\b|\bс\s+(принтом|карманами|воротником)", re.I)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


def ua_title(url: str) -> str | None:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "uk-UA,uk;q=0.9"})
    page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    m = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]+)"', page) or re.search(r"<title>([^<]+)", page)
    if not m:
        return None
    title = html.unescape(m.group(1)).replace("\xa0", " ")
    # "Назва | Арт. 5590 | 3 499 грн", "Назва - купити ...", "Назва – Brand"
    return " ".join(re.split(r"\s+[|–—]\s+|\s+-\s+(?:купити|арт)", title, flags=re.I)[0].split()) or None


def main(path: str, prefix: str = "") -> None:
    f = Path(path)
    doc = json.loads(f.read_text(encoding="utf-8"))
    fixed = dropped = 0
    keep = []
    brand = (doc.get("_meta", {}).get("brand") or "").strip().lower()
    for p in doc["products"]:
        p["name"] = re.sub(r",\s*Розмір\b.*$", "", p.get("name") or "").strip()
        if RUSSIAN.search(p["name"]) or not p["name"] or p["name"].lower() == brand:
            url = p["source_url"]
            if prefix and prefix not in url:
                url = re.sub(r"^(https?://[^/]+)", r"\1" + prefix, url)
            try:
                name = ua_title(url)
            except Exception as e:  # noqa: BLE001
                print("  fail", url, e)
                name = None
            time.sleep(0.4)
            if name and not RUSSIAN.search(name) and name.lower() != brand:
                p["name"], p["source_url"] = name, url
                fixed += 1
            else:
                dropped += 1
                continue
        keep.append(p)
    doc["products"] = keep
    f.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{f.name}: {fixed} renamed from the product page, {dropped} dropped (no usable name), {len(keep)} kept")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    pref = sys.argv[sys.argv.index("--lang-prefix") + 1] if "--lang-prefix" in sys.argv else ""
    main(args[0], pref)
