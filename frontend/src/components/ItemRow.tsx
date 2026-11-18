import { useEffect, useMemo, useState } from "react";
import { api, COLORS, formatDiff, formatUah, img, openProduct, slotLabel, type Person, type Product, type Slot } from "../lib/api";
import { addToCart, removeFromCart, useCart } from "../lib/cart";
import { isAdmin } from "../lib/admin";
import { BagIcon, CheckIcon, ExternalIcon } from "./Icons";

type Props = {
  outfitId: string;
  person: Person;
  gender?: string;
  slot: Slot;
  original: Product;
  picked?: Product;
  onPick: (p: Product) => void;
};

export default function ItemRow({ outfitId, person, gender, slot, original, picked, onPick }: Props) {
  const [pool, setPool] = useState<Product[] | null>(null); // the item's colour first, then the rest; chips come from it
  const [color, setColor] = useState<string | null>(null);
  const [filtered, setFiltered] = useState<Product[] | null>(null);
  const [gone, setGone] = useState<Set<string>>(new Set()); // hidden from the catalog by an admin just now
  const cart = useCart();
  const cartProps = (p: Product) => {
    const inCart = cart.some((i) => i.id === p.id);
    return {
      inCart, onCart: () => (inCart ? removeFromCart(p.id) : addToCart(p, outfitId, slot)),
      onBrand: () => openProduct(p, outfitId, slot, "card"), // the click is logged, then the brand's product page opens
    };
  };

  useEffect(() => {
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?person=${person}&limit=30`).then(setPool).catch(() => setPool([]));
  }, [outfitId, person, slot]);

  useEffect(() => {
    if (!color) return setFiltered(null);
    setFiltered(null);
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?person=${person}&color=${color}&limit=5`).then(setFiltered).catch(() => setFiltered([]));
  }, [outfitId, person, slot, color]);

  const colors = useMemo(() => [...new Set((pool ?? []).map((p) => p.color).filter(Boolean))] as string[], [pool]);
  const alternatives = (color ? filtered : pool)?.filter((p) => !gone.has(p.id)).slice(0, color ? 5 : 8) ?? null;
  const hide = (p: Product) =>
    api(`/admin/products/${p.id}`, { method: "PATCH", body: JSON.stringify({ hidden: true }) })
      .then(() => setGone((g) => new Set(g).add(p.id))).catch(() => {});

  return (
    <section className="row" aria-label={slotLabel(slot, gender)}>
      <div className="row-head">
        <h2>{slotLabel(slot, gender)}</h2>
        {colors.length > 1 && (
          <div className="chips scroll" role="group" aria-label="Колір">
            {colors.map((c) => (
              <button key={c} className={`chip color ${color === c ? "on" : ""}`} aria-pressed={color === c}
                onClick={() => setColor(color === c ? null : c)}>
                <span className="swatch" style={{ background: COLORS[c]?.[1] ?? c }} />
                {COLORS[c]?.[0] ?? c}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="scroller">
        <ItemCard p={original} original selected={picked?.id === original.id} {...cartProps(original)}
          onPick={() => onPick(original)} />
        {alternatives === null
          ? [0, 1, 2].map((i) => <div key={i} className="item-card skeleton" />)
          : alternatives.map((p) => (
              <ItemCard key={p.id} p={p} selected={picked?.id === p.id} {...cartProps(p)}
                onPick={() => onPick(p)} onHide={isAdmin() ? () => hide(p) : undefined} />
            ))}
        {alternatives?.length === 0 && <p className="muted empty">Немає альтернатив у цьому кольорі</p>}
      </div>
    </section>
  );
}

type CardProps = {
  p: Product; original?: boolean; selected: boolean; inCart: boolean;
  onPick: () => void; onCart: () => void; onBrand: () => void; onHide?: () => void;
};

function ItemCard({ p, original, selected, inCart, onPick, onCart, onBrand, onHide }: CardProps) {
  const [broken, setBroken] = useState(false);
  if (broken && !original) return null; // brand's photo didn't load: don't offer it
  return (
    <article className={`item-card ${selected ? "selected" : ""}`}>
      <button className="item-pick" onClick={onPick} aria-pressed={selected}
        aria-label={`${p.title}, ${p.brand}, ${formatUah(p.price_uah)}${selected ? " — обрано" : " — обрати"}`}>
        <div className="item-img">
          <img referrerPolicy="no-referrer" src={img(p.image_url)} alt="" loading="lazy" onError={() => setBroken(true)} />
          {selected && <span className="selected-mark"><CheckIcon /></span>}
        </div>
        <div className="item-meta">
          <div className="brand">{p.brand}{p.is_demo && <span className="demo"> · демо</span>}</div>
          <div className="title">{p.title}</div>
          <div className="price">
            {formatUah(p.price_uah)}
            {!original && p.price_diff !== undefined && (
              <span className={`diff ${p.price_diff < 0 ? "cheaper" : ""}`}>{formatDiff(p.price_diff)}</span>
            )}
          </div>
        </div>
      </button>
      <div className="card-actions">
        <button className={`to-cart ${inCart ? "on" : ""}`} onClick={onCart} aria-pressed={inCart}
          aria-label={inCart ? "У кошику — прибрати" : "В кошик"} title={inCart ? "У кошику" : "В кошик"}>
          {inCart ? <CheckIcon /> : <BagIcon />}
        </button>
        <button className="to-brand" onClick={onBrand} aria-label={`Відкрити на сайті ${p.brand}`} title={`На сайт ${p.brand}`}>
          <ExternalIcon />
        </button>
      </div>
      {onHide && <button className="admin-hide" onClick={onHide} title="Лише для адмінів">Сховати з каталогу</button>}
    </article>
  );
}
