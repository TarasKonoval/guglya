import { useState } from "react";
import { api } from "../lib/api";
import { currentOutfitId } from "../lib/feedback";
import DonateBlock from "./DonateBlock";
import Sheet from "./Sheet";

const WOULD_BUY = [
  { v: "yes", label: "Так" },
  { v: "maybe", label: "Можливо" },
  { v: "no", label: "Ні" },
] as const;

export default function FeedbackModal({ onClose, auto }: { onClose: () => void; auto?: boolean }) {
  const [rating, setRating] = useState(0);
  const [wouldBuy, setWouldBuy] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rating) return;
    setState("sending");
    try {
      await api("/feedback", {
        method: "POST",
        body: JSON.stringify({ rating, would_buy: wouldBuy, text, outfit_id: currentOutfitId }),
      });
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <Sheet onClose={onClose} label="Відгук">
      {state === "done" ? (
        <div className="stack">
          <h2>Дякуємо!</h2>
          <p>Твій відгук допоможе зробити Ґуґлю кращою.</p>
          <DonateBlock />
          <button className="btn ghost" onClick={onClose}>Закрити</button>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          <h2>{auto ? "Хвилинка на відгук?" : "Як тобі Ґуґля?"}</h2>
          <fieldset>
            <legend>Оцінка</legend>
            <div className="stars" role="radiogroup" aria-label="Оцінка від 1 до 5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button type="button" key={n} role="radio" aria-checked={rating === n}
                  className={n <= rating ? "star on" : "star"} onClick={() => setRating(n)} aria-label={`${n} з 5`}>★</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Чи купили б ви щось із цього образу?</legend>
            <div className="seg full">
              {WOULD_BUY.map((o) => (
                <button type="button" key={o.v} className={wouldBuy === o.v ? "on" : ""} aria-pressed={wouldBuy === o.v}
                  onClick={() => setWouldBuy(o.v)}>{o.label}</button>
              ))}
            </div>
          </fieldset>
          <textarea placeholder="Що сподобалось, що ні, чого бракує?" value={text} rows={3}
            onChange={(e) => setText(e.target.value)} />
          {state === "error" && <p className="error">Не вдалося надіслати. Спробуй ще раз.</p>}
          <button className="btn primary" type="submit" disabled={!rating || state === "sending"}>
            {state === "sending" ? "Надсилаємо…" : rating ? "Надіслати" : "Постав оцінку"}
          </button>
        </form>
      )}
    </Sheet>
  );
}
