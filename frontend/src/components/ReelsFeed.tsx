import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { formatUah, img, things, type OutfitSummary } from "../lib/api";
import OutfitCover from "./OutfitCover";
import { ChatIcon, HeartIcon } from "./Icons";

const POS_KEY = "guglya-reel";
const SWIPE_OPEN = 70; // px to the left that opens the outfit

type Props = {
  outfits: OutfitSummary[];
  saved: Set<string>;
  onToggleSave: (id: string) => void;
  onFeedback: () => void;
  toolbar: ReactNode;
};

/** Instagram-Reels-style feed: one outfit per screen, vertical snap; swipe left (or tap) opens all its items. */
export default function ReelsFeed({ outfits, saved, onToggleSave, onFeedback, toolbar }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [barAway, setBarAway] = useState(false);
  const lastTop = useRef(0);
  const hideTimer = useRef<number>();

  // Quick-return toolbar: hide on scroll down, show on a small scroll up, hide again after a few seconds
  // (always visible on the first outfit)
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const top = el.scrollTop;
    const delta = top - lastTop.current;
    if (Math.abs(delta) < 6) return;
    lastTop.current = top;
    window.clearTimeout(hideTimer.current);
    if (top < 40 || delta < 0) {
      setBarAway(false);
      if (top >= 40) hideTimer.current = window.setTimeout(() => setBarAway(true), 3000);
    } else setBarAway(true);
  };
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // Come back to the same outfit after visiting its page
  useEffect(() => {
    const el = box.current;
    const id = sessionStorage.getItem(POS_KEY);
    const i = outfits.findIndex((o) => o.id === id);
    if (el && i > 0) el.scrollTo({ top: i * el.clientHeight });
  }, [outfits]);

  return (
    <div className="reels" ref={box} onScroll={onScroll}>
      <div className={`reels-toolbar ${barAway ? "away" : ""}`}>{toolbar}</div>
      {outfits.map((o, i) => (
        <Reel key={o.id} outfit={o} first={i === 0} saved={saved.has(o.id)}
          onToggleSave={() => onToggleSave(o.id)} onFeedback={onFeedback} />
      ))}
    </div>
  );
}

type ReelProps = { outfit: OutfitSummary; first: boolean; saved: boolean; onToggleSave: () => void; onFeedback: () => void };

function Reel({ outfit, first, saved, onToggleSave, onFeedback }: ReelProps) {
  const navigate = useNavigate();
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<"h" | "v" | null>(null);
  const drag = useRef(0); // latest offset; state lags behind fast flicks
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const open = () => {
    sessionStorage.setItem(POS_KEY, outfit.id);
    navigate(`/outfit/${outfit.id}`);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    axis.current = null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!start.current) return;
    const mx = e.touches[0].clientX - start.current.x;
    const my = e.touches[0].clientY - start.current.y;
    if (!axis.current && Math.hypot(mx, my) > 10) axis.current = Math.abs(mx) > Math.abs(my) * 1.2 ? "h" : "v";
    if (axis.current === "h") {
      drag.current = Math.min(0, mx);
      setDx(drag.current);
    }
  };
  const onTouchEnd = () => {
    if (axis.current === "h" && drag.current < -SWIPE_OPEN) {
      setLeaving(true);
      setTimeout(open, 180);
    } else setDx(0);
    start.current = null;
    drag.current = 0;
  };

  return (
    <section className="reel" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* revealed behind the outfit while swiping left */}
      <div className="reel-under" aria-hidden>
        <span>Усі речі</span>
        {outfit.items.map((it) => <img referrerPolicy="no-referrer" key={`${it.person}-${it.slot}`} src={img(it.image_url)} alt="" />)}
      </div>

      <div className={`reel-card ${dx ? "dragging" : ""} ${leaving ? "leaving" : ""}`}
        style={dx && !leaving ? { transform: `translateX(${dx}px)` } : undefined}>
        <button className="reel-cover" onClick={open} aria-label={`Відкрити образ «${outfit.title}»`}>
          <OutfitCover outfit={outfit} eager={first} />
        </button>

        <div className="reel-info" onClick={open}>
          {outfit.style_tag && <span className="reel-tag">#{outfit.style_tag}</span>}
          <h2>{outfit.title}</h2>
          <p className="reel-check">
            <span className="check-label">АутфітЧек</span> {things(outfit.item_count)} · <strong>{formatUah(outfit.total_uah)}</strong>
          </p>
          <div className="reel-brands">
            {outfit.items.map((it) => (
              <span key={`${it.person}-${it.slot}`}>{it.brand} · {formatUah(it.price_uah)}</span>
            ))}
          </div>
        </div>

        <div className="reel-actions">
          <button className={`reel-action ${saved ? "on" : ""}`} onClick={onToggleSave} aria-pressed={saved}
            aria-label={saved ? "Прибрати зі збережених" : "Зберегти образ"}>
            <span className="reel-icon"><HeartIcon filled={saved} /></span>
            <span>{saved ? "Збережено" : "Зберегти"}</span>
          </button>
          <button className="reel-action" onClick={onFeedback} aria-label="Відгук">
            <span className="reel-icon"><ChatIcon /></span>
            <span>Відгук</span>
          </button>
          <button className="reel-action" onClick={open} aria-label="Усі речі образу">
            <span className="reel-icon arrow">→</span>
            <span>Речі</span>
          </button>
        </div>

        {first && <div className="reel-hint" aria-hidden>Свайпни вліво — усі речі ←</div>}
      </div>
    </section>
  );
}
