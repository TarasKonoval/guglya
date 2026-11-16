import { useState } from "react";
import { signIn, signUp } from "aws-amplify/auth";
import { authErrorMessage } from "../lib/auth";

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      const username = email.trim().toLowerCase();
      if (mode === "signup") {
        // A pre-sign-up trigger confirms the account immediately, so we can sign straight in.
        await signUp({ username, password, options: { userAttributes: { email: username } } });
      }
      const { nextStep } = await signIn({ username, password });
      if (nextStep.signInStep !== "DONE") setMsg("Не вдалося увійти. Спробуй ще раз.");
      // On success the Hub "signedIn" event switches the app to the feed.
    } catch (err) {
      setMsg(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth">
      <div className="auth-hero">
        <h1 className="logo big">Ґуґля</h1>
        <p className="tagline">Трендові образи сезону — з речей українських брендів.</p>
      </div>
      <form onSubmit={submit} className="auth-form">
        <h2>{mode === "signup" ? "Створи акаунт" : "Вхід"}</h2>
        <input type="email" placeholder="Email" autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Пароль (від 8 символів)" minLength={8} required value={password}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          onChange={(e) => setPassword(e.target.value)} />
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Зачекай…" : mode === "signup" ? "Зареєструватися" : "Увійти"}
        </button>
        {msg && <p className="error">{msg}</p>}
        <button type="button" className="link" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}>
          {mode === "signin" ? "Немає акаунта? Реєстрація" : "Вже є акаунт? Увійти"}
        </button>
      </form>
    </main>
  );
}
