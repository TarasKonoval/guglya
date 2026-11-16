import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import AuthPage from "./pages/AuthPage";

// TODO (Claude Code): replace the placeholder below with the real screens:
// outfit feed -> outfit page (outfit on the left, swipeable rows of 5 similar items per slot on the right).
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return null;
  if (!session) return <AuthPage />;

  return (
    <main style={{ fontFamily: "system-ui", padding: 16 }}>
      <p>Привіт, {session.user.email}!</p>
      <button onClick={() => supabase.auth.signOut()}>Вийти</button>
    </main>
  );
}
