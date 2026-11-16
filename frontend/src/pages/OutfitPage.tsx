import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatUah, SLOTS, type Outfit, type Product, type Slot } from "../lib/api";
import { useSaved } from "../lib/saved";
import { BackIcon, HeartIcon } from "../components/Icons";
import ItemRow from "../components/ItemRow";

export default function OutfitPage() {
  const { id = "" } = useParams();
  const [outfit, setOutfit] = useState<Outfit | null | "missing">(null);
  const [picked, setPicked] = useState<Partial<Record<Slot, Product>>>({});
  const { saved, toggle } = useSaved();

  useEffect(() => {
    api<Outfit>(`/outfits/${id}`)
      .then((o) => { setOutfit(o); setPicked(o.items); })
      .catch(() => setOutfit("missing"));
  }, [id]);

  const total = useMemo(() => Object.values(picked).reduce((s, p) => s + (p?.price_uah ?? 0), 0), [picked]);

  if (outfit === null) return <main className="page"><div className="outfit-layout skeleton tall" /></main>;
  if (outfit === "missing") return <main className="page pad">Образ не знайдено. <Link to="/">До стрічки</Link></main>;

  const slots = SLOTS.filter((s) => outfit.items[s]);
  return (
    <main className="outfit-layout">
      <div className="outfit-visual">
        <img src={outfit.cover_image_url} alt={outfit.title} />
      </div>
      <div className="outfit-panel">
        <div className="outfit-panel-head">
          <Link to="/" className="iconbtn" aria-label="Назад"><BackIcon /></Link>
          <h1>{outfit.title}</h1>
          <button className={`heart inline ${saved.has(outfit.id) ? "on" : ""}`} onClick={() => toggle(outfit.id)}
            aria-label={saved.has(outfit.id) ? "Прибрати зі збережених" : "Зберегти"}>
            <HeartIcon filled={saved.has(outfit.id)} />
          </button>
        </div>
        {slots.map((slot) => (
          <ItemRow key={slot} outfitId={outfit.id} slot={slot} hero={outfit.items[slot]!}
            picked={picked[slot]} onPick={(p) => setPicked((x) => ({ ...x, [slot]: p }))} />
        ))}
        <div className="total-bar">
          <span>Разом за образ</span>
          <strong>{formatUah(total)}</strong>
        </div>
      </div>
    </main>
  );
}
