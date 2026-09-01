import { useMemo, useState } from "react";
import type { ShoePreference } from "../api";
import { resolveShoeImage } from "../config/shoeImages";
import EmptyState from "./EmptyState";
import { parseStravaLocalDate } from "../utils/dateBuckets";

type Shoe = {
  id?: string | null;
  name?: string | null;
  distance?: number | null;
  converted_distance?: number | null;
};

type Activity = {
  sport_type: string;
  distance: number;
  start_date_local: string;
  gear_id?: string | null;
};

type BrandKey =
  | "nike" | "adidas" | "hoka" | "asics" | "new_balance" | "on"
  | "saucony" | "brooks" | "salomon" | "puma" | "mizuno" | "altra" | "other";
type WearLevel = "fresh" | "normal" | "warning" | "critical";
type SortMode = "wear" | "recent" | "distance";

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const DEFAULT_RETIREMENT_KM = 800;
const round1 = (value: number) => Math.round(value * 10) / 10;

function kmFromShoe(shoe: Shoe): number {
  if (typeof shoe.distance === "number" && shoe.distance > 0) return shoe.distance / 1000;
  if (typeof shoe.converted_distance === "number" && shoe.converted_distance > 0) {
    return shoe.converted_distance;
  }
  return 0;
}

const BRAND_KEYS: BrandKey[] = [
  "nike", "adidas", "hoka", "asics", "new_balance", "on",
  "saucony", "brooks", "salomon", "puma", "mizuno", "altra", "other",
];

function isBrandKey(value: string | null | undefined): value is BrandKey {
  return typeof value === "string" && (BRAND_KEYS as string[]).includes(value);
}

function detectBrand(name?: string | null): BrandKey {
  const value = (name ?? "").toLowerCase();
  if (value.includes("nike")) return "nike";
  if (value.includes("adidas")) return "adidas";
  if (value.includes("hoka")) return "hoka";
  if (value.includes("asics")) return "asics";
  if (value.includes("new balance") || value.includes("newbalance")) return "new_balance";
  if (value.includes(" on ") || value.startsWith("on ") || value.includes(" cloud")) return "on";
  if (value.includes("saucony")) return "saucony";
  if (value.includes("brooks")) return "brooks";
  if (value.includes("salomon")) return "salomon";
  if (value.includes("puma")) return "puma";
  if (value.includes("mizuno")) return "mizuno";
  if (value.includes("altra")) return "altra";
  return "other";
}

