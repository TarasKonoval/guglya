import { useEffect, type RefObject } from "react";
import { trackLater } from "./api";

const seen = new Set<string>(); // one impression per outfit per visit

/** An outfit counts as shown when at least half of it is on screen for a second. With `dwell`, the time it
 *  stays on screen is also sent (reels). */
export function useImpression(ref: RefObject<HTMLElement | null>, outfitId: string, mode: "grid" | "reels",
  position: number, dwell = false) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let since = 0;
    let timer: number | undefined;
    const leave = () => {
      window.clearTimeout(timer);
      if (dwell && since) {
        const ms = Date.now() - since;
        if (ms > 700) trackLater("reel_dwell", { outfit_id: outfitId }, { ms, position });
      }
      since = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        since = Date.now();
        timer = window.setTimeout(() => {
          if (seen.has(outfitId)) return;
          seen.add(outfitId);
          trackLater("outfit_impression", { outfit_id: outfitId }, { mode, position });
        }, 1000);
      } else leave();
    }, { threshold: 0.5 });
    io.observe(el);
    return () => {
      leave();
      io.disconnect();
    };
  }, [ref, outfitId, mode, position, dwell]);
}
