"""Compute FashionCLIP image embeddings for products that don't have one yet.

Runs offline on a laptop (CPU is fine for a few hundred images), then writes vectors to Postgres.
Usage:  pip install -r backend/requirements-ml.txt && python backend/ml/embed.py
"""
import io
import os

import psycopg
import requests
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL = "patrickjohncyh/fashion-clip"  # 512-dim; falls back fine to openai/clip-vit-base-patch32


def main() -> None:
    model = CLIPModel.from_pretrained(MODEL).eval()
    proc = CLIPProcessor.from_pretrained(MODEL)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute("select id, image_url from products where embedding is null").fetchall()
        print(f"{len(rows)} products to embed")
        for pid, url in rows:
            try:
                img = Image.open(io.BytesIO(requests.get(url, timeout=20).content)).convert("RGB")
            except Exception as e:
                print("skip", url, e)
                continue
            with torch.no_grad():
                vec = model.get_image_features(**proc(images=img, return_tensors="pt"))[0]
            vec = (vec / vec.norm()).tolist()
            conn.execute("update products set embedding = %s::vector where id = %s", (str(vec), pid))
            conn.commit()
    print("Done.")


if __name__ == "__main__":
    main()
