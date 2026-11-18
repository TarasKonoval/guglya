import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatUah, img, SLOT_LABELS, SLOTS, track, type Outfit, type Person, type Product, type Slot } from "../lib/api";
import { bump, setCurrentOutfit } from "../lib/feedback";
import { useSaved } from "../lib/saved";
import { addToCart, useCart } from "../lib/cart";
import { BackIcon, HeartIcon } from "../components/Icons";
import OutfitCover from "../components/OutfitCover";
import ItemRow from "../components/ItemRow";
import Sheet from "../components/Sheet";

const LOOK_LABELS: Record<Person, string> = { 1: "Перший образ", 2: "Другий образ" };
const key = (person: Person, slot: Slot) => `${person}-${slot}`;

export default function OutfitPage() {
  const { id = "" } = useParams();
  const [outfit, setOutfit] = useState<Outfit | null | "missing">(null);
  const [picked, setPicked] = useState<Record<string, Product>>({}); // by key(person, slot)
  const [buyOpen, setBuyOpen] = useState(false);
  const { saved, toggle } = useSaved();
  const cart = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    setOutfit(null);
    api<Outfit>(`/outfits/${id}`)
      .then((o) => {
        setOutfit(o);
        setPicked(Object.fromEntries(o.looks.flatMap((l) =>
          SLOTS.filter((s) => l.products[s]).map((s) => [key(l.person, s), l.products[s]!]))));
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

  const looks = outfit && outfit !== "missing" ? outfit.looks : [];
  const rows = looks.flatMap((l) => SLOTS.filter((s) => l.products[s]).map((s) => ({ person: l.person, slot: s })));
  const selected = rows.filter((r) => picked[key(r.person, r.slot)]).map((r) => ({ ...r, p: picked[key(r.person, r.slot)] }));
  const allInCart = selected.length > 0 && selected.every(({ p }) => cart.some((i) => i.id === p.id));
  const total = selected.reduce((sum, { p }) => sum + p.price_uah, 0);

  if (outfit === null) return <main className="outfit-layout"><div className="skeleton tall" /></main>;
  if (outfit === "missing") return <main className="page pad">Образ не знайдено. <Link to="/" className="link-strong">До образів</Link></main>;

  function swap(person: Person, slot: Slot, p: Product) {
    if (picked[key(person, slot)]?.id === p.id) return;
    setPicked((x) => ({ ...x, [key(person, slot)]: p }));
    track("swap", { outfit_id: id, product_id: p.id });
  }

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
        {looks.map((l) => (
          <div key={l.person} className="look">
            {looks.length > 1 && <h2 className="look-title pad-x">{LOOK_LABELS[l.person]}</h2>}
            {SLOTS.filter((s) => l.products[s]).map((slot) => (
              <ItemRow key={key(l.person, slot)} outfitId={outfit.id} person={l.person} slot={slot}
                original={l.products[slot]!} picked={picked[key(l.person, slot)]} onPick={(p) => swap(l.person, slot, p)} />
            ))}
          </div>
        ))}
      </div>

      <aside className="check-bar" aria-label="АутфітЧек">
        <div className="check-items">
          {selected.map(({ person, slot, p }) => (
            <div key={key(person, slot)} className="check-item">
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
            {selected.map(({ person, slot, p }) => (
              <li key={key(person, slot)}>
                <img src={img(p.image_url)} alt="" />
                <div className="grow">
                  <div className="muted small">
                    {looks.length > 1 && `${LOOK_LABELS[person]} · `}{SLOT_LABELS[slot]} · {p.brand}
                  </div>
                  <div>{p.title}</div>
                  <strong>{formatUah(p.price_uah)}</strong>
                </div>
              </li>
            ))}
          </ul>
          <div className="buy-total"><span>Разом</span><strong>{formatUah(total)}</strong></div>
          <button className="btn primary full"
            onClick={() => {
              selected.forEach(({ slot, p }) => addToCart(p, id, slot));
              navigate("/cart");
            }}>
            {allInCart ? "Перейти в кошик →" : "Додати все в кошик"}
          </button>
        </Sheet>
      )}
    </main>
  );
}
