"""Generate the DEMO catalog: 8 fictional brands, 60 products, 10 autumn outfits, with our own drawn images.

Everything here is placeholder data (brands are invented; product links point to our own /demo/<id> page).
Outputs (committed, so you normally don't need to re-run this):
  data/demo/img/*.png        flat product illustrations + outfit covers -> uploaded to S3 under /img/
  data/demo/catalog.csv      import format, see backend/ml/import_catalog.py
  data/demo/outfits.json

Usage (from repo root):  python data/demo/generate_demo.py   (needs pillow)
"""
import csv
import json
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
IMG_DIR = HERE / "img"
W, H = 600, 750  # product images, 4:5
S = 2  # supersampling for smooth edges
NS = uuid.UUID("6d1f3c52-6f0e-4a8e-9a57-0b6c2f1e9d10")  # stable demo product ids

COLORS = {
    "black": (38, 36, 35), "white": (236, 232, 224), "grey": (140, 140, 138), "beige": (214, 192, 160),
    "brown": (122, 82, 54), "blue": (52, 74, 120), "green": (78, 102, 72), "red": (160, 52, 46),
    "burgundy": (104, 30, 44),
}
BG = (246, 243, 238)

BRANDS = [  # all fictional
    ("Lisova Knit", "lisova-knit"),
    ("Podil Denim", "podil-denim"),
    ("Hromada Wear", "hromada-wear"),
    ("Stezhka", "stezhka"),
    ("Polotno Studio", "polotno-studio"),
    ("Bereh Atelier", "bereh-atelier"),
    ("Kashtan Leather", "kashtan-leather"),
    ("Zerno", "zerno"),
]

# 15 per category: (shape, title, colour, price). Brand = BRANDS[index % 8].
PRODUCTS = {
    "hat": [
        ("beanie", "Вʼязана шапка біні", "beige", 790),
        ("pompom", "Шапка з помпоном", "red", 890),
        ("bucket", "Вовняна панама", "black", 1150),
        ("beanie", "Шапка рубчиком", "grey", 690),
        ("beret", "Берет з вовни", "burgundy", 950),
        ("cap", "Замшева кепка", "brown", 1090),
        ("beanie", "Мериносова біні", "green", 980),
        ("beret", "Класичний берет", "black", 870),
        ("bucket", "Стьобана панама", "beige", 1290),
        ("cap", "Кепка з вельвету", "blue", 820),
        ("beanie", "Шапка кольору бордо", "burgundy", 760),
        ("pompom", "Тепла шапка з помпоном", "white", 840),
        ("beret", "Берет кольору беж", "beige", 920),
        ("beanie", "Кашемірова біні", "brown", 1390),
        ("cap", "Вовняна кепка", "grey", 990),
    ],
    "top": [
        ("sweater", "Светр оверсайз", "beige", 2400),
        ("coat", "Вовняне пальто", "brown", 5900),
        ("hoodie", "Худі з начосом", "grey", 1850),
        ("blazer", "Піджак оверсайз", "black", 3900),
        ("trench", "Класичний тренч", "beige", 5400),
        ("jacket", "Шкіряна куртка", "black", 6900),
        ("sweater", "Светр кольору бордо", "burgundy", 2650),
        ("bomber", "Бомбер", "green", 3300),
        ("coat", "Пальто прямого крою", "grey", 6300),
        ("blazer", "Вельветовий піджак", "brown", 3600),
        ("sweater", "Мериносовий джемпер", "white", 2950),
        ("hoodie", "Худі оверсайз", "blue", 1990),
        ("trench", "Тренч кольору мокко", "brown", 5200),
        ("jacket", "Замшева куртка", "brown", 6400),
        ("sweater", "Кардиган-светр", "green", 2200),
    ],
    "bottom": [
        ("trousers", "Вовняні штани", "grey", 2300),
        ("jeans", "Широкі джинси", "blue", 2100),
        ("jeans", "Чорні джинси", "black", 2250),
        ("skirt", "Спідниця міді", "brown", 1900),
        ("trousers", "Штани палаццо", "beige", 2450),
        ("cargo", "Штани-карго", "green", 2150),
        ("skirt", "Шкіряна спідниця міді", "black", 3200),
        ("trousers", "Штани кольору бордо", "burgundy", 2350),
        ("jeans", "Прямі джинси", "blue", 1950),
        ("cargo", "Карго з кишенями", "beige", 2050),
        ("skirt", "Плісирована спідниця", "grey", 2050),
        ("trousers", "Класичні штани", "black", 2600),
        ("jeans", "Світлі джинси", "white", 2200),
        ("skirt", "Вельветова спідниця", "burgundy", 1750),
        ("trousers", "Вельветові штани", "brown", 2250),
    ],
    "shoes": [
        ("boot", "Шкіряні черевики", "black", 4900),
        ("sneaker", "Кеди шкіряні", "white", 3100),
        ("chelsea", "Челсі", "brown", 4600),
        ("loafer", "Лофери", "black", 3800),
        ("boot", "Черевики на шнурівці", "brown", 5200),
        ("sneaker", "Кросівки ретро", "grey", 3400),
        ("chelsea", "Челсі на тракторній", "black", 4800),
        ("loafer", "Лофери кольору бордо", "burgundy", 3950),
        ("sneaker", "Замшеві кеди", "beige", 2950),
        ("boot", "Зимові черевики", "beige", 5600),
        ("loafer", "Замшеві лофери", "brown", 3700),
        ("chelsea", "Сірі челсі", "grey", 4400),
        ("sneaker", "Кросівки сині", "blue", 3250),
        ("boot", "Черевики бордо", "burgundy", 5300),
        ("loafer", "Світлі лофери", "white", 3600),
    ],
}

