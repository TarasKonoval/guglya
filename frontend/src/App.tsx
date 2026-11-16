import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Hub } from "aws-amplify/utils";
import { fetchAuthSession, signOut } from "aws-amplify/auth";
import { api, DONATE_URL } from "./lib/api";
import AuthPage from "./pages/AuthPage";
import FeedPage from "./pages/FeedPage";
import OutfitPage from "./pages/OutfitPage";
import SavedPage from "./pages/SavedPage";
import FeedbackModal from "./components/FeedbackModal";
import { HeartIcon, ChatIcon, LogoutIcon } from "./components/Icons";

type User = { email: string } | null;

export default function App() {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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

  // Registers the user in our database (users table) on every sign-in / app open.
  useEffect(() => {
    if (user) api("/me").catch(() => {});
  }, [user]);

  if (user === undefined) return null;
  if (!user) return <AuthPage />;

  return (
    <>
      <header className="topbar">
        <Link to="/" className="logo">Ґуґля</Link>
        <nav className="topnav">
          <NavLink to="/saved" className="iconbtn" title="Збережені" aria-label="Збережені">
            <HeartIcon /> <span className="hide-sm">Збережені</span>
          </NavLink>
          <button className="iconbtn" onClick={() => setFeedbackOpen(true)} title="Відгук" aria-label="Відгук">
            <ChatIcon /> <span className="hide-sm">Відгук</span>
          </button>
          {DONATE_URL && (
            <a className="pill" href={DONATE_URL} target="_blank" rel="noopener noreferrer">Підтримати збір</a>
          )}
          <button className="iconbtn" onClick={() => signOut()} title={`Вийти (${user.email})`} aria-label="Вийти">
            <LogoutIcon />
          </button>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<FeedPage />} />
        <Route path="/outfit/:id" element={<OutfitPage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <footer className="footer">
        Демо-каталог: бренди й товари вигадані, зображення — наші ілюстрації. Ґуґля · прототип, 2026
      </footer>
      {feedbackOpen && <FeedbackModal onClose={() => setFeedbackOpen(false)} />}
    </>
  );
}
