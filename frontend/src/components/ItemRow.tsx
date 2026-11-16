import { useEffect, useMemo, useState } from "react";
import { api, formatUah, openProduct, type Product, type Slot } from "../lib/api";
import { CheckIcon, PlusIcon } from "./Icons";

const SLOT_LABELS: Record<Slot, string> = { hat: "Головний убір", top: "Верх", bottom: "Низ", shoes: "Взуття" };
const COLOR_LABELS: Record<string, [string, string]> = {
  black: ["Чорний", "#262423"], white: ["Білий", "#ece8e0"], grey: ["Сірий", "#8c8c8a"],
  beige: ["Бежевий", "#d6c0a0"], brown: ["Коричневий", "#7a5236"], blue: ["Синій", "#344a78"],
  green: ["Зелений", "#4e6648"], red: ["Червоний", "#8a2c2c"],
};

type Props = { outfitId: string; slot: Slot; hero: Product; picked?: Product; onPick: (p: Product) => void };

export default function ItemRow({ outfitId, slot, hero, picked, onPick }: Props) {
  const [similar, setSimilar] = useState<Product[] | null>(null);
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    // Fetch a wider pool once; colour chips then filter it client-side, showing the top 5.
    api<Product[]>(`/outfits/${outfitId}/similar/${slot}?limit=20`).then(setSimilar).catch(() => setSimilar([]));
  }, [outfitId, slot]);

  const colors = useMemo(
    () => [...new Set([hero, ...(similar ?? [])].map((p) => p.color).filter(Boolean))] as string[],
    [hero, similar],
  );
  const shown = (similar ?? []).filter((p) => !color || p.color === color).slice(0, 5);

  return (
    <section className="row">
      <div className="row-head">
        <h2>{SLOT_LABELS[slot]}</h2>
        <div className="chips">
          {colors.map((c) => (
            <button key={c} className={`chip ${color === c ? "on" : ""}`} onClick={() => setColor(color === c ? null : c)}
              title={COLOR_LABELS[c]?.[0] ?? c} aria-pressed={color === c}>
              <span className="swatch" style={{ background: COLOR_LABELS[c]?.[1] ?? c }} />
              <span className="chip-label">{COLOR_LABELS[c]?.[0] ?? c}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="scroller">
        <ItemCard p={hero} badge="З образу" selected={picked?.id === hero.id}
          onPick={() => onPick(hero)} onOpen={() => openProduct(hero, outfitId, slot)} />
        {similar === null
          ? [0, 1, 2].map((i) => <div key={i} className="item-card skeleton" />)
          : shown.map((p) => (
              <ItemCard key={p.id} p={p} selected={picked?.id === p.id}
                onPick={() => onPick(p)} onOpen={() => openProduct(p, outfitId, slot)} />
            ))}
        {similar !== null && shown.length === 0 && <p className="muted empty">Немає схожих у цьому кольорі</p>}
      </div>
    </section>
  );
}

type CardProps = { p: Product; badge?: string; selected: boolean; onPick: () => void; onOpen: () => void };

function ItemCard({ p, badge, selected, onPick, onOpen }: CardProps) {
  return (
    <article className={`item-card ${selected ? "selected" : ""}`}>
      <button className="item-img" onClick={onOpen} aria-label={`${p.title} — відкрити на сайті бренду`}>
        <img src={p.image_url} alt={p.title} loading="lazy" />
        {badge && <span className="badge">{badge}</span>}
      </button>
      <button className={`pick ${selected ? "on" : ""}`} onClick={onPick}
        aria-label={selected ? "Обрано в образ" : "Обрати в образ"}>
        {selected ? <CheckIcon /> : <PlusIcon />}
      </button>
      <div className="item-meta" onClick={onOpen}>
        <div className="brand">{p.brand}</div>
        <div className="title">{p.title}</div>
        <div className="price">{formatUah(p.price_uah)}</div>
      </div>
    </article>
  );
}
