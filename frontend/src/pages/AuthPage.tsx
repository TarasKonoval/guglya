import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { confirmSignUp, resendSignUpCode, signIn, signUp } from "aws-amplify/auth";
import { authErrorMessage } from "../lib/auth";
import { track } from "../lib/api";
import GoogleButton from "../components/GoogleButton";

const RESEND_AFTER_S = 30;

export default function AuthPage() {
  const [params, setParams] = useSearchParams();
  const mode = params.get("mode") === "signin" ? "signin" : "signup";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirming, setConfirming] = useState(false); // the emailed-code step
  const [wait, setWait] = useState(0); // seconds until the code can be sent again
  const [msg, setMsg] = useState<{ error?: string; info?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const username = email.trim().toLowerCase();

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const toCode = (info: string) => {
    setConfirming(true);
    setCode("");
    setWait(RESEND_AFTER_S);
    setMsg({ info });
  };

  async function enter() {
    const { nextStep } = await signIn({ username, password });
    // an account that signed up but never entered its code
    if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
      await resendSignUpCode({ username });
      return toCode(`Спершу підтверди email: ми надіслали новий код на ${username}.`);
    }
    if (nextStep.signInStep !== "DONE") setMsg({ error: "Не вдалося увійти. Спробуй ще раз." });
    else track("signin_done");
    // On success the Hub "signedIn" event switches the app to the feed.
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setBusy(true);
    try {
      if (confirming) {
        await confirmSignUp({ username, confirmationCode: code.trim() });
        track("code_confirmed");
        await enter();
      } else if (mode === "signup") {
        track("signup_submit");
        const { nextStep } = await signUp({ username, password, options: { userAttributes: { email: username } } });
        if (nextStep.signUpStep === "CONFIRM_SIGN_UP") {
          track("code_sent");
          toCode(`Ми надіслали 6-значний код на ${username}. Перевір і «Спам».`);
        }
        else await enter();
      } else {
        await enter();
      }
    } catch (err) {
      setMsg({ error: authErrorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setMsg(null);
    try {
      await resendSignUpCode({ username });
      setWait(RESEND_AFTER_S);
      setMsg({ info: `Новий код надіслано на ${username}.` });
    } catch (err) {
      setMsg({ error: authErrorMessage(err) });
    }
  }

  const switchTo = (m: string) => { setParams({ mode: m }, { replace: true }); setMsg(null); setConfirming(false); };

  return (
    <main className="auth">
      <Link to="/" className="logo big">Ґуґля</Link>
      <form onSubmit={submit} className="auth-form">
        {confirming ? (
          <>
            <h1 className="auth-title">Код підтвердження</h1>
            <label>Код з листа
              <input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
                maxLength={6} required autoFocus value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="••••••" />
            </label>
            {msg?.info && <p className="hint" role="status">{msg.info}</p>}
            {msg?.error && <p className="error" role="alert">{msg.error}</p>}
            <button className="btn primary" type="submit" disabled={busy || code.length !== 6}>
              {busy ? "Перевіряємо…" : "Підтвердити"}
            </button>
            <div className="auth-links">
              <button type="button" className="link-strong small" disabled={wait > 0} onClick={resend}>
                {wait > 0 ? `Надіслати код ще раз · ${wait} с` : "Надіслати код ще раз"}
              </button>
              <button type="button" className="link small" onClick={() => { setConfirming(false); setMsg(null); }}>
                Змінити email
              </button>
            </div>
          </>
        ) : (
          <>
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
              {mode === "signup" && <span className="hint">Щонайменше 8 символів. Підтвердимо email кодом.</span>}
            </label>
            {msg?.info && <p className="hint" role="status">{msg.info}</p>}
            {msg?.error && <p className="error" role="alert">{msg.error}</p>}
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Зачекай…" : mode === "signup" ? "Зареєструватися" : "Увійти"}
            </button>
            {import.meta.env.VITE_CLARITY_ID && (
              <p className="hint">Ми збираємо знеособлену статистику користування сайтом (Microsoft Clarity: кліки й прокрутка),
                щоб робити його зручнішим. Паролі й введений текст не записуються.</p>
            )}
          </>
        )}
      </form>
    </main>
  );
}
