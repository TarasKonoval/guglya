from contextlib import asynccontextmanager
from urllib.parse import urlencode, urlparse, urlunparse, parse_qsl
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth import current_user, optional_user
from .config import settings
from .db import execute, fetch_all, fetch_one, pool

SLOTS = ("hat", "top", "bottom", "shoes")
PRODUCT_COLS = """p.id, p.title, b.name as brand, p.category, p.color, p.price_uah,
                  p.image_url, p.product_url"""


@asynccontextmanager
async def lifespan(_: FastAPI):
    pool.open()
    yield
    pool.close()


app = FastAPI(title="Guglya API", lifespan=lifespan)
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
    return {"id": user["sub"], "email": user.get("email")}


@app.get("/outfits")
def list_outfits(season: str | None = None):
    sql = "select id, title, season, cover_image_url from outfits where published"
    params: tuple = ()
    if season:
        sql += " and season = %s"
        params = (season,)
    return fetch_all(sql + " order by created_at desc", params)


@app.get("/outfits/{outfit_id}")
def get_outfit(outfit_id: str):
    try:
        UUID(outfit_id)
    except ValueError:
        raise HTTPException(404, "Outfit not found")
    outfit = fetch_one("select id, title, season, cover_image_url from outfits where id = %s", (outfit_id,))
    if not outfit:
        raise HTTPException(404, "Outfit not found")
    rows = fetch_all(
        f"""select oi.slot, {PRODUCT_COLS}
            from outfit_items oi join products p on p.id = oi.product_id join brands b on b.id = p.brand_id
            where oi.outfit_id = %s""",
        (outfit_id,),
    )
    outfit["items"] = {r.pop("slot"): r for r in rows}
    return outfit


@app.get("/outfits/{outfit_id}/similar/{slot}")
def similar(outfit_id: str, slot: str, color: str | None = None, limit: int = 5):
    """In-stock items from other brands, most similar (by CLIP embedding) to the outfit's item in this slot."""
    if slot not in SLOTS:
        raise HTTPException(400, f"slot must be one of {SLOTS}")
    return fetch_all(
        f"""with hero as (
              select p.id, p.brand_id, p.embedding, p.category from outfit_items oi join products p on p.id = oi.product_id
              where oi.outfit_id = %(outfit)s and oi.slot = %(slot)s
            )
            select {PRODUCT_COLS}, 1 - (p.embedding <=> hero.embedding) as similarity
            from products p join brands b on b.id = p.brand_id, hero
            where p.category = hero.category and p.in_stock and p.brand_id <> hero.brand_id
              and p.embedding is not null
              and (%(color)s::text is null or p.color = %(color)s)
            order by p.embedding <=> hero.embedding
            limit %(limit)s""",
        {"outfit": outfit_id, "slot": slot, "color": color, "limit": min(limit, 20)},
    )


class ClickIn(BaseModel):
    product_id: str
    outfit_id: str | None = None
    slot: str | None = None


@app.post("/clicks")
def click(body: ClickIn, user: dict | None = Depends(optional_user)):
    """Log a click and return the brand URL with UTM tags; the frontend then opens it."""
    product = fetch_one("select product_url from products where id = %s", (body.product_id,))
    if not product:
        raise HTTPException(404, "Product not found")
    execute(
        "insert into clicks (user_id, product_id, outfit_id, slot) values (%s, %s, %s, %s)",
        (user["sub"] if user else None, body.product_id, body.outfit_id, body.slot),
    )
    u = urlparse(product["product_url"])
    q = dict(parse_qsl(u.query)) | {"utm_source": "guglya", "utm_medium": "referral", "utm_campaign": "outfit"}
    return {"url": urlunparse(u._replace(query=urlencode(q)))}


@app.get("/saved")
def list_saved(user: dict = Depends(current_user)):
    return fetch_all(
        """select o.id, o.title, o.season, o.cover_image_url from saved_outfits s
           join outfits o on o.id = s.outfit_id where s.user_id = %s order by s.created_at desc""",
        (user["sub"],),
    )


@app.post("/saved/{outfit_id}")
def save(outfit_id: str, user: dict = Depends(current_user)):
    execute(
        "insert into saved_outfits (user_id, outfit_id) values (%s, %s) on conflict do nothing",
        (user["sub"], outfit_id),
    )
    return {"ok": True}


@app.delete("/saved/{outfit_id}")
def unsave(outfit_id: str, user: dict = Depends(current_user)):
    execute("delete from saved_outfits where user_id = %s and outfit_id = %s", (user["sub"], outfit_id))
    return {"ok": True}


class FeedbackIn(BaseModel):
    rating: int | None = None
    text: str


@app.post("/feedback")
def feedback(body: FeedbackIn, user: dict = Depends(current_user)):
    execute(
        "insert into feedback (user_id, rating, text) values (%s, %s, %s)",
        (user["sub"], body.rating, body.text),
    )
    return {"ok": True}
