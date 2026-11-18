import { Link } from "react-router-dom";
import { formatUah, img, openProduct, SLOT_LABELS } from "../lib/api";
import { removeFromCart, useCart, type CartItem } from "../lib/cart";
import { bump } from "../lib/feedback";

export default function CartPage() {
  const items = useCart();
  const total = items.reduce((sum, p) => sum + p.price_uah, 0);
  const toBrand = (p: CartItem) => {
    bump("clicks");
    openProduct(p, p.outfit_id ?? undefined, p.slot ?? undefined);
  };

  return (
    <main className="page narrow">
      <section className="feed-head">
        <h1>Кошик</h1>
        <p className="muted">Торкнись речі — відкриємо її на сайті бренду, там і купиш.</p>
      </section>
      {items.length === 0 ? (
        <p className="muted pad">Кошик порожній. Додай речі з будь-якого образу. <Link to="/" className="link-strong">До образів</Link></p>
      ) : (
        <div className="pad-x">
          <ul className="buy-list cart-list">
            {items.map((p) => (
              <li key={p.id}>
                <button className="cart-item" onClick={() => toBrand(p)}>
                  <img src={img(p.image_url)} alt="" />
                  <div className="grow">
                    <div className="muted small">{p.slot ? `${SLOT_LABELS[p.slot]} · ` : ""}{p.brand}</div>
                    <div>{p.title}</div>
                    <strong>{formatUah(p.price_uah)}</strong>
                  </div>
                  <span className="cart-go" aria-hidden>→</span>
                </button>
                <button className="iconbtn" aria-label={`Прибрати «${p.title}» з кошика`} onClick={() => removeFromCart(p.id)}>×</button>
              </li>
            ))}
          </ul>
          <div className="buy-total"><span>Разом · {items.length} шт.</span><strong>{formatUah(total)}</strong></div>
        </div>
      )}
    </main>
  );
}
