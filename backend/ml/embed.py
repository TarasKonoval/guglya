"""Compute FashionCLIP image embeddings for products that don't have one yet.

Runs offline on a laptop (Apple Silicon GPU via MPS if available, else CPU), then writes
normalised 512-d vectors to Postgres (products.embedding, pgvector).
Usage (from repo root):
  pip install -r backend/requirements-ml.txt
  DATABASE_URL=... IMAGE_BASE_URL=https://xxxx.cloudfront.net python backend/ml/embed.py
IMAGE_BASE_URL is prepended to site-relative image URLs such as /img/top-01.png.
"""
import io
import os

import psycopg
import requests
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL = "patrickjohncyh/fashion-clip"  # 512-dim CLIP fine-tuned on fashion product images
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"


def load_image(url: str) -> Image.Image:
    if url.startswith("/"):
        url = os.environ["IMAGE_BASE_URL"].rstrip("/") + url
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return Image.open(io.BytesIO(resp.content)).convert("RGB")


def main() -> None:
    model = CLIPModel.from_pretrained(MODEL).eval().to(DEVICE)
    proc = CLIPProcessor.from_pretrained(MODEL)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute("select id, image_url from products where embedding is null").fetchall()
        print(f"{len(rows)} products to embed on {DEVICE}")
        done = 0
        for pid, url in rows:
            try:
                img = load_image(url)
            except Exception as e:
                print("skip", url, e)
                continue
            with torch.no_grad():
                inputs = proc(images=img, return_tensors="pt").to(DEVICE)
                out = model.get_image_features(**inputs)
                vec = (out if isinstance(out, torch.Tensor) else out.pooler_output)[0]  # transformers 4 vs 5
            vec = (vec / vec.norm()).cpu().tolist()
            conn.execute("update products set embedding = %s::vector where id = %s", (str(vec), pid))
            conn.commit()
            done += 1
    print(f"Embedded {done}/{len(rows)}.")


if __name__ == "__main__":
    main()
