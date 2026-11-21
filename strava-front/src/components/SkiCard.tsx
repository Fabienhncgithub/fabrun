import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchGarminSki, type GarminSkiBatch } from "../api";
import { skiSeasons, summarizeSki, type SkiSummary } from "../utils/ski";
import EmptyState from "./EmptyState";
import "../styles/kpis.scss";

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function SeasonSummary({ s, current = false, allTime = false }: { s: SkiSummary; current?: boolean; allTime?: boolean }) {
  const id = useId();
  return (
    <section className={`activity-period-card${current ? " activity-period-current" : ""}${allTime ? " activity-period-all" : ""}`} aria-labelledby={id}>
      <header className="activity-period-header">
        <h3 id={id}>{s.label}</h3>
        {current && <span>Dernière saison</span>}
      </header>
      <div className="activity-summary-content">
        <dl className="activity-summary-primary">
          <div><dt>Distance skiée</dt><dd>{decimal.format(s.km)} <span>km</span></dd></div>
          <div><dt>Journées de ski</dt><dd>{integer.format(s.days)}</dd></div>
        </dl>
        <dl className="activity-summary-metrics">
          <div><dt>Vitesse max</dt><dd>{s.maxKmh == null ? "—" : <>{decimal.format(s.maxKmh)} <span>km/h</span></>}</dd></div>
          <div><dt>Dénivelé négatif</dt><dd>{integer.format(s.descentM)} <span>m</span></dd></div>
          <div><dt>Plus grosse journée</dt><dd>{decimal.format(s.biggestDayKm)} <span>km</span></dd></div>
          <div><dt>Moyenne par journée</dt><dd>{s.days ? <>{decimal.format(s.km / s.days)} <span>km</span></> : "—"}</dd></div>
        </dl>
      </div>
    </section>
  );
}

// Loads only once the Progression page is opened, so Garmin is not queried on every app start.
export default function SkiCard({ active }: { active: boolean }) {
  const id = useId();
  const [data, setData] = useState<GarminSkiBatch | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const requested = useRef(false);

  async function load() {
    requested.current = true;
    setLoading(true); setError("");
    try { setData(await fetchGarminSki()); }
    catch (e) { setError(e instanceof Error ? e.message : "Données de ski Garmin indisponibles."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (active && !requested.current) void load(); }, [active]);

  const seasons = useMemo(() => skiSeasons(data?.days ?? []), [data]);
  const total = useMemo(() => summarizeSki("Depuis la première journée", data?.days ?? []), [data]);
  const firstDay = data?.days.length ? data.days.map((d) => d.startLocal).sort()[0] : null;
  const firstLabel = firstDay
    ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${firstDay.slice(0, 10)}T00:00:00Z`))
    : null;

  return (
    <section className="activity-summary" aria-labelledby={`${id}-title`}>
      <header className="activity-summary-header"><h2 id={`${id}-title`}>Bilan ski</h2></header>
      {error ? (
        <EmptyState title="Ski indisponible" message={error}
          action={<button type="button" className="btn btn-secondary" disabled={loading} onClick={load}>Réessayer</button>} />
      ) : !data ? (
        <p className="activity-summary-period">{loading ? "Chargement des journées de ski depuis Garmin…" : "Ouvre la page pour charger le ski."}</p>
      ) : data.days.length === 0 ? (
        <EmptyState title="Aucune journée de ski" message="Aucune activité de ski n’a été trouvée dans Garmin Connect." />
      ) : (
        <>
          <div className="activity-summary-years">
            {seasons.slice(0, 3).reverse().map((s, i, list) => <SeasonSummary key={s.label} s={s} current={i === list.length - 1} />)}
          </div>
          <SeasonSummary s={{ ...total, label: firstLabel ? `Depuis le ${firstLabel}` : total.label }} allTime />
          <details className="activity-summary-method">
            <summary>Comment ces chiffres sont-ils calculés ?</summary>
            <p>Les données viennent de Garmin Connect : ski en station, ski de randonnée, ski de fond et snowboard. Une saison va de juillet à juin.</p>
            <p>La distance est celle enregistrée par la montre. La vitesse max est la pointe mesurée par la montre sur la journée ; un point GPS aberrant peut la gonfler.</p>
            {data.truncated && <p>L’historique est très long : seules les 2 970 dernières activités Garmin ont été lues.</p>}
          </details>
        </>
      )}
    </section>
  );
}
