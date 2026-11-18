"""Outfit agent: look photo -> the pieces in it, each with a FashionCLIP search vector.

Runs as its own Lambda behind a Function URL (outside the VPC: it needs Bedrock, not the database).
Only Cognito users in the "admins" group may call it. The admin page then sends each vector to
POST /admin/match on the main API, which searches the catalog (pgvector) and ranks by brand popularity.

Request:  POST {"image": "<base64 JPEG>", "gender": "women" | "men" | "couple"}
Response: {"title": "Беж і денім", "style_tag": "кежуал",
           "pieces": [{"person": 1, "slot": "outer", "item_type": "Пальто", "color": "beige",
                       "description": "long beige wool coat", "vector": [512 floats]}]}
"""
import base64
import json
import os

import boto3
import jwt
import torch
from transformers import CLIPModel, CLIPTokenizerFast

MODEL_ID = os.environ.get("MODEL_ID", "eu.anthropic.claude-sonnet-4-6")
CLIP = "patrickjohncyh/fashion-clip"
ISSUER = f"https://cognito-idp.{os.environ['COGNITO_REGION']}.amazonaws.com/{os.environ['COGNITO_USER_POOL_ID']}"
JWKS = jwt.PyJWKSet.from_json(os.environ["COGNITO_JWKS"])
SLOTS = ["hat", "outer", "jacket", "top", "dress", "bottom", "shoes", "bag"]
COLORS = ["black", "white", "grey", "beige", "brown", "blue", "green", "red", "burgundy",
          "pink", "purple", "yellow", "orange"]

bedrock = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", os.environ["COGNITO_REGION"]))
clip = CLIPModel.from_pretrained(CLIP).eval()
tokenizer = CLIPTokenizerFast.from_pretrained(CLIP)  # text side only: pieces are searched by description

SYSTEM = """You are a fashion stylist for Ґуґля, a site of ready-made outfits from Ukrainian brands.
You get a photo of a look. List the clothing pieces so we can find the closest real products in our catalog.
Rules:
- Slots, one piece each per person:
  hat: any headwear.
  outer: the outermost layer: coat, trench, jacket, puffer, bomber (not blazers).
  jacket: a blazer (піджак), worn alone or under a coat.
  top: the layer under it: sweater, turtleneck, shirt, t-shirt, hoodie, cardigan, blouse. List it whenever it
       is visible, also under a coat or a blazer.
  dress: dress, jumpsuit, matching set, or a suit (matching blazer + trousers, also a three-piece).
  bottom: trousers, jeans, skirt, shorts.
  shoes.
  bag: handbag, shoulder bag, crossbody, shopper/tote, clutch or backpack (item_type in Ukrainian: Сумка, Кросбоді,
       Шопер, Клатч, Рюкзак).
- A suit is listed THREE times so the admin can pick the whole suit or separates: the whole suit as dress, its
  blazer as jacket, its trousers as bottom, with part_of_suit = true on the blazer and the trousers. A dress or
  jumpsuit is listed once, as dress (a separate blazer over a dress is a normal jacket, part_of_suit = false).
- Layering example: long coat over a brown suit over a white turtleneck = outer (coat) + dress (suit) + jacket
  (brown blazer) + bottom (brown trousers) + top (turtleneck) + shoes.
- Skip jewellery, belts, scarves, glasses, socks (list the bag).
- Only pieces you can actually see. If shoes are cut off, leave them out.
- person: 1 for a single look. For a couple: 1 = the person on the left, 2 = on the right.
- description: short English product-style text for image search, e.g. "long beige wool trench coat with belt".
  Mention colour, material, cut and length; no brand names.
- item_type: the product type in Ukrainian as a shop would name it (Пальто, Светр, Джинси, Сукня, Черевики...).
- color: the closest of the allowed colour keys.
- title: a short catchy Ukrainian outfit name, 2-4 words, built from its key pieces or colours, like
  "Тренч і широкі джинси", "Бордо з голови до пʼят", "Тиха розкіш у беж".
- style_tag: one lowercase Ukrainian style word, like кежуал, класика, стрітстайл, спорт-шик, преппі, мінімалізм."""

