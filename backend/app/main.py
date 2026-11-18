from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import admin_user, current_user, is_admin, optional_user
from .config import settings
from .db import execute, fetch_all, fetch_one, transaction

Slot = Literal["hat", "outer", "jacket", "top", "dress", "bottom", "shoes"]
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
                  order by oi.person, array_position(array['hat','outer','jacket','top','dress','bottom','shoes'], oi.slot))
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
SAME_TYPE_BONUS = 0.06    # кеди -> кеди before кеди -> черевики (same-type pairs score ~0.75-0.9, others ~0.65-0.7)
MIN_SIMILARITY = 0.6      # below this it's a different kind of item: better no alternative than a wrong one


# Alternatives stay within the item's kind: trousers vs sweatpants vs jeans, loafers vs boots vs sneakers...
# (falls back to the whole slot only when the group has fewer than MIN_GROUP candidates).
TYPE_GROUPS = {
    "coat": ["Пальто", "Тренч", "Шуба", "Дублянка"],
    "jacket": ["Куртка", "Бомбер", "Пуховик", "Парка", "Вітрівка", "Косуха"],
    "knit": ["Светр", "Джемпер", "Гольф", "Водолазка", "Кардиган"],
    "sweatshirt": ["Світшот", "Худі"],
    "shirt": ["Сорочка", "Блуза", "Вишиванка"],
    "tee": ["Футболка", "Лонгслів", "Поло", "Майка"],
    "fitted_top": ["Топ", "Боді", "Корсет"],
    "trousers": ["Брюки", "Чіноси", "Штани"],
    "jeans": ["Джинси"],
    "sweatpants": ["Спортивні штани", "Легінси", "Джогери"],
    "dress_shoes": ["Туфлі", "Лофери", "Мюлі", "Дербі", "Оксфорди", "Монки"],
    "boots": ["Черевики", "Чоботи"],
    "sneakers": ["Кросівки", "Кеди"],
    "sandals": ["Сандалі", "Капці", "Шльопанці"],
    "dress": ["Сукня", "Комбінезон"],
    "suit": ["Класичний костюм", "Костюм"],
    "tracksuit": ["Спортивний костюм"],
    "beanie": ["Шапка", "Балаклава"],
    "cap": ["Кепка", "Бейсболка"],
    "brimmed": ["Капелюх", "Панама"],
}
GROUP_OF = {t.lower(): g for g, types in TYPE_GROUPS.items() for t in types}
# Shop types are sometimes too broad ("Брюки" for fleece joggers, "Взуття" for anything): the title decides first
TITLE_GROUPS = [
    ("bottom", "спортивн|фліс|джогер|jogger|sweatpant|трикотажн|тринитк|трьохнитк|футер", "sweatpants"),
    ("bottom", "джинс|denim|jeans", "jeans"),
    ("top", "світшот|худі|hoodie|sweatshirt|фліс|тринитк|футер", "sweatshirt"),
    ("shoes", "черевик|чобот|boots|ботильйон|челсі", "boots"),
    ("shoes", "кросівк|кеди|sneaker|trainer", "sneakers"),
    ("shoes", "лофер|loafer|туфл|дербі|derby|оксфорд|oxford|монки|мокасин", "dress_shoes"),
]
MIN_GROUP = 3
SAME_COLOR_FIRST = 8  # the alternatives row opens with this many in the item's colour, then other colours


def type_group(a: str) -> str:
    """SQL: the item-type group of product alias `a` (title rules first, then its item_type)."""
    rules = " ".join(f"when {a}.category = '{cat}' and {a}.title ~* '{rx}' then '{g}'" for cat, rx, g in TITLE_GROUPS)
    types = " ".join(f"when lower({a}.item_type) = '{t}' then '{g}'" for t, g in GROUP_OF.items())
    return f"(case {rules} {types} else {a}.item_type end)"


