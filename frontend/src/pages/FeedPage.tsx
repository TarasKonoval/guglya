import { useEffect, useState } from "react";
import { api, type OutfitSummary } from "../lib/api";
import { useSaved } from "../lib/saved";
import OutfitCard from "../components/OutfitCard";

const BUDGETS = [
  { id: "all", label: "Усі", min: 0, max: Infinity },
  { id: "lt3", label: "до 3 000 ₴", min: 0, max: 3000 },
  { id: "3-6", label: "3 000–6 000 ₴", min: 3000, max: 6000 },
  { id: "gt6", label: "6 000 ₴+", min: 6000, max: Infinity },
];

export default function FeedPage() {
  const [outfits, setOutfits] = useState<OutfitSummary[] | null>(null);
  const [budget, setBudget] = useState("all");
  const { saved, toggle } = useSaved();

  useEffect(() => {
    api<OutfitSummary[]>("/outfits?season=autumn").then(setOutfits).catch(() => setOutfits([]));
  }, []);

  const b = BUDGETS.find((x) => x.id === budget)!;
  const shown = (outfits ?? []).filter((o) => o.total_uah >= b.min && o.total_uah < b.max);

  return (
    <main className="page">
      <section className="feed-head">
        <h1>Образи на осінь</h1>
        <p className="muted">Обери образ — і заміни будь-яку річ на схожу від іншого українського бренду.</p>
        <div className="chips scroll" role="group" aria-label="Бюджет образу">
          {BUDGETS.map((x) => (
            <button key={x.id} className={`chip ${budget === x.id ? "on" : ""}`} aria-pressed={budget === x.id}
              onClick={() => setBudget(x.id)}>{x.label}</button>
          ))}
        </div>
      </section>
      {outfits === null ? (
        <div className="feed">{[0, 1, 2, 3].map((i) => <div key={i} className="outfit-card skeleton" />)}</div>
      ) : shown.length === 0 ? (
        <p className="muted pad">У цьому бюджеті образів поки немає — спробуй інший.</p>
      ) : (
        <div className="feed">
          {shown.map((o) => <OutfitCard key={o.id} outfit={o} saved={saved.has(o.id)} onToggleSave={() => toggle(o.id)} />)}
        </div>
      )}
    </main>
  );
}
