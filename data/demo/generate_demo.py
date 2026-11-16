"""Generate the DEMO catalog: 5 fictional brands, 40 products, 6 outfits, with our own drawn images.

Everything here is placeholder data for the prototype (brands are invented, product links go to example.com).
Outputs (committed, so you normally don't need to re-run this):
  frontend/public/demo/*.png      product illustrations + outfit covers (served by the frontend)
  data/demo/catalog.csv           same format as data/catalog.example.csv
  data/demo/outfits.json          same format as data/outfits.example.json

Usage (from repo root):  python data/demo/generate_demo.py   (needs pillow)
"""
import csv
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
IMG_DIR = ROOT / "frontend" / "public" / "demo"
W, H = 600, 750  # product images, 4:5
S = 2  # supersampling for smooth edges

COLORS = {
    "black": (38, 36, 35),
    "white": (236, 232, 224),
    "grey": (140, 140, 138),
    "beige": (214, 192, 160),
    "brown": (122, 82, 54),
    "blue": (52, 74, 120),
    "green": (78, 102, 72),
    "red": (138, 44, 44),
}
BG = (245, 241, 235)

BRANDS = [
    ("Lisova Knit · demo", "lisova-knit"),
    ("Podil Denim · demo", "podil-denim"),
    ("Hromada Wear · demo", "hromada-wear"),
    ("Stezhka Shoes · demo", "stezhka-shoes"),
    ("Polotno Studio · demo", "polotno-studio"),
]

# (category, shape, title, colour, price) — 2 per brand per category, in BRANDS order
PRODUCTS = {
    "hat": [
        ("beanie", "Вʼязана шапка біні", "beige", 790),
        ("pompom", "Шапка з помпоном", "red", 890),
        ("bucket", "Панама з вовни", "black", 1150),
        ("beanie", "Шапка рубчиком", "grey", 690),
        ("beanie", "Мериносова біні", "green", 980),
        ("bucket", "Вельветова панама", "brown", 1050),
        ("pompom", "Тепла шапка з помпоном", "white", 840),
        ("beanie", "Шапка з відворотом", "blue", 720),
        ("bucket", "Стьобана панама", "beige", 1290),
        ("beanie", "Кашемірова біні", "black", 1390),
    ],
    "top": [
        ("sweater", "Светр оверсайз", "beige", 2400),
        ("coat", "Вовняне пальто", "brown", 5900),
        ("hoodie", "Худі з начосом", "grey", 1850),
        ("sweater", "Светр з горлом", "black", 2650),
        ("coat", "Пальто прямого крою", "grey", 6300),
        ("sweater", "Кардиган-светр", "green", 2200),
        ("hoodie", "Худі оверсайз", "blue", 1990),
        ("coat", "Тренч утеплений", "beige", 5400),
        ("sweater", "Мериносовий джемпер", "red", 2950),
        ("hoodie", "Худі на блискавці", "black", 2100),
    ],
    "bottom": [
        ("trousers", "Вовняні штани", "grey", 2300),
        ("jeans", "Джинси прямі", "blue", 2100),
        ("jeans", "Джинси широкі", "black", 2250),
        ("skirt", "Спідниця міді", "brown", 1900),
        ("trousers", "Штани палаццо", "beige", 2450),
        ("jeans", "Джинси мом", "blue", 1950),
        ("skirt", "Вельветова спідниця", "green", 1750),
        ("trousers", "Класичні штани", "black", 2600),
        ("trousers", "Штани-карго", "green", 2150),
        ("skirt", "Плісирована спідниця", "grey", 2050),
    ],
    "shoes": [
        ("boot", "Шкіряні черевики", "black", 4900),
        ("sneaker", "Кеди замшеві", "white", 3100),
        ("chelsea", "Челсі", "brown", 4600),
        ("sneaker", "Кросівки утеплені", "grey", 3400),
        ("boot", "Черевики на шнурівці", "brown", 5200),
        ("chelsea", "Челсі на тракторній", "black", 4800),
        ("sneaker", "Кеди шкіряні", "beige", 2950),
        ("boot", "Зимові черевики", "beige", 5600),
        ("chelsea", "Замшеві челсі", "green", 4400),
        ("sneaker", "Кросівки ретро", "blue", 3250),
    ],
}

