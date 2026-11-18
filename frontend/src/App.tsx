import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import { Hub } from "aws-amplify/utils";
import { fetchAuthSession } from "aws-amplify/auth";
import { api, DONATE_URL, donate, track } from "./lib/api";
import { initFeedbackPrompt, markPrompted } from "./lib/feedback";
import LandingPage from "./pages/LandingPage";
import AuthPage from "./pages/AuthPage";
import FeedPage from "./pages/FeedPage";
import OutfitPage from "./pages/OutfitPage";
import SavedPage from "./pages/SavedPage";
import ProfilePage from "./pages/ProfilePage";
import CartPage from "./pages/CartPage";
import DemoProductPage from "./pages/DemoProductPage";
import FeedbackModal from "./components/FeedbackModal";
import { BagIcon, ChatIcon, HeartIcon, UserIcon } from "./components/Icons";
import { loadCart, useCart } from "./lib/cart";

type User = { email: string } | null;
type Me = { id: string; email: string; feedback_prompted: boolean };

export default function App() {
  const [user, setUser] = useState<User | undefined>(undefined);
  const [feedback, setFeedback] = useState<null | "manual" | "auto">(null);
  const cart = useCart();

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
    loadCart();
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
          <Link to="/profile" className="iconbtn" aria-label="Профіль"><UserIcon /></Link>
          <Link to="/cart" className="iconbtn cart-btn" aria-label={`Кошик${cart.length ? `, ${cart.length} шт.` : ""}`}>
            <BagIcon />
            {cart.length > 0 && <span className="cart-count" aria-hidden>{cart.length}</span>}
          </Link>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<FeedPage onFeedback={() => openFeedback("manual")} />} />
        <Route path="/outfit/:id" element={<OutfitPage />} />
        <Route path="/saved" element={<SavedPage />} />
        <Route path="/profile" element={<ProfilePage onFeedback={() => openFeedback("manual")} />} />
        <Route path="/cart" element={<CartPage />} />
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