def gender_ok(target: str) -> str:
    """SQL condition on p.gender for an outfit for `target`: men's outfits get men's items only,
    women's outfits women's + unisex; anything else (couple person of unknown gender) everything."""
    return f"""(case {target} when 'men' then p.gender = 'men'
                               when 'women' then p.gender is distinct from 'men'
                               else true end)"""


@app.get("/outfits/{outfit_id}/similar/{slot}")
def similar(outfit_id: UUID, slot: Slot, person: int = 1, color: str | None = None, limit: int = 5):
    """AI alternatives: same category and the same kind of item (trousers vs sweatpants, loafers vs boots...; the
    whole category only if that kind has < MIN_GROUP candidates), in stock, other brands (one per brand first), for
    the outfit's gender (a couple look: the original item's gender).
    Items published from the builder keep its search (AI description of the look photo as a FashionCLIP text
    vector + colour): they are ranked exactly like /admin/match, so visitors see the row the admin picked from.
    Older items: by the chosen product's photo (similarity >= MIN_SIMILARITY). The item's colour comes first, then
    the closest items in other colours (a colour chip shows only that colour). Bonuses: exact item type, popular
    brands."""
    return fetch_all(
        f"""with hero as (
              select p.id, p.brand_id, p.category, p.price_uah, p.item_type, {type_group("p")} as grp,
                     coalesce(oi.query_vector, p.embedding) as v, oi.query_vector is not null as by_text,
                     coalesce(oi.query_color, p.color) as want_color,
                     case when o.gender in ('men', 'women') then o.gender else p.gender end as target
              from outfit_items oi join outfits o on o.id = oi.outfit_id join products p on p.id = oi.product_id
              where oi.outfit_id = %(outfit)s and oi.person = %(person)s and oi.slot = %(slot)s
            ), pop as ({BRAND_POPULARITY}), pool as (
              select {PRODUCT_COLS}, hero.by_text,
                     p.price_uah - hero.price_uah as price_diff,
                     1 - (p.embedding <=> hero.v) as similarity,
                     coalesce(pop.score, 0) as brand_score,
                     (p.color is not distinct from hero.want_color) as same_color,
                     (p.item_type is not distinct from hero.item_type) as same_type,
                     ({type_group("p")} is not distinct from hero.grp) as same_group
              from products p join brands b on b.id = p.brand_id left join pop on pop.brand_id = p.brand_id, hero
              where p.category = hero.category and p.in_stock and p.brand_id <> hero.brand_id
                and p.embedding is not null and {gender_ok("hero.target")}
                -- text-to-image scores are ~0.3, image-to-image ~0.7-0.9: the floor only applies to photo search
                and (hero.by_text or 1 - (p.embedding <=> hero.v) >= {MIN_SIMILARITY})
            ), ranked as (
              select * from (select *, count(*) filter (where same_group) over () as n_group from pool) g
              where (same_group or n_group < {MIN_GROUP}) and (%(color)s::text is null or color = %(color)s)
            ), scored as (
              -- same weights as /admin/match for builder items
              select *, similarity + 0.02 * same_color::int
                        + (case when by_text then 0.03 else {SAME_TYPE_BONUS} end) * same_type::int
                        + {POPULARITY_WEIGHT} * brand_score as score
              from ranked
            )
            select id, title, brand, category, color, price_uah, image_url, product_url, is_demo,
                   price_diff, round(similarity::numeric, 3)::float as similarity
            from (select *, row_number() over (partition by same_color order by brand_rank, score desc) as color_rank
                  from (select *, row_number() over (partition by brand, same_color order by score desc) as brand_rank
                        from scored) b) s
            -- up to SAME_COLOR_FIRST items in the item's colour (one per brand first), then the rest in any colour
            order by (same_color and color_rank <= {SAME_COLOR_FIRST}) desc, brand_rank, score desc
            limit %(limit)s""",
        {"outfit": outfit_id, "slot": slot, "person": person, "color": color, "limit": min(limit, 30)},
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
    color: str | None = None          # the piece's colour: small bonus
    only_color: str | None = None     # colour chip in the builder: only this colour
    item_type: str | None = None      # "Кеди", "Пальто"...: same-type bonus
    limit: int = Field(default=8, ge=1, le=20)


@app.post("/admin/match")
def admin_match(body: MatchIn, _: dict = Depends(admin_user)):
    """Closest real products to one piece: same slot, for the outfit's gender, in stock; one per brand first,
    then CLIP similarity with small bonuses for the same colour, the same item type and popular brands."""
    return fetch_all(
        f"""with pop as ({BRAND_POPULARITY}), ranked as (
              select {PRODUCT_COLS}, p.item_type, p.old_price_uah,
                     1 - (p.embedding <=> %(vec)s::vector) as similarity,
                     coalesce(pop.score, 0) as brand_score,
                     (p.color is not distinct from %(color)s) as same_color,
                     (p.item_type is not distinct from %(item_type)s) as same_type,
                     ({type_group("p")} is not distinct from %(group)s) as same_group
              from products p join brands b on b.id = p.brand_id left join pop on pop.brand_id = p.brand_id
              where p.category = %(slot)s and p.in_stock and not p.is_demo and p.embedding is not null
                and {gender_ok("%(gender)s")}
                and (%(only_color)s::text is null or p.color = %(only_color)s)
              order by p.embedding <=> %(vec)s::vector
              limit 200
            ), scored as (
              -- the AI's kind of item only (whole slot if it has < MIN_GROUP matches or the kind is unknown)
              select *, similarity + 0.02 * same_color::int + 0.03 * same_type::int
                        + {POPULARITY_WEIGHT} * brand_score as score
              from (select *, count(*) filter (where same_group) over () as n_group from ranked) g
              where %(group)s::text is null or same_group or n_group < {MIN_GROUP}
            )
            select id, title, brand, category, color, price_uah, old_price_uah, image_url, product_url, item_type,
                   round(similarity::numeric, 3)::float as similarity
            from (select *, row_number() over (partition by brand order by score desc) as brand_rank from scored) s
            order by brand_rank, score desc
            limit %(limit)s""",
        {"vec": str(body.vector), "slot": body.slot, "gender": body.gender, "color": body.color,
         "only_color": body.only_color, "item_type": body.item_type,
         "group": GROUP_OF.get((body.item_type or "").strip().lower()), "limit": body.limit},
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
    # per look, the builder's search for each slot (kept so the outfit page shows the same alternatives)
    queries: list[dict[Slot, "QueryIn"]] | None = None


class QueryIn(BaseModel):
    vector: list[float] = Field(min_length=512, max_length=512)
    color: str | None = Field(default=None, max_length=20)
    text: str | None = Field(default=None, max_length=200)


OutfitIn.model_rebuild()


def check_outfit(body: OutfitIn, outfit_id: UUID | None = None) -> None:
    # a dress / set / suit already includes the bottom (a blazer or coat over it is fine)
    if any(not look or {"dress", "bottom"} <= look.keys() for look in body.looks):
        raise HTTPException(400, "Each look needs items, and a dress/suit can't be combined with a bottom")
    if (body.gender == "couple") != (len(body.looks) == 2):
        raise HTTPException(400, "A couple outfit has exactly two looks")
    if fetch_one("select 1 from outfits where title = %s and id is distinct from %s", (body.title.strip(), outfit_id)):
        raise HTTPException(409, "An outfit with this title already exists")


def insert_items(conn, outfit_id: UUID, body: OutfitIn) -> None:
    for person, look in enumerate(body.looks, 1):
        queries = (body.queries or [])[person - 1] if len(body.queries or []) >= person else {}
        for slot, product_id in look.items():
            q = queries.get(slot)
            conn.execute(
                """insert into outfit_items (outfit_id, person, slot, product_id, query_text, query_color, query_vector)
                   values (%s, %s, %s, %s, %s, %s, %s::vector)""",
                (outfit_id, person, slot, product_id, q and q.text, q and q.color, q and str(q.vector)),
            )


@app.post("/admin/outfits")
def admin_create_outfit(body: OutfitIn, _: dict = Depends(admin_user)):
    check_outfit(body)
    with transaction() as conn:
        outfit = conn.execute(
            """insert into outfits (title, season, gender, style_tag, cover_image_url, sort_order, is_published)
               values (%s, 'autumn', %s, %s, %s, (select coalesce(min(sort_order), 0) - 1 from outfits), true)
               returning id""",
            (body.title.strip(), body.gender, (body.style_tag or "").strip().lstrip("#") or None, body.cover_image_url),
        ).fetchone()
        insert_items(conn, outfit["id"], body)
    return outfit


@app.get("/admin/outfits/{outfit_id}")
def admin_get_outfit(outfit_id: UUID, _: dict = Depends(admin_user)):
    """A published outfit for editing in the builder: each item with its stored builder search (query_*), or its
    image embedding as the search vector for items published without one."""
    outfit = fetch_one("select id, title, gender, style_tag, cover_image_url from outfits where id = %s", (outfit_id,))
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    outfit["items"] = fetch_all(
        f"""select oi.person, oi.slot, {PRODUCT_COLS}, p.item_type, p.embedding::text as vector,
                   oi.query_vector::text as query_vector, oi.query_text, oi.query_color
            from outfit_items oi join products p on p.id = oi.product_id join brands b on b.id = p.brand_id
            where oi.outfit_id = %s
            order by oi.person, array_position(array['hat','outer','jacket','top','dress','bottom','shoes'], oi.slot)""",
        (outfit_id,),
    )
    return outfit


@app.put("/admin/outfits/{outfit_id}")
def admin_update_outfit_items(outfit_id: UUID, body: OutfitIn, _: dict = Depends(admin_user)):
    """Replace a published outfit's title, tag, gender, cover and items (its place in the feed stays)."""
    check_outfit(body, outfit_id)
    with transaction() as conn:
        updated = conn.execute(
            "update outfits set title = %s, gender = %s, style_tag = %s, cover_image_url = %s where id = %s",
            (body.title.strip(), body.gender, (body.style_tag or "").strip().lstrip("#") or None,
             body.cover_image_url, outfit_id),
        ).rowcount
        if not updated:
            raise HTTPException(404, "Outfit not found")
        conn.execute("delete from outfit_items where outfit_id = %s", (outfit_id,))
        insert_items(conn, outfit_id, body)
    return {"id": outfit_id}


@app.get("/admin/outfits")
def admin_list_outfits(_: dict = Depends(admin_user)):
    return fetch_all(
        """select o.id, o.title, o.gender, o.is_published, o.cover_image_url, o.created_at,
                  bool_or(p.is_demo) as is_demo, count(oi.product_id)::int as item_count
           from outfits o left join outfit_items oi on oi.outfit_id = o.id left join products p on p.id = oi.product_id
           group by o.id order by o.sort_order, o.created_at"""
    )


class OutfitPatch(BaseModel):
    is_published: bool | None = None
    cover_image_url: str | None = Field(default=None, pattern=r"^/img/looks/[0-9a-f-]{36}\.jpg$")


@app.patch("/admin/outfits/{outfit_id}")
def admin_update_outfit(outfit_id: UUID, body: OutfitPatch, _: dict = Depends(admin_user)):
    """Publish/hide an outfit, or set its cover (an uploaded look photo; null = back to the item collage)."""
    for field in body.model_fields_set & {"is_published", "cover_image_url"}:
        execute(f"update outfits set {field} = %s where id = %s", (getattr(body, field), outfit_id))
    return {"ok": True}


class HideIn(BaseModel):
    hidden: bool


@app.patch("/admin/products/{product_id}")
def admin_hide_product(product_id: UUID, body: HideIn, _: dict = Depends(admin_user)):
    """Hide a wrong product (wrong gender, broken photo) from matching and alternatives; re-imports keep it hidden."""
    execute("update products set is_hidden = %s, in_stock = not %s where id = %s and not is_demo",
            (body.hidden, body.hidden, product_id))
    return {"ok": True}
