import { useEffect, useMemo, useState } from "react";
import { api, formatDiff, formatUah, img, SLOT_LABELS, type Product, type Slot } from "../lib/api";
import { CheckIcon } from "./Icons";

const COLORS: Record<string, [string, string]> = {
  black: ["Чорний", "#262423"], white: ["Білий", "#ece8e0"], grey: ["Сірий", "#8c8c8a"],
  beige: ["Беж", "#d6c0a0"], brown: ["Коричневий", "#7a5236"], blue: ["Синій", "#344a78"],
  green: ["Зелений", "#4e6648"], red: ["Червоний", "#a0342e"], burgundy: ["Бордо", "#681e2c"],
};

type Props = {
  outfitId: string;
  slot: Slot;
  original: Product;
  picked?: Product;
  onPick: (p: Product) => void;
  onBrand: (p: Product) => void;
};

export default function ItemRow({ outfitId, slot, original, picked, onPick, onBrand }: Props) {
  const [pool, setPool] = useState<Product[] | null>(null); // unfiltered, for the colour chips
  const [color, setColor] = useState<string | null>(null);
  const [filtered, setFiltered] = useState<Product[] | null>(null);

  useEffect(() => {
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?limit=20`).then(setPool).catch(() => setPool([]));
  }, [outfitId, slot]);

  useEffect(() => {
    if (!color) return setFiltered(null);
    setFiltered(null);
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?color=${color}&limit=5`).then(setFiltered).catch(() => setFiltered([]));
  }, [outfitId, slot, color]);

  const colors = useMemo(() => [...new Set((pool ?? []).map((p) => p.color).filter(Boolean))] as string[], [pool]);
  const alternatives = color ? filtered : pool?.slice(0, 5) ?? null;

  return (
    <section className="row" aria-label={SLOT_LABELS[slot]}>
      <div className="row-head">
        <h2>{SLOT_LABELS[slot]}</h2>
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
        <ItemCard p={original} original selected={picked?.id === original.id}
          onPick={() => onPick(original)} onBrand={() => onBrand(original)} />
        {alternatives === null
          ? [0, 1, 2].map((i) => <div key={i} className="item-card skeleton" />)
          : alternatives.map((p) => (
              <ItemCard key={p.id} p={p} selected={picked?.id === p.id}
                onPick={() => onPick(p)} onBrand={() => onBrand(p)} />
            ))}
        {alternatives?.length === 0 && <p className="muted empty">Немає альтернатив у цьому кольорі</p>}
      </div>
    </section>
  );
}

type CardProps = { p: Product; original?: boolean; selected: boolean; onPick: () => void; onBrand: () => void };

function ItemCard({ p, original, selected, onPick, onBrand }: CardProps) {
  return (
    <article className={`item-card ${selected ? "selected" : ""}`}>
      <button className="item-pick" onClick={onPick} aria-pressed={selected}
        aria-label={`${p.title}, ${p.brand}, ${formatUah(p.price_uah)}${selected ? " — обрано" : " — обрати"}`}>
        <div className="item-img">
          <img src={img(p.image_url)} alt="" loading="lazy" />
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
      <button className="to-brand" onClick={onBrand}>До бренду →</button>
    </article>
  );
}
