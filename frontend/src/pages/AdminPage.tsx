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

type Candidate = Product & { item_type: string | null };
type Piece = {
  person: 1 | 2; slot: Slot; item_type: string; color: string | null; description: string; vector: number[];
  part_of_suit: boolean; // the blazer / trousers of a suit: an alternative to the whole suit
  candidates: Candidate[] | null; chosen: string | null; removed?: boolean;
  only_color?: string | null; // colour chip: show only this colour
  keep?: Candidate; // editing: the item already in the outfit, always offered first
  by_text: boolean; // vector is the AI's description (saved with the outfit: the outfit page ranks the same way)
};
type AdminOutfit = {
  id: string; title: string; gender: string; is_published: boolean; is_demo: boolean; item_count: number;
  cover_image_url: string | null;
};
type EditOutfit = {
  id: string; title: string; gender: Gender; style_tag: string | null; cover_image_url: string | null;
  items: (Candidate & {
    person: 1 | 2; slot: Slot; vector: string; query_vector: string | null; query_text: string | null; query_color: string | null;
  })[];
};

/** Look photo -> max 1280 px JPEG (the agent gets base64, the cover goes to S3 as a blob). */
async function shrink(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("jpeg"))), "image/jpeg", 0.85));
}

/** Look photo -> S3 (presigned PUT); returns the /img/looks/... path for the outfit */
async function uploadCover(blob: Blob) {
  const { upload_url, image_url } = await api<{ upload_url: string; image_url: string }>("/admin/upload-url", { method: "POST" });
  const put = await fetch(upload_url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
  if (!put.ok) throw new Error(`upload ${put.status}`);
  return image_url;
}

const toBase64 = (b: Blob) =>
  new Promise<string>((ok) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.readAsDataURL(b);
  });

