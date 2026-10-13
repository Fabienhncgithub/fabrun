import { computeTrainingLoad } from "../utils/trainingLoad";
import { localDateKey } from "../utils/dateBuckets";
import { buildNormalPlan, buildRehabPlan, type PlanActivity as Activity, type PlannedSession } from "../utils/weeklyPlan";
import "../styles/weeklyPlan.scss";
import { buildTcxMultiple, distanceBudgetSteps, downloadTextFile, type WorkoutExport } from "../utils/workoutExport";

type Predictions = { predictions?: Record<string, number> };
const DAY_LONG = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const kmFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const shortDateFormatter = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const fullDateFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const formatKm = (km: number) => kmFormatter.format(km);
const round1 = (value: number) => Math.round(value * 10) / 10;

function sessionToWorkout(session: PlannedSession): WorkoutExport | null {
  if (session.status !== "planned" || session.type === "rest" || session.km <= 0) return null;
  return {
    fileName: `fabrun-${localDateKey(session.date)}.tcx`,
    workoutName: `FabRun ${DAY_LONG[session.date.getDay()]} - ${session.title}`,
    steps: distanceBudgetSteps(session.title, session.km * 1000),
  };
}

function statusLabel(session: PlannedSession, hasShinPain: boolean) {
  if (session.status === "done") return session.type === "rest" ? "Passé" : "Importé";
  if (session.status === "missed") return "Non effectuée";
  return session.type === "rest" ? "Repos" : hasShinPain ? "Si indolore" : "Prévu";
}

