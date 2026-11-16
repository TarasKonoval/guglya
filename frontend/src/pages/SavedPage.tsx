import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OutfitSummary } from "../lib/api";

export default function SavedPage() {
  const [outfits, setOutfits] = useState<OutfitSummary[] | null>(null);

  useEffect(() => {
    api<OutfitSummary[]>("/saved").then(setOutfits).catch(() => setOutfits([]));
  }, []);

  return (
    <main className="page">
      <section className="feed-head">
        <h1>Збережені</h1>
      </section>
      {outfits === null ? null : outfits.length === 0 ? (
        <p className="muted pad">Тут зʼявляться образи, які ти збережеш ♡</p>
      ) : (
        <div className="grid">
          {outfits.map((o) => (
            <Link key={o.id} to={`/outfit/${o.id}`} className="outfit-card">
              <img src={o.cover_image_url} alt={o.title} loading="lazy" />
              <div className="outfit-card-title">{o.title}</div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
