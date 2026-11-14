import { useState } from "react";
import { bestRunWindow, describeRunWindow } from "../utils/genevaWeather";
import { buildCoach, type Coach } from "../utils/coach";
import { formatPace, formatPaceRange } from "../utils/paces";
import PlanWeather from "./PlanWeather";
import { computeTrainingLoad } from "../utils/trainingLoad";
import { localDateKey } from "../utils/dateBuckets";
import type { PlanActivity as Activity, PlannedSession } from "../utils/weeklyPlan";
import "../styles/weeklyPlan.scss";
import "../styles/coach.scss";
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
    steps: session.workout?.steps ?? distanceBudgetSteps(session.title, session.km * 1000),
  };
}

function statusLabel(session: PlannedSession, hasShinPain: boolean) {
  if (session.status === "done") return session.type === "rest" ? "Passé" : "Importé";
  if (session.status === "missed") return "Non effectuée";
  return session.type === "rest" ? "Repos" : hasShinPain ? "Si indolore" : "Prévu";
}

export default function WeeklyTrainingPlanCard({
  rows,
  predictions,
  hasShinPain,
  coach: sharedCoach,
}: {
  rows: Activity[];
  predictions?: Predictions | null;
  hasShinPain: boolean;
  /** Shared plan for the week; built from the rows alone when omitted. */
  coach?: Coach;
}) {
  const now = new Date();
  const coach = sharedCoach ?? buildCoach({ rows, predictions, hasShinPain, now });
  const { plan, basePlan, weather, weatherError, race, paces, feedback } = coach;
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
  const nextWeather = nextSession ? weather?.daily.get(localDateKey(nextSession.date)) : undefined;
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
    const dayWeather = !isPast ? weather?.daily.get(localDateKey(session.date)) : undefined;
    const weatherChanged = session.status === "planned" && session.type !== "rest" && basePlan.sessions.find(s => localDateKey(s.date) === localDateKey(session.date))?.type === "rest";
    return (
      <>
        <time className="week-schedule-date" dateTime={localDateKey(session.date)} aria-label={fullDateFormatter.format(session.date)}>
          <span>{session.isToday ? "Aujourd’hui" : dayFormatter.format(session.date).replace(".", "")}</span>
          <strong>{shortDateFormatter.format(session.date)}</strong>
        </time>
        <div className="week-schedule-content">
          <strong>{isRest ? isPast ? "Journée sans course" : session.title.startsWith("Repos · ") ? session.title : "Repos course" : session.title}</strong>
          {!isRest && session.status === "planned" && session.workout?.paceLabel && <span className="week-schedule-pace">{session.workout.paceLabel}</span>}
          <span className={`week-schedule-state week-schedule-state-${session.status}${isRest ? " week-schedule-state-rest" : ""}`}>
            {weatherChanged ? "Déplacée · météo" : statusLabel(session, hasShinPain)}
          </span>
        </div>
        {!isPast && (dayWeather
          ? <PlanWeather day={dayWeather} heavy={weather?.rainyDays.has(localDateKey(session.date)) ?? false} />
          : <span className="plan-weather-unavailable">{weatherError ? "Météo indisponible" : weather ? "Prévision indisponible" : "Chargement météo…"}</span>)}
        <span className="week-schedule-distance">
          {isRest ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 7v10M15 7v10" /><circle cx="12" cy="12" r="9" /></svg>
            : session.status === "missed" ? "—" : <>{formatKm(session.km)} <small>km</small></>}
        </span>
      </>
    );
  }

  // Day cards stay compact; the selected day is detailed in a full-width panel below the grid.
  const hasDetail = (session: PlannedSession) => session.type !== "rest" || Boolean(session.adjustment);
  const todayKey = localDateKey(now);
  const defaultKey = plan.sessions.find(session => session.isToday && hasDetail(session))
    ? todayKey : nextSession ? localDateKey(nextSession.date) : null;
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  const selected = plan.sessions.find(session => localDateKey(session.date) === (pickedKey ?? defaultKey) && hasDetail(session));

  function dayDetail(session: PlannedSession) {
    const key = localDateKey(session.date);
    const isRest = session.type === "rest";
    const done = session.status === "done" ? feedback.byDay.get(key) : undefined;
    const minutes = session.workout?.estimatedMinutes ?? Math.round(session.km * 6.5);
    const window = session.status === "planned" && !isRest ? bestRunWindow(weather, key, minutes, now) : null;
    const planned = session.status === "planned" && !isRest;
    return (
      <div className="week-day-detail" id="week-day-detail" role="region" aria-live="polite" aria-label={`Détail du ${fullDateFormatter.format(session.date)}`}>
        <div className="week-day-detail-head">
          <span className="coach-eyebrow">{session.isToday ? "Aujourd’hui" : fullDateFormatter.format(session.date)}</span>
          <strong>{session.title}{!isRest && session.status !== "missed" ? ` · ${formatKm(session.km)} km` : ""}</strong>
        </div>
        {!isRest && <p className="week-day-detail-summary">{session.details}</p>}
        {session.adjustment && <p className="coach-adjustment">{session.adjustment}</p>}
        {planned && (
          <dl className="coach-facts">
            {session.workout?.paceLabel && <div><dt>Allure cible</dt><dd>{session.workout.paceLabel}</dd></div>}
            <div><dt>Durée estimée</dt><dd>{minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`}</dd></div>
            {window && <div><dt>{window.dry ? "Meilleur créneau" : "Créneau le moins humide"}</dt><dd>{describeRunWindow(window)}</dd></div>}
          </dl>
        )}
        {planned && session.workout && session.workout.lines.length > 1 && (
          <ol className="coach-steps">
            {session.workout.lines.map(line => <li key={line.label}><strong>{line.label}</strong><span>{line.text}</span></li>)}
          </ol>
        )}
        {done && <p className={`coach-feedback coach-feedback-${done.verdict}`}><strong>Bilan</strong> {done.summary}. {done.text}</p>}
      </div>
    );
  }

  return (
    <section className={`weekly-plan-card weekly-plan-card-v2 ${hasShinPain ? "weekly-plan-card-rehab" : ""}`} aria-label="Plan de la semaine">
      <header className="week-plan-header">
        <div>
          <h2>Cette semaine</h2>
          <p>{weekLabel ? `${weekLabel} · ` : ""}{hasShinPain ? "Reprise prudente" : race ? race.phaseLabel : "Plan adaptatif"}</p>
        </div>
        {plan.sessions.length > 0 && (
          <div className="week-plan-reference">
            <span>{targetLabel}</span>
            <strong>{formatKm(plannedTotalKm)} <small>km</small></strong>
          </div>
        )}
      </header>

      {race && (
        <div className="coach-goal">
          <div className="coach-goal-head">
            <div>
              <span className="coach-eyebrow">Objectif</span>
              <strong>{race.goal.label} · {formatKm(race.goal.distanceKm)} km</strong>
            </div>
            <div className="coach-goal-countdown">
              <strong>{race.daysToRace === 0 ? "Aujourd’hui" : `J-${race.daysToRace}`}</strong>
              {race.goalPace != null && <span>Allure cible {formatPace(race.goalPace)}/km</span>}
            </div>
          </div>
          <ol className="coach-phases" aria-label="Phases de la préparation">
            {race.timeline.map(item => (
              <li key={item.phase} className={item.current ? "coach-phase-current" : ""} style={{ flexGrow: item.weeks }} aria-current={item.current ? "step" : undefined}>
                <span>{item.label}</span>
                <small>{item.phase === "race-week" ? "course" : `${item.weeks} sem.`}</small>
              </li>
            ))}
          </ol>
          <p>{hasShinPain ? "Mode prudent actif : la préparation spécifique reprendra quand la douleur aura disparu." : race.focus}</p>
        </div>
      )}

      <div className={`plan-weather-heading${weatherError ? " plan-weather-heading-error" : ""}`} role="status">
        <div><span className="plan-weather-location">◎ Genève</span><strong>{weather ? "Votre semaine, au rythme de la météo" : weatherError ? "Prévisions momentanément indisponibles" : "On regarde le ciel pour vos sorties…"}</strong>
        <p>{weather ? "Les jours de forte pluie laissent place au repos. Les sorties sont réorganisées selon la récupération." : weatherError ? "Le calendrier habituel reste affiché, sans adaptation météo." : "Chargement des prévisions et adaptation du calendrier."}</p></div>
        <span className="plan-weather-source">{weather && <>Actualisé à {new Intl.DateTimeFormat("fr-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" }).format(weather.updatedAt)} · </>}<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a></span>
      </div>

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
                <p>{nextSession.title}{hasShinPain ? " · uniquement sans douleur" : nextSession.workout ? ` · ${nextSession.details}` : ""}</p>
                {nextWeather && <PlanWeather day={nextWeather} heavy={false} compact /> }
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
                : `${race && race.volumeFactor < 1 ? `Référence ${race.phaseLabel.toLowerCase()}` : "Référence +10 %"} : ${formatKm(plan.targetKm)} km. ${unplannedKm >= 0.1 ? `${formatKm(unplannedKm)} km restent non programmés : les créneaux et les limites par séance ne permettent pas de les répartir.` : "Le volume restant est réparti sur les séances à venir."}`}
            </p>
          </div>

          <div className="week-schedule" aria-label="Calendrier de la semaine">
            {plan.sessions.map((session) => (
              <article
                key={localDateKey(session.date)}
                className={`week-schedule-entry weekly-plan-${session.type} weekly-plan-status-${session.status}${session.isToday ? " week-schedule-today" : ""}${selected === session ? " week-schedule-selected" : ""}`}
              >
                {hasDetail(session) ? (
                  <button
                    type="button"
                    className="week-schedule-row week-schedule-pick"
                    aria-pressed={selected === session}
                    aria-controls="week-day-detail"
                    onClick={() => setPickedKey(localDateKey(session.date))}
                  >
                    {sessionRow(session)}
                  </button>
                ) : (
                  <div className="week-schedule-row">{sessionRow(session)}</div>
                )}
              </article>
            ))}
          </div>

          {selected && dayDetail(selected)}

          <div className="week-plan-footer">
            <p>Météo actualisée chaque heure · plan recalculé après synchronisation.</p>
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

          {paces && !hasShinPain && (
            <details className="week-plan-disclosure">
              <summary>Tes allures d’entraînement</summary>
              <div className="week-plan-disclosure-body">
                <p>Calculées à partir de ton estimation actuelle sur 5 km ({formatPace(paces.fiveKPace)}/km). Elles évoluent avec tes meilleures performances récentes.</p>
                <dl className="coach-paces">
                  <div><dt>Endurance</dt><dd>{formatPaceRange(paces.easy)}</dd><dd>Footings, échauffements, récupérations</dd></div>
                  <div><dt>Sortie longue</dt><dd>{formatPaceRange(paces.long)}</dd><dd>Régulier, sans forcer</dd></div>
                  <div><dt>Seuil / tempo</dt><dd>{formatPaceRange(paces.tempo)}</dd><dd>Soutenu mais contrôlé, 15 à 40 min au total</dd></div>
                  <div><dt>Fractionné long</dt><dd>{formatPaceRange(paces.interval)}</dd><dd>800 à 1 000 m, proche de ton allure 5 km</dd></div>
                  <div><dt>Fractionné court</dt><dd>{formatPaceRange(paces.repetition)}</dd><dd>400 m, plus rapide que ton allure 5 km</dd></div>
                  {race?.goalPace != null && <div><dt>Allure objectif</dt><dd>{formatPace(race.goalPace)}/km</dd><dd>{race.goal.label}</dd></div>}
                </dl>
                {feedback.adjustmentReason && <p>{feedback.adjustmentReason}</p>}
              </div>
            </details>
          )}

          {feedback.runs.length > 0 && (
            <details className="week-plan-disclosure">
              <summary>Bilan de tes dernières sorties</summary>
              <div className="week-plan-disclosure-body">
                <ul className="coach-feedback-list">
                  {feedback.runs.slice(0, 5).map(run => (
                    <li key={`${run.dateKey}-${run.km}`} className={`coach-feedback coach-feedback-${run.verdict}`}>
                      <strong>{shortDateFormatter.format(new Date(`${run.dateKey}T12:00:00`))} · {run.summary}</strong>
                      <span>{run.text}</span>
                    </li>
                  ))}
                </ul>
                <p>Le bilan compare l’allure et la fréquence cardiaque moyennes à tes zones. La dérive cardiaque en cours de sortie n’est pas encore analysée.</p>
              </div>
            </details>
          )}

          <details className="week-plan-disclosure">
            <summary>Comment ce plan s’adapte</summary>
            <div className="week-plan-disclosure-body">
              <p>
                Les kilomètres déjà courus remplacent le programme du jour. Seules les séances à venir sont
                recalculées. Une séance manquée n’est pas automatiquement rattrapée.
              </p>
              <p>À Genève, une prévision de 4 mm/h ou plus entre 6 h et 22 h écarte la journée. Les températures, cumuls et probabilités affichés couvrent la journée entière. Une séance déplacée reste soumise aux limites de charge.</p>
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
