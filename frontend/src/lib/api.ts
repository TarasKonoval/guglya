import { fetchAuthSession } from "aws-amplify/auth";

const API = import.meta.env.VITE_API_URL;

async function authHeaders(): Promise<Record<string, string>> {
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

export type Slot = "hat" | "top" | "bottom" | "shoes";
export const SLOTS: Slot[] = ["hat", "top", "bottom", "shoes"];

export type Product = {
  id: string;
  title: string;
  brand: string;
  category: Slot;
  color: string | null;
  price_uah: number;
  image_url: string;
  product_url: string;
  similarity?: number;
};

export type OutfitSummary = { id: string; title: string; season: string; cover_image_url: string };
export type Outfit = OutfitSummary & { items: Partial<Record<Slot, Product>> };

export const DONATE_URL: string = import.meta.env.VITE_DONATE_URL ?? "";

export const formatUah = (n: number) => `${n.toLocaleString("uk-UA")} ₴`;

/** Log the click, then send the user to the brand page (window opened synchronously to dodge popup blockers). */
export async function openProduct(p: Product, outfitId?: string, slot?: Slot) {
  const win = window.open("", "_blank");
  try {
    const { url } = await api<{ url: string }>("/clicks", {
      method: "POST",
      body: JSON.stringify({ product_id: p.id, outfit_id: outfitId, slot }),
    });
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else window.location.href = url;
  } catch {
    if (win) win.location.href = p.product_url;
  }
}
