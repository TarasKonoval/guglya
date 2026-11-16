import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OutfitSummary } from "../lib/api";
import { useSaved } from "../lib/saved";
import OutfitCard from "../components/OutfitCard";

export default function SavedPage() {
  const [outfits, setOutfits] = useState<OutfitSummary[] | null>(null);
  const { saved, toggle } = useSaved();

  useEffect(() => {
    api<OutfitSummary[]>("/saved").then(setOutfits).catch(() => setOutfits([]));
  }, []);

  return (
    <main className="page">
      <section className="feed-head"><h1>Збережені</h1></section>
      {outfits === null ? (
        <div className="feed"><div className="outfit-card skeleton" /></div>
      ) : outfits.length === 0 ? (
        <p className="muted pad">Тут зʼявляться образи, які ти збережеш ♡ <Link to="/" className="link-strong">До образів</Link></p>
      ) : (
        <div className="feed">
          {outfits.map((o) => <OutfitCard key={o.id} outfit={o} saved={saved.has(o.id)} onToggleSave={() => toggle(o.id)} />)}
        </div>
      )}
    </main>
  );
}
