import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, authHeaders, COLORS, formatUah, img, slotLabel, SLOTS, type Product, type Slot } from "../lib/api";

const AGENT_URL = import.meta.env.VITE_AGENT_URL ?? "";
const GENDERS = [
  { id: "women", label: "Жінкам" },
  { id: "men", label: "Чоловікам" },
  { id: "couple", label: "Парам" },
] as const;
type Gender = (typeof GENDERS)[number]["id"];

type Piece = {
  person: 1 | 2; slot: Slot; item_type: string; color: string | null; description: string; vector: number[];
  candidates: (Product & { item_type: string | null })[] | null; chosen: string | null; removed?: boolean;
};
type AdminOutfit = { id: string; title: string; gender: string; is_published: boolean; is_demo: boolean; item_count: number };

/** Look photo -> max 1280 px JPEG (the agent gets base64, the cover goes to S3 as a blob). */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("jpeg"))), "image/jpeg", 0.85));
}

const toBase64 = (b: Blob) =>
  new Promise<string>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.readAsDataURL(b);
  });

export default function AdminPage() {
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [gender, setGender] = useState<Gender>("women");
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("");
  const [useCover, setUseCover] = useState(false);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [state, setState] = useState<"idle" | "detecting" | "publishing">("idle");
  const [message, setMessage] = useState<{ error?: string; done?: string } | null>(null);
  const [outfits, setOutfits] = useState<AdminOutfit[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // hidden from the catalog by an admin
  const [broken, setBroken] = useState<Set<string>>(new Set()); // photo didn't load: not offered

  const loadOutfits = () => api<AdminOutfit[]>("/admin/outfits").then(setOutfits).catch(() => {});
  useEffect(() => {
    loadOutfits();
  }, []);

  async function pickFile(file?: File) {
    if (!file) return;
    const blob = await shrink(file);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    setPieces([]);
    setMessage(null);
  }

  async function detect() {
    if (!photo) return;
    setState("detecting");
    setMessage(null);
    try {
      const res = await fetch(AGENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ image: await toBase64(photo.blob), gender }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data: { title: string; style_tag: string; pieces: Piece[] } = await res.json();
      const found = data.pieces.map((p) => ({ ...p, candidates: null, chosen: null }));
      setPieces(found);
      // AI suggestions; whatever the admin already typed wins
      setTitle((t) => t.trim() ? t : data.title);
      setTag((t) => t.trim() ? t : data.style_tag);
      // couples: we don't know each person's gender, so search everything
      const g = gender === "couple" ? "unisex" : gender;
      found.forEach((p, i) =>
        api<Piece["candidates"]>("/admin/match", {
          method: "POST", body: JSON.stringify({ slot: p.slot, gender: g, vector: p.vector, color: p.color }),
        })
          .then((c) => setPieces((all) => all.map((x, j) => (j === i ? { ...x, candidates: c, chosen: c?.[0]?.id ?? null } : x))))
          .catch(() => setPieces((all) => all.map((x, j) => (j === i ? { ...x, candidates: [] } : x)))),
      );
    } catch (e) {
      setMessage({ error: `AI не зміг розібрати фото: ${e instanceof Error ? e.message : e}` });
    } finally {
      setState("idle");
    }
  }

  async function publish() {
    const chosen = pieces.filter((p) => p.chosen && !p.removed);
    const looks = ([1, 2] as const)
      .map((n) => Object.fromEntries(chosen.filter((p) => p.person === n).map((p) => [p.slot, p.chosen])))
      .filter((l) => Object.keys(l).length);
    setState("publishing");
    setMessage(null);
    try {
      let cover: string | null = null;
      if (useCover && photo) {
        const { upload_url, image_url } = await api<{ upload_url: string; image_url: string }>("/admin/upload-url", { method: "POST" });
        const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: photo.blob });
        if (!put.ok) throw new Error(`upload ${put.status}`);
        cover = image_url;
      }
      const { id } = await api<{ id: string }>("/admin/outfits", {
        method: "POST",
        body: JSON.stringify({ title, gender, style_tag: tag || null, cover_image_url: cover, looks }),
      });
      setMessage({ done: id });
      setPieces([]);
      setPhoto(null);
      setTitle("");
      setTag("");
      loadOutfits();
    } catch (e) {
      setMessage({ error: `Не вдалося опублікувати: ${e instanceof Error ? e.message : e}` });
    } finally {
      setState("idle");
    }
  }

  async function togglePublished(o: AdminOutfit) {
    await api(`/admin/outfits/${o.id}`, { method: "PATCH", body: JSON.stringify({ is_published: !o.is_published }) });
    loadOutfits();
  }

  const update = (i: number, patch: Partial<Piece>) => setPieces((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const offered = (p: Piece) => (p.candidates ?? []).filter((c) => !broken.has(c.id));
  // the chosen product got hidden or its photo is broken -> move to the next one in that row
  const firstOk = (p: Piece, skip: Set<string>) => offered(p).find((c) => !skip.has(c.id) && !hidden.has(c.id))?.id ?? null;
  const reselect = (bad: string, skip: Set<string>) =>
    setPieces((all) => all.map((x) => (x.chosen === bad ? { ...x, chosen: firstOk(x, skip) } : x)));

  async function hideProduct(id: string, hide: boolean) {
    await api(`/admin/products/${id}`, { method: "PATCH", body: JSON.stringify({ hidden: hide }) });
    const next = new Set(hidden);
    if (hide) next.add(id); else next.delete(id);
    setHidden(next);
    if (hide) reselect(id, next);
  }
  function photoFailed(id: string) {
    const next = new Set(broken).add(id);
    setBroken(next);
    reselect(id, next);
  }

  const active = pieces.filter((p) => p.chosen && !p.removed);
  const dressAndBottom = [1, 2].some((n) => ["dress", "bottom"].every((s) => active.some((p) => p.person === n && p.slot === s)));
  const ready = title.trim().length >= 2 && active.length > 0 && !dressAndBottom &&
    (gender !== "couple" || [1, 2].every((n) => active.some((p) => p.person === n)));
  const sorted = pieces.map((p, i) => ({ p, i })).sort((a, b) => a.p.person - b.p.person || SLOTS.indexOf(a.p.slot) - SLOTS.indexOf(b.p.slot));

  return (
    <main className="page admin">
      <section className="feed-head">
        <h1>Новий образ</h1>
        <p className="muted">Завантаж фото образу — AI знайде схожі речі українських брендів (популярні бренди першими). Перевір і опублікуй.</p>
      </section>

      <div className="admin-form pad-x">
        <label className="admin-photo">
          {photo ? <img src={photo.url} alt="Фото образу" /> : <span>+ Фото образу</span>}
          <input type="file" accept="image/*" onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>
        <div className="stack grow">
          <div className="seg full" role="group" aria-label="Для кого">
            {GENDERS.map((g) => (
              <button key={g.id} className={gender === g.id ? "on" : ""} aria-pressed={gender === g.id}
                onClick={() => setGender(g.id)}>{g.label}</button>
            ))}
          </div>
          <div className="auth-form">
            <label>Назва<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Беж і денім" /></label>
            <label>Тег<input value={tag} maxLength={30} onChange={(e) => setTag(e.target.value)} placeholder="кежуал" /></label>
          </div>
          <label className="check">
            <input type="checkbox" checked={useCover} onChange={(e) => setUseCover(e.target.checked)} />
            Фото як обкладинка (лише власні фото або з дозволом; інакше — колаж із речей)
          </label>
          <button className="btn primary" disabled={!photo || state !== "idle"} onClick={detect}>
            {state === "detecting" ? "AI розглядає фото… (до хвилини)" : "Знайти речі"}
          </button>
        </div>
      </div>

      {message?.error && <p className="error pad">{message.error}</p>}
      {message?.done && <p className="pad">Опубліковано ✓ <Link className="link-strong" to={`/outfit/${message.done}`}>Відкрити образ</Link></p>}

      {sorted.map(({ p, i }) => (
        <section key={i} className={`row ${p.removed ? "removed" : ""}`}>
          <div className="row-head pad-x">
            <h2>
              {gender === "couple" && `${p.person === 1 ? "Перший" : "Другий"} · `}{slotLabel(p.slot, gender)}
              <span className="muted small"> · {p.item_type}{p.color && ` · ${COLORS[p.color]?.[0] ?? p.color}`}</span>
            </h2>
            <button className="link-strong small" onClick={() => update(i, { removed: !p.removed })}>
              {p.removed ? "Повернути" : "Прибрати"}
            </button>
          </div>
          {p.removed ? (
            <p className="hint pad-x">Не додаємо в образ.</p>
          ) : (
            <>
              <p className="hint pad-x">AI: «{p.description}»</p>
              <div className="scroller">
                {p.candidates === null
                  ? [0, 1, 2].map((k) => <div key={k} className="pick-card skeleton" />)
                  : offered(p).map((c) => (
                      <div key={c.id} className={`pick-wrap ${hidden.has(c.id) ? "hidden" : ""}`}>
                        <button className={`pick-card ${p.chosen === c.id ? "on" : ""}`} aria-pressed={p.chosen === c.id}
                          disabled={hidden.has(c.id)} onClick={() => update(i, { chosen: c.id })}>
                          <img referrerPolicy="no-referrer" src={img(c.image_url)} alt="" loading="lazy" onError={() => photoFailed(c.id)} />
                          <span className="brand">{c.brand}</span>
                          <span className="title">{c.title}</span>
                          <strong>{formatUah(c.price_uah)}</strong>
                          <span className="muted small">схожість {Math.round((c.similarity ?? 0) * 100)}%</span>
                        </button>
                        <button className="link small" onClick={() => hideProduct(c.id, !hidden.has(c.id))}>
                          {hidden.has(c.id) ? "Приховано · повернути" : "Сховати з каталогу"}
                        </button>
                      </div>
                    ))}
                {p.candidates !== null && offered(p).length === 0 && <p className="muted empty">Нічого схожого в каталозі</p>}
              </div>
            </>
          )}
        </section>
      ))}

      {pieces.length > 0 && (
        <div className="pad">
          <button className="btn accent full" disabled={!ready || state !== "idle"} onClick={publish}>
            {state === "publishing" ? "Публікуємо…" : "Опублікувати образ"}
          </button>
          {!title.trim() && <p className="hint">Додай назву образу.</p>}
          {dressAndBottom && <p className="hint">Сукня / костюм уже містить низ: прибери «Низ» або «{slotLabel("dress", gender)}».</p>}
        </div>
      )}

      <section className="pad">
        <h2 className="look-title">Усі образи</h2>
        <ul className="admin-list">
          {outfits.map((o) => (
            <li key={o.id}>
              <Link to={`/outfit/${o.id}`} className="grow">
                {o.title} <span className="muted small">· {GENDERS.find((g) => g.id === o.gender)?.label ?? o.gender} · {o.item_count} шт.{o.is_demo && " · демо"}</span>
              </Link>
              <button className={`chip ${o.is_published ? "on" : ""}`} onClick={() => togglePublished(o)}>
                {o.is_published ? "Опубліковано" : "Приховано"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
