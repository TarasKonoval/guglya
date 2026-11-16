import { DONATE_URL, donate } from "../lib/api";

export default function DonateBlock() {
  if (!DONATE_URL) return null;
  return (
    <div className="donate">
      <p>Ґуґля — студентський проєкт. Якщо вам сподобалось — підтримайте волонтерський збір і напишіть у коментарі «Ґуґля».</p>
      <button className="btn accent" onClick={donate}>Підтримати збір</button>
    </div>
  );
}
