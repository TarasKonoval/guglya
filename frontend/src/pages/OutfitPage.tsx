import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatUah, img, openProduct, SLOT_LABELS, SLOTS, track, type Outfit, type Product, type Slot } from "../lib/api";
import { bump, setCurrentOutfit } from "../lib/feedback";
import { useSaved } from "../lib/saved";
import { BackIcon, HeartIcon } from "../components/Icons";
import OutfitCover from "../components/OutfitCover";
import ItemRow from "../components/ItemRow";
import Sheet from "../components/Sheet";

export default function OutfitPage() {
  const { id = "" } = useParams();
  const [outfit, setOutfit] = useState<Outfit | null | "missing">(null);
  const [picked, setPicked] = useState<Partial<Record<Slot, Product>>>({});
  const [buyOpen, setBuyOpen] = useState(false);
  const { saved, toggle } = useSaved();

  useEffect(() => {
    setOutfit(null);
    api<Outfit>(`/outfits/${id}`)
      .then((o) => {
        setOutfit(o);
        setPicked(o.products);
        track("outfit_view", { outfit_id: o.id });
        bump("views");
      })
      .catch(() => setOutfit("missing"));
    setCurrentOutfit(id);
    document.body.classList.add("has-bar");
    return () => {
      setCurrentOutfit(undefined);
      document.body.classList.remove("has-bar");
    };
  }, [id]);

  const slots = outfit && outfit !== "missing" ? SLOTS.filter((s) => outfit.products[s]) : [];
  const selected = slots.map((s) => [s, picked[s]!] as const);
  const total = selected.reduce((sum, [, p]) => sum + p.price_uah, 0);

  if (outfit === null) return <main className="outfit-layout"><div className="skeleton tall" /></main>;
  if (outfit === "missing") return <main className="page pad">Образ не знайдено. <Link to="/" className="link-strong">До образів</Link></main>;

  function swap(slot: Slot, p: Product) {
    if (picked[slot]?.id === p.id) return;
    setPicked((x) => ({ ...x, [slot]: p }));
    track("swap", { outfit_id: id, product_id: p.id });
  }
  const goToBrand = (p: Product, slot: Slot) => {
    bump("clicks");
    openProduct(p, id, slot);
  };

  return (
    <main className="outfit-layout">
      <div className="outfit-visual">
        <OutfitCover outfit={outfit} eager />
      </div>
      <div className="outfit-panel">
        <div className="outfit-panel-head">
          <Link to="/" className="iconbtn" aria-label="До образів"><BackIcon /></Link>
          <div className="grow">
            {outfit.style_tag && <span className="tag">#{outfit.style_tag}</span>}
            <h1>{outfit.title}</h1>
          </div>
          <button className={`heart inline ${saved.has(outfit.id) ? "on" : ""}`} onClick={() => toggle(outfit.id)}
            aria-label={saved.has(outfit.id) ? "Прибрати зі збережених" : "Зберегти образ"} aria-pressed={saved.has(outfit.id)}>
            <HeartIcon filled={saved.has(outfit.id)} />
          </button>
        </div>
        <p className="hint pad-x">Торкнись речі, щоб замінити її у своїй версії образу.</p>
        {slots.map((slot) => (
          <ItemRow key={slot} outfitId={outfit.id} slot={slot} original={outfit.products[slot]!}
            picked={picked[slot]} onPick={(p) => swap(slot, p)} onBrand={(p) => goToBrand(p, slot)} />
        ))}
      </div>

      <aside className="check-bar" aria-label="АутфітЧек">
        <div className="check-items">
          {selected.map(([slot, p]) => (
            <div key={slot} className="check-item">
              <img src={img(p.image_url)} alt="" />
              <span className="check-brand">{p.brand}</span>
              <span className="check-price">{formatUah(p.price_uah)}</span>
            </div>
          ))}
        </div>
        <div className="check-total">
          <div><span className="check-label">АутфітЧек</span><strong>{formatUah(total)}</strong></div>
          <button className="btn accent" onClick={() => setBuyOpen(true)}>Купити речі</button>
        </div>
      </aside>

      {buyOpen && (
        <Sheet onClose={() => setBuyOpen(false)} label="Купити речі">
          <h2>Твій образ</h2>
          <ul className="buy-list">
            {selected.map(([slot, p]) => (
              <li key={slot}>
                <img src={img(p.image_url)} alt="" />
                <div className="grow">
                  <div className="muted small">{SLOT_LABELS[slot]} · {p.brand}</div>
                  <div>{p.title}</div>
                  <strong>{formatUah(p.price_uah)}</strong>
                </div>
                <button className="btn small primary" onClick={() => goToBrand(p, slot)}>До бренду →</button>
              </li>
            ))}
          </ul>
          <div className="buy-total"><span>Разом</span><strong>{formatUah(total)}</strong></div>
        </Sheet>
      )}
    </main>
  );
}
