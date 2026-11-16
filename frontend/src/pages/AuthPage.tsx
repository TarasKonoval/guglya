import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const { error } =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
    if (error) setMsg(error.message);
    else if (mode === "signup") setMsg("Акаунт створено. Якщо увімкнено підтвердження — перевір пошту.");
  }

  return (
    <main style={{ maxWidth: 360, margin: "15vh auto", fontFamily: "system-ui", padding: 16 }}>
      <h1>Ґуґля</h1>
      <p>Образи сезону з речей українських брендів.</p>
      <form onSubmit={submit} style={{ display: "grid", gap: 8 }}>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Пароль (від 6 символів)" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        <button type="submit">{mode === "signup" ? "Зареєструватися" : "Увійти"}</button>
      </form>
      <button style={{ marginTop: 8 }} onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
        {mode === "signin" ? "Немає акаунта? Реєстрація" : "Вже є акаунт? Увійти"}
      </button>
      {msg && <p>{msg}</p>}
    </main>
  );
}
