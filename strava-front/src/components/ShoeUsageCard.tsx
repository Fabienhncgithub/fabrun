import { useMemo, useState } from "react";
import { resolveShoeImage } from "../config/shoeImages";

type Shoe = {
  id?: string | null;
  name?: string | null;
  distance?: number | null; // meters
  converted_distance?: number | null; // optional, from Strava
};

type BrandKey =
  | "nike"
  | "adidas"
  | "hoka"
  | "asics"
  | "new_balance"
  | "on"
  | "saucony"
  | "brooks"
  | "salomon"
  | "puma"
  | "mizuno"
  | "altra"
  | "other";

const round1 = (v: number) => Math.round(v * 10) / 10;
const RED_WEAR_KM = 800;
const ORANGE_WEAR_KM = 400;

function kmFromShoe(shoe: Shoe): number {
  if (typeof shoe.distance === "number" && shoe.distance > 0) {
    return shoe.distance / 1000;
  }
  if (
    typeof shoe.converted_distance === "number" &&
    shoe.converted_distance > 0
  ) {
    return shoe.converted_distance;
  }
  return 0;
}

function detectBrand(name?: string | null): BrandKey {
  const n = (name ?? "").toLowerCase();
  if (n.includes("nike")) return "nike";
  if (n.includes("adidas")) return "adidas";
  if (n.includes("hoka")) return "hoka";
  if (n.includes("asics")) return "asics";
  if (n.includes("new balance") || n.includes("newbalance"))
    return "new_balance";
  if (n.includes(" on ") || n.startsWith("on ") || n.includes(" cloud"))
    return "on";
  if (n.includes("saucony")) return "saucony";
  if (n.includes("brooks")) return "brooks";
  if (n.includes("salomon")) return "salomon";
  if (n.includes("puma")) return "puma";
  if (n.includes("mizuno")) return "mizuno";
  if (n.includes("altra")) return "altra";
  return "other";
}

function brandLabel(brand: BrandKey): string {
  if (brand === "new_balance") return "New Balance";
  if (brand === "other") return "Marque inconnue";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function brandMark(brand: BrandKey): string {
  switch (brand) {
    case "nike":
      return "N";
    case "adidas":
      return "A";
    case "hoka":
      return "H";
    case "asics":
      return "AS";
    case "new_balance":
      return "NB";
    case "on":
      return "ON";
    case "saucony":
      return "S";
    case "brooks":
      return "B";
    case "salomon":
      return "SL";
    case "puma":
      return "P";
    case "mizuno":
      return "M";
    case "altra":
      return "A";
    default:
      return "👟";
  }
}

type WearLevel = "green" | "orange" | "red";

function wearLevel(km: number): WearLevel {
  if (km >= RED_WEAR_KM) return "red";
  if (km >= ORANGE_WEAR_KM) return "orange";
  return "green";
}

function wearLabel(level: WearLevel): string {
  if (level === "red") return "Usure élevée";
  if (level === "orange") return "Usure modérée";
  return "Usure faible";
}

export default function ShoeUsageCard({ shoes }: { shoes: Shoe[] }) {
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const sorted = useMemo(() => {
    const prepared = [...(shoes ?? [])]
      .map((s) => {
        const km = kmFromShoe(s);
        return {
          ...s,
          km,
          brand: detectBrand(s.name),
          imageUrl: resolveShoeImage(s),
          wear: wearLevel(km),
        };
      })
      .filter((s) => s.km > 0 || (s.name && s.name.trim().length > 0));

    prepared.sort((a, b) => {
      const kmDiff = sortOrder === "desc" ? b.km - a.km : a.km - b.km;
      if (Math.abs(kmDiff) > 0.0001) return kmDiff;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return prepared;
  }, [shoes, sortOrder]);

  if (sorted.length === 0) {
    return (
      <div className="shoes-card">
        <div className="panel-head">Gears</div>
        <p className="shoes-empty">
          Aucune chaussure trouvée dans le profil Strava.
        </p>
      </div>
    );
  }

  return (
    <div className="shoes-card">
      <div className="shoes-head">
        <div className="panel-head">Gears</div>
        <div className="shoes-sort">
          <button
            type="button"
            className={`shoes-sort-btn ${sortOrder === "desc" ? "shoes-sort-btn-active" : ""}`}
            onClick={() => setSortOrder("desc")}
          >
            Km ↓
          </button>
          <button
            type="button"
            className={`shoes-sort-btn ${sortOrder === "asc" ? "shoes-sort-btn-active" : ""}`}
            onClick={() => setSortOrder("asc")}
          >
            Km ↑
          </button>
        </div>
      </div>
      <div className="shoes-list">
        {sorted.map((shoe, idx) => (
          <article key={shoe.id ?? `${shoe.name}-${idx}`} className="shoe-item">
            <div className="shoe-left">
              {shoe.imageUrl ? (
                <img
                  className="shoe-photo"
                  src={shoe.imageUrl}
                  alt={shoe.name?.trim() || "Chaussure"}
                  loading="lazy"
                />
              ) : (
                <span
                  className={`shoe-brand-logo shoe-brand-${shoe.brand}`}
                  aria-hidden
                >
                  {brandMark(shoe.brand)}
                </span>
              )}
              <div>
                <div className="shoe-name">
                  {shoe.name?.trim() || "Modèle inconnu"}
                </div>
                <div className="shoe-sub">
                  {brandLabel(shoe.brand)}
                  {shoe.id ? ` • ID: ${shoe.id}` : ""}
                </div>
              </div>
            </div>
            <div className="shoe-km-block">
              <div className={`shoe-km shoe-km-${shoe.wear}`}>
                {round1(shoe.km).toFixed(1)} km
              </div>
              <div className={`shoe-wear shoe-wear-${shoe.wear}`}>
                {wearLabel(shoe.wear)}
                {shoe.km >= RED_WEAR_KM ? " • à remplacer" : ""}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
