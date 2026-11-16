import { useCallback, useEffect, useState } from "react";
import { api, type OutfitSummary } from "./api";

/** Ids of the signed-in user's saved outfits, with an optimistic toggle. */
export function useSaved() {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    api<OutfitSummary[]>("/saved")
      .then((rows) => setSaved(new Set(rows.map((r) => r.id))))
      .catch(() => {});
  }, []);

  const toggle = useCallback(
    async (id: string) => {
      const on = !saved.has(id);
      setSaved((s) => {
        const n = new Set(s);
        if (on) n.add(id);
        else n.delete(id);
        return n;
      });
      await api(`/saved/${id}`, { method: on ? "POST" : "DELETE" }).catch(() => {});
    },
    [saved],
  );

  return { saved, toggle };
}
