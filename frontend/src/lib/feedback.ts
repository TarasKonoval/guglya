// Once per user, after the 2nd brand click or the 3rd outfit view, ask for feedback automatically.
type Listener = () => void;
let listener: Listener | null = null;
let userKey = "";
let prompted = true; // until /me says otherwise
export let currentOutfitId: string | undefined;

function counts(): { clicks: number; views: number } {
  try {
    return JSON.parse(localStorage.getItem(userKey) ?? "") ?? { clicks: 0, views: 0 };
  } catch {
    return { clicks: 0, views: 0 };
  }
}

export function initFeedbackPrompt(userId: string, alreadyPrompted: boolean, onPrompt: Listener) {
  userKey = `guglya-fb-${userId}`;
  prompted = alreadyPrompted;
  listener = onPrompt;
}

export function markPrompted() {
  prompted = true;
}

export function setCurrentOutfit(id: string | undefined) {
  currentOutfitId = id;
}

export function bump(kind: "clicks" | "views") {
  const c = counts();
  c[kind] += 1;
  try {
    localStorage.setItem(userKey, JSON.stringify(c));
  } catch {
    /* private mode */
  }
  if (!prompted && (c.clicks >= 2 || c.views >= 3)) {
    prompted = true;
    // let the brand tab open first
    setTimeout(() => listener?.(), kind === "clicks" ? 1200 : 400);
  }
}
