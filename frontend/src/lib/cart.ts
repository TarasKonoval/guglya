import { useSyncExternalStore } from "react";
import { api, track, type Product, type Slot } from "./api";

export type CartItem = Product & { outfit_id: string | null; slot: Slot | null };

/** The signed-in user's cart, shared by the header badge, item cards and the cart page. */
let items: CartItem[] = [];
const listeners = new Set<() => void>();
const set = (next: CartItem[]) => {
  items = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Called by App whenever the signed-in user changes. */
export function loadCart() {
  set([]);
  api<CartItem[]>("/cart").then(set).catch(() => {});
}

export async function addToCart(p: Product, outfitId?: string, slot?: Slot) {
  if (items.some((i) => i.id === p.id)) return;
  set([{ ...p, outfit_id: outfitId ?? null, slot: slot ?? null }, ...items]);
  track("cart_add", { product_id: p.id, outfit_id: outfitId }, { slot: slot ?? null });
  await api("/cart", { method: "POST", body: JSON.stringify({ product_id: p.id, outfit_id: outfitId, slot }) }).catch(() => {});
}

export async function removeFromCart(id: string) {
  const gone = items.find((i) => i.id === id);
  set(items.filter((i) => i.id !== id));
  track("cart_remove", { product_id: id, outfit_id: gone?.outfit_id ?? undefined }, { slot: gone?.slot ?? null });
  await api(`/cart/${id}`, { method: "DELETE" }).catch(() => {});
}

export function useCart() {
  return useSyncExternalStore(subscribe, () => items);
}
