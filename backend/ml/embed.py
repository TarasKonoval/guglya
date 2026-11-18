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
from concurrent.futures import ThreadPoolExecutor

import psycopg
import requests
import torch
from PIL import Image
from transformers import CLIPModel, CLIPProcessor

MODEL = "patrickjohncyh/fashion-clip"  # 512-dim CLIP fine-tuned on fashion product images
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"
BATCH = 32
# Some brands' image servers refuse the python-requests default (Staff: 403); site visitors' browsers get the photos
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
                         "Chrome/130 Safari/537.36"}


def load_image(url: str) -> Image.Image:
    if url.startswith("/"):
        url = os.environ["IMAGE_BASE_URL"].rstrip("/") + url
    resp = requests.get(url, timeout=30, headers=HEADERS)
    resp.raise_for_status()
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    img.thumbnail((448, 448))  # brand photos can be several MB; CLIP needs 224 px
    return img


def try_load(url: str) -> Image.Image | None:
    try:
        return load_image(url)
    except Exception as e:
        print("skip", url, e)
        return None


def main() -> None:
    model = CLIPModel.from_pretrained(MODEL).eval().to(DEVICE)
    proc = CLIPProcessor.from_pretrained(MODEL)
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        rows = conn.execute("select id, image_url from products where embedding is null").fetchall()
        print(f"{len(rows)} products to embed on {DEVICE}")
        done = 0
        # photos download in parallel (brand sites are the bottleneck), embeddings run in batches
        with ThreadPoolExecutor(16) as pool:
            for i in range(0, len(rows), BATCH):
                batch = rows[i : i + BATCH]
                loaded = [(pid, img) for (pid, _), img in zip(batch, pool.map(try_load, [u for _, u in batch])) if img]
                if not loaded:
                    continue
                with torch.no_grad():
                    inputs = proc(images=[img for _, img in loaded], return_tensors="pt").to(DEVICE)
                    out = model.get_image_features(**inputs)
                    vecs = out if isinstance(out, torch.Tensor) else out.pooler_output  # transformers 4 vs 5
                vecs = (vecs / vecs.norm(dim=-1, keepdim=True)).cpu().tolist()
                with conn.cursor() as cur:
                    cur.executemany("update products set embedding = %s::vector where id = %s",
                                    [(str(v), pid) for (pid, _), v in zip(loaded, vecs)])
                conn.commit()
                done += len(loaded)
                print(f"{done}/{len(rows)}", flush=True)
    print(f"Embedded {done}/{len(rows)}.")


if __name__ == "__main__":
    main()
