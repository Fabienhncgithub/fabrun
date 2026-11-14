import { useId } from "react";
import "../styles/today.scss";
import "../styles/coach.scss";
import type { Coach } from "../utils/coach";
import { localDateKey } from "../utils/dateBuckets";
import { bestRunWindow, describeRunWindow } from "../utils/genevaWeather";
import { buildTcx, distanceBudgetSteps, downloadTextFile } from "../utils/workoutExport";

const formatKm = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Today's session in full: what to run, at which pace, when, and why. */
export default function NextSessionCard({ coach, embedded = false }: { coach: Coach; embedded?: boolean }) {
  const titleId = useId();
  const session = coach.today;
  if (!session || session.status !== "planned" || session.type === "rest") return null;

  const workout = session.workout;
  const minutes = workout?.estimatedMinutes ?? Math.round(session.km * 6.5);
  const window = bestRunWindow(coach.weather, localDateKey(session.date), minutes);
  const steps = workout?.steps ?? distanceBudgetSteps(session.title, session.km * 1000);
  const reasons = [
    ...(coach.race ? [`Objectif ${coach.race.goal.label} dans ${coach.race.daysToRace} jour${coach.race.daysToRace > 1 ? "s" : ""} · phase ${coach.race.phaseLabel.toLowerCase()}. ${coach.race.focus}`] : []),
    coach.readiness.advice,
    ...(coach.feedback.adjustmentReason ? [coach.feedback.adjustmentReason] : []),
    ...coach.plan.reasons.slice(coach.race ? 1 : 0, coach.race ? 3 : 2),
  ];

  return (
    <section className={`next-session-card next-session-refined${embedded ? " next-session-embedded" : ""}`} aria-labelledby={titleId}>
      <h4 className="next-session-type" id={titleId}>{session.title}</h4>
      <div className="next-session-plan">{session.details}</div>
      {session.adjustment && <p className="coach-adjustment">{session.adjustment}</p>}

      <dl className="coach-facts">
        {workout?.paceLabel && <div><dt>Allure cible</dt><dd>{workout.paceLabel}</dd></div>}
        <div><dt>Durée estimée</dt><dd>{minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`}</dd></div>
        {window && <div><dt>{window.dry ? "Meilleur créneau" : "Créneau le moins humide"}</dt><dd>{describeRunWindow(window)}</dd></div>}
      </dl>

      {workout && workout.lines.length > 1 && (
        <ol className="coach-steps">
          {workout.lines.map(line => <li key={line.label}><strong>{line.label}</strong><span>{line.text}</span></li>)}
        </ol>
      )}
      {!coach.paces && !session.race && (
        <p className="coach-note">Allures personnalisées indisponibles : il faut une estimation 5 km (page Objectifs) pour les calculer.</p>
      )}

      <details className="next-session-details">
        <summary>Pourquoi cette séance, et export pour la montre</summary>
        <ul className="next-session-why">
          {reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
        </ul>
        <div className="next-session-export">
          <button
            className="next-session-export-btn"
            type="button"
            onClick={() => downloadTextFile(`fabrun-${localDateKey(session.date)}.tcx`, buildTcx({
              fileName: `fabrun-${localDateKey(session.date)}.tcx`,
              workoutName: `FabRun ${session.title} ${formatKm(session.km)} km`,
              steps,
            }))}
          >
            Télécharger la séance (.tcx)
          </button>
          <div className="next-session-export-hint">Pour une montre ou une application compatible TCX. Les allures figurent dans le nom de chaque étape.</div>
        </div>
      </details>
    </section>
  );
}
