import type { Readiness } from "../utils/readiness";
import type { GarminState } from "../utils/useGarmin";
import "../styles/coach.scss";

const LEVEL_LABEL = { green: "Feu vert", orange: "Orange", red: "Rouge", unknown: "Inconnu" } as const;

/** Morning traffic light: recovery signals and what they change for today's session. */
export default function ReadinessCard({ readiness, garmin }: { readiness: Readiness; garmin?: GarminState }) {
  const canSync = garmin?.configured && !readiness.fresh;
  return (
    <section className={`readiness readiness-${readiness.level}`} aria-label="Forme du jour">
      <div className="readiness-head">
        <span className="readiness-light" aria-hidden="true" />
        <div>
          <span className="coach-eyebrow">Forme du jour <span className="sr-only">: {LEVEL_LABEL[readiness.level]}</span></span>
          <strong>{readiness.title}</strong>
        </div>
        {garmin?.configured && (
          <button type="button" className="readiness-sync" disabled={garmin.loading} onClick={() => { void garmin.sync(); }}>
            {garmin.loading ? "Synchronisation…" : canSync ? "Synchroniser Garmin" : "Actualiser"}
          </button>
        )}
      </div>
      <p className="readiness-advice">
        {garmin && !garmin.configured && !garmin.loading
          ? "Garmin n’est pas connecté : le plan suit uniquement ta charge de course. Ajoute ta clé Garmin côté serveur pour tenir compte du sommeil et de la HRV."
          : readiness.advice}
      </p>
      {garmin?.error && <p className="readiness-error" role="alert">{garmin.error}</p>}
      <ul className="readiness-factors">
        {readiness.factors.map(factor => (
          <li key={factor.key} className={`readiness-factor readiness-factor-${factor.tone}`}>
            <span>{factor.label}</span>
            <strong>{factor.value}</strong>
            <small>{factor.note}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}
