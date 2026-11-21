export type ShoeImageInput = {
  id?: string | null;
  name?: string | null;
};

// Ajoute ici tes photos (URL publique ou chemin local dans /public).
// Priorité: mapping par ID (le plus fiable), puis par nom de modèle.
const SHOE_IMAGE_BY_ID: Record<string, string> = {
  // "g1234567": "/shoes/nike-pegasus-41.jpg",
};

const SHOE_IMAGE_BY_NAME: Array<{ match: string; imageUrl: string }> = [
  // { match: "pegasus", imageUrl: "/shoes/nike-pegasus-41.jpg" },
  // { match: "cloudmonster", imageUrl: "/shoes/on-cloudmonster.jpg" },
];

export function resolveShoeImage(shoe: ShoeImageInput): string | null {
  const id = (shoe.id ?? "").trim();
  if (id && SHOE_IMAGE_BY_ID[id]) {
    return SHOE_IMAGE_BY_ID[id];
  }

  const name = (shoe.name ?? "").toLowerCase();
  if (!name) return null;

  for (const rule of SHOE_IMAGE_BY_NAME) {
    if (name.includes(rule.match.toLowerCase())) {
      return rule.imageUrl;
    }
  }

  return null;
}
