import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OutfitSummary } from "../lib/api";
import { useSaved } from "../lib/saved";
import { HeartIcon } from "../components/Icons";

const SEASONS = [
  { id: "autumn", label: "Осінь" },
  { id: "winter", label: "Зима" },
  { id: "", label: "Усі" },
];

export default function FeedPage() {
  const [season, setSeason] = useState("autumn");
  const [outfits, setOutfits] = useState<OutfitSummary[] | null>(null);
  const { saved, toggle } = useSaved();

  useEffect(() => {
    setOutfits(null);
    api<OutfitSummary[]>(`/outfits${season ? `?season=${season}` : ""}`).then(setOutfits).catch(() => setOutfits([]));
  }, [season]);

  return (
    <main className="page">
      <section className="feed-head">
        <h1>Образи сезону</h1>
        <p className="muted">Обери образ — і ми підберемо схожі речі в наявності в інших українських брендів.</p>
        <div className="seg" role="tablist">
          {SEASONS.map((s) => (
            <button key={s.id} role="tab" aria-selected={season === s.id}
              className={season === s.id ? "on" : ""} onClick={() => setSeason(s.id)}>{s.label}</button>
          ))}
        </div>
      </section>

      {outfits === null ? (
        <div className="feed">{[0, 1, 2].map((i) => <div key={i} className="outfit-card skeleton" />)}</div>
      ) : outfits.length === 0 ? (
        <p className="muted pad">Для цього сезону образів ще немає.</p>
      ) : (
        <div className="feed">
          {outfits.map((o) => (
            <article key={o.id} className="outfit-card">
              <Link to={`/outfit/${o.id}`}>
                <img src={o.cover_image_url} alt={o.title} loading="lazy" />
                <div className="outfit-card-title">{o.title}</div>
              </Link>
              <button className={`heart ${saved.has(o.id) ? "on" : ""}`} onClick={() => toggle(o.id)}
                aria-label={saved.has(o.id) ? "Прибрати зі збережених" : "Зберегти"}>
                <HeartIcon filled={saved.has(o.id)} />
              </button>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
