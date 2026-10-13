import { useId, useMemo, useState, type ReactNode } from "react";
import "../styles/today.scss";
import { buildNormalPlan, buildRehabPlan } from "../utils/weeklyPlan";
import { addDays, localDateKey, toDateKey } from "../utils/dateBuckets";
import {
  computeTrainingLoad,
  computeWeekDailyBreakdown,
  computeWeeklyRampHistory,
  zoneFromWeeklyChangePct,
} from "../utils/trainingLoad";

type Activity = {
  id: number;
  sport_type: string;
  distance: number; // meters
  start_date_local: string;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

const round1 = (value: number) => Math.round(value * 10) / 10;

const formatKm = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatPercent = (value: number) => `${value > 0 ? "+" : ""}${formatKm(value)} %`;
const formatDate = (key: string, short = false) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: short ? "numeric" : "long" }).format(new Date(`${key}T12:00:00`));

type TrainingZone = "green" | "orange" | "red" | "insufficient_data";

function zoneLabel(zone: TrainingZone) {
  if (zone === "green") return "Charge stable";
  if (zone === "orange") return "Charge en hausse";
  if (zone === "red") return "Charge élevée";
  return "Données insuffisantes";
}

function rampZoneLabel(zone: TrainingZone) {
  if (zone === "green") return "Sous le repère +10 %";
  if (zone === "orange") return "Progression rapide";
  if (zone === "red") return "Hausse supérieure à 20 %";
  return "Pas encore de semaine de référence";
}


