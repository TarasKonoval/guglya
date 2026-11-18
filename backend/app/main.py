from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import admin_user, current_user, is_admin, optional_user
from .config import settings
from .db import execute, fetch_all, fetch_one, transaction

Slot = Literal["hat", "top", "dress", "bottom", "shoes"]
PRODUCT_COLS = """p.id, p.title, b.name as brand, p.category, p.color, p.price_uah,
                  p.image_url, p.product_url, p.is_demo"""

# Outfit cards: totals and item thumbnails of the original items, for the «АутфітЧек» line and collages.
# colors and popularity (views + 3×saves + 5×brand clicks) feed the filters on the feed.
OUTFIT_SUMMARY = """
  select o.id, o.title, o.season, o.gender, o.style_tag, o.cover_image_url,
         count(p.id)::int as item_count, coalesce(sum(p.price_uah), 0)::int as total_uah,
         coalesce(array_agg(distinct p.color) filter (where p.color is not null), '{}') as colors,
         ((select count(*) from events e where e.outfit_id = o.id and e.type = 'outfit_view')
          + 3 * (select count(*) from saved_outfits s where s.outfit_id = o.id)
          + 5 * (select count(*) from clicks c where c.outfit_id = o.id))::int as popularity,
         coalesce(json_agg(json_build_object('person', oi.person, 'slot', oi.slot, 'image_url', p.image_url,
                                             'brand', b.name, 'price_uah', p.price_uah)
                  order by oi.person, array_position(array['hat','top','dress','bottom','shoes'], oi.slot))
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
    row = fetch_one(
        """select first_name, last_name, phone,
                  exists(select 1 from events where user_id = %(u)s and type = 'feedback_open')
                  or exists(select 1 from feedback where user_id = %(u)s) as feedback_prompted
           from users where id = %(u)s""",
        {"u": user["sub"]},
    )
    return {"id": user["sub"], "email": user.get("email"), "is_admin": is_admin(user), **row}


class ProfileIn(BaseModel):
    first_name: str = Field(default="", max_length=80)
    last_name: str = Field(default="", max_length=80)
    phone: str = Field(default="", max_length=30, pattern=r"^[0-9+()\- ]*$")


@app.put("/me")
def update_me(body: ProfileIn, user: dict = Depends(current_user)):
    execute(
        "update users set first_name = %s, last_name = %s, phone = %s where id = %s",
        (body.first_name.strip() or None, body.last_name.strip() or None, body.phone.strip() or None, user["sub"]),
    )
    return me(user)


@app.get("/outfits")
def list_outfits(
    season: str | None = "autumn", gender: Literal["women", "men", "couple"] | None = None, limit: int = 100
):
    return fetch_all(
        OUTFIT_SUMMARY
        + """ where o.is_published and (%(season)s::text is null or o.season = %(season)s)
                and (%(gender)s::text is null or o.gender in (%(gender)s, 'unisex'))
              group by o.id order by o.sort_order, o.created_at limit %(limit)s""",
        {"season": season or None, "gender": gender, "limit": min(limit, 100)},
    )


@app.get("/outfits/{outfit_id}")
def get_outfit(outfit_id: UUID):
    outfit = fetch_one(OUTFIT_SUMMARY + " where o.id = %s group by o.id", (outfit_id,))
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    rows = fetch_all(
        f"""select oi.person, oi.slot, {PRODUCT_COLS}
            from outfit_items oi join products p on p.id = oi.product_id join brands b on b.id = p.brand_id
            where oi.outfit_id = %s order by oi.person""",
        (outfit_id,),
    )
    # One look for a regular outfit, two for a couple
    looks: dict[int, dict] = {}
    for r in rows:
        looks.setdefault(r.pop("person"), {})[r.pop("slot")] = r
    outfit["looks"] = [{"person": n, "products": products} for n, products in looks.items()]
    return outfit


# Brand popularity 0..1: Instagram followers (70%) + clicks to the brand on Ґуґля (30%), both log-scaled.
BRAND_POPULARITY = """
  select b.id as brand_id,
         0.7 * coalesce(ln(1 + b.instagram_followers) / nullif(ln(1 + max(b.instagram_followers) over ()), 0), 0)
       + 0.3 * coalesce(ln(1 + c.n) / nullif(ln(1 + max(c.n) over ()), 0), 0) as score
  from brands b
  left join (select p.brand_id, count(*) as n from clicks k join products p on p.id = k.product_id group by 1) c
    on c.brand_id = b.id
