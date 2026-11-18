import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatUah, img, type Product } from "../lib/api";

export default function DemoProductPage() {
  const { productId = "" } = useParams();
  const [p, setP] = useState<Product | null>(null);

  useEffect(() => {
    api<Product>(`/products/${productId}`).then(setP).catch(() => {});
  }, [productId]);

  return (
    <main className="page demo-product">
      {p && <img referrerPolicy="no-referrer" src={img(p.image_url)} alt={p.title} />}
      <div className="stack">
        {p && (
          <>
            <div className="brand">{p.brand}</div>
            <h1>{p.title}</h1>
            <div className="price big">{formatUah(p.price_uah)}</div>
          </>
        )}
        <p className="notice">Це демо-товар — тут відкриється сторінка товару на сайті бренду, де й відбувається покупка.</p>
        <Link to="/" className="btn ghost">До образів</Link>
      </div>
    </main>
  );
}
