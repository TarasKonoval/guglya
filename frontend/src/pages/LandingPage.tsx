import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, img, type OutfitSummary } from "../lib/api";
import OutfitCard from "../components/OutfitCard";

const BENEFITS = [
  ["Готові образи", "речі, що пасують одне до одного"],
  ["Тренди цієї осені", "без годин на Pinterest"],
  ["Під будь-який бюджет", "ціна кожної речі й усього образу"],
];
const SLIDE_MS = 4500;
const WALL_COLUMNS = 3;

export default function LandingPage() {
  const [outfits, setOutfits] = useState<OutfitSummary[] | null>(null);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    api<OutfitSummary[]>("/outfits?limit=12").then(setOutfits).catch(() => setOutfits([]));
  }, []);

  // Phone: look photos fill the screen behind the text and slowly change (like app welcome screens)
  const photos = (outfits ?? []).filter((o) => o.cover_image_url).slice(0, 6);
  useEffect(() => {
    if (photos.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % photos.length), SLIDE_MS);
    return () => clearInterval(t);
  }, [photos.length]);
  const example = outfits?.[0] ?? null;

  // Desktop: a slowly drifting wall of look photos and the brands' item photos (Pinterest-style)
  let tiles = [...photos.map((o) => o.cover_image_url!), ...(outfits ?? []).flatMap((o) => o.items.map((i) => i.image_url))];
  while (tiles.length && tiles.length < WALL_COLUMNS * 4) tiles = [...tiles, ...tiles];
  const columns = Array.from({ length: WALL_COLUMNS }, (_, c) => tiles.filter((_, i) => i % WALL_COLUMNS === c));

  return (
    <main className={`landing ${photos.length ? "has-photos" : ""}`}>
      {photos.length > 0 && (
        <div className="landing-bg" aria-hidden>
          {photos.map((o, i) => (
            <img key={o.id} src={img(o.cover_image_url!)} alt="" className={i === slide ? "on" : ""}
              referrerPolicy="no-referrer" loading={i === 0 ? "eager" : "lazy"} />
          ))}
        </div>
      )}
      <div className="landing-copy">
        <header className="landing-top"><span className="logo">Ґуґля</span>
          <Link to="/auth?mode=signin" className="link-strong">Увійти</Link>
        </header>
        <section className="landing-hero">
          <h1>Виглядай красиво за лічені хвилини</h1>
          <p className="lead">Трендові образи на сезон, зібрані виключно з речей українських брендів. Для кожної речі підберемо для вас схожі альтернативи в інших брендах.</p>
          <ul className="benefits">
            {BENEFITS.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}
          </ul>
          <div className="cta">
            <Link to="/auth?mode=signup" className="btn primary">Зареєструватися</Link>
            <Link to="/auth?mode=signin" className="btn ghost">Увійти</Link>
          </div>
        </section>
      </div>
      {tiles.length > 0 && (
        <div className="landing-wall" aria-hidden>
          {columns.map((col, c) => (
            // each column twice: moving it by exactly half loops seamlessly
            <div key={c} className="wall-col">
              {[...col, ...col].map((url, i) => (
                <img key={i} src={img(url)} alt="" referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ))}
            </div>
          ))}
        </div>
      )}
      <section className="landing-example">
        {example ? <OutfitCard outfit={example} to="/auth?mode=signup" /> : <div className="outfit-card skeleton" />}
      </section>
    </main>
  );
}
