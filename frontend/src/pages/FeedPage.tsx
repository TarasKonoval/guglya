import { useEffect, useState } from "react";
import { api, COLORS, type OutfitSummary } from "../lib/api";
import { useSaved } from "../lib/saved";
import { useMediaQuery } from "../lib/useMediaQuery";
import OutfitCard from "../components/OutfitCard";
import ReelsFeed from "../components/ReelsFeed";
import Sheet from "../components/Sheet";
import { FilterIcon } from "../components/Icons";

const SORTS = [
  { id: "popular", label: "Популярні" },
  { id: "cheap", label: "Дешевші" },
  { id: "pricey", label: "Дорожчі" },
] as const;
type Sort = (typeof SORTS)[number]["id"];
const GENDERS = [
  { id: "women", label: "Жінкам" },
  { id: "men", label: "Чоловікам" },
  { id: "couple", label: "Парам" },
] as const;
type Gender = (typeof GENDERS)[number]["id"];
const GENDER_KEY = "guglya-gender"; // localStorage: remembered between visits
const SORT_KEY = "guglya-sort";
const COLOR_KEY = "guglya-color";

function sorted(outfits: OutfitSummary[], sort: Sort) {
  const by = {
    popular: (a: OutfitSummary, b: OutfitSummary) => b.popularity - a.popularity,
    cheap: (a: OutfitSummary, b: OutfitSummary) => a.total_uah - b.total_uah,
    pricey: (a: OutfitSummary, b: OutfitSummary) => b.total_uah - a.total_uah,
  }[sort];
  return [...outfits].sort(by); // stable: ties keep the curated order
}

export default function FeedPage({ onFeedback }: { onFeedback: () => void }) {
  const [chosen, setGender] = useState<Gender | null>(() => localStorage.getItem(GENDER_KEY) as Gender | null);
  const [all, setAll] = useState<OutfitSummary[] | null>(null); // every published outfit, split by tab below
  const [sort, setSort] = useState<Sort>(() => (sessionStorage.getItem(SORT_KEY) as Sort) ?? "popular");
  const [color, setColor] = useState(() => sessionStorage.getItem(COLOR_KEY) ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { saved, toggle } = useSaved();
  const reels = useMediaQuery("(max-width: 719px)");

  useEffect(() => {
    api<OutfitSummary[]>("/outfits?season=autumn").then(setAll).catch(() => setAll([]));
  }, []);

  // Only tabs that have outfits; the feed opens on the remembered tab if it has any, else the first one that does
  const forTab = (g: Gender) => (all ?? []).filter((o) => o.gender === g || (o.gender === "unisex" && g !== "couple"));
  const tabs = all?.length ? GENDERS.filter((g) => forTab(g.id).length) : GENDERS;
  const gender: Gender = tabs.some((g) => g.id === chosen) ? chosen! : tabs[0].id;
  const outfits = all && forTab(gender);

  // Reels mode: the feed fills the screen, no page scroll / footer / floating button
  useEffect(() => {
    document.body.classList.toggle("reels-mode", reels);
    return () => document.body.classList.remove("reels-mode");
  }, [reels]);

  const pickGender = (g: Gender) => {
    setGender(g);
    localStorage.setItem(GENDER_KEY, g);
  };
  const pickSort = (id: Sort) => {
    setSort(id);
    sessionStorage.setItem(SORT_KEY, id);
  };
  const pickColor = (c: string) => {
    const next = c === color ? "" : c; // tap the active colour again to clear it
    setColor(next);
    sessionStorage.setItem(COLOR_KEY, next);
  };
  const colors = Object.keys(COLORS).filter((c) => outfits?.some((o) => o.colors.includes(c)));
  const shown = sorted((outfits ?? []).filter((o) => !color || o.colors.includes(color)), sort);

  const active = (sort !== "popular" ? 1 : 0) + (color ? 1 : 0);
  const reset = () => {
    pickSort("popular");
    if (color) pickColor(color);
  };

  const chips = (
    <div className="chips feed-toolbar">
      <div className="seg" role="group" aria-label="Чиї образи">
        {tabs.map((g) => (
          <button key={g.id} className={gender === g.id ? "on" : ""} aria-pressed={gender === g.id}
            onClick={() => pickGender(g.id)}>{g.label}</button>
        ))}
      </div>
      <button className={`chip ${reels ? "icon" : ""} ${active ? "on" : ""}`} aria-haspopup="dialog"
        aria-label={`Фільтри${active ? `, обрано ${active}` : ""}`} onClick={() => setFiltersOpen(true)}>
        <FilterIcon /> <span className="chip-label">Фільтри{active ? ` · ${active}` : ""}</span>
        {reels && active > 0 && <span className="chip-count">{active}</span>}
      </button>
    </div>
  );
  const filters = filtersOpen && (
    <Sheet onClose={() => setFiltersOpen(false)} label="Фільтри">
      <div className="stack">
        <h2>Фільтри</h2>
        <fieldset>
          <legend>Сортування</legend>
          <div className="seg full">
            {SORTS.map((x) => (
              <button key={x.id} className={sort === x.id ? "on" : ""} aria-pressed={sort === x.id}
                onClick={() => pickSort(x.id)}>{x.label}</button>
            ))}
          </div>
        </fieldset>
        {colors.length > 0 && <fieldset>
          <legend>Колір</legend>
          <div className="chips wrap">
            {colors.map((c) => (
              <button key={c} className={`chip color ${color === c ? "on" : ""}`} aria-pressed={color === c}
                onClick={() => pickColor(c)}>
                <span className="swatch" style={{ background: COLORS[c][1] }} />
                {COLORS[c][0]}
              </button>
            ))}
          </div>
        </fieldset>}
        <div className="sheet-actions">
          <button className="btn ghost" onClick={reset} disabled={!active}>Скинути</button>
          <button className="btn primary grow" onClick={() => setFiltersOpen(false)}>Показати {shown.length}</button>
        </div>
      </div>
    </Sheet>
  );
  const empty = (
    <p className="muted pad">
      {outfits?.length
        ? "Образів цього кольору поки немає — спробуй інший."
        : gender === "couple"
          ? "Парні образи вже збираємо — зовсім скоро вони зʼявляться тут."
          : "Образи на осінь вже збираємо — зовсім скоро вони зʼявляться тут."}
    </p>
  );

  if (reels) {
    if (outfits === null) return <div className="reels"><div className="reel skeleton" /></div>;
    return (
      <>
        {shown.length ? (
          <ReelsFeed key={`${gender}-${sort}-${color}`} outfits={shown} saved={saved} onToggleSave={toggle} onFeedback={onFeedback} toolbar={chips} />
        ) : (
          <main className="page"><section className="feed-head">{chips}</section>{empty}</main>
        )}
        {filters}
      </>
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
      {filters}
    </main>
  );
}