"""
POPULARITY_WEIGHT = 0.05  # popularity can lift an item over one up to 0.05 more similar (cosine)


@app.get("/outfits/{outfit_id}/similar/{slot}")
def similar(outfit_id: UUID, slot: Slot, person: int = 1, color: str | None = None, limit: int = 5):
    """AI alternatives: same category and gender, in stock, other brands (one per brand first), ranked by
    CLIP similarity with a bonus for popular brands."""
    return fetch_all(
        f"""with hero as (
              select p.id, p.brand_id, p.embedding, p.category, p.gender, p.price_uah
              from outfit_items oi join products p on p.id = oi.product_id
              where oi.outfit_id = %(outfit)s and oi.person = %(person)s and oi.slot = %(slot)s
            ), pop as ({BRAND_POPULARITY}), ranked as (
              select {PRODUCT_COLS},
                     p.price_uah - hero.price_uah as price_diff,
                     1 - (p.embedding <=> hero.embedding) as similarity,
                     row_number() over (partition by p.brand_id order by p.embedding <=> hero.embedding) as brand_rank,
                     coalesce(pop.score, 0) as brand_score
              from products p join brands b on b.id = p.brand_id left join pop on pop.brand_id = p.brand_id, hero
              where p.category = hero.category and p.in_stock and p.brand_id <> hero.brand_id
                and p.embedding is not null
                and (hero.gender is null or p.gender is null or hero.gender = 'unisex'
                     or p.gender in (hero.gender, 'unisex'))
                and (%(color)s::text is null or p.color = %(color)s)
            )
            select id, title, brand, category, color, price_uah, image_url, product_url, is_demo,
                   price_diff, round(similarity::numeric, 3)::float as similarity
            from ranked
            order by brand_rank, similarity + {POPULARITY_WEIGHT} * brand_score desc
            limit %(limit)s""",
        {"outfit": outfit_id, "slot": slot, "person": person, "color": color, "limit": min(limit, 20)},
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


@app.get("/cart")
def list_cart(user: dict = Depends(current_user)):
    return fetch_all(
        f"""select {PRODUCT_COLS}, c.outfit_id, c.slot
            from cart_items c join products p on p.id = c.product_id join brands b on b.id = p.brand_id
            where c.user_id = %s order by c.created_at desc""",
        (user["sub"],),
    )


class CartIn(BaseModel):
    product_id: UUID
    outfit_id: UUID | None = None
    slot: Slot | None = None


@app.post("/cart")
def add_to_cart(body: CartIn, user: dict = Depends(current_user)):
    execute(
        """insert into cart_items (user_id, product_id, outfit_id, slot) values (%s, %s, %s, %s)
           on conflict do nothing""",
        (user["sub"], body.product_id, body.outfit_id, body.slot),
    )
    return {"ok": True}


@app.delete("/cart/{product_id}")
def remove_from_cart(product_id: UUID, user: dict = Depends(current_user)):
    execute("delete from cart_items where user_id = %s and product_id = %s", (user["sub"], product_id))
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


# --- Admin: outfit builder (/admin page). The outfit agent Lambda (backend/agent) turns a look photo into
# pieces with FashionCLIP text vectors; these endpoints search the real catalog and publish the outfit.

class MatchIn(BaseModel):
    slot: Slot
    gender: Literal["women", "men", "unisex"]
    vector: list[float] = Field(min_length=512, max_length=512)
    color: str | None = None
    limit: int = Field(default=8, ge=1, le=20)


@app.post("/admin/match")
def admin_match(body: MatchIn, _: dict = Depends(admin_user)):
    """Closest real products to one piece: same slot and gender, in stock; one per brand first, then CLIP
    similarity with small bonuses for the same colour and for popular brands."""
    return fetch_all(
        f"""with pop as ({BRAND_POPULARITY}), ranked as (
              select {PRODUCT_COLS}, p.item_type, p.old_price_uah,
                     1 - (p.embedding <=> %(vec)s::vector) as similarity,
                     coalesce(pop.score, 0) as brand_score,
                     (p.color is not distinct from %(color)s) as same_color
              from products p join brands b on b.id = p.brand_id left join pop on pop.brand_id = p.brand_id
              where p.category = %(slot)s and p.in_stock and not p.is_demo and p.embedding is not null
                and (p.gender is null or p.gender in (%(gender)s, 'unisex') or %(gender)s = 'unisex')
              order by p.embedding <=> %(vec)s::vector
              limit 200
            ), scored as (
              select *, similarity + 0.02 * same_color::int + {POPULARITY_WEIGHT} * brand_score as score
              from ranked
            )
            select id, title, brand, category, color, price_uah, old_price_uah, image_url, product_url, item_type,
                   round(similarity::numeric, 3)::float as similarity
            from (select *, row_number() over (partition by brand order by score desc) as brand_rank from scored) s
            order by brand_rank, score desc
            limit %(limit)s""",
        {"vec": str(body.vector), "slot": body.slot, "gender": body.gender, "color": body.color, "limit": body.limit},
    )


@app.post("/admin/upload-url")
def admin_upload_url(_: dict = Depends(admin_user)):
    """Presigned S3 PUT for a look cover (JPEG). Signing happens locally, so the Lambda needs no S3 network access."""
    if not settings.upload_bucket:
        raise HTTPException(503, "Uploads are not configured here")
    import boto3  # in the Lambda base image; only needed by admins

    key = f"img/looks/{uuid4()}.jpg"
    url = boto3.client("s3", region_name=settings.region).generate_presigned_url(
        "put_object", Params={"Bucket": settings.upload_bucket, "Key": key, "ContentType": "image/jpeg"}, ExpiresIn=600
    )
    return {"upload_url": url, "image_url": f"/{key}"}


class OutfitIn(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    gender: Literal["women", "men", "unisex", "couple"]
    style_tag: str | None = Field(default=None, max_length=30)
    cover_image_url: str | None = Field(default=None, pattern=r"^/img/looks/[0-9a-f-]{36}\.jpg$")
    looks: list[dict[Slot, UUID]] = Field(min_length=1, max_length=2)


@app.post("/admin/outfits")
def admin_create_outfit(body: OutfitIn, _: dict = Depends(admin_user)):
    # a dress/set replaces the bottom (a coat on top of it is fine)
    if any(not look or {"dress", "bottom"} <= look.keys() for look in body.looks):
        raise HTTPException(400, "Each look needs items, and a dress can't be combined with a bottom")
    if (body.gender == "couple") != (len(body.looks) == 2):
        raise HTTPException(400, "A couple outfit has exactly two looks")
    if fetch_one("select 1 from outfits where title = %s", (body.title.strip(),)):
        raise HTTPException(409, "An outfit with this title already exists")
    with transaction() as conn:
        outfit = conn.execute(
            """insert into outfits (title, season, gender, style_tag, cover_image_url, sort_order, is_published)
               values (%s, 'autumn', %s, %s, %s, (select coalesce(min(sort_order), 0) - 1 from outfits), true)
               returning id""",
            (body.title.strip(), body.gender, (body.style_tag or "").strip().lstrip("#") or None, body.cover_image_url),
        ).fetchone()
        for person, look in enumerate(body.looks, 1):
            for slot, product_id in look.items():
                conn.execute(
                    "insert into outfit_items (outfit_id, person, slot, product_id) values (%s, %s, %s, %s)",
                    (outfit["id"], person, slot, product_id),
                )
    return outfit


@app.get("/admin/outfits")
def admin_list_outfits(_: dict = Depends(admin_user)):
    return fetch_all(
        """select o.id, o.title, o.gender, o.is_published, o.created_at,
                  bool_or(p.is_demo) as is_demo, count(oi.product_id)::int as item_count
           from outfits o left join outfit_items oi on oi.outfit_id = o.id left join products p on p.id = oi.product_id
           group by o.id order by o.sort_order, o.created_at"""
    )


class PublishIn(BaseModel):
    is_published: bool


@app.patch("/admin/outfits/{outfit_id}")
def admin_publish(outfit_id: UUID, body: PublishIn, _: dict = Depends(admin_user)):
    execute("update outfits set is_published = %s where id = %s", (body.is_published, outfit_id))
    return {"ok": True}