# Outfits: (title, season, {slot: index into PRODUCTS[slot]})
OUTFITS = [
    ("Осінь у Львові", "autumn", {"hat": 0, "top": 0, "bottom": 1, "shoes": 2}),
    ("Кава на Подолі", "autumn", {"hat": 3, "top": 7, "bottom": 7, "shoes": 1}),
    ("Карпатський вікенд", "autumn", {"hat": 4, "top": 5, "bottom": 8, "shoes": 4}),
    ("Перший сніг", "winter", {"hat": 6, "top": 4, "bottom": 0, "shoes": 7}),
    ("Різдвяний ярмарок", "winter", {"hat": 1, "top": 1, "bottom": 3, "shoes": 0}),
    ("Зимове місто", "winter", {"hat": 9, "top": 3, "bottom": 2, "shoes": 5}),
]
OUTFIT_BG = {"autumn": (236, 224, 208), "winter": (226, 230, 234)}


def shade(rgb, f):
    return tuple(max(0, min(255, int(c * f))) for c in rgb)


def p(*pts):
    return [(x * S, y * S) for x, y in pts]


def draw_item(shape: str, color: tuple) -> Image.Image:
    """Return the item drawn on a transparent W x H layer."""
    img = Image.new("RGBA", (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    dark, light = shade(color, 0.78), shade(color, 1.12)
    line = shade(color, 0.6)

    if shape in ("beanie", "pompom"):
        d.ellipse(p((140, 200), (460, 560)), fill=color)
        d.rectangle(p((140, 380), (460, 560)), fill=(0, 0, 0, 0))
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

    elif shape in ("sweater", "hoodie"):
        d.polygon(p((190, 150), (410, 150), (530, 230), (560, 560), (490, 570), (460, 300),
                    (460, 620), (140, 620), (140, 300), (110, 570), (40, 560), (70, 230)), fill=color)
        d.rectangle(p((140, 590), (460, 630)), fill=dark)
        for x in range(150, 460, 18):
            d.line(p((x, 594), (x, 626)), fill=line, width=2 * S)
        if shape == "sweater":
            d.rounded_rectangle(p((240, 130), (360, 185)), radius=20 * S, fill=dark)
        else:
            d.ellipse(p((210, 70), (390, 230)), fill=dark)
            d.ellipse(p((245, 120), (355, 215)), fill=shade(color, 0.5))
            d.rectangle(p((210, 380), (390, 480)), outline=line, width=3 * S)
            d.line(p((280, 220), (275, 330)), fill=light, width=4 * S)
            d.line(p((320, 220), (325, 330)), fill=light, width=4 * S)
    elif shape == "coat":
        d.polygon(p((200, 90), (400, 90), (510, 160), (550, 560), (480, 570), (455, 290),
                    (470, 700), (130, 700), (145, 290), (120, 570), (50, 560), (90, 160)), fill=color)
        d.polygon(p((240, 90), (300, 300), (210, 200)), fill=dark)
        d.polygon(p((360, 90), (300, 300), (390, 200)), fill=dark)
        d.line(p((300, 300), (300, 700)), fill=line, width=3 * S)
        for y in (360, 450, 540):
            d.ellipse(p((315, y), (335, y + 20)), fill=line)
        d.line(p((160, 470), (230, 470)), fill=line, width=3 * S)
        d.line(p((370, 470), (440, 470)), fill=line, width=3 * S)

    elif shape in ("trousers", "jeans"):
        d.polygon(p((180, 90), (420, 90), (470, 690), (330, 690), (300, 250),
                    (270, 690), (130, 690), (180, 90)), fill=color)
        d.rectangle(p((178, 90), (422, 130)), fill=dark)
        if shape == "jeans":
            stitch = (196, 150, 70)
            d.line(p((300, 130), (300, 250)), fill=stitch, width=2 * S)
            d.arc(p((195, 110), (275, 200)), 0, 90, fill=stitch, width=2 * S)
            d.arc(p((325, 110), (405, 200)), 90, 180, fill=stitch, width=2 * S)
            for x in (215, 300, 385):
                d.rectangle(p((x - 6, 86), (x + 6, 134)), fill=color)
        else:
            d.line(p((215, 140), (180, 680)), fill=line, width=2 * S)
            d.line(p((385, 140), (420, 680)), fill=line, width=2 * S)
    elif shape == "skirt":
        d.polygon(p((200, 120), (400, 120), (490, 630), (110, 630)), fill=color)
        d.rectangle(p((195, 110), (405, 155)), fill=dark)
        for i, x in enumerate(range(130, 480, 45)):
            top_x = 200 + (x - 110) * 200 / 380
            d.line(p((top_x, 160), (x, 625)), fill=line if i % 2 else light, width=2 * S)

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
    elif shape == "sneaker":
        for dy in (0, 200):
            d.polygon(p((80, 300 + dy), (230, 290 + dy), (330, 350 + dy), (510, 380 + dy),
                        (530, 430 + dy), (70, 430 + dy)), fill=color)
            d.rounded_rectangle(p((60, 420 + dy), (540, 455 + dy)), radius=12 * S, fill=(246, 244, 240))
            d.line(p((60, 438 + dy), (540, 438 + dy)), fill=(210, 206, 200), width=2 * S)
            for x in range(240, 330, 22):
                d.line(p((x, 320 + dy), (x + 18, 345 + dy)), fill=light if color != COLORS["white"] else line,
                       width=3 * S)
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
    random.seed(7)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    rows, layers, urls = [], {}, {}
    for cat, items in PRODUCTS.items():
        for i, (shape, title, color, price) in enumerate(items):
            brand, slug = BRANDS[i // 2]
            name = f"{cat}-{i + 1:02d}"
            layer = draw_item(shape, COLORS[color])
            on_background(layer, BG).save(IMG_DIR / f"{name}.png", optimize=True)
            layers[(cat, i)] = layer
            url = f"https://example.com/demo/{slug}/{name}"
            urls[(cat, i)] = url
            rows.append({
                "brand": brand, "brand_site": f"https://example.com/demo/{slug}", "title": title,
                "category": cat, "color": color, "price_uah": price,
                "image_url": f"/demo/{name}.png", "product_url": url,
            })

    with open(ROOT / "data" / "demo" / "catalog.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    # Outfit covers: a vertical flat lay of the four hero items, 2:3
    placement = {"hat": (0.42, 300, 10), "top": (0.82, 175, 190), "bottom": (0.74, 200, 640), "shoes": (0.5, 300, 975)}
    outfits = []
    for n, (title, season, picks) in enumerate(OUTFITS, 1):
        cover = Image.new("RGBA", (900, 1350), (0, 0, 0, 0))
        for slot in ("bottom", "top", "shoes", "hat"):
            scale, x, y = placement[slot]
            layer = layers[(slot, picks[slot])]
            layer = layer.resize((int(W * scale), int(H * scale)), Image.LANCZOS)
            cover.alpha_composite(layer, (x if slot not in ("hat", "shoes") else 450 - layer.width // 2, y))
        name = f"outfit-{n:02d}.png"
        on_background(cover, OUTFIT_BG[season]).save(IMG_DIR / name, optimize=True)
        outfits.append({
            "title": title, "season": season, "cover_image_url": f"/demo/{name}",
            "items": {slot: urls[(slot, i)] for slot, i in picks.items()},
        })
    with open(ROOT / "data" / "demo" / "outfits.json", "w", encoding="utf-8") as f:
        json.dump(outfits, f, ensure_ascii=False, indent=2)
    print(f"{len(rows)} products, {len(outfits)} outfits -> {IMG_DIR}")


if __name__ == "__main__":
    main()
