import { img, type OutfitSummary } from "../lib/api";

/** Outfit cover photo, or a 2×2 flat-lay collage of its items when there is none. */
export default function OutfitCover({ outfit, eager = false }: { outfit: OutfitSummary; eager?: boolean }) {
  if (outfit.cover_image_url)
    return <img className="cover" src={img(outfit.cover_image_url)} alt={outfit.title} loading={eager ? "eager" : "lazy"} />;
  return (
    <div className="cover collage" aria-label={outfit.title}>
      {outfit.items.slice(0, 4).map((i) => <img key={i.slot} src={img(i.image_url)} alt="" loading="lazy" />)}
    </div>
  );
}
