"""Sort "unisex" products (the scrape didn't say) into women / men from their photo, with FashionCLIP zero-shot.

Usage (from repo root, after backend/ml/embed.py):
  DATABASE_URL=... python backend/ml/classify_gender.py [--dry-run]

Compares each stored image embedding with the text "menswear" vs "womenswear". On products whose gender we
know, the score gap is about +7 for men and -7 for women; only clear cases (|gap| >= MARGIN) are changed,
so real unisex items (caps, basic tees) stay unisex. Titles that say "унісекс" are never changed.
"""
import argparse
import os

import numpy as np
import psycopg
import torch
from transformers import CLIPModel, CLIPTokenizerFast

MODEL = "patrickjohncyh/fashion-clip"
PROMPTS = ["menswear, clothing for men", "womenswear, clothing for women"]
MARGIN = 4.0


def text_vectors() -> np.ndarray:
    model, tokenizer = CLIPModel.from_pretrained(MODEL).eval(), CLIPTokenizerFast.from_pretrained(MODEL)
    with torch.no_grad():
        out = model.get_text_features(**tokenizer(PROMPTS, return_tensors="pt", padding=True))
        out = out if isinstance(out, torch.Tensor) else out.pooler_output  # transformers 4 vs 5
    return (out / out.norm(dim=-1, keepdim=True)).numpy()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    texts = text_vectors()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute(
            """select id, embedding::text from products
               where gender = 'unisex' and not is_demo and embedding is not null and title not ilike '%%унісекс%%'"""
        ).fetchall()
        if not rows:
            print("Nothing to classify.")
            return
        emb = np.array([np.fromstring(e[1:-1], sep=",") for _, e in rows])
        gap = (emb @ texts.T * 100) @ np.array([1, -1])  # > 0: men, < 0: women
        updates = [("men" if g > 0 else "women", pid) for (pid, _), g in zip(rows, gap) if abs(g) >= MARGIN]
        men = sum(1 for g, _ in updates if g == "men")
        print(f"{len(rows)} unisex products: {men} -> men, {len(updates) - men} -> women, "
              f"{len(rows) - len(updates)} stay unisex.")
        if not args.dry_run:
            with conn.cursor() as cur:
                cur.executemany("update products set gender = %s where id = %s", updates)


if __name__ == "__main__":
    main()
