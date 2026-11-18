import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type Row = Record<string, string | number | null>;
type Analytics = {
  totals: Row; outfits: Row[]; brands: Row[]; funnel: Row; choices: Row[]; feedback: Row[]; signups: Row[];
};
const PERIODS = [
  { days: null, label: "Увесь час" },
  { days: 7, label: "7 днів" },
  { days: 1, label: "Доба" },
] as const;
const FUNNEL = [
  ["landing_view", "Відкрили лендінг"],
  ["signup_click", "Натиснули «Зареєструватися»"],
  ["signup_submit", "Надіслали форму"],
  ["code_sent", "Отримали код"],
  ["code_confirmed", "Підтвердили код"],
  ["outfit_view", "Відкрили образ"],
] as const;
const CHOICE = { feed_tab: "Вкладка", feed_sort: "Сортування", feed_color: "Колір" } as Record<string, string>;
const BUY = { yes: "так", maybe: "можливо", no: "ні" } as Record<string, string>;

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: unknown, b: unknown) => (n(b) ? `${Math.round((n(a) / n(b)) * 100)}%` : "—");
const date = (v: unknown) => (v ? new Date(String(v)).toLocaleString("uk-UA", { dateStyle: "short", timeStyle: "short" }) : "");

/** /admin/analytics: what people see, open, click and say (admins only; the API checks the group). */
export default function AnalyticsPage() {
  const [days, setDays] = useState<number | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<Analytics>(`/admin/analytics${days ? `?days=${days}` : ""}`).then(setData).catch((e) => setError(String(e)));
  }, [days]);

  if (error) return <main className="page pad"><p className="error">Не вдалося завантажити: {error}</p></main>;
  const t = data?.totals ?? {};
  const f = data?.funnel ?? {};

  return (
    <main className="page admin analytics">
      <section className="feed-head">
        <Link to="/admin" className="link-strong small">← Адмінка</Link>
        <h1>Аналітика</h1>
        <div className="seg" role="group" aria-label="Період">
          {PERIODS.map((p) => (
            <button key={p.label} className={days === p.days ? "on" : ""} onClick={() => setDays(p.days)}>{p.label}</button>
          ))}
        </div>
      </section>

      {!data ? <div className="skeleton tall" /> : (
        <div className="pad stack">
          <div className="kpis">
            <Kpi label="Реєстрацій" value={t.signups} hint={`усього ${t.users_total}`} />
            <Kpi label="Переглянули образ" value={t.viewers} hint={`${t.views} відкриттів`} />
            <Kpi label="Перейшли на бренд" value={t.clickers} hint={`${t.clicks} кліків, ${t.alt_clicks} на альтернативи`} />
            <Kpi label="Click-through" value={pct(t.clickers, t.viewers)} hint="ціль ≥ 10%" />
            <Kpi label="Показів у стрічці" value={t.impressions} hint={`відкривають ${pct(t.views, t.impressions)}`} />
            <Kpi label="Відгуків" value={t.feedback} hint={t.avg_rating ? `середня оцінка ${t.avg_rating}` : ""} />
            <Kpi label="Донати" value={t.donate_clicks} hint="кліки на банку" />
          </div>

          <h2 className="look-title">Воронка реєстрації</h2>
          <table className="atable">
            <tbody>
              {FUNNEL.map(([k, label], i) => (
                <tr key={k}><td>{label}</td><td className="num">{n(f[k])}</td>
                  <td className="num muted">{i ? pct(f[k], f[FUNNEL[i - 1][0]]) : ""}</td></tr>
              ))}
            </tbody>
          </table>

          <h2 className="look-title">Образи</h2>
          <div className="atable-wrap">
            <table className="atable">
              <thead><tr><th>Образ</th><th>Показів</th><th>Відкрили</th><th>%</th><th>Кліки</th><th>♡</th><th>У кошик</th><th>Заміни</th><th>Сек на рілсі</th></tr></thead>
              <tbody>
                {data.outfits.map((o) => (
                  <tr key={String(o.id)}>
                    <td><Link to={`/outfit/${o.id}`}>{o.title}</Link></td>
                    <td className="num">{n(o.impressions)}</td><td className="num">{n(o.views)}</td>
                    <td className="num muted">{pct(o.views, o.impressions)}</td><td className="num">{n(o.clicks)}</td>
                    <td className="num">{n(o.saves)}</td><td className="num">{n(o.cart_adds)}</td><td className="num">{n(o.swaps)}</td>
                    <td className="num">{o.dwell_s ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="look-title">Бренди (кліки на сайт бренду)</h2>
          <table className="atable">
            <thead><tr><th>Бренд</th><th>Кліки</th><th>На альтернативи</th><th>З картки</th><th>З кошика</th></tr></thead>
            <tbody>
              {data.brands.map((b) => (
                <tr key={String(b.name)}><td>{b.name}</td><td className="num">{n(b.clicks)}</td><td className="num">{n(b.alternative)}</td>
                  <td className="num">{n(b.from_card)}</td><td className="num">{n(b.from_cart)}</td></tr>
              ))}
            </tbody>
          </table>

          <h2 className="look-title">Що обирають у стрічці</h2>
          <table className="atable">
            <tbody>
              {data.choices.map((c, i) => (
                <tr key={i}><td>{CHOICE[String(c.type)] ?? c.type}</td><td>{c.value}</td><td className="num">{n(c.n)}</td></tr>
              ))}
            </tbody>
          </table>

          <h2 className="look-title">Відгуки ({data.feedback.length})</h2>
          <ul className="feedback-list">
            {data.feedback.map((r, i) => (
              <li key={i}>
                <div className="muted small">{date(r.created_at)} · {r.email ?? "анонімно"}{r.outfit ? ` · «${r.outfit}»` : ""}</div>
                <div><strong>{r.rating ? "★".repeat(n(r.rating)) : "без оцінки"}</strong>
                  {r.would_buy && <span className="muted"> · купили б: {BUY[String(r.would_buy)] ?? r.would_buy}</span>}</div>
                {r.text && <p>{r.text}</p>}
              </li>
            ))}
          </ul>

          <h2 className="look-title">Реєстрації ({data.signups.length})</h2>
          <div className="atable-wrap">
            <table className="atable">
              <thead><tr><th>Email</th><th>Імʼя</th><th>Коли</th><th>Відкрив образів</th><th>Кліків</th></tr></thead>
              <tbody>
                {data.signups.map((u, i) => (
                  <tr key={i}><td>{u.email}</td><td>{[u.first_name, u.last_name].filter(Boolean).join(" ")}</td>
                    <td>{date(u.created_at)}</td><td className="num">{n(u.views)}</td><td className="num">{n(u.clicks)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function Kpi({ label, value, hint }: { label: string; value: unknown; hint?: string }) {
  return (
    <div className="kpi">
      <span className="muted small">{label}</span>
      <strong>{String(value ?? 0)}</strong>
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}
