import { useMemo, useState } from "react";
import {
  computeNextAvailableRun,
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

const round3 = (value: number) => Math.round(value * 1000) / 1000;
const round1 = (value: number) => Math.round(value * 10) / 10;

type TrainingZone = "green" | "orange" | "red" | "insufficient_data";

function zoneLabel(zone: TrainingZone) {
  if (zone === "green") return "Zone OK";
  if (zone === "orange") return "Attention";
  if (zone === "red") return "Risque élevé";
  return "Données insuffisantes";
}

function zoneMessage(zone: TrainingZone) {
  if (zone === "green") return "Progression raisonnable.";
  if (zone === "orange") return "Charge en hausse: reste prudent aujourd'hui.";
  if (zone === "red") return "Risque élevé: privilégie repos ou sortie très courte.";
  return "Pas assez de données récentes pour une estimation fiable.";
}

function rampZoneLabel(zone: TrainingZone) {
  if (zone === "green") return "Marge OK";
  if (zone === "orange") return "Progression rapide";
  if (zone === "red") return "Hausse trop rapide";
  return "Pas encore de semaine de référence";
}


export default function TrainingLoadCard({
  rows,
  hasShinPain,
  onShinPainChange,
  settingsSaving = false,
  settingsError = null,
}: {
  rows: Activity[];
  hasShinPain: boolean;
  onShinPainChange: (value: boolean) => void;
  settingsSaving?: boolean;
  settingsError?: string | null;
}) {
  const metrics = computeTrainingLoad(rows);
  const periostitis = metrics.periostitis;
  const weeklyRamp = metrics.weeklyRamp;
  const label = zoneLabel(metrics.zone);
  const message = zoneMessage(metrics.zone);
  const deltaRaw = round3(metrics.maxKmNowRaw - metrics.maxKmNowYesterdayRaw);
  const deltaSign = deltaRaw > 0 ? "+" : "";

  const budgetTodayKm = hasShinPain ? periostitis.remainingTodayKm : metrics.remainingNow;
  const canRunToday = budgetTodayKm >= 0.5;
  const nextAvailable = useMemo(
    () => (canRunToday ? null : computeNextAvailableRun(rows, 10)),
    [rows, canRunToday]
  );
  const nextAvailableKm = nextAvailable ? (hasShinPain ? nextAvailable.rehabMaxKm : nextAvailable.maxKm) : 0;

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
    <section className="training-load-card">
      <button
        className="training-pain-toggle"
        type="button"
        role="switch"
        aria-checked={hasShinPain}
        disabled={settingsSaving}
        onClick={() => onShinPainChange(!hasShinPain)}
      >
        <span>Douleur périostite</span>
        <span className="training-switch" aria-hidden="true" />
        <strong>{settingsSaving ? "Enregistrement…" : hasShinPain ? "Oui" : "Non"}</strong>
      </button>
      {settingsError && (
        <div className="training-settings-error" role="status">
          <span>{settingsError}</span>
          <button type="button" disabled={settingsSaving} onClick={() => onShinPainChange(hasShinPain)}>
            Réessayer
          </button>
        </div>
      )}
      <p className={`training-mode-explainer ${hasShinPain ? "training-mode-explainer-active" : ""}`}>
        {hasShinPain
          ? "Mode actif : le conseil du jour et le plan hebdomadaire passent immédiatement en reprise prudente."
          : "Active ce bouton si une douleur de périostite est présente : FabRun retirera vitesse, côtes et jours consécutifs."}
      </p>

      <div className={`training-go-badge training-go-badge-${canRunToday ? "yes" : "no"}`}>
        {canRunToday ? "✅ Tu peux courir aujourd'hui" : "⛔ Pas de course aujourd'hui"}
      </div>

      <div className="training-load-head">
        {hasShinPain && <span className="training-injury-mode">Reprise périostite</span>}
        <span className={`training-zone training-zone-${metrics.zone}`}>{label}</span>
        <span className="training-acr">ACR: {metrics.acr == null ? "—" : metrics.acr}</span>
        <span className={`training-confidence training-confidence-${metrics.confidenceClass}`}>
          Fiabilité: {metrics.confidence} ({metrics.confidenceScore}%)
        </span>
      </div>

      <div className="training-main">
        <div className="training-title">Km conseillés max pour le reste d'aujourd'hui</div>
        <div className="training-value">{budgetTodayKm.toFixed(1)} km</div>
      </div>

      {!canRunToday && (
        <p className="training-next-available">
          {nextAvailable
            ? `Prochaine sortie possible dans ${nextAvailable.daysAhead} jour${
                nextAvailable.daysAhead > 1 ? "s" : ""
              } (~${nextAvailableKm.toFixed(1)} km), en supposant un repos complet d'ici là.`
            : "Toujours au-dessus du plafond dans 10 jours même en te reposant: laisse la charge redescendre avant de reprogrammer une sortie."}
        </p>
      )}

      <p className="training-text">
        {hasShinPain && periostitis.ranYesterday
          ? "Repos course aujourd'hui: au moins un jour sans impact entre deux sorties."
          : !canRunToday
          ? "Budget du jour déjà consommé: attends la prochaine ouverture indiquée ci-dessus avant de repartir courir."
          : message}
      </p>
      <p className="training-reco">
        Séance conseillée maintenant:{" "}
        {hasShinPain
          ? periostitis.remainingTodayKm <= 0
            ? "repos, marche indolore ou cardio sans impact"
            : "course-marche très facile, terrain plat, sans vitesse ni côtes"
          : !canRunToday
          ? "repos, marche ou cardio sans impact"
          : metrics.sessionAdvice}
        .
      </p>

      <div className="training-ramp">
        <div className="training-ramp-head">
          <span className="training-title">Marge avant hausse à risque (règle des +10%/semaine)</span>
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
                <strong>{weeklyRamp.previousWeekKm.toFixed(1)} km</strong>
              </div>
              <div>
                <span>Cette semaine</span>
                <strong>{weeklyRamp.currentWeekKm.toFixed(1)} km</strong>
              </div>
              <div>
                <span>Plafond +10%</span>
                <strong>{weeklyRamp.capKm.toFixed(1)} km</strong>
              </div>
            </div>

            <div className="training-ramp-progress" aria-label="Utilisation de la marge de progression hebdomadaire">
              <span
                className={`training-ramp-fill training-ramp-fill-${weeklyRamp.zone}`}
                style={{ width: `${Math.min(100, (weeklyRamp.currentWeekKm / weeklyRamp.capKm) * 100)}%` }}
              />
            </div>
            <div className="training-rehab-progress-labels">
              <span>Reste avant +10%: {(weeklyRamp.remainingKm ?? 0).toFixed(1)} km</span>
              <span>
                {weeklyRamp.changePct == null
                  ? "—"
                  : `${weeklyRamp.changePct > 0 ? "+" : ""}${weeklyRamp.changePct.toFixed(1)}%`}{" "}
                vs semaine dernière
              </span>
            </div>

            <label className="training-ramp-simulator">
              <span>
                Simuler: si je cours <strong>{extraKm.toFixed(1)} km</strong> de plus cette semaine →{" "}
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
              → {projectedWeekKm.toFixed(1)} km cette semaine
              {projectedChangePct != null &&
                ` (${projectedChangePct > 0 ? "+" : ""}${projectedChangePct.toFixed(1)}% vs semaine dernière)`}
              {" — "}
              {rampZoneLabel(projectedZone)}
            </p>
          </>
        )}

        <div className="training-ramp-history">
          <span className="training-title">Historique ({rampHistory.length} dernières semaines)</span>
          <div className="training-ramp-history-bars">
            {rampHistory.map((week) => (
              <button
                key={week.weekStartKey}
                type="button"
                className={`training-ramp-history-bar-wrap ${
                  week.weekStartKey === selectedWeekKey ? "training-ramp-history-bar-wrap-selected" : ""
                }`}
                aria-pressed={week.weekStartKey === selectedWeekKey}
                aria-label={`Semaine du ${week.weekStartKey}: ${week.weekKm.toFixed(1)} km`}
                title={`Semaine du ${week.weekStartKey}: ${week.weekKm.toFixed(1)} km${
                  week.changePct == null ? "" : ` (${week.changePct > 0 ? "+" : ""}${week.changePct.toFixed(1)}% vs semaine précédente)`
                }`}
                onClick={() => setSelectedWeekKey(week.weekStartKey === selectedWeekKey ? null : week.weekStartKey)}
              >
                <span
                  className={`training-ramp-history-bar training-ramp-fill-${week.zone}`}
                  style={{ height: `${Math.max(6, Math.round((week.weekKm / maxWeekKm) * 100))}%` }}
                />
              </button>
            ))}
          </div>
          <div className="training-ramp-history-legend">
            <span>
              <i className="training-ramp-fill-green" /> ≤10%
            </span>
            <span>
              <i className="training-ramp-fill-orange" /> 10–20%
            </span>
            <span>
              <i className="training-ramp-fill-red" /> &gt;20%
            </span>
          </div>
          {selectedWeek ? (
            <div className="training-week-detail">
              <div className="training-week-detail-head">
                <strong>Semaine du {selectedWeek.weekStartKey}</strong>
                <span>
                  {selectedWeek.weekKm.toFixed(1)} km
                  {selectedWeek.changePct != null &&
                    ` (${selectedWeek.changePct > 0 ? "+" : ""}${selectedWeek.changePct.toFixed(1)}% vs semaine précédente: ${selectedWeek.previousWeekKm.toFixed(1)} km)`}
                </span>
              </div>
              <div className="training-week-detail-days">
                {selectedDays.map((day, index) => (
                  <div key={day.dateKey} className="training-week-detail-day">
                    <span className="training-week-detail-km">{day.km > 0 ? day.km.toFixed(1) : "—"}</span>
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
            <p className="training-meta">Clique sur une semaine pour voir la répartition jour par jour.</p>
          )}
        </div>

        <p className="training-meta">
          Repère indicatif (pas une certitude médicale): +10%/semaine ou moins = marge raisonnable, +10 à +20% =
          progression rapide à surveiller, plus de +20% = risque de blessure de surutilisation (dont périostite)
          nettement accru.
        </p>
      </div>

      {hasShinPain && <><div className="training-rehab-summary">
        <div>
          <span>Cette semaine</span>
          <strong>{periostitis.currentWeekKm.toFixed(1)} km</strong>
        </div>
        <div>
          <span>Plafond semaine</span>
          <strong>{periostitis.weeklyCapKm.toFixed(1)} km</strong>
        </div>
        <div>
          <span>Reste semaine</span>
          <strong>{periostitis.weekRemainingKm.toFixed(1)} km</strong>
        </div>
      </div>

      <div className="training-rehab-progress" aria-label="Utilisation du plafond de reprise">
        <span style={{ width: `${periostitis.weeklyCapKm > 0 ? Math.min(100, periostitis.currentWeekKm / periostitis.weeklyCapKm * 100) : 0}%` }} />
      </div>
      <div className="training-rehab-progress-labels">
        <span>Couru {periostitis.currentWeekKm.toFixed(1)} km</span>
        <span>Limite {periostitis.weeklyCapKm.toFixed(1)} km</span>
      </div>

      <a className="training-plan-link" href="#plan-semaine">
        Voir comment le reste de la semaine et S+1 sont recalculés →
      </a>
      </>}

      <p className="training-meta">
        {hasShinPain
          ? "Ne commence la reprise que si tu peux marcher 30 min sans douleur. Le plafond de +10 % n'est jamais un objectif obligatoire. Si la douleur augmente, devient vive ou persiste plus de 24–48 h: arrêt et retour à l'étape précédente."
          : "Estimation dynamique (pas une certitude médicale). Si une douleur apparaît ou augmente: stoppe la séance et active le mode périostite."}
        {metrics.overrunToday > 0
          ? ` Tu as déjà dépassé de ${metrics.overrunToday.toFixed(1)} km, prudence renforcée demain.`
          : ""}
      </p>

      <details className="training-details">
        <summary>Voir le détail du calcul</summary>
        <p className="training-meta">
          28 derniers jours (runs): Acute 7j {metrics.acute7Km} km, Chronic 28j {metrics.chronic28AvgKm} km/sem.
        </p>
        <p className="training-meta">
          Déjà couru aujourd'hui: {metrics.kmToday.toFixed(1)} km. Hier: {metrics.kmYesterday.toFixed(1)} km.
          Plafond ACR du jour: {metrics.maxKmNow.toFixed(1)} km.
          {hasShinPain && ` Plafond reprise périostite restant: ${periostitis.remainingTodayKm.toFixed(1)} km. Semaine précédente: ${periostitis.previousWeekKm.toFixed(1)} km.`}
        </p>
        <p className="training-meta">
          Ajustements: récup +{metrics.recoveryBoostPct.toFixed(1)}% ({metrics.restDaysBeforeToday} jour(s) repos),
          fatigue -{metrics.fatiguePenaltyPct.toFixed(1)}%, report -{metrics.carryoverPenaltyPct.toFixed(1)}%.
        </p>
        <p className="training-meta">
          Fiabilité: {metrics.confidence} ({metrics.confidenceScore}%) • jours actifs 28j: {metrics.activeDays28} •
          variabilité: {metrics.variability}.
        </p>
        <p className="training-meta">
          Brut ACR: aujourd'hui {metrics.maxKmNowRaw.toFixed(3)} km, ajusté {metrics.maxKmNowAdjustedRaw.toFixed(3)} km,
          final {metrics.maxKmNowFinalRaw.toFixed(3)} km. Dépassement hier: {metrics.yesterdayOverrunKm.toFixed(1)} km.
          Hier (brut): {metrics.maxKmNowYesterdayRaw.toFixed(3)} km (delta {deltaSign}
          {deltaRaw.toFixed(3)} km).
        </p>
      </details>
    </section>
  );
}
