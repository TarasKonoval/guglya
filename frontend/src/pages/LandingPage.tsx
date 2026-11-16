import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type OutfitSummary } from "../lib/api";
import OutfitCard from "../components/OutfitCard";

const BENEFITS = [
  ["Готові образи", "речі, що пасують одне до одного"],
  ["Тренди цієї осені", "без годин на Pinterest"],
  ["Під будь-який бюджет", "ціна кожної речі й усього образу"],
];

export default function LandingPage() {
  const [example, setExample] = useState<OutfitSummary | null>(null);

  useEffect(() => {
    api<OutfitSummary[]>("/outfits?limit=1").then((r) => setExample(r[0] ?? null)).catch(() => {});
  }, []);

  return (
    <main className="landing">
      <header className="landing-top"><span className="logo">Ґуґля</span>
        <Link to="/auth?mode=signin" className="link-strong">Увійти</Link>
      </header>
      <section className="landing-hero">
        <h1>Обираєш образ — і одягаєшся в українське за кілька хвилин</h1>
        <p className="lead">Трендові образи на сезон, зібрані виключно з речей українських брендів. Для кожної речі AI підбирає схожі альтернативи в інших брендів.</p>
        <ul className="benefits">
          {BENEFITS.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}
        </ul>
        <div className="cta">
          <Link to="/auth?mode=signup" className="btn primary">Зареєструватися</Link>
          <Link to="/auth?mode=signin" className="btn ghost">Увійти</Link>
        </div>
      </section>
      <section className="landing-example">
        {example ? <OutfitCard outfit={example} to="/auth?mode=signup" /> : <div className="outfit-card skeleton" />}
      </section>
    </main>
  );
}