# (title, style_tag, {slot: index into PRODUCTS[slot]}); no "hat" key = outfit without a hat
OUTFITS = [
    ("Бордо з голови до пʼят", "бордо", {"hat": 10, "top": 6, "bottom": 7, "shoes": 7}),
    ("Замша й мокко", "замша", {"hat": 5, "top": 13, "bottom": 4, "shoes": 2}),
    ("Тренч і широкі джинси", "класика", {"top": 4, "bottom": 1, "shoes": 3}),
    ("Оверсайз-піджак", "оверсайз", {"top": 3, "bottom": 0, "shoes": 1}),
    ("Шкіра й міді", "шкіра", {"hat": 7, "top": 5, "bottom": 3, "shoes": 0}),
    ("Тиха розкіш у беж", "тиха розкіш", {"hat": 12, "top": 10, "bottom": 4, "shoes": 10}),
    ("Преппі на пари", "преппі", {"hat": 4, "top": 14, "bottom": 10, "shoes": 3}),
    ("Спорт-шик", "спорт-шик", {"hat": 3, "top": 2, "bottom": 11, "shoes": 5}),
    ("Карго та бомбер", "мілітарі", {"hat": 6, "top": 7, "bottom": 9, "shoes": 4}),
    ("Сірий монохром", "монохром", {"hat": 14, "top": 8, "bottom": 0, "shoes": 11}),
]
COVER_BG = (236, 226, 212)


def shade(rgb, f):
    return tuple(max(0, min(255, int(c * f))) for c in rgb)


def p(*pts):
    return [(x * S, y * S) for x, y in pts]


