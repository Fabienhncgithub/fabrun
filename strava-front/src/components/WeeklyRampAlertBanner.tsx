import { useMemo } from "react";
import { computeWeeklyRampRedStreak, type TrainingLoadActivity } from "../utils/trainingLoad";
import { toneClass } from "../utils/statusTone";

const STREAK_THRESHOLD = 3;

// In-app alert (no push notification infra in this app yet) shown when the
// week-over-week +10% margin has been in the red zone (> +20% vs the prior
// week, see zoneFromWeeklyChangePct in utils/trainingLoad.ts) for several
// days running, so a fast volume ramp - the classic periostitis/overuse
// trigger - doesn't get missed until someone opens TrainingLoadCard.
export default function WeeklyRampAlertBanner({ rows }: { rows: TrainingLoadActivity[] }) {
  const streak = useMemo(() => computeWeeklyRampRedStreak(rows), [rows]);
  if (streak < STREAK_THRESHOLD) return null;

  return (
    <div className={`acr-alert-banner ${toneClass("bad")}`} role="alert">
      <span className="acr-alert-icon" aria-hidden>
        ⚠
      </span>
      <div>
        <strong>Progression hebdomadaire au-delà de +20% depuis {streak} jours.</strong>{" "}
        C'est bien au-delà de la règle des +10%/semaine : risque de blessure de surutilisation (périostite,
        tendinopathies) nettement accru. Réduis le volume ou ajoute un jour de repos avant de continuer à monter.
      </div>
    </div>
  );
}
