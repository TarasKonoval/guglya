import { useEffect, useState } from "react";
import { api, type OutfitSummary } from "../lib/api";
import { useSaved } from "../lib/saved";
import { useMediaQuery } from "../lib/useMediaQuery";
import OutfitCard from "../components/OutfitCard";
import ReelsFeed from "../components/ReelsFeed";

const BUDGETS = [
  { id: "all", label: "Усі", min: 0, max: Infinity },
  { id: "lt3", label: "до 3 000 ₴", min: 0, max: 3000 },
  { id: "3-6", label: "3 000–6 000 ₴", min: 3000, max: 6000 },
  { id: "gt6", label: "6 000 ₴+", min: 6000, max: Infinity },
];
const BUDGET_KEY = "guglya-budget";

export default function FeedPage({ onFeedback }: { onFeedback: () => void }) {
  const [outfits, setOutfits] = useState<OutfitSummary[] | null>(null);
  const [budget, setBudget] = useState(() => sessionStorage.getItem(BUDGET_KEY) ?? "all");
  const { saved, toggle } = useSaved();
  const reels = useMediaQuery("(max-width: 719px)");

  useEffect(() => {
    api<OutfitSummary[]>("/outfits?season=autumn").then(setOutfits).catch(() => setOutfits([]));
  }, []);

  // Reels mode: the feed fills the screen, no page scroll / footer / floating button
  useEffect(() => {
    document.body.classList.toggle("reels-mode", reels);
    return () => document.body.classList.remove("reels-mode");
  }, [reels]);

  const pickBudget = (id: string) => {
    setBudget(id);
    sessionStorage.setItem(BUDGET_KEY, id);
  };
  const b = BUDGETS.find((x) => x.id === budget) ?? BUDGETS[0];
  const shown = (outfits ?? []).filter((o) => o.total_uah >= b.min && o.total_uah < b.max);

  const chips = (
    <div className="chips scroll" role="group" aria-label="Бюджет образу">
      {BUDGETS.map((x) => (
        <button key={x.id} className={`chip ${budget === x.id ? "on" : ""}`} aria-pressed={budget === x.id}
          onClick={() => pickBudget(x.id)}>{x.label}</button>
      ))}
    </div>
  );
  const empty = <p className="muted pad">У цьому бюджеті образів поки немає — спробуй інший.</p>;

  if (reels) {
    if (outfits === null) return <div className="reels"><div className="reel skeleton" /></div>;
    return shown.length ? (
      <ReelsFeed key={budget} outfits={shown} saved={saved} onToggleSave={toggle} onFeedback={onFeedback} toolbar={chips} />
    ) : (
      <main className="page"><section className="feed-head">{chips}</section>{empty}</main>
    );
  }

  return (
    <main className="page">
      <section className="feed-head">
        <h1>Образи на осінь</h1>
        <p className="muted">Обери образ — і заміни будь-яку річ на схожу від іншого українського бренду.</p>
        {chips}
      </section>
      {outfits === null ? (
        <div className="feed">{[0, 1, 2, 3].map((i) => <div key={i} className="outfit-card skeleton" />)}</div>
      ) : shown.length === 0 ? (
        empty
      ) : (
        <div className="feed">
          {shown.map((o) => <OutfitCard key={o.id} outfit={o} saved={saved.has(o.id)} onToggleSave={() => toggle(o.id)} />)}
        </div>
      )}
    </main>
  );
}