export default function AdminPage() {
  // blob is null while editing until the stored cover has been downloaded (needed only to ask the AI again)
  const [photo, setPhoto] = useState<{ blob: Blob | null; url: string; stored?: string } | null>(null);
  const [gender, setGender] = useState<Gender>("women");
  const [title, setTitle] = useState("");
  const [tag, setTag] = useState("");
  const [useCover, setUseCover] = useState(true);
  const [pieces, setPieces] = useState<Piece[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // id of the published outfit being changed
  const [state, setState] = useState<"idle" | "detecting" | "publishing">("idle");
  const [message, setMessage] = useState<{ error?: string; done?: string } | null>(null);
  const [outfits, setOutfits] = useState<AdminOutfit[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set()); // hidden from the catalog by an admin
  const [broken, setBroken] = useState<Set<string>>(new Set()); // photo didn't load: not offered

  const loadOutfits = () => api<AdminOutfit[]>("/admin/outfits").then(setOutfits).catch(() => {});
  useEffect(() => {
    loadOutfits();
  }, []);

  function reset() {
    setPieces([]);
    setPhoto(null);
    setTitle("");
    setTag("");
    setEditing(null);
    setUseCover(true);
  }

  async function pickFile(file?: File) {
    if (!file) return;
    const blob = await shrink(file);
    setPhoto({ blob, url: URL.createObjectURL(blob) });
    if (!editing) setPieces([]);
    setMessage(null);
  }

  /** Catalog products for one piece (couples: we don't know each person's gender, so search everything) */
  function search(i: number, p: Piece, g: Gender = gender) {
    setPieces((all) => all.map((x, j) => (j === i ? { ...x, candidates: null } : x)));
    api<Candidate[]>("/admin/match", {
      method: "POST",
      body: JSON.stringify({
        slot: p.slot, gender: g === "couple" ? "unisex" : g, vector: p.vector, color: p.color,
        only_color: p.only_color ?? null, item_type: p.item_type || null,
      }),
    })
      .then((found) => setPieces((all) => all.map((x, j) => {
        if (j !== i) return x;
        const keep = x.keep && (!x.only_color || x.keep.color === x.only_color) ? [x.keep] : [];
        const c = [...keep, ...found.filter((f) => f.id !== x.keep?.id)];
        return { ...x, candidates: c, chosen: c.some((f) => f.id === x.chosen) ? x.chosen : c[0]?.id ?? null };
      })))
      .catch(() => setPieces((all) => all.map((x, j) => (j === i ? { ...x, candidates: [] } : x))));
  }

  async function detect() {
    if (!photo?.blob) return;
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
      // a suit comes as the whole suit + its blazer + its trousers; the whole suit is picked by default
      const found = data.pieces.map((p) => ({ ...p, candidates: null, chosen: null, removed: p.part_of_suit, by_text: true }));
      setPieces(found);
      // AI suggestions; whatever the admin already typed wins
      setTitle((t) => t.trim() ? t : data.title);
      setTag((t) => t.trim() ? t : data.style_tag);
      found.forEach((p, i) => search(i, p));
    } catch (e) {
      setMessage({ error: `AI не зміг розібрати фото: ${e instanceof Error ? e.message : e}` });
    } finally {
      setState("idle");
    }
  }

  /** Load a published outfit into the builder: its items stay picked, alternatives come from their photos */
  async function edit(o: AdminOutfit) {
    setMessage(null);
    const data = await api<EditOutfit>(`/admin/outfits/${o.id}`);
    setEditing(data.id);
    setGender(data.gender);
    setTitle(data.title);
    setTag(data.style_tag ?? "");
    setUseCover(!!data.cover_image_url);
    setPhoto(data.cover_image_url ? { blob: null, url: img(data.cover_image_url), stored: data.cover_image_url } : null);
    if (data.cover_image_url)
      fetch(img(data.cover_image_url)).then((r) => r.blob()).then((blob) =>
        setPhoto((ph) => (ph?.stored === data.cover_image_url ? { ...ph, blob } : ph))).catch(() => {});
    const loaded: Piece[] = data.items.map(({ person, slot, vector, query_vector, query_text, query_color, ...product }) => ({
      person, slot, item_type: product.item_type ?? "", color: query_color ?? product.color,
      description: query_text ?? product.title, vector: JSON.parse(query_vector ?? vector), by_text: !!query_vector,
      part_of_suit: false, candidates: null, chosen: product.id, keep: product,
    }));
    setPieces(loaded);
    loaded.forEach((p, i) => search(i, p, data.gender));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function publish() {
    const chosen = pieces.filter((p) => p.chosen && !p.removed);
    const people = ([1, 2] as const).filter((n) => chosen.some((p) => p.person === n));
    const looks = people.map((n) => Object.fromEntries(chosen.filter((p) => p.person === n).map((p) => [p.slot, p.chosen])));
    // the AI search of each piece goes with the outfit: its page shows the same alternatives as here
    const queries = people.map((n) => Object.fromEntries(chosen.filter((p) => p.person === n && p.by_text)
      .map((p) => [p.slot, { vector: p.vector, color: p.color, text: p.description }])));
    setState("publishing");
    setMessage(null);
    try {
      // an unchanged stored cover is reused, a new photo is uploaded
      const cover = !useCover || !photo ? null : photo.stored ?? (photo.blob ? await uploadCover(photo.blob) : null);
      const body = JSON.stringify({ title, gender, style_tag: tag || null, cover_image_url: cover, looks, queries });
      const { id } = editing
        ? await api<{ id: string }>(`/admin/outfits/${editing}`, { method: "PUT", body })
        : await api<{ id: string }>("/admin/outfits", { method: "POST", body });
      setMessage({ done: id });
      reset();
      loadOutfits();
    } catch (e) {
      setMessage({ error: `Не вдалося зберегти: ${e instanceof Error ? e.message : e}` });
    } finally {
      setState("idle");
    }
  }

  async function changeCover(o: AdminOutfit, file?: File) {
    if (!file) return;
    try {
      const cover = await uploadCover(await shrink(file));
      await api(`/admin/outfits/${o.id}`, { method: "PATCH", body: JSON.stringify({ cover_image_url: cover }) });
      loadOutfits();
    } catch (e) {
      setMessage({ error: `Не вдалося змінити обкладинку: ${e instanceof Error ? e.message : e}` });
    }
  }

  async function togglePublished(o: AdminOutfit) {
    await api(`/admin/outfits/${o.id}`, { method: "PATCH", body: JSON.stringify({ is_published: !o.is_published }) });
    loadOutfits();
  }

  const update = (i: number, patch: Partial<Piece>) => setPieces((all) => all.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const pickColor = (i: number, c: string) => {
    const p = { ...pieces[i], only_color: pieces[i].only_color === c ? null : c };
    update(i, { only_color: p.only_color });
    search(i, p);
  };
  // whole suit vs separates: bringing back one side takes out the other
  const toggleRemoved = (i: number) => setPieces((all) => {
    const p = all[i];
    const back = p.removed;
    return all.map((x, j) => {
      if (j === i) return { ...x, removed: !back };
      if (!back || x.person !== p.person) return x;
      if (p.slot === "dress" && x.part_of_suit) return { ...x, removed: true };
      if (p.part_of_suit && x.slot === "dress") return { ...x, removed: true };
      return x;
    });
  });
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
  // suit parts right under the whole suit
  const order = (p: Piece) => (p.part_of_suit ? SLOTS.indexOf("dress") + (p.slot === "jacket" ? 0.1 : 0.2) : SLOTS.indexOf(p.slot));
  const sorted = pieces.map((p, i) => ({ p, i })).sort((a, b) => a.p.person - b.p.person || order(a.p) - order(b.p));

  return (
    <main className="page admin">
      <section className="feed-head">
        <h1>{editing ? "Редагування образу" : "Новий образ"}</h1>
        <p className="muted">
          {editing
            ? "Заміни речі, назву чи обкладинку і збережи. Нове фото + «Знайти речі» — AI підбере все заново."
            : "Завантаж фото образу — AI знайде схожі речі українських брендів (популярні бренди першими). Перевір і опублікуй."}
        </p>
        {editing && <button className="link-strong small" onClick={reset}>Скасувати редагування</button>}
      </section>

      <div className="admin-form pad-x">
        <label className="admin-photo">
          {photo ? <img referrerPolicy="no-referrer" src={photo.url} alt="Фото образу" /> : <span>+ Фото образу</span>}
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
            Фото як обкладинка образу (зніми галочку — буде колаж із речей)
          </label>
          <button className="btn primary" disabled={!photo?.blob || state !== "idle"} onClick={detect}>
            {state === "detecting" ? "AI розглядає фото… (до хвилини)" : "Знайти речі"}
          </button>
        </div>
      </div>

      {message?.error && <p className="error pad">{message.error}</p>}
      {message?.done && <p className="pad">Збережено ✓ <Link className="link-strong" to={`/outfit/${message.done}`}>Відкрити образ</Link></p>}

      {sorted.map(({ p, i }) => (
        <section key={i} className={`row ${p.removed ? "removed" : ""}`}>
          <div className="row-head pad-x">
            <h2>
              {gender === "couple" && `${p.person === 1 ? "Перший" : "Другий"} · `}{slotLabel(p.slot, gender)}
              <span className="muted small"> · {p.item_type}{p.color && ` · ${COLORS[p.color]?.[0] ?? p.color}`}</span>
            </h2>
            <button className="link-strong small" onClick={() => toggleRemoved(i)}>
              {p.removed ? "Повернути" : "Прибрати"}
            </button>
          </div>
          {p.removed ? (
            <p className="hint pad-x">
              {p.part_of_suit ? "Частина костюма: поверни, щоб брати піджак і штани окремо замість цілого костюма." : "Не додаємо в образ."}
            </p>
          ) : (
            <>
              <p className="hint pad-x">{p.by_text ? "AI" : "Зараз в образі"}: «{p.description}»</p>
              <div className="swatches pad-x" role="group" aria-label="Колір">
                {Object.entries(COLORS).map(([c, [label, hex]]) => (
                  <button key={c} className={`swatch-btn ${p.only_color === c ? "on" : ""}`} aria-pressed={p.only_color === c}
                    title={label} aria-label={label} onClick={() => pickColor(i, c)}>
                    <span className="swatch" style={{ background: hex }} />
                  </button>
                ))}
              </div>
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
                          {c.similarity != null && <span className="muted small">схожість {Math.round(c.similarity * 100)}%</span>}
                        </button>
                        <button className="link small" onClick={() => hideProduct(c.id, !hidden.has(c.id))}>
                          {hidden.has(c.id) ? "Приховано · повернути" : "Сховати з каталогу"}
                        </button>
                      </div>
                    ))}
                {p.candidates !== null && offered(p).length === 0 && (
                  <p className="muted empty">{p.only_color ? "Немає схожих речей цього кольору" : "Нічого схожого в каталозі"}</p>
                )}
              </div>
            </>
          )}
        </section>
      ))}

      {pieces.length > 0 && (
        <div className="pad">
          <button className="btn accent full" disabled={!ready || state !== "idle"} onClick={publish}>
            {state === "publishing" ? "Зберігаємо…" : editing ? "Зберегти зміни" : "Опублікувати образ"}
          </button>
          {!title.trim() && <p className="hint">Додай назву образу.</p>}
          {dressAndBottom && <p className="hint">Сукня / костюм уже містить низ: прибери «Низ» або «{slotLabel("dress", gender)}».</p>}
        </div>
      )}

      <section className="pad">
        <h2 className="look-title">Усі образи</h2>
        <ul className="admin-list">
          {outfits.map((o) => (
            <li key={o.id} className={editing === o.id ? "on" : ""}>
              <Link to={`/outfit/${o.id}`} className="grow">
                {o.title} <span className="muted small">· {GENDERS.find((g) => g.id === o.gender)?.label ?? o.gender} · {o.item_count} шт.{o.is_demo && " · демо"}</span>
              </Link>
              <button className="chip" onClick={() => edit(o)}>Редагувати</button>
              <label className="chip">
                {o.cover_image_url ? "Змінити обкладинку" : "Додати обкладинку"}
                <input type="file" accept="image/*" hidden onChange={(e) => changeCover(o, e.target.files?.[0])} />
              </label>
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