export default function TrainingLoadCard({
  rows,
  hasShinPain,
  onShinPainChange,
  settingsSaving = false,
  settingsError = null,
  children,
}: {
  rows: Activity[];
  hasShinPain: boolean;
  onShinPainChange: (value: boolean) => void;
  settingsSaving?: boolean;
  settingsError?: string | null;
  children?: ReactNode;
}) {
  const metrics = computeTrainingLoad(rows);
  const periostitis = metrics.periostitis;
  const weeklyRamp = metrics.weeklyRamp;
  const label = zoneLabel(metrics.zone);
  const painDescriptionId = useId();
  const headingId = useId();

  const today = new Date();
  const todayKey = localDateKey(today);
  const windowStartKey = localDateKey(addDays(today, -27));
  const recentRunCount = rows.filter((activity) => {
    if (!RUN_TYPES.has(activity.sport_type)) return false;
    const key = toDateKey(activity.start_date_local);
    return key != null && key >= windowStartKey && key <= todayKey;
  }).length;
  const hasEnoughRecentRuns = recentRunCount >= 3;

  const selectedPlan = hasShinPain ? buildRehabPlan(rows, today) : buildNormalPlan(rows, today);
  const todaySession = selectedPlan.sessions.find((session) => session.isToday);
  const budgetTodayKm = todaySession?.status === "planned" && todaySession.type !== "rest" ? todaySession.km : 0;
  const nextSession = selectedPlan.sessions.find((session) => session.status === "planned" && session.type !== "rest" && !session.isToday);
  const overrunTodayKm = hasShinPain ? Math.max(0, metrics.kmToday - periostitis.sessionCapKm) : metrics.overrunToday;
  const canRunToday = hasEnoughRecentRuns && budgetTodayKm >= 0.5;

  const [extraKm, setExtraKm] = useState(0);
  const projectedWeekKm = round1(weeklyRamp.currentWeekKm + extraKm);
  const projectedChangePct =
    weeklyRamp.previousWeekKm > 0
      ? round1(((projectedWeekKm - weeklyRamp.previousWeekKm) / weeklyRamp.previousWeekKm) * 100)
      : null;
  const projectedZone = zoneFromWeeklyChangePct(projectedChangePct);

  const rampHistory = useMemo(() => computeWeeklyRampHistory(rows), [rows]);
  const maxWeekKm = Math.max(...rampHistory.map((w) => w.weekKm), 0.1);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const selectedWeek = rampHistory.find((w) => w.weekStartKey === selectedWeekKey) ?? null;
  const selectedDays = useMemo(
    () => (selectedWeek ? computeWeekDailyBreakdown(rows, selectedWeek.weekStartKey) : []),
    [rows, selectedWeek]
  );
  const maxDayKm = Math.max(...selectedDays.map((day) => day.km), 0.1);

  return (
    <section className="training-load-card training-today-card" aria-labelledby={headingId}>
      <div className="training-today-heading">
        <span className="training-today-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            {!hasEnoughRecentRuns ? <><circle cx="12" cy="12" r="10" /><path d="M8 12h8" /></> : canRunToday ? <><path d="M5 12h14M13 6l6 6-6 6" /></> : <><path d="M9 7v10M15 7v10" /><circle cx="12" cy="12" r="10" /></>}
          </svg>
        </span>
        <div>
          <p className="training-today-eyebrow">Aujourd’hui</p>
          <h2 id={headingId}>{!hasEnoughRecentRuns ? "Quelques sorties manquent" : canRunToday ? hasShinPain ? "Reprise très facile" : "Une séance est possible" : "Repos course"}</h2>
        </div>
      </div>

      <div className="training-today-advice">
        {!hasEnoughRecentRuns ? (
          <>
            <p className="training-text">Synchronise au moins trois sorties de course sur les 28 derniers jours pour obtenir un conseil adapté.</p>
            <p className="training-today-alternative">{recentRunCount} sortie{recentRunCount > 1 ? "s" : ""} récente{recentRunCount > 1 ? "s" : ""} disponible{recentRunCount > 1 ? "s" : ""} sur 3 minimum.</p>
          </>
        ) : canRunToday ? (
          <>
            <div className="training-today-budget">
              <strong>{formatKm(budgetTodayKm)} <span>km</span></strong>
              <span>{hasShinPain ? "Limite conditionnelle de reprise" : "Distance prévue par le plan hebdomadaire"}</span>
            </div>
            {hasShinPain ? (
              <p className="training-text">Course-marche sur terrain plat, sans vitesse ni côtes, uniquement si tu peux marcher 30 minutes sans douleur. Arrête si la douleur apparaît.</p>
            ) : children ? children : (
              <p className="training-text">Reste en aisance et adapte la distance à ton ressenti.</p>
            )}
          </>
        ) : (
          <>
            <p className="training-text">
              {hasShinPain && periostitis.ranYesterday
                ? "Tu as couru hier : garde une journée sans course entre deux sorties."
                : metrics.kmToday > 0
                ? "Ta sortie est prise en compte. Pas de course supplémentaire conseillée aujourd’hui."
                : hasShinPain ? "La charge récente limite la reprise aujourd’hui."
                : metrics.normalRecoveryDay ? "Récupération après les sorties récentes. Le volume restant est réparti sur les autres séances."
                : "Repos prévu au programme. Le volume de la semaine est réparti sur les prochaines séances."}
            </p>
            <p className="training-today-alternative">Marche indolore ou cardio sans impact très facile, selon ton ressenti.</p>
          </>
        )}
      </div>

      <button
        className="training-pain-toggle"
        type="button"
        role="switch"
        aria-label="Douleur au tibia"
        aria-describedby={painDescriptionId}
        aria-checked={hasShinPain}
        aria-busy={settingsSaving}
        disabled={settingsSaving}
        onClick={() => onShinPainChange(!hasShinPain)}
      >
        <span className="training-pain-copy">
          <span>Douleur au tibia</span>
          <small id={painDescriptionId}>
            {settingsSaving ? "Enregistrement…" : hasShinPain ? "Mode prudent actif · reprise seulement sans douleur" : "Active le mode prudent en cas de douleur"}
          </small>
        </span>
        <strong>{hasShinPain ? "Oui" : "Non"}</strong>
        <span className="training-switch" aria-hidden="true" />
      </button>
      {settingsError && (
        <div className="training-settings-error" role="status">
          <span>{settingsError}</span>
          <button type="button" disabled={settingsSaving} onClick={() => onShinPainChange(hasShinPain)}>
            Réessayer
          </button>
        </div>
      )}
      {hasShinPain && !canRunToday && (
        <p className="training-pain-condition">Avant toute reprise, vérifie que tu peux marcher 30 minutes sans douleur.</p>
      )}
      <a className="training-plan-link" href="#plan-semaine">Voir le programme de la semaine <span aria-hidden="true">→</span></a>

      <details className="training-details">
        <summary>Historique et simulateur</summary>
      <div className="training-ramp">
        <div className="training-ramp-head">
          <span className="training-title">Kilomètres par semaine</span>
          <span className={`training-zone training-zone-${weeklyRamp.zone}`}>{rampZoneLabel(weeklyRamp.zone)}</span>
        </div>

        {weeklyRamp.capKm == null ? (
          <p className="training-meta">
            Pas encore de semaine précédente complète : la marge s'affichera dès qu'il y aura un historique.
          </p>
        ) : (
          <>
            <div className="training-ramp-summary">
              <div>
                <span>Semaine dernière</span>
                <strong>{formatKm(weeklyRamp.previousWeekKm)} km</strong>
              </div>
              <div>
                <span>Cette semaine</span>
                <strong>{formatKm(weeklyRamp.currentWeekKm)} km</strong>
              </div>
              <div>
                <span>Repère +10 %</span>
                <strong>{formatKm(weeklyRamp.capKm)} km</strong>
              </div>
            </div>

            <div className="training-ramp-progress" aria-label="Utilisation de la marge de progression hebdomadaire">
              <span
                className={`training-ramp-fill training-ramp-fill-${weeklyRamp.zone}`}
                style={{ width: `${Math.min(100, (weeklyRamp.currentWeekKm / weeklyRamp.capKm) * 100)}%` }}
              />
            </div>
            <div className="training-rehab-progress-labels">
              <span>Écart au repère : {formatKm((weeklyRamp.remainingKm ?? 0))} km</span>
              <span>
                {weeklyRamp.changePct == null
                  ? "—"
                  : `${weeklyRamp.changePct > 0 ? "+" : ""}${formatKm(weeklyRamp.changePct)} %`}{" "}
                par rapport à la semaine dernière
              </span>
            </div>

            <label className="training-ramp-simulator">
              <span>
                Simuler <strong>{formatKm(extraKm)} km</strong> supplémentaires cette semaine
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(10, Math.round(weeklyRamp.capKm * 1.5))}
                step={0.5}
                value={extraKm}
                onChange={(e) => setExtraKm(Number(e.target.value))}
                aria-label="Kilomètres supplémentaires simulés cette semaine"
              />
            </label>
            <p className={`training-ramp-projection training-zone-${projectedZone}`}>
              {formatKm(projectedWeekKm)} km cette semaine
              {projectedChangePct != null &&
                ` (${formatPercent(projectedChangePct)} par rapport à la semaine dernière)`}
              {" — "}
              {rampZoneLabel(projectedZone)}
            </p>
          </>
        )}

        <div className="training-ramp-history">
          <span className="training-title">Les {rampHistory.length} dernières semaines</span>
          <div className="training-ramp-history-bars">
            {rampHistory.map((week) => (
              <button
                key={week.weekStartKey}
                type="button"
                className={`training-ramp-history-bar-wrap ${
                  week.weekStartKey === selectedWeekKey ? "training-ramp-history-bar-wrap-selected" : ""
                }`}
                aria-pressed={week.weekStartKey === selectedWeekKey}
                aria-label={`Semaine du ${formatDate(week.weekStartKey)} : ${formatKm(week.weekKm)} km, ${rampZoneLabel(week.zone)}`}
                title={`Semaine du ${formatDate(week.weekStartKey)} : ${formatKm(week.weekKm)} km`}
                onClick={() => setSelectedWeekKey(week.weekStartKey === selectedWeekKey ? null : week.weekStartKey)}
              >
                <span className="training-ramp-history-bar-track" aria-hidden="true">
                  <span
                    className={`training-ramp-history-bar training-ramp-fill-${week.zone}`}
                    style={{ height: `${Math.max(6, Math.round((week.weekKm / maxWeekKm) * 100))}%` }}
                  />
                </span>
                <small aria-hidden="true">{formatDate(week.weekStartKey, true)}</small>
              </button>
            ))}
          </div>
          <div className="training-ramp-history-legend">
            <span>
              <i className="training-ramp-fill-green" /> ≤ 10 %
            </span>
            <span>
              <i className="training-ramp-fill-orange" /> 10–20 %
            </span>
            <span>
              <i className="training-ramp-fill-red" /> &gt; 20 %
            </span>
          </div>
          {selectedWeek ? (
            <div className="training-week-detail">
              <div className="training-week-detail-head">
                <strong>Semaine du {formatDate(selectedWeek.weekStartKey)}</strong>
                <span>
                  {formatKm(selectedWeek.weekKm)} km
                  {selectedWeek.changePct != null &&
                    ` (${formatPercent(selectedWeek.changePct)} par rapport à ${formatKm(selectedWeek.previousWeekKm)} km)`}
                </span>
              </div>
              <div className="training-week-detail-days">
                {selectedDays.map((day, index) => (
                  <div key={day.dateKey} className="training-week-detail-day">
                    <span className="training-week-detail-km">{day.km > 0 ? formatKm(day.km) : "—"}</span>
                    <span className="training-week-detail-bar-track">
                      <span
                        className="training-week-detail-bar"
                        style={{ height: `${day.km > 0 ? Math.max(6, Math.round((day.km / maxDayKm) * 100)) : 0}%` }}
                      />
                    </span>
                    <span className="training-week-detail-label">
                      {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"][index]}
                    </span>
                    <small>{day.dateKey.slice(8)}/{day.dateKey.slice(5, 7)}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="training-meta">Sélectionne une semaine pour voir les jours courus.</p>
          )}
        </div>

        <p className="training-meta">
          Le repère +10 % compare des volumes hebdomadaires. Il ne garantit pas l’absence de blessure
          et ne permet pas de décider si tu peux courir aujourd’hui. La semaine en cours est incomplète.
        </p>
      </div>
      </details>

      <details className="training-details">
        <summary>Comprendre le calcul</summary>
        <dl className="training-calculation-grid">
          <div><dt>Course sur 7 jours</dt><dd>{formatKm(metrics.acute7Km)} km</dd></div>
          <div><dt>Moyenne sur 28 jours</dt><dd>{formatKm(metrics.chronic28AvgKm)} km/semaine</dd></div>
          <div><dt>Ratio de charge (ACR)</dt><dd>{metrics.acr == null ? "—" : metrics.acr.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} · {label.toLowerCase()}</dd></div>
          <div><dt>Course importée aujourd’hui</dt><dd>{formatKm(metrics.kmToday)} km</dd></div>
        </dl>
        <p className="training-meta">
          Les sorties de course, trail et course virtuelle alimentent le calcul. Sans douleur, le programme suit la référence hebdomadaire +10 % et répartit les kilomètres sur les séances disponibles.
          {hasShinPain ? " Le mode prudent divise le volume de référence par deux, garde la limite de charge récente et espace les sorties." : " L’ACR adapte l’intensité ; il ne remplace pas la référence hebdomadaire."}
        </p>
        <p className="training-meta">
          Données {metrics.confidence === "haute" ? "bien renseignées" : metrics.confidence === "moyenne" ? "partielles" : "limitées"} : {metrics.activeDays28} jours de course sur 28. Cet indice décrit les données du modèle, pas la sécurité médicale d’une séance.
        </p>
        {!canRunToday && hasEnoughRecentRuns && hasShinPain && (
          <p className="training-meta">
            {nextSession
              ? `Prochaine séance du programme : le ${formatDate(localDateKey(nextSession.date))}, au plus ${formatKm(nextSession.km)} km, uniquement si la reprise est indolore.`
              : "Aucune autre course proposée dans le programme de cette semaine. Le plan sera réévalué après récupération et synchronisation."}
          </p>
        )}
        {hasEnoughRecentRuns && overrunTodayKm > 0 && (
          <p className="training-meta">
            La sortie importée aujourd’hui dépasse le repère journalier de {formatKm(overrunTodayKm)} km. Privilégie la récupération.
          </p>
        )}
      </details>
    </section>
  );
}
