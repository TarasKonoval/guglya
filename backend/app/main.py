from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import current_user, optional_user
from .config import settings
from .db import execute, fetch_all, fetch_one

Slot = Literal["hat", "top", "bottom", "shoes"]
PRODUCT_COLS = """p.id, p.title, b.name as brand, p.category, p.color, p.price_uah,
                  p.image_url, p.product_url, p.is_demo"""

# Outfit cards: totals and item thumbnails of the original items, for the «АутфітЧек» line and collages
OUTFIT_SUMMARY = """
  select o.id, o.title, o.season, o.style_tag, o.cover_image_url,
         count(p.id)::int as item_count, coalesce(sum(p.price_uah), 0)::int as total_uah,
         coalesce(json_agg(json_build_object('slot', oi.slot, 'image_url', p.image_url,
                                             'brand', b.name, 'price_uah', p.price_uah)
                  order by array_position(array['hat','top','bottom','shoes'], oi.slot))
                  filter (where p.id is not null), '[]') as items
  from outfits o
  left join outfit_items oi on oi.outfit_id = o.id
  left join products p on p.id = oi.product_id
  left join brands b on b.id = p.brand_id
"""

app = FastAPI(title="Guglya API")
# CORS lives here only (API Gateway passes everything through).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/me")
def me(user: dict = Depends(current_user)):
    prompted = fetch_one(
        """select exists(select 1 from events where user_id = %(u)s and type = 'feedback_open')
               or exists(select 1 from feedback where user_id = %(u)s) as v""",
        {"u": user["sub"]},
    )
    return {"id": user["sub"], "email": user.get("email"), "feedback_prompted": prompted["v"]}


@app.get("/outfits")
def list_outfits(season: str | None = "autumn", limit: int = 100):
    return fetch_all(
        OUTFIT_SUMMARY
        + """ where o.is_published and (%(season)s::text is null or o.season = %(season)s)
              group by o.id order by o.sort_order, o.created_at limit %(limit)s""",
        {"season": season or None, "limit": min(limit, 100)},
    )


@app.get("/outfits/{outfit_id}")
def get_outfit(outfit_id: UUID):
    outfit = fetch_one(OUTFIT_SUMMARY + " where o.id = %s group by o.id", (outfit_id,))
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    rows = fetch_all(
        f"""select oi.slot, {PRODUCT_COLS}
            from outfit_items oi join products p on p.id = oi.product_id join brands b on b.id = p.brand_id
            where oi.outfit_id = %s""",
        (outfit_id,),
    )
    outfit["products"] = {r.pop("slot"): r for r in rows}
    return outfit


@app.get("/outfits/{outfit_id}/similar/{slot}")
def similar(outfit_id: UUID, slot: Slot, color: str | None = None, limit: int = 5):
    """AI alternatives: same category, in stock, other brands (one per brand first), nearest by CLIP embedding."""
    return fetch_all(
        f"""with hero as (
              select p.id, p.brand_id, p.embedding, p.category, p.price_uah
              from outfit_items oi join products p on p.id = oi.product_id
              where oi.outfit_id = %(outfit)s and oi.slot = %(slot)s
            ), ranked as (
              select {PRODUCT_COLS},
                     p.price_uah - hero.price_uah as price_diff,
                     p.embedding <=> hero.embedding as distance,
                     row_number() over (partition by p.brand_id order by p.embedding <=> hero.embedding) as brand_rank
              from products p join brands b on b.id = p.brand_id, hero
              where p.category = hero.category and p.in_stock and p.brand_id <> hero.brand_id
                and p.embedding is not null
                and (%(color)s::text is null or p.color = %(color)s)
            )
            select id, title, brand, category, color, price_uah, image_url, product_url, is_demo,
                   price_diff, round((1 - distance)::numeric, 3)::float as similarity
            from ranked order by brand_rank, distance limit %(limit)s""",
        {"outfit": outfit_id, "slot": slot, "color": color, "limit": min(limit, 20)},
    )


@app.get("/products/{product_id}")
def get_product(product_id: UUID):
    product = fetch_one(
        f"select {PRODUCT_COLS} from products p join brands b on b.id = p.brand_id where p.id = %s", (product_id,)
    )
    if not product:
        raise HTTPException(404, "Product not found")
    return product


class ClickIn(BaseModel):
    product_id: UUID
    outfit_id: UUID | None = None
    slot: Slot | None = None


@app.post("/clicks")
def click(body: ClickIn, user: dict | None = Depends(optional_user)):
    """Log a click and return the brand URL with UTM tags; the frontend then opens it."""
    product = fetch_one("select product_url from products where id = %s", (body.product_id,))
    if not product:
        raise HTTPException(404, "Product not found")
    execute(
        """insert into clicks (user_id, product_id, outfit_id, slot, is_alternative)
           values (%(u)s, %(p)s, %(o)s, %(s)s,
                   %(o)s::uuid is not null and not exists (
                     select 1 from outfit_items where outfit_id = %(o)s and product_id = %(p)s))""",
        {"u": user["sub"] if user else None, "p": body.product_id, "o": body.outfit_id, "s": body.slot},
    )
    u = urlparse(product["product_url"])
    q = dict(parse_qsl(u.query)) | {"utm_source": "guglya", "utm_medium": "referral", "utm_campaign": "outfit"}
    return {"url": urlunparse(u._replace(query=urlencode(q)))}


class EventIn(BaseModel):
    type: Literal["outfit_view", "swap", "donate_click", "feedback_open"]
    outfit_id: UUID | None = None
    product_id: UUID | None = None


@app.post("/events")
def event(body: EventIn, user: dict | None = Depends(optional_user)):
    execute(
        "insert into events (user_id, type, outfit_id, product_id) values (%s, %s, %s, %s)",
        (user["sub"] if user else None, body.type, body.outfit_id, body.product_id),
    )
    return {"ok": True}


@app.get("/saved")
def list_saved(user: dict = Depends(current_user)):
    return fetch_all(
        OUTFIT_SUMMARY
        + """ join saved_outfits s on s.outfit_id = o.id and s.user_id = %s
              group by o.id, s.created_at order by s.created_at desc""",
        (user["sub"],),
    )


@app.post("/saved/{outfit_id}")
def save(outfit_id: UUID, user: dict = Depends(current_user)):
    execute(
        "insert into saved_outfits (user_id, outfit_id) values (%s, %s) on conflict do nothing",
        (user["sub"], outfit_id),
    )
    return {"ok": True}


@app.delete("/saved/{outfit_id}")
def unsave(outfit_id: UUID, user: dict = Depends(current_user)):
    execute("delete from saved_outfits where user_id = %s and outfit_id = %s", (user["sub"], outfit_id))
    return {"ok": True}


class FeedbackIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    would_buy: Literal["yes", "maybe", "no"] | None = None
    text: str | None = Field(default=None, max_length=4000)
    outfit_id: UUID | None = None


@app.post("/feedback")
def feedback(body: FeedbackIn, user: dict = Depends(current_user)):
    execute(
        "insert into feedback (user_id, outfit_id, rating, would_buy, text) values (%s, %s, %s, %s, %s)",
        (user["sub"], body.outfit_id, body.rating, body.would_buy, (body.text or "").strip() or None),
    )
    return {"ok": True}
