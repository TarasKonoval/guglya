import { fetchAuthSession } from "aws-amplify/auth";

const API = import.meta.env.VITE_API_URL;
// Catalog images are site-relative (/img/...). In local dev point this at the CloudFront URL.
const ASSET_BASE = import.meta.env.VITE_ASSET_BASE_URL ?? "";
export const DONATE_URL: string = import.meta.env.VITE_DONATE_URL ?? "";

export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const token = (await fetchAuthSession()).tokens?.idToken?.toString();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...init.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type Slot = "hat" | "outer" | "top" | "dress" | "bottom" | "shoes";
export const SLOTS: Slot[] = ["hat", "outer", "top", "dress", "bottom", "shoes"];
export const SLOT_LABELS: Record<Slot, string> = {
  hat: "Шапка", outer: "Верхній одяг", top: "Кофта / сорочка", dress: "Сукня / костюм", bottom: "Низ", shoes: "Взуття",
};
/** "dress" is a suit for men and a dress or set for women */
export function slotLabel(slot: Slot, gender?: string) {
  if (slot === "dress" && gender === "men") return "Костюм";
  if (slot === "dress" && gender === "women") return "Сукня / комплект";
  return SLOT_LABELS[slot];
}

export type Product = {
  id: string;
  title: string;
  brand: string;
  category: Slot;
  color: string | null;
  price_uah: number;
  image_url: string;
  product_url: string;
  is_demo: boolean;
  price_diff?: number;
  similarity?: number;
};

export type OutfitSummary = {
  id: string;
  title: string;
  season: string;
  gender: "women" | "men" | "unisex" | "couple";
  style_tag: string | null;
  cover_image_url: string | null;
  item_count: number;
  total_uah: number;
  colors: string[];
  popularity: number;
  items: { person: Person; slot: Slot; image_url: string; brand: string; price_uah: number }[];
};
/** 1 for a regular outfit; a couple outfit has looks for person 1 and 2. */
export type Person = 1 | 2;
export type Look = { person: Person; products: Partial<Record<Slot, Product>> };
export type Outfit = OutfitSummary & { looks: Look[] };

export type EventType = "outfit_view" | "swap" | "donate_click" | "feedback_open";

/** Fire-and-forget analytics event (evidence for the report). */
export function track(type: EventType, ids: { outfit_id?: string; product_id?: string } = {}) {
  api("/events", { method: "POST", body: JSON.stringify({ type, ...ids }) }).catch(() => {});
}

export const img = (url: string) => (url.startsWith("/") ? ASSET_BASE + url : url);

/** Normalised product colours (products.color) → [label, swatch]. */
export const COLORS: Record<string, [string, string]> = {
  black: ["Чорний", "#262423"], white: ["Білий", "#ece8e0"], grey: ["Сірий", "#8c8c8a"],
  beige: ["Беж", "#d6c0a0"], brown: ["Коричневий", "#7a5236"], blue: ["Синій", "#344a78"],
  green: ["Зелений", "#4e6648"], red: ["Червоний", "#a0342e"], burgundy: ["Бордо", "#681e2c"],
  pink: ["Рожевий", "#e3a6b4"], purple: ["Фіолетовий", "#7a5c9a"], yellow: ["Жовтий", "#e2c04e"],
  orange: ["Помаранчевий", "#d9773a"],
};

const nf = new Intl.NumberFormat("uk-UA");
export const formatUah = (n: number) => `${nf.format(n)} ₴`;
export const formatDiff = (n: number) => (n === 0 ? "та сама ціна" : `${n < 0 ? "−" : "+"}${nf.format(Math.abs(n))} ₴`);

export function things(n: number) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} річ`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} речі`;
  return `${n} речей`;
}

/** Log the click, then open the brand page in a new tab (window opened synchronously to dodge popup blockers). */
export async function openProduct(p: Product, outfitId?: string, slot?: Slot) {
  const win = window.open("", "_blank");
  let url = p.product_url;
  try {
    url = (
      await api<{ url: string }>("/clicks", {
        method: "POST",
        body: JSON.stringify({ product_id: p.id, outfit_id: outfitId, slot }),
      })
    ).url;
  } catch {
    /* still send the user on */
  }
  if (win) {
    win.opener = null;
    win.location.href = url;
  } else window.location.href = url;
}

export function donate() {
  track("donate_click");
  window.open(DONATE_URL, "_blank", "noopener");
}