export default function WeeklyTrainingPlanCard({
  rows,
  hasShinPain,
}: {
  rows: Activity[];
  predictions?: Predictions | null;
  hasShinPain: boolean;
}) {
  const now = new Date();
  const plan = hasShinPain ? buildRehabPlan(rows, now) : buildNormalPlan(rows, now);
  const load = computeTrainingLoad(rows, now);
  const weekWorkouts = plan.sessions
    .map(sessionToWorkout)
    .filter((workout): workout is WorkoutExport => workout !== null);
  const doneKm = round1(
    plan.sessions.filter((session) => session.status === "done" && session.type !== "rest")
      .reduce((sum, session) => sum + session.km, 0)
  );
  const plannedKm = round1(
    plan.sessions.filter((session) => session.status === "planned" && session.type !== "rest")
      .reduce((sum, session) => sum + session.km, 0)
  );
  const remainingKm = round1(Math.max(0, plan.targetKm - doneKm));
  const unplannedKm = round1(Math.max(0, remainingKm - plannedKm));
  const overrunKm = round1(Math.max(0, doneKm - plan.targetKm));
  const doneWidth = doneKm + plannedKm > 0 ? Math.min(100, doneKm / (doneKm + plannedKm) * 100) : 0;
  const plannedWidth = plannedKm > 0 ? 100 - doneWidth : 0;
  const plannedSessions = weekWorkouts.length;
  const plannedTotalKm = round1(doneKm + plannedKm);
  const targetLabel = "Total prévu";
  const progressionReferenceKm = load.weeklyRamp.capKm;
  const nextSession = plan.sessions.find((session) => session.status === "planned" && session.type !== "rest");
  const weekLabel = plan.sessions.length > 0
    ? `${shortDateFormatter.format(plan.sessions[0].date)} – ${shortDateFormatter.format(plan.sessions[6].date)}`
    : null;
  const restSummary = overrunKm > 0
    ? `Le repère est dépassé de ${formatKm(overrunKm)} km. Aucune course supplémentaire proposée.`
    : remainingKm <= 0.05
      ? "Le volume de référence est atteint. Place à la récupération."
      : "La charge actuelle ne permet pas de proposer une autre course cette semaine.";

  function sessionRow(session: PlannedSession) {
    const isRest = session.type === "rest";
    const isPast = session.status !== "planned" && !session.isToday;
    return (
      <>
        <time className="week-schedule-date" dateTime={localDateKey(session.date)} aria-label={fullDateFormatter.format(session.date)}>
          <span>{session.isToday ? "Aujourd’hui" : dayFormatter.format(session.date).replace(".", "")}</span>
          <strong>{shortDateFormatter.format(session.date)}</strong>
        </time>
        <div className="week-schedule-content">
          <strong>{isRest ? isPast ? "Journée sans course" : "Repos course" : session.title}</strong>
          <span className={`week-schedule-state week-schedule-state-${session.status}${isRest ? " week-schedule-state-rest" : ""}`}>
            {statusLabel(session, hasShinPain)}
          </span>
        </div>
        <span className="week-schedule-distance">
          {isRest ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 7v10M15 7v10" /><circle cx="12" cy="12" r="9" /></svg>
            : session.status === "missed" ? "—" : <>{formatKm(session.km)} <small>km</small></>}
        </span>
        {!isRest && <span className="week-schedule-expand" aria-hidden="true">⌄</span>}
      </>
    );
  }

  return (
    <section className={`weekly-plan-card weekly-plan-card-v2 ${hasShinPain ? "weekly-plan-card-rehab" : ""}`} aria-label="Plan de la semaine">
      <header className="week-plan-header">
        <div>
          <h2>Cette semaine</h2>
          <p>{weekLabel ? `${weekLabel} · ` : ""}{hasShinPain ? "Reprise prudente" : "Plan adaptatif"}</p>
        </div>
        {plan.sessions.length > 0 && (
          <div className="week-plan-reference">
            <span>{targetLabel}</span>
            <strong>{formatKm(plannedTotalKm)} <small>km</small></strong>
          </div>
        )}
      </header>

      {plan.sessions.length === 0 ? (
        <div className="week-plan-empty">
          <strong>Pas encore de plan à proposer</strong>
          <p>{plan.reasons[0]}</p>
          <p>Les sorties importées depuis Strava servent à adapter la semaine.</p>
        </div>
      ) : (
        <>
          <div className={`week-plan-next${hasShinPain ? " week-plan-next-prudent" : ""}${overrunKm > 0 ? " week-plan-next-warning" : ""}`}>
            <span className="week-plan-next-label">{nextSession ? "Prochaine séance proposée" : "Suite de la semaine"}</span>
            {nextSession ? (
              <>
                <div className="week-plan-next-main">
                  <strong>{nextSession.isToday ? "Aujourd’hui" : fullDateFormatter.format(nextSession.date)}</strong>
                  <span>{formatKm(nextSession.km)} km{hasShinPain ? " max." : ""}</span>
                </div>
                <p>{nextSession.title}{hasShinPain ? " · uniquement sans douleur" : ""}</p>
              </>
            ) : (
              <>
                <strong className="week-plan-rest-title">Repos course</strong>
                <p>{restSummary}</p>
              </>
            )}
          </div>

          <div className="week-plan-volume" aria-label="Volume de la semaine">
            <div className="week-plan-volume-values">
              <span><i className="week-plan-marker week-plan-marker-done" aria-hidden="true" />Réalisé <strong>{formatKm(doneKm)} km</strong></span>
              <span><i className="week-plan-marker week-plan-marker-planned" aria-hidden="true" />{hasShinPain ? "Proposé si indolore" : "À venir"} <strong>{formatKm(plannedKm)} km</strong></span>
            </div>
            <div
              className="week-plan-volume-track"
              role="progressbar"
              aria-label="Kilomètres réalisés cette semaine"
              aria-valuemin={0}
              aria-valuemax={Math.max(plannedTotalKm, 1)}
              aria-valuenow={doneKm}
              aria-valuetext={`${formatKm(doneKm)} kilomètres réalisés, ${formatKm(plannedKm)} proposés, total prévu de ${formatKm(plannedTotalKm)} kilomètres`}
            >
              <span className="week-plan-volume-done" style={{ width: `${doneWidth}%` }} />
              <span className="week-plan-volume-planned" style={{ width: `${plannedWidth}%` }} />
            </div>
            <p>{formatKm(doneKm)} km réalisés + {formatKm(plannedKm)} km proposés = <strong>{formatKm(plannedTotalKm)} km prévus</strong>.</p>
            <p className="week-plan-policy">
              {hasShinPain
                ? `Plafond de reprise : ${formatKm(plan.targetKm)} km · volume réduit de moitié, uniquement après disparition de la douleur.`
                : `Référence +10 % : ${formatKm(plan.targetKm)} km. ${unplannedKm >= 0.1 ? `${formatKm(unplannedKm)} km restent non programmés : les créneaux et les limites par séance ne permettent pas de les répartir.` : "Le volume restant est réparti sur les séances à venir."}`}
            </p>
          </div>

          <div className="week-schedule" aria-label="Calendrier de la semaine">
            {plan.sessions.map((session) => (
              <article
                key={localDateKey(session.date)}
                className={`week-schedule-entry weekly-plan-${session.type} weekly-plan-status-${session.status}${session.isToday ? " week-schedule-today" : ""}`}
              >
                {session.type === "rest" ? (
                  <div className="week-schedule-row">{sessionRow(session)}</div>
                ) : (
                  <details className="week-schedule-details">
                    <summary className="week-schedule-row">{sessionRow(session)}</summary>
                    <p className="week-schedule-advice">{session.details}</p>
                  </details>
                )}
              </article>
            ))}
          </div>

          <div className="week-plan-footer">
            <p>Recalculé après chaque synchronisation Strava.</p>
            {weekWorkouts.length > 0 && (
              <button
                className="week-plan-export"
                type="button"
                onClick={() => downloadTextFile("fabrun-semaine.tcx", buildTcxMultiple(weekWorkouts))}
                title="Exporter uniquement les séances proposées à venir au format TCX"
              >
                Exporter {plannedSessions === 1 ? "la séance" : `les ${plannedSessions} séances`} (.tcx)
              </button>
            )}
          </div>

          <details className="week-plan-disclosure">
            <summary>Comment ce plan s’adapte</summary>
            <div className="week-plan-disclosure-body">
              <p>
                Les kilomètres déjà courus remplacent le programme du jour. Seules les séances à venir sont
                recalculées. Une séance manquée n’est pas automatiquement rattrapée.
              </p>
              {progressionReferenceKm != null && <p>
                Repère de progression : {formatKm(load.weeklyRamp.previousWeekKm)} km la semaine dernière × 1,10 = {formatKm(progressionReferenceKm)} km.
                Sans douleur, ce repère sert de référence au volume de la semaine ; le plan le répartit sur les séances disponibles sans concentrer le reliquat sur une seule sortie.
              </p>}
              <p>
                La référence du plan est {formatKm(plan.targetKm)} km. Les créneaux disponibles et la charge de chaque jour
                aboutissent à {formatKm(plannedTotalKm)} km réellement prévus ; {formatKm(unplannedKm)} km de cette référence ne sont pas programmés.
              </p>
              {hasShinPain && (
                <p>
                  En reprise périostite, au moins un jour sans course sépare deux sorties. La charge du jour peut
                  limiter ou retirer une séance. Le plafond de reprise est réduit à 50 % de la semaine de référence. La douleur prime : aucune reprise tant qu’elle est présente.
                </p>
              )}
              <ul>{plan.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          </details>

          {plan.progression.length > 0 && (
            <details className="week-plan-disclosure">
              <summary>Projection des prochaines semaines</summary>
              <div className="week-plan-disclosure-body">
                <p>
                  Estimation à recalculer après les prochaines sorties : elle part des {formatKm(doneKm + plannedKm)} km
                  réalisés ou proposés{hasShinPain ? ", uniquement si la reprise reste indolore." : "."}
                </p>
                <dl className="week-plan-projection">
                  {plan.progression.slice(1).map((week, index) => (
                    <div key={week.label}>
                      <dt>Semaine +{index + 1}</dt>
                      <dd>{formatKm(week.km)} <small>km</small></dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
