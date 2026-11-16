"""Compute FashionCLIP image embeddings for products that don't have one yet.

Runs offline on a laptop (CPU is fine for a few hundred images), then writes vectors to Postgres.
Usage:  pip install -r backend/requirements-ml.txt && python backend/ml/embed.py
"""
import io
import os
from pathlib import Path

import psycopg
import requests
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL = "patrickjohncyh/fashion-clip"  # 512-dim; falls back fine to openai/clip-vit-base-patch32
# Site-relative image URLs (e.g. /demo/top-01.png) are files the frontend serves from public/.
PUBLIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public"


def load_image(url: str) -> Image.Image:
    if url.startswith("/"):
        return Image.open(PUBLIC_DIR / url.lstrip("/")).convert("RGB")
    return Image.open(io.BytesIO(requests.get(url, timeout=20).content)).convert("RGB")


def main() -> None:
    model = CLIPModel.from_pretrained(MODEL).eval()
    proc = CLIPProcessor.from_pretrained(MODEL)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute("select id, image_url from products where embedding is null").fetchall()
        print(f"{len(rows)} products to embed")
        for pid, url in rows:
            try:
                img = load_image(url)
            except Exception as e:
                print("skip", url, e)
                continue
            with torch.no_grad():
                out = model.get_image_features(**proc(images=img, return_tensors="pt"))
                vec = (out if isinstance(out, torch.Tensor) else out.pooler_output)[0]  # transformers 4 vs 5
            vec = (vec / vec.norm()).tolist()
            conn.execute("update products set embedding = %s::vector where id = %s", (str(vec), pid))
            conn.commit()
    print("Done.")


if __name__ == "__main__":
    main()
