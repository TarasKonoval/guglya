import { useEffect, useMemo, useState } from "react";
import { api, COLORS, formatDiff, formatUah, img, slotLabel, type Person, type Product, type Slot } from "../lib/api";
import { addToCart, removeFromCart, useCart } from "../lib/cart";
import { BagIcon, CheckIcon } from "./Icons";

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
  const [pool, setPool] = useState<Product[] | null>(null); // unfiltered, for the colour chips
  const [color, setColor] = useState<string | null>(null);
  const [filtered, setFiltered] = useState<Product[] | null>(null);
  const cart = useCart();
  const cartProps = (p: Product) => {
    const inCart = cart.some((i) => i.id === p.id);
    return { inCart, onCart: () => (inCart ? removeFromCart(p.id) : addToCart(p, outfitId, slot)) };
  };

  useEffect(() => {
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?person=${person}&limit=20`).then(setPool).catch(() => setPool([]));
  }, [outfitId, person, slot]);

  useEffect(() => {
    if (!color) return setFiltered(null);
    setFiltered(null);
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?person=${person}&color=${color}&limit=5`).then(setFiltered).catch(() => setFiltered([]));
  }, [outfitId, person, slot, color]);

  const colors = useMemo(() => [...new Set((pool ?? []).map((p) => p.color).filter(Boolean))] as string[], [pool]);
  const alternatives = color ? filtered : pool?.slice(0, 5) ?? null;

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
                onPick={() => onPick(p)} />
            ))}
        {alternatives?.length === 0 && <p className="muted empty">Немає альтернатив у цьому кольорі</p>}
      </div>
    </section>
  );
}

type CardProps = {
  p: Product; original?: boolean; selected: boolean; inCart: boolean;
  onPick: () => void; onCart: () => void;
};

function ItemCard({ p, original, selected, inCart, onPick, onCart }: CardProps) {
  return (
    <article className={`item-card ${selected ? "selected" : ""}`}>
      <button className="item-pick" onClick={onPick} aria-pressed={selected}
        aria-label={`${p.title}, ${p.brand}, ${formatUah(p.price_uah)}${selected ? " — обрано" : " — обрати"}`}>
        <div className="item-img">
          <img referrerPolicy="no-referrer" src={img(p.image_url)} alt="" loading="lazy" />
          <span className={`badge ${original ? "" : "ai"}`}>{original ? "в образі" : "AI-підбір"}</span>
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
      <button className={`to-cart ${inCart ? "on" : ""}`} onClick={onCart} aria-pressed={inCart}>
        {inCart ? <><CheckIcon /> У кошику</> : <><BagIcon /> В кошик</>}
      </button>
    </article>
  );
}
