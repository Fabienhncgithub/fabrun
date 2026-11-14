import { fetchGarminActivities, type GarminActivityBatch } from "../api";
import { matchGarminActivities } from "../utils/garminActivityMatch";
import { useMemo, useState } from "react";
import { activeCalories, type CalorieProfile } from "../utils/activityEnergy";
import { downloadTextFile } from "../utils/workoutExport";
import { parseStravaLocalDate } from "../utils/dateBuckets";

type Activity = {
  id: number;
  name: string;
  sport_type: string;
  distance: number; // m
  moving_time: number; // s
  total_elevation_gain?: number; // m
  start_date_local: string;
  average_speed?: number; // m/s
  average_heartrate?: number | null;
  calories?: number;
  kilojoules?: number;
  gear_id?: string | null;
};

type Shoe = { id?: string | null; name?: string | null };

const PAGE_SIZE = 20;

const fmtKm = (m: number) => (m / 1000).toFixed(2);
const fmtPace = (v?: number) => {
  if (!v || v <= 0) return "-";
  const secPerKm = Math.round(1000 / v);
  const m = Math.floor(secPerKm / 60),
    s = secPerKm % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

const kcalText = (value: number) => Math.round(value).toLocaleString("fr-FR");

const fmtCalories = (activity: Activity, athleteWeightKg?: number, calorieProfile?: CalorieProfile) => {
  const energy = activeCalories(activity, athleteWeightKg, calorieProfile);
  if (!energy) return "-";
  return `${energy.estimated ? "~" : ""}${kcalText(energy.value)}`;
};

type SportVisual = {
  icon: string;
  className: string;
};

const SPORT_VISUALS: Record<string, SportVisual> = {
  Run: { icon: "🏃", className: "sport-run" },
  TrailRun: { icon: "🏃", className: "sport-run" },
  VirtualRun: { icon: "🏃", className: "sport-run" },
  AlpineSki: { icon: "⛷", className: "sport-ski" },
  WeightTraining: { icon: "🏋", className: "sport-strength" },
  Ride: { icon: "🚴", className: "sport-bike" },
  Walk: { icon: "🚶", className: "sport-walk" },
  Hike: { icon: "🥾", className: "sport-hike" },
};

const getSportVisual = (sportType: string): SportVisual =>
  SPORT_VISUALS[sportType] ?? { icon: "🏅", className: "sport-other" };

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h${minutes.toString().padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const date = parseStravaLocalDate(value);
  return date ? date.toLocaleDateString("fr-FR") : "—";
}

function csvCell(value: string | number): string {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

export default function ActivitiesTable({
  rows,
  athleteWeightKg,
  calorieProfile,
  shoes,
}: {
  rows: Activity[];
  athleteWeightKg?: number;
  calorieProfile?: CalorieProfile;
  shoes: Shoe[];
}) {
  const [garmin, setGarmin] = useState<GarminActivityBatch | null>(null);
  const [garminLoading, setGarminLoading] = useState(false);
  const [garminError, setGarminError] = useState("");
  const matches = useMemo(() => matchGarminActivities(rows, garmin?.activities ?? []), [rows, garmin]);
  async function loadGarmin() {
    setGarminLoading(true); setGarminError("");
    try { setGarmin(await fetchGarminActivities()); }
    catch (e) { setGarminError(e instanceof Error ? e.message : "Bilans Garmin indisponibles."); }
    finally { setGarminLoading(false); }
  }
  const [sportFilter, setSportFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const shoeNameById = useMemo(
    () => new Map(shoes.flatMap((shoe) => shoe.id ? [[shoe.id, shoe.name?.trim() || "Chaussure"] as const] : [])),
    [shoes]
  );

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (parseStravaLocalDate(b.start_date_local)?.getTime() ?? 0) -
          (parseStravaLocalDate(a.start_date_local)?.getTime() ?? 0)
      ),
    [rows]
  );

  const sportTypes = useMemo(
    () => Array.from(new Set(sorted.map((a) => a.sport_type))).sort(),
    [sorted]
  );

  const filtered = useMemo(
    () => {
      const query = searchQuery.trim().toLocaleLowerCase("fr-FR");
      return sorted.filter((activity) => {
        if (sportFilter !== "all" && activity.sport_type !== sportFilter) return false;
        if (!query) return true;
        const shoeName = activity.gear_id ? shoeNameById.get(activity.gear_id) ?? "" : "";
        return `${activity.name} ${activity.sport_type} ${shoeName}`
          .toLocaleLowerCase("fr-FR")
          .includes(query);
      });
    },
    [searchQuery, shoeNameById, sorted, sportFilter]
  );

  const visible = filtered.slice(0, visibleCount);

  return (
    <div>
      <div className="activities-table-toolbar">
        <button type="button" className="btn btn-secondary" disabled={garminLoading} onClick={loadGarmin}>
          {garminLoading ? "Chargement Garmin…" : garmin ? "Actualiser les bilans Garmin" : "Charger les bilans Garmin"}
        </button>
        <label className="activities-table-filter activities-table-search">
          Recherche
          <input
            type="search"
            value={searchQuery}
            placeholder="Nom ou chaussure…"
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          />
        </label>
        <label className="activities-table-filter">
          Type
          <select
            value={sportFilter}
            onChange={(event) => {
              setSportFilter(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="all">Tous</option>
            {sportTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
        <span className="activities-table-count">
          {visible.length} / {filtered.length} activité{filtered.length > 1 ? "s" : ""}
        </span>
        <button
          type="button"
          className="btn btn-secondary activities-export"
          disabled={filtered.length === 0}
          onClick={() => {
            const header = ["Date", "Nom", "Type", "Chaussure", "Distance km", "Allure", "Durée", "Calories"];
            const body = filtered.map((activity) => [
              formatDate(activity.start_date_local),
              activity.name,
              activity.sport_type,
              activity.gear_id ? shoeNameById.get(activity.gear_id) ?? "" : "",
              fmtKm(activity.distance),
              fmtPace(activity.average_speed),
              formatDuration(activity.moving_time),
              fmtCalories(activity, athleteWeightKg, calorieProfile),
            ]);
            const csv = `\uFEFF${[header, ...body].map((line) => line.map(csvCell).join(";")).join("\n")}`;
            downloadTextFile("fabrun-activites.csv", csv, "text/csv;charset=utf-8");
          }}
        >
          Exporter CSV
        </button>
      </div>

      {garminError && <p role="alert">{garminError}</p>}
      {garmin && <p className="garmin-activity-note">{matches.size} séances rapprochées sur {rows.length} activités · Garmin Connect · du {garmin.from} au {garmin.until}.
        {garmin.truncated && " Historique Garmin limité aux 1 089 dernières activités."}
        {" "}Une séance sans correspondance certaine reste sans bilan.</p>}
      <div className="activities-table-wrap">
        <table className="activities-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Nom</th>
              <th>Type</th>
              <th>Chaussure</th>
              <th className="num">Km</th>
              <th className="num">Allure</th>
              <th className="num">Temps</th>
              <th className="num">Calories(estimation)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const visual = getSportVisual(a.sport_type);
              return (
                <tr key={a.id}>
                  <td>{formatDate(a.start_date_local)}</td>
                  <td>
                    <a
                      className="activities-table-link"
                      href={`https://www.strava.com/activities/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {a.name}
                    </a>
                    {garmin && (matches.get(a.id) ? <GarminSessionSummary activity={matches.get(a.id)!} />
                      : <div className="garmin-activity-note">Aucun bilan Garmin associé</div>)}
                  </td>
                  <td className="type-cell">
                    <span className={`sport-badge ${visual.className}`}>
                      <span className="sport-icon" aria-hidden>
                        {visual.icon}
                      </span>
                      <span>{a.sport_type}</span>
                    </span>
                  </td>
                  <td>{a.gear_id ? shoeNameById.get(a.gear_id) ?? "—" : "—"}</td>
                  <td className="num">{fmtKm(a.distance)}</td>
                  <td className="num">{fmtPace(a.average_speed)}</td>
                  <td className="num">{formatDuration(a.moving_time)}</td>
                  <td className="num">{fmtCalories(a, athleteWeightKg, calorieProfile)}</td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="activities-table-empty">
                  Aucune activité pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {visibleCount < filtered.length && (
        <button
          type="button"
          className="btn btn-secondary activities-table-more"
          onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
        >
          Afficher plus ({filtered.length - visibleCount} restantes)
        </button>
      )}
    </div>
  );
}

function GarminSessionSummary({ activity }: { activity: import("../api").GarminActivity }) {
  const value = (n: number | null, unit = "") => n == null ? "Indisponible" : `${n.toLocaleString("fr-CH", { maximumFractionDigits: 1 })}${unit}`;
  return <details className="garmin-session-summary">
    <summary>Bilan Garmin · charge {value(activity.load)}</summary>
    <dl>
      <dt>Charge de séance</dt><dd>{value(activity.load)} — coût physiologique estimé par Garmin, à comparer à tes autres séances.</dd>
      <dt>Effet aérobie</dt><dd>{value(activity.aerobic, " / 5")} — effet sur ta capacité à soutenir un effort dans la durée.</dd>
      <dt>Effet anaérobie</dt><dd>{value(activity.anaerobic, " / 5")} — effet sur tes efforts courts et intenses.</dd>
    </dl>
    <a href={`https://connect.garmin.com/modern/activity/${activity.id}`} target="_blank" rel="noopener noreferrer">Voir la séance dans Garmin Connect</a>
    <p>Source : Garmin Connect. Rapprochement par sport, heure de départ, distance et durée.</p>
  </details>;
}
