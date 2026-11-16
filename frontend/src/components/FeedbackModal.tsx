import { useState } from "react";
import { api } from "../lib/api";

export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      await api("/feedback", { method: "POST", body: JSON.stringify({ rating: rating || null, text }) });
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Закрити">×</button>
        {state === "done" ? (
          <>
            <h2>Дякуємо!</h2>
            <p>Твій відгук допоможе зробити Ґуґлю кращою.</p>
            <button className="btn primary" onClick={onClose}>Закрити</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <h2>Як тобі Ґуґля?</h2>
            <div className="stars" role="radiogroup" aria-label="Оцінка">
              {[1, 2, 3, 4, 5].map((n) => (
                <button type="button" key={n} className={n <= rating ? "star on" : "star"}
                  onClick={() => setRating(n)} aria-label={`${n} з 5`}>★</button>
              ))}
            </div>
            <textarea placeholder="Що сподобалось, що ні, чого бракує?" value={text} required rows={4}
              onChange={(e) => setText(e.target.value)} />
            {state === "error" && <p className="error">Не вдалося надіслати. Спробуй ще раз.</p>}
            <button className="btn primary" type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Надсилаємо…" : "Надіслати"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
