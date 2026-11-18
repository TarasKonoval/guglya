import { Link } from "react-router-dom";
import { formatUah, things, type OutfitSummary } from "../lib/api";
import OutfitCover from "./OutfitCover";
import { HeartIcon } from "./Icons";

type Props = { outfit: OutfitSummary; saved?: boolean; onToggleSave?: () => void; to?: string };

export default function OutfitCard({ outfit, saved, onToggleSave, to }: Props) {
  return (
    <article className="outfit-card">
      <Link to={to ?? `/outfit/${outfit.id}`} className="outfit-card-link">
        <OutfitCover outfit={outfit} />
        <div className="outfit-card-body">
          {/* the tag line is always there (blank without a tag): all cards are the same height */}
          <span className="tag">{outfit.style_tag ? `#${outfit.style_tag}` : "\u00a0"}</span>
          <h3>{outfit.title}</h3>
          <p className="check-line">
            <span className="check-label">АутфітЧек</span> {things(outfit.item_count)} · <strong>{formatUah(outfit.total_uah)}</strong>
          </p>
        </div>
      </Link>
      {onToggleSave && (
        <button className={`heart ${saved ? "on" : ""}`} onClick={onToggleSave}
          aria-label={saved ? "Прибрати зі збережених" : "Зберегти образ"} aria-pressed={saved}>
          <HeartIcon filled={saved} />
        </button>
      )}
    </article>
  );
}
