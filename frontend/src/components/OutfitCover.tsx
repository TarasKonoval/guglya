import { img, type OutfitSummary } from "../lib/api";

/** Outfit cover photo, or a flat-lay collage of its items when there is none (couples: two looks side by side). */
export default function OutfitCover({ outfit, eager = false }: { outfit: OutfitSummary; eager?: boolean }) {
  if (outfit.cover_image_url)
    return <img className="cover" src={img(outfit.cover_image_url)} alt={outfit.title} loading={eager ? "eager" : "lazy"} />;
  if (outfit.items.some((i) => i.person === 2))
    return (
      <div className="cover collage pair" aria-label={outfit.title}>
        {([1, 2] as const).map((n) => (
          <div key={n} className="collage-look">
            {outfit.items.filter((i) => i.person === n).map((i) => <img key={i.slot} src={img(i.image_url)} alt="" loading="lazy" />)}
          </div>
        ))}
      </div>
    );
  return (
    <div className="cover collage" aria-label={outfit.title}>
      {outfit.items.slice(0, 4).map((i) => <img key={i.slot} src={img(i.image_url)} alt="" loading="lazy" />)}
    </div>
  );
}