function brandLabel(brand: BrandKey): string {
  if (brand === "new_balance") return "New Balance";
  if (brand === "other") return "Marque inconnue";
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

function brandMark(brand: BrandKey): string {
  const marks: Record<BrandKey, string> = {
    nike: "N", adidas: "A", hoka: "H", asics: "AS", new_balance: "NB",
    on: "ON", saucony: "S", brooks: "B", salomon: "SL", puma: "P",
    mizuno: "M", altra: "A", other: "👟",
  };
  return marks[brand];
}

function wearLevel(percent: number): WearLevel {
  if (percent >= 100) return "critical";
  if (percent >= 75) return "warning";
  if (percent >= 50) return "normal";
  return "fresh";
}

function wearLabel(level: WearLevel): string {
  if (level === "critical") return "Seuil atteint";
  if (level === "warning") return "Fin de vie à surveiller";
  if (level === "normal") return "Usure intermédiaire";
  return "Début de vie";
}

function validDate(value: string): Date | null {
  return parseStravaLocalDate(value);
}

function formatLastUsed(value: Date | null): string {
  if (!value) return "non détectée sur 12 mois";
  return value.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

function replacementDate(kmRemaining: number, weeklyKm: number, nowMs: number): string | null {
  if (kmRemaining <= 0 || weeklyKm <= 0) return null;
  const weeks = kmRemaining / weeklyKm;
  if (weeks > 104) return "dans plus de 2 ans";
  const date = new Date(nowMs);
  date.setDate(date.getDate() + Math.round(weeks * 7));
  return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function ShoeBrandEditor({
  gearId,
  brand,
  saving,
  onSave,
}: {
  gearId: string;
  brand: BrandKey;
  saving: boolean;
  onSave: (gearId: string, brand: string | null) => void;
}) {
  return (
    <div className="shoe-brand-editor">
      <label>
        Marque
        <select
          value={brand}
          disabled={saving}
          onChange={(event) => onSave(gearId, event.target.value === "other" ? null : event.target.value)}
        >
          {BRAND_KEYS.map((key) => (
            <option key={key} value={key}>
              {brandLabel(key)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function ShoeThresholdEditor({
  gearId,
  retirementKm,
  saving,
  onSave,
}: {
  gearId: string;
  retirementKm: number;
  saving: boolean;
  onSave: (gearId: string, retirementKm: number) => void;
}) {
  const [draft, setDraft] = useState(String(retirementKm));
  const parsed = Number(draft);
  const changed = Number.isFinite(parsed) && parsed !== retirementKm;

  return (
    <div className="shoe-threshold-editor">
      <label>
        Seuil personnel
        <span>
          <input
            type="number"
            min="300"
            max="1500"
            step="25"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          /> km
        </span>
      </label>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={saving || !changed || parsed < 300 || parsed > 1500}
        onClick={() => onSave(gearId, parsed)}
      >
        Appliquer
      </button>
    </div>
  );
}

export default function ShoeUsageCard({
  shoes,
  rows,
  preferences,
  saving,
  onRetirementKmChange,
  onBrandChange,
}: {
  shoes: Shoe[];
  rows: Activity[];
  preferences: ShoePreference[];
  saving: boolean;
  onRetirementKmChange: (gearId: string, retirementKm: number) => void;
  onBrandChange: (gearId: string, brand: string | null) => void;
}) {
  const [sortMode, setSortMode] = useState<SortMode>("wear");
  const [nowMs] = useState(() => Date.now());
  const preferenceById = useMemo(
    () => new Map(preferences.map((preference) => [preference.gearId, preference.retirementKm])),
    [preferences]
  );
  const brandById = useMemo(
    () => new Map(preferences.map((preference) => [preference.gearId, preference.brand ?? null])),
    [preferences]
  );

  const prepared = useMemo(() => {
    const cutoff = nowMs - 28 * 24 * 60 * 60 * 1000;
    const result = shoes
      .map((shoe) => {
        const km = kmFromShoe(shoe);
        const retirementKm = shoe.id
          ? preferenceById.get(shoe.id) ?? DEFAULT_RETIREMENT_KM
          : DEFAULT_RETIREMENT_KM;
        const matchingRuns = rows
          .filter((activity) =>
            RUN_TYPES.has(activity.sport_type) &&
            Boolean(shoe.id) &&
            activity.gear_id === shoe.id
          )
          .map((activity) => ({ ...activity, date: validDate(activity.start_date_local) }))
          .filter((activity) => activity.date != null);
        const recentRuns = matchingRuns.filter((activity) => activity.date!.getTime() >= cutoff);
        const km28 = recentRuns.reduce((sum, activity) => sum + activity.distance / 1000, 0);
        const weeklyKm = km28 / 4;
        const lastUsed = matchingRuns.reduce<Date | null>(
          (latest, activity) => !latest || activity.date! > latest ? activity.date : latest,
          null
        );
        const percent = retirementKm > 0 ? Math.round((km / retirementKm) * 100) : 0;
        const remainingKm = Math.max(0, retirementKm - km);
        const savedBrand = shoe.id ? brandById.get(shoe.id) : null;
        const brand = isBrandKey(savedBrand) ? savedBrand : detectBrand(shoe.name);

        return {
          ...shoe,
          km,
          retirementKm,
          percent,
          remainingKm,
          wear: wearLevel(percent),
          brand,
          imageUrl: resolveShoeImage(shoe),
          km28: round1(km28),
          weeklyKm: round1(weeklyKm),
          runCount28: recentRuns.length,
          lastUsed,
          eta: replacementDate(remainingKm, weeklyKm, nowMs),
        };
      })
      .filter((shoe) => shoe.km > 0 || Boolean(shoe.name?.trim()));

    result.sort((a, b) => {
      if (sortMode === "recent") return (b.lastUsed?.getTime() ?? 0) - (a.lastUsed?.getTime() ?? 0);
      if (sortMode === "distance") return b.km - a.km;
      return b.percent - a.percent;
    });
    return result;
  }, [brandById, nowMs, preferenceById, rows, shoes, sortMode]);

  if (prepared.length === 0) {
    return (
      <div className="shoes-card">
        <div className="panel-head">Chaussures</div>
        <EmptyState
          icon="👟"
          title="Aucune chaussure"
          message="Aucune chaussure trouvée dans le profil Strava."
        />
      </div>
    );
  }

  return (
    <div className="shoes-card">
      <div className="shoes-head">
        <div>
          <div className="panel-head">Chaussures</div>
          <p className="shoes-intro">
            Usure calculée par paire avec le kilométrage Strava et son rythme réel sur 28 jours.
          </p>
        </div>
        <div className="shoes-sort" aria-label="Trier les chaussures">
          {(["wear", "recent", "distance"] as const).map((value) => (
            <button
              type="button"
              className={`shoes-sort-btn ${sortMode === value ? "shoes-sort-btn-active" : ""}`}
              onClick={() => setSortMode(value)}
              key={value}
            >
              {value === "wear" ? "Usure" : value === "recent" ? "Récentes" : "Km"}
            </button>
          ))}
        </div>
      </div>

      <div className="shoes-list shoes-list-detailed">
        {prepared.map((shoe, index) => {
          return (
            <article key={shoe.id ?? `${shoe.name}-${index}`} className={`shoe-item shoe-item-${shoe.wear}`}>
              <div className="shoe-main-row">
                <div className="shoe-left">
                  {shoe.imageUrl ? (
                    <img className="shoe-photo" src={shoe.imageUrl} alt={shoe.name?.trim() || "Chaussure"} loading="lazy" />
                  ) : (
                    <span className={`shoe-brand-logo shoe-brand-${shoe.brand}`} aria-hidden>
                      {brandMark(shoe.brand)}
                    </span>
                  )}
                  <div>
                    <div className="shoe-name">{shoe.name?.trim() || "Modèle inconnu"}</div>
                    <div className="shoe-sub">{brandLabel(shoe.brand)} • dernière sortie {formatLastUsed(shoe.lastUsed)}</div>
                  </div>
                </div>
                <div className={`shoe-health shoe-health-${shoe.wear}`}>
                  <strong>{shoe.percent}%</strong>
                  <span>{wearLabel(shoe.wear)}</span>
                </div>
              </div>

              <div
                className="shoe-life-bar"
                role="progressbar"
                aria-label={`Usure estimée de ${shoe.name ?? "la chaussure"}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(shoe.percent, 100)}
              >
                <span className={`shoe-life-fill shoe-life-fill-${shoe.wear}`} style={{ width: `${Math.min(shoe.percent, 100)}%` }} />
              </div>

              <div className="shoe-metrics-grid">
                <div><span>Total Strava</span><strong>{round1(shoe.km).toFixed(1)} km</strong></div>
                <div><span>28 derniers jours</span><strong>{shoe.km28.toFixed(1)} km</strong></div>
                <div><span>Rythme de la paire</span><strong>{shoe.weeklyKm.toFixed(1)} km/sem.</strong></div>
                <div><span>Avant le seuil</span><strong>{shoe.remainingKm > 0 ? `${round1(shoe.remainingKm)} km` : "Dépassé"}</strong></div>
              </div>

              <div className="shoe-projection">
                {shoe.wear === "critical"
                  ? "Seuil kilométrique atteint : contrôle visuel et sensations indispensables."
                  : shoe.eta
                  ? `Au rythme de cette paire : seuil estimé vers ${shoe.eta}.`
                  : shoe.runCount28 > 0
                  ? "Rythme récent trop faible pour une date fiable."
                  : "Aucune sortie associée à cette paire sur les 28 derniers jours."}
              </div>

              {shoe.id && (
                <div className="shoe-editors">
                  <ShoeThresholdEditor
                    key={`${shoe.id}-${shoe.retirementKm}`}
                    gearId={shoe.id}
                    retirementKm={shoe.retirementKm}
                    saving={saving}
                    onSave={onRetirementKmChange}
                  />
                  <ShoeBrandEditor
                    key={`${shoe.id}-${shoe.brand}-brand`}
                    gearId={shoe.id}
                    brand={shoe.brand}
                    saving={saving}
                    onSave={onBrandChange}
                  />
                </div>
              )}

              <details className="shoe-checklist">
                <summary>Contrôle physique de la paire</summary>
                <ul>
                  <li>Semelle extérieure lisse ou usée de façon asymétrique.</li>
                  <li>Mousse tassée, plis profonds ou amorti devenu nettement plus ferme.</li>
                  <li>Nouvelle gêne ou perte de stabilité sans changement d’entraînement.</li>
                </ul>
              </details>
            </article>
          );
        })}
      </div>

      <p className="shoes-disclaimer">
        Le seuil kilométrique est une aide, pas un diagnostic : terrain, modèle, rotation et sensations modifient la durée de vie réelle.
      </p>
    </div>
  );
}
