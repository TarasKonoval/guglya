"""Sort "unisex" / unknown-gender products (the scrape didn't say) into women / men from their photo, with
FashionCLIP zero-shot. Brands that are unisex by design ("keep_unisex": true in brands.json) are left unisex.

Usage (from repo root, after backend/ml/embed.py):
  DATABASE_URL=... python backend/ml/classify_gender.py [--dry-run] [--only id1,id2]

Compares each stored image embedding with the text "menswear" vs "womenswear". On products whose gender we
know, the score gap is about +7 for men and -7 for women; only clear cases (|gap| >= MARGIN) are changed,
so real unisex items (caps, basic tees) stay unisex. Titles that say "унісекс" are never changed.
"""
import argparse
import json
import os
from pathlib import Path

import numpy as np
import psycopg
import torch
from transformers import CLIPModel, CLIPTokenizerFast

MODEL = "patrickjohncyh/fashion-clip"
PROMPTS = ["menswear, clothing for men", "womenswear, clothing for women"]
MARGIN = 4.0
BRANDS_JSON = Path(__file__).resolve().parents[2] / "data" / "database" / "brands.json"


def text_vectors() -> np.ndarray:
    model, tokenizer = CLIPModel.from_pretrained(MODEL).eval(), CLIPTokenizerFast.from_pretrained(MODEL)
    with torch.no_grad():
        out = model.get_text_features(**tokenizer(PROMPTS, return_tensors="pt", padding=True))
        out = out if isinstance(out, torch.Tensor) else out.pooler_output  # transformers 4 vs 5
    return (out / out.norm(dim=-1, keepdim=True)).numpy()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", help="comma-separated brand ids: classify just these brands")
    args = ap.parse_args()

    texts = text_vectors()
    only = args.only.split(",") if args.only else None
    unisex_brands = [b["id"] for b in json.loads(BRANDS_JSON.read_text(encoding="utf-8"))
                     if b.get("keep_unisex") and (only is None or b["id"] in only)]
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        # unisex-by-design brands: everything back to unisex (an earlier run may have split them by the model's gender)
        if not args.dry_run:
            reset = conn.execute(
                """update products p set gender = 'unisex' from brands b
                   where b.id = p.brand_id and b.slug = any(%s) and p.gender is distinct from 'unisex'""",
                (unisex_brands,),
            ).rowcount
            print(f"{reset} products of unisex brands ({', '.join(unisex_brands)}) set back to unisex.")
        rows = conn.execute(
            """select p.id, p.embedding::text from products p join brands b on b.id = p.brand_id
               where (p.gender = 'unisex' or p.gender is null) and not p.is_demo and p.embedding is not null
                 and p.title not ilike '%%унісекс%%' and not (b.slug = any(%s))
                 and (%s::text[] is null or b.slug = any(%s))""",
            (unisex_brands, only, only),
        ).fetchall()
        if not rows:
            print("Nothing to classify.")
            return
        emb = np.array([np.fromstring(e[1:-1], sep=",") for _, e in rows])
        gap = (emb @ texts.T * 100) @ np.array([1, -1])  # > 0: men, < 0: women
        updates = [("men" if g > 0 else "women", pid) for (pid, _), g in zip(rows, gap) if abs(g) >= MARGIN]
        men = sum(1 for g, _ in updates if g == "men")
        print(f"{len(rows)} unisex / unknown products: {men} -> men, {len(updates) - men} -> women, "
              f"{len(rows) - len(updates)} stay unisex.")
        if not args.dry_run:
            with conn.cursor() as cur:
                cur.executemany("update products set gender = %s where id = %s", updates)


if __name__ == "__main__":
    main()
