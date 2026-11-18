import { useEffect, useState } from "react";
import { signOut } from "aws-amplify/auth";
import { api, DONATE_URL, donate } from "../lib/api";

type Profile = { email: string; first_name: string | null; last_name: string | null; phone: string | null };

export default function ProfilePage({ onFeedback }: { onFeedback: () => void }) {
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "" });
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");

  useEffect(() => {
    api<Profile>("/me")
      .then((p) => {
        setEmail(p.email);
        setForm({ first_name: p.first_name ?? "", last_name: p.last_name ?? "", phone: p.phone ?? "" });
        setState("idle");
      })
      .catch(() => setState("error"));
  }, []);

  const field = (k: keyof typeof form) => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm({ ...form, [k]: e.target.value });
      setState("idle");
    },
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    try {
      await api("/me", { method: "PUT", body: JSON.stringify(form) });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="page narrow">
      <section className="feed-head"><h1>Профіль</h1></section>
      <form className="auth-form stack pad-x" onSubmit={save}>
        <label>Імʼя<input autoComplete="given-name" maxLength={80} {...field("first_name")} /></label>
        <label>Прізвище<input autoComplete="family-name" maxLength={80} {...field("last_name")} /></label>
        <label>Email<input type="email" value={email} readOnly disabled /></label>
        <label>Телефон
          <input type="tel" autoComplete="tel" inputMode="tel" placeholder="+380 67 123 45 67" maxLength={30}
            pattern="[0-9+()\- ]*" {...field("phone")} />
        </label>
        {state === "error" && <p className="error">Не вдалося зберегти. Спробуй ще раз.</p>}
        <button className="btn primary" disabled={state === "loading" || state === "saving"}>
          {state === "saved" ? "Збережено ✓" : state === "saving" ? "Зберігаємо…" : "Зберегти"}
        </button>
      </form>
      <nav className="profile-links pad">
        <button onClick={onFeedback}>Залишити відгук</button>
        {DONATE_URL && <button onClick={donate}>Підтримати збір ♥</button>}
        <button onClick={() => signOut()}>Вийти</button>
      </nav>
    </main>
  );
}