def draw_item(shape: str, color: tuple) -> Image.Image:
    """Return the item drawn on a transparent W x H layer."""
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    dark, light, line = shade(color, 0.78), shade(color, 1.15), shade(color, 0.6)

    # Hats
    if shape in ("beanie", "pompom"):
        d.pieslice(p((140, 200), (460, 560)), 180, 360, fill=color)
        d.rectangle(p((130, 380), (470, 500)), fill=dark)
        for x in range(145, 470, 22):
            d.line(p((x, 385), (x, 495)), fill=line, width=3 * S)
        for x in range(170, 440, 30):
            d.line(p((x, 260), (x, 375)), fill=shade(color, 0.9), width=2 * S)
        if shape == "pompom":
            d.ellipse(p((250, 140), (350, 240)), fill=light)
    elif shape == "bucket":
        d.polygon(p((200, 250), (400, 250), (440, 440), (160, 440)), fill=color)
        d.ellipse(p((95, 410), (505, 500)), fill=dark)
        d.polygon(p((160, 440), (440, 440), (430, 455), (170, 455)), fill=color)
        d.line(p((178, 400), (422, 400)), fill=line, width=3 * S)
    elif shape == "beret":
        d.ellipse(p((90, 290), (510, 470)), fill=color)
        d.ellipse(p((170, 430), (430, 490)), fill=dark)
        d.rectangle(p((292, 260), (308, 300)), fill=dark)
    elif shape == "cap":
        d.pieslice(p((150, 230), (450, 530)), 180, 360, fill=color)
        d.polygon(p((330, 380), (520, 380), (540, 410), (330, 410)), fill=dark)
        d.line(p((300, 235), (300, 380)), fill=line, width=3 * S)
        d.ellipse(p((290, 222), (310, 242)), fill=dark)

    # Tops
    elif shape in ("sweater", "hoodie", "bomber"):
        d.polygon(p((190, 150), (410, 150), (530, 230), (560, 560), (490, 570), (460, 300),
                    (460, 620), (140, 620), (140, 300), (110, 570), (40, 560), (70, 230)), fill=color)
        d.rectangle(p((140, 590), (460, 630)), fill=dark)
        for x in range(150, 460, 18):
            d.line(p((x, 594), (x, 626)), fill=line, width=2 * S)
        if shape == "sweater":
            d.rounded_rectangle(p((240, 130), (360, 185)), radius=20 * S, fill=dark)
        elif shape == "hoodie":
            d.ellipse(p((210, 70), (390, 230)), fill=dark)
            d.ellipse(p((245, 120), (355, 215)), fill=shade(color, 0.5))
            d.rectangle(p((210, 380), (390, 480)), outline=line, width=3 * S)
        else:  # bomber: zip, ribbed collar and cuffs
            d.rounded_rectangle(p((230, 135), (370, 175)), radius=14 * S, fill=dark)
            d.line(p((300, 175), (300, 590)), fill=(190, 190, 185), width=3 * S)
            d.rectangle(p((488, 540), (562, 572)), fill=dark)
            d.rectangle(p((38, 540), (112, 572)), fill=dark)
            d.rectangle(p((175, 300), (235, 320)), fill=dark)
    elif shape in ("coat", "trench", "blazer", "jacket"):
        hem = {"coat": 700, "trench": 710, "blazer": 600, "jacket": 560}[shape]
        d.polygon(p((200, 90), (400, 90), (510, 160), (550, 560), (480, 570), (455, 290),
                    (470, hem), (130, hem), (145, 290), (120, 570), (50, 560), (90, 160)), fill=color)
        if shape == "jacket":
            d.polygon(p((240, 90), (300, 200), (360, 90)), fill=dark)
            d.line(p((300, 200), (300, hem)), fill=(200, 200, 195), width=3 * S)
            d.polygon(p((130, hem - 40), (470, hem - 40), (470, hem), (130, hem)), fill=dark)
        else:
            d.polygon(p((240, 90), (300, 300), (210, 200)), fill=dark)
            d.polygon(p((360, 90), (300, 300), (390, 200)), fill=dark)
            d.line(p((300, 300), (300, hem)), fill=line, width=3 * S)
            for y in (360, 450) if shape == "blazer" else (360, 450, 540):
                d.ellipse(p((315, y), (335, y + 20)), fill=line)
            d.line(p((160, 470), (230, 470)), fill=line, width=3 * S)
            d.line(p((370, 470), (440, 470)), fill=line, width=3 * S)
        if shape == "trench":
            d.rectangle(p((138, 400), (462, 430)), fill=dark)
            d.rectangle(p((285, 396), (315, 434)), outline=line, width=3 * S)

    # Bottoms
    elif shape in ("trousers", "jeans", "cargo"):
        d.polygon(p((180, 90), (420, 90), (470, 690), (330, 690), (300, 250),
                    (270, 690), (130, 690), (180, 90)), fill=color)
        d.rectangle(p((178, 90), (422, 130)), fill=dark)
        if shape == "jeans":
            stitch = (196, 150, 70)
            d.line(p((300, 130), (300, 250)), fill=stitch, width=2 * S)
            d.arc(p((195, 110), (275, 200)), 0, 90, fill=stitch, width=2 * S)
            d.arc(p((325, 110), (405, 200)), 90, 180, fill=stitch, width=2 * S)
        elif shape == "cargo":
            d.rectangle(p((150, 380), (220, 470)), fill=dark)
            d.rectangle(p((380, 380), (450, 470)), fill=dark)
            d.line(p((150, 400), (220, 400)), fill=line, width=3 * S)
            d.line(p((380, 400), (450, 400)), fill=line, width=3 * S)
        else:
            d.line(p((215, 140), (180, 680)), fill=line, width=2 * S)
            d.line(p((385, 140), (420, 680)), fill=line, width=2 * S)
    elif shape == "skirt":
        d.polygon(p((200, 120), (400, 120), (490, 630), (110, 630)), fill=color)
        d.rectangle(p((195, 110), (405, 155)), fill=dark)
        for i, x in enumerate(range(130, 480, 45)):
            top_x = 200 + (x - 110) * 200 / 380
            d.line(p((top_x, 160), (x, 625)), fill=line if i % 2 else light, width=2 * S)

    # Shoes
    elif shape in ("boot", "chelsea"):
        for dx in (0, 210):
            d.polygon(p((90 + dx, 200), (210 + dx, 200), (215 + dx, 470), (290 + dx, 520), (295 + dx, 560),
                        (80 + dx, 560), (85 + dx, 300)), fill=color)
            d.rectangle(p((78 + dx, 555), (298 + dx, 585)), fill=shade(color, 0.45))
            if shape == "boot":
                for y in range(240, 470, 38):
                    d.line(p((120 + dx, y), (185 + dx, y + 12)), fill=light, width=3 * S)
            else:
                d.polygon(p((90 + dx, 300), (130 + dx, 300), (125 + dx, 420), (95 + dx, 420)), fill=dark)
                d.rounded_rectangle(p((140 + dx, 180), (170 + dx, 215)), radius=6 * S, fill=dark)
    elif shape in ("sneaker", "loafer"):
        for dy in (0, 200):
            if shape == "sneaker":
                d.polygon(p((80, 300 + dy), (230, 290 + dy), (330, 350 + dy), (510, 380 + dy),
                            (530, 430 + dy), (70, 430 + dy)), fill=color)
                d.rounded_rectangle(p((60, 420 + dy), (540, 455 + dy)), radius=12 * S, fill=(246, 244, 240))
                lace = line if color == COLORS["white"] else light
                for x in range(240, 330, 22):
                    d.line(p((x, 320 + dy), (x + 18, 345 + dy)), fill=lace, width=3 * S)
            else:
                d.polygon(p((80, 340 + dy), (200, 330 + dy), (300, 360 + dy), (500, 390 + dy),
                            (530, 435 + dy), (70, 435 + dy)), fill=color)
                d.rectangle(p((300, 372 + dy), (380, 390 + dy)), fill=dark)
                d.rectangle(p((65, 432 + dy), (535, 448 + dy)), fill=shade(color, 0.45))
    else:
        raise ValueError(shape)
    return img.resize((W, H), Image.LANCZOS)


