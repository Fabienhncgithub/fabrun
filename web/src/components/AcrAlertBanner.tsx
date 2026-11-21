import { useMemo } from "react";
import { computeRedZoneStreak, type TrainingLoadActivity } from "../utils/trainingLoad";
import { toneClass } from "../utils/statusTone";

const STREAK_THRESHOLD = 3;

// In-app alert (no push notification infra in this app yet) shown when the
// ACR has been in the red zone (> 1.5, see utils/trainingLoad.ts) for
// several days running, so it doesn't get missed until someone opens
// TrainingLoadCard.
export default function AcrAlertBanner({ rows }: { rows: TrainingLoadActivity[] }) {
  const streak = useMemo(() => computeRedZoneStreak(rows), [rows]);
  if (streak < STREAK_THRESHOLD) return null;

  return (
    <div className={`acr-alert-banner ${toneClass("bad")}`} role="alert">
      <span className="acr-alert-icon" aria-hidden>
        ⚠
      </span>
      <div>
        <strong>Charge d'entraînement en zone rouge depuis {streak} jours.</strong>{" "}
        La hausse est importante par rapport à ta base récente : privilégie repos ou sorties très courtes avant de reprendre du volume.
      </div>
    </div>
  );
}