TOOL = {
    "toolSpec": {
        "name": "report_pieces",
        "description": "Report the clothing pieces visible in the look photo.",
        "inputSchema": {"json": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "style_tag": {"type": "string"},
                "pieces": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "person": {"type": "integer", "enum": [1, 2]},
                    "slot": {"type": "string", "enum": SLOTS},
                    "item_type": {"type": "string"},
                    "color": {"type": "string", "enum": COLORS},
                    "description": {"type": "string"},
                    "part_of_suit": {"type": "boolean"},
                },
                "required": ["person", "slot", "item_type", "color", "description"],
            }}},
            "required": ["title", "style_tag", "pieces"],
        }},
    }
}


def is_admin(headers: dict) -> bool:
    auth = headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return False
    token = auth[7:]
    try:
        key = next(k for k in JWKS.keys if k.key_id == jwt.get_unverified_header(token).get("kid"))
        claims = jwt.decode(token, key.key, algorithms=["RS256"], audience=os.environ["COGNITO_CLIENT_ID"],
                            issuer=ISSUER, options={"require": ["exp", "iss", "aud", "sub"]})
    except Exception:
        return False
    return claims.get("token_use") == "id" and "admins" in claims.get("cognito:groups", [])


def detect(image: bytes, gender: str) -> dict:
    who = {"couple": "a couple (two people)", "men": "a man", "women": "a woman"}.get(gender, "a person")
    resp = bedrock.converse(
        modelId=MODEL_ID,
        system=[{"text": SYSTEM}],
        messages=[{"role": "user", "content": [
            {"image": {"format": "jpeg", "source": {"bytes": image}}},
            {"text": f"This look is for {who}. Report its pieces."},
        ]}],
        toolConfig={"tools": [TOOL], "toolChoice": {"tool": {"name": "report_pieces"}}},
        inferenceConfig={"maxTokens": 2000},
    )
    found = next(b["toolUse"] for b in resp["output"]["message"]["content"] if "toolUse" in b)["input"]
    # Model output is untrusted: keep only well-formed pieces, one per (person, slot)
    seen, pieces = set(), []
    for p in found.get("pieces", []):
        person = 2 if gender == "couple" and p.get("person") == 2 else 1
        if p.get("slot") not in SLOTS or (person, p["slot"]) in seen or not str(p.get("description", "")).strip():
            continue
        seen.add((person, p["slot"]))
        pieces.append({
            "person": person, "slot": p["slot"], "item_type": str(p.get("item_type", ""))[:40],
            "color": p.get("color") if p.get("color") in COLORS else None,
            "description": str(p["description"])[:200],
            "part_of_suit": p.get("part_of_suit") is True and p["slot"] in ("jacket", "bottom"),
        })
    for p in pieces:  # "part of a suit" only makes sense next to that suit
        p["part_of_suit"] = p["part_of_suit"] and (p["person"], "dress") in seen
    return {"title": str(found.get("title") or "").strip()[:80], "style_tag": str(found.get("style_tag") or "").strip()[:30],
            "pieces": pieces}


def embed(texts: list[str]) -> list[list[float]]:
    with torch.no_grad():
        inputs = tokenizer(texts, return_tensors="pt", padding=True, truncation=True)
        out = clip.get_text_features(**inputs)
        vecs = out if isinstance(out, torch.Tensor) else out.pooler_output  # transformers 4 vs 5
    return (vecs / vecs.norm(dim=-1, keepdim=True)).tolist()


def handler(event, _context):
    def reply(status: int, body: dict):
        return {"statusCode": status, "headers": {"content-type": "application/json"}, "body": json.dumps(body)}

    if not is_admin({k.lower(): v for k, v in (event.get("headers") or {}).items()}):
        return reply(403, {"detail": "Admins only"})
    try:
        body = json.loads(base64.b64decode(event["body"]) if event.get("isBase64Encoded") else event["body"])
        image = base64.b64decode(body["image"])
    except Exception:
        return reply(400, {"detail": "Expected JSON with a base64 JPEG in 'image'"})
    if len(image) > 4_000_000:
        return reply(413, {"detail": "Image too large (max 4 MB)"})

    result = detect(image, body.get("gender", "women"))
    pieces = result["pieces"]
    for piece, vec in zip(pieces, embed([p["description"] for p in pieces]) if pieces else []):
        piece["vector"] = vec
    return reply(200, result)