def on_background(layer: Image.Image, bg: tuple) -> Image.Image:
    base = Image.new("RGBA", layer.size, bg + (255,))
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    shadow.putalpha(layer.getchannel("A").point(lambda a: a * 0.18))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    base.alpha_composite(shadow, (8, 14))
    base.alpha_composite(layer)
    return base.convert("RGB")


def main() -> None:
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    rows, layers, urls = [], {}, {}
    for cat, items in PRODUCTS.items():
        for i, (shape, title, color, price) in enumerate(items):
            brand, slug = BRANDS[i % len(BRANDS)]
            name = f"{cat}-{i + 1:02d}"
            layer = draw_item(shape, COLORS[color])
            on_background(layer, BG).save(IMG_DIR / f"{name}.png", optimize=True)
            layers[(cat, i)] = layer
            url = f"/demo/{uuid.uuid5(NS, name)}"
            urls[(cat, i)] = url
            rows.append({
                "brand": brand, "brand_site": f"https://example.com/{slug}", "title": title,
                "category": cat, "color": color, "price_uah": price,
                "image_url": f"/img/{name}.png", "product_url": url, "in_stock": "true",
            })
    with open(HERE / "catalog.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    # Covers: a vertical flat lay of the outfit's items, 2:3
    placement = {"hat": (0.42, 10), "top": (0.82, 190), "bottom": (0.74, 640), "shoes": (0.5, 975)}
    outfits = []
    for n, (title, tag, picks) in enumerate(OUTFITS, 1):
        cover = Image.new("RGBA", (900, 1350), (0, 0, 0, 0))
        shift = 0 if "hat" in picks else -90  # no hat: move everything up a bit
        for slot in ("bottom", "top", "shoes", "hat"):
            if slot not in picks:
                continue
            scale, y = placement[slot]
            layer = layers[(slot, picks[slot])].resize((int(W * scale), int(H * scale)), Image.LANCZOS)
            cover.alpha_composite(layer, (450 - layer.width // 2, max(0, y + shift)))
        name = f"outfit-{n:02d}.png"
        on_background(cover, COVER_BG).save(IMG_DIR / name, optimize=True)
        outfits.append({
            "title": title, "season": "autumn", "cover_image_url": f"/img/{name}", "style_tag": tag,
            "items": {slot: urls[(slot, i)] for slot, i in picks.items()},
        })
    with open(HERE / "outfits.json", "w", encoding="utf-8") as f:
        json.dump(outfits, f, ensure_ascii=False, indent=2)
    print(f"{len(rows)} products, {len(outfits)} outfits -> {IMG_DIR}")


if __name__ == "__main__":
    main()
