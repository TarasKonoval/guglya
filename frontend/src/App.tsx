import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Hub } from "aws-amplify/utils";
import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { api, DONATE_URL, donate, track } from "./lib/api";
import { initFeedbackPrompt, markPrompted } from "./lib/feedback";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import FeedPage from "./pages/FeedPage";
import OutfitPage from "./pages/OutfitPage";
import SavedPage from "./pages/SavedPage";
import DemoProductPage from "./pages/DemoProductPage";
import FeedbackModal from "./components/FeedbackModal";
import { ChatIcon, HeartIcon, MenuIcon } from "./components/Icons";

type User = { email: string } | null;
type Me = { id: string; email: string; feedback_prompted: boolean };

export default function App() {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [feedback, setFeedback] = useState<null | "manual" | "auto">(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const refresh = async () => {
      try {
        const idToken = (await fetchAuthSession()).tokens?.idToken;
        setUser(idToken ? { email: String(idToken.payload.email ?? "") } : null);
      } catch {
        setUser(null);
      }
    };
    refresh();
    return Hub.listen("auth", refresh);
  }, []);

  const openFeedback = useCallback((kind: "manual" | "auto") => {
    markPrompted();
    track("feedback_open");
    setFeedback(kind);
  }, []);

  // /me registers the user in our database and tells us whether we already asked for feedback.
  useEffect(() => {
    if (!user) return;
    api<Me>("/me")
      .then((me) => initFeedbackPrompt(me.id, me.feedback_prompted, () => openFeedback("auto")))
      .catch(() => {});
  }, [user, openFeedback]);

  if (user === undefined) return null;

  if (!user)
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/demo/:productId" element={<DemoProductPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );

  return (
    <>
      <header className="topbar">
        <Link to="/" className="logo">Ґуґля</Link>
        <nav className="topnav">
          {DONATE_URL && <button className="pill hide-xs" onClick={donate}>Підтримати збір</button>}
          <Link to="/saved" className="iconbtn" aria-label="Збережені"><HeartIcon /></Link>
          <button className="iconbtn" aria-label="Меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            <MenuIcon />
          </button>
        </nav>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="menu" onClick={() => setMenuOpen(false)}>
              <div className="menu-email">{user.email}</div>
              <Link to="/">Образи на осінь</Link>
              <Link to="/saved">Збережені</Link>
              <button onClick={() => openFeedback("manual")}>Залишити відгук</button>
              {DONATE_URL && <button onClick={donate}>Підтримати збір ♥</button>}
              <button onClick={() => signOut()}>Вийти</button>
            </div>
          </>
        )}
      </header>
      <Routes>
        <Route path="/" element={<FeedPage />} />
        <Route path="/outfit/:id" element={<OutfitPage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/demo/:productId" element={<DemoProductPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="footer">
        Ґуґля — студентський проєкт, 2026. Демо-каталог: бренди й товари вигадані, ілюстрації наші.
      </footer>
      <button className="fab" aria-label="Відгук" onClick={() => openFeedback("manual")}><ChatIcon /> <span className="fab-label">Відгук</span></button>
      {feedback && <FeedbackModal auto={feedback === "auto"} onClose={() => setFeedback(null)} />}
    </>
  );
}
