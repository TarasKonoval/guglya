"""Colour for products without one (the title and the scrape didn't say), from their photo with FashionCLIP zero-shot.

Usage (from repo root, after backend/ml/embed.py):
  DATABASE_URL=... python backend/ml/classify_color.py [--dry-run] [--test] [--only id1,id2]

Compares each image embedding with "a <colour> <item>" for the site's colour keys and takes the best one when it
is clearly ahead of the runner-up (MARGIN). --test measures accuracy on products whose colour is known instead.
Only products with no colour are changed; colours from titles are never overwritten.
"""
import argparse
import os

import numpy as np
import psycopg
import torch
from transformers import CLIPModel, CLIPTokenizerFast

MODEL = "patrickjohncyh/fashion-clip"
COLORS = {
    "black": "black", "white": "white", "grey": "grey", "beige": "beige", "brown": "brown", "blue": "blue",
    "green": "green", "red": "red", "burgundy": "burgundy", "pink": "pink", "purple": "purple",
    "yellow": "yellow", "orange": "orange",
}
NOUN = {"hat": "hat", "outer": "coat", "jacket": "blazer", "top": "top", "dress": "dress", "bottom": "trousers",
        "shoes": "shoes", "bag": "bag"}
MARGIN = 2.5  # cosine x 100: best colour must beat the second one by this much


def text_vectors(model, tokenizer, noun: str) -> np.ndarray:
    prompts = [f"a photo of a {c} {noun}" for c in COLORS.values()]
    with torch.no_grad():
        out = model.get_text_features(**tokenizer(prompts, return_tensors="pt", padding=True))
        out = out if isinstance(out, torch.Tensor) else out.pooler_output  # transformers 4 vs 5
    return (out / out.norm(dim=-1, keepdim=True)).numpy()


def guess(emb: np.ndarray, texts: np.ndarray) -> list[tuple[str | None, float]]:
    s = emb @ texts.T * 100
    top = np.argsort(-s, axis=1)
    keys = list(COLORS)
    return [(keys[t[0]] if s[i, t[0]] - s[i, t[1]] >= MARGIN else None, s[i, t[0]] - s[i, t[1]]) for i, t in enumerate(top)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--test", action="store_true", help="accuracy on products whose colour is known")
    ap.add_argument("--only", help="comma-separated brand ids")
    args = ap.parse_args()
    only = args.only.split(",") if args.only else None

    model, tokenizer = CLIPModel.from_pretrained(MODEL).eval(), CLIPTokenizerFast.from_pretrained(MODEL)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        total = changed = 0
        for cat, noun in NOUN.items():
            rows = conn.execute(
                f"""select p.id, p.embedding::text, p.color from products p join brands b on b.id = p.brand_id
                    where p.category = %s and p.in_stock and not p.is_demo and p.embedding is not null
                      and p.color is {'not ' if args.test else ''}null and (%s::text[] is null or b.slug = any(%s))""",
                (cat, only, only),
            ).fetchall()
            if not rows:
                continue
            emb = np.array([np.fromstring(e[1:-1], sep=",") for _, e, _ in rows])
            guesses = guess(emb, text_vectors(model, tokenizer, noun))
            if args.test:
                decided = [(g, r[2]) for (g, _), r in zip(guesses, rows) if g]
                ok = sum(g == known for g, known in decided)
                print(f"{cat:7} {len(rows):5} known, {len(decided):5} decided, accuracy {ok / max(len(decided), 1):.0%}")
                continue
            updates = [(g, pid) for (g, _), (pid, _, _) in zip(guesses, rows) if g]
            total += len(rows)
            changed += len(updates)
            print(f"{cat:7} {len(rows):5} without colour -> {len(updates)} coloured")
            if not args.dry_run:
                with conn.cursor() as cur:
                    cur.executemany("update products set color = %s where id = %s and color is null", updates)
        if not args.test:
            print(f"{changed} of {total} products got a colour{' (dry run)' if args.dry_run else ''}.")


if __name__ == "__main__":
    main()
