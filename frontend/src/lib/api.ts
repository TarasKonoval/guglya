import { supabase } from "./supabase";

const API = import.meta.env.VITE_API_URL;

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...init.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export type Product = {
  id: string;
  title: string;
  brand: string;
  category: "hat" | "top" | "bottom" | "shoes";
  color: string | null;
  price_uah: number;
  image_url: string;
  product_url: string;
};

export type OutfitSummary = { id: string; title: string; season: string; cover_image_url: string };
export type Outfit = OutfitSummary & { items: Record<string, Product> };
