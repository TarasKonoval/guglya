import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { signIn, signUp } from "aws-amplify/auth";
import { authErrorMessage } from "../lib/auth";
import GoogleButton from "../components/GoogleButton";

export default function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "signin" ? "signin" : "signup";
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
        // The pre-sign-up trigger confirms the account immediately, so we sign straight in.
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

  const switchTo = (m: string) => { setParams({ mode: m }, { replace: true }); setMsg(null); };

  return (
    <main className="auth">
      <Link to="/" className="logo big">Ґуґля</Link>
      <form onSubmit={submit} className="auth-form">
        <div className="seg full" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""}
            onClick={() => switchTo("signup")}>Реєстрація</button>
          <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""}
            onClick={() => switchTo("signin")}>Вхід</button>
        </div>
        <GoogleButton />
        <label>Email
          <input type="email" autoComplete="email" inputMode="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>Пароль
          <input type="password" minLength={8} required value={password}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)} />
          {mode === "signup" && <span className="hint">Щонайменше 8 символів</span>}
        </label>
        {msg && <p className="error" role="alert">{msg}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Зачекай…" : mode === "signup" ? "Зареєструватися" : "Увійти"}
        </button>
      </form>
    </main>
  );
}
