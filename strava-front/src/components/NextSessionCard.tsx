import { useId } from "react";
import { computeTrainingLoad } from "../utils/trainingLoad";
import { buildNormalPlan, buildRehabPlan } from "../utils/weeklyPlan";
import "../styles/today.scss";
import { addDays, localDateKey, parseStravaLocalDate } from "../utils/dateBuckets";
import {
  buildTcx,
  distanceBudgetSteps,
  downloadTextFile,
  sixByFourHundredSteps,
  stepDistance,
  stepTime,
  type WorkoutExport,
} from "../utils/workoutExport";

type Activity = {
  sport_type: string;
  distance: number; // meters
  moving_time: number; // sec
  start_date_local: string;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
};

type Predictions = {
  predictions?: Record<string, number>;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

function toDate(value: string) {
  return parseStravaLocalDate(value);
}

const formatKm = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m} min ${String(s).padStart(2, "0")} s`;
}

function analyze(rows: Activity[], predictions: Predictions | null | undefined, hasShinPain: boolean) {
  const now = new Date();
  const runs = rows
    .filter((r) => RUN_TYPES.has(r.sport_type))
    .map((r) => ({ ...r, date: toDate(r.start_date_local) }))
    .filter((r) => r.date != null)
    .sort((a, b) => (b.date!.getTime() - a.date!.getTime()));

  if (runs.length === 0) {
    return {
      type: "none",
      title: "Pas assez de données",
      plan: "Ajoute 2-3 sorties pour générer une séance ciblée.",
      why: ["Aucune sortie run exploitable."],
      confidence: "faible",
      workout: null as WorkoutExport | null,
    };
  }

  const todayKey = localDateKey(now);
  const inLastDays = (days: number) => {
    const startKey = localDateKey(addDays(now, -(days - 1)));
    return runs.filter((run) => {
      const key = localDateKey(run.date!);
      return key >= startKey && key <= todayKey;
    });
  };

  const runs28 = inLastDays(28);
  if (runs28.length < 3) {
    return {
      type: "none",
      title: "Pas assez de données récentes",
      plan: "Synchronise au moins trois sorties récentes avant de générer une séance ciblée.",
      why: [`${runs28.length} sortie${runs28.length > 1 ? "s" : ""} exploitable${runs28.length > 1 ? "s" : ""} sur 28 jours.`],
      confidence: "faible",
      workout: null as WorkoutExport | null,
    };
  }
  const metrics = computeTrainingLoad(rows);
  const km7 = metrics.acute7Km;
  const chronicPerWeek = metrics.chronic28AvgKm;
  const km28 = chronicPerWeek * 4;
  const acr = metrics.acr ?? 0;

  const hrSamples = runs28
    .map((r) => ({
      avg: typeof r.average_heartrate === "number" ? r.average_heartrate : null,
      max: typeof r.max_heartrate === "number" ? r.max_heartrate : null,
    }))
    .filter((h) => h.avg != null || h.max != null);
  const hrCoverage = runs28.length > 0 ? hrSamples.length / runs28.length : 0;
  const observedHrMax = Math.max(
    ...hrSamples.map((h) => Math.max(h.max ?? 0, (h.avg ?? 0) + 10)),
    0
  );

  const recent48h = inLastDays(2);
  const hadHard48h = recent48h.some((r) => {
    const avgHr = r.average_heartrate ?? 0;
    const km = r.distance / 1000;
    const longSteadyHard = km >= 10 && r.moving_time >= 45 * 60 && observedHrMax > 0 && avgHr >= observedHrMax * 0.82;
    const intenseByHr = observedHrMax > 0 && avgHr >= observedHrMax * 0.88;
    return intenseByHr || longSteadyHard;
  });

  const selectedPlan = hasShinPain ? buildRehabPlan(rows, now) : buildNormalPlan(rows, now);
  const todaySession = selectedPlan.sessions.find((session) => session.isToday);
  const remainingToday = todaySession?.status === "planned" && todaySession.type !== "rest" ? todaySession.km : 0;

  const fiveKSec = predictions?.predictions?.["5k"];
  const pace5k = typeof fiveKSec === "number" && fiveKSec > 0 ? fiveKSec / 5 : null;
  const rep400 = pace5k ? Math.round(pace5k * 0.4) : null;

  const reasons: string[] = [];
  reasons.push(`Course : ${formatKm(km7)} km sur 7 jours, ${formatKm(km28)} km sur 28 jours. Ratio de charge (ACR) : ${acr.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}.`);
  if (hrCoverage > 0) reasons.push(`Fréquence cardiaque renseignée sur ${Math.round(hrCoverage * 100)} % des sorties récentes.`);
  if (hadHard48h) reasons.push("Une sortie intense a été détectée hier ou aujourd’hui.");

  if (hasShinPain) {
    const rehabKm = remainingToday;
    const requiresRest = metrics.periostitis.ranYesterday || rehabKm < 0.5;
    return {
      type: "rehab",
      title: requiresRest ? "Repos course" : "Course-marche très facile",
      plan: requiresRest
        ? "Pas de course aujourd'hui. Marche uniquement si indolore, ou cardio sans impact très facile."
        : `Au plus ${formatKm(rehabKm)} km sur terrain plat, sans vitesse ni côtes. Reprise seulement si tu peux marcher 30 minutes sans douleur ; arrête si la douleur apparaît.`,
      why: [
        ...reasons,
        `Limite du mode prudent cette semaine : ${formatKm(metrics.periostitis.weeklyCapKm)} km.`,
        metrics.periostitis.ranYesterday
          ? "Une sortie a été détectée hier: au moins un jour sans impact est conseillé."
          : "Le repère de progression hebdomadaire reste une limite, jamais un objectif.",
      ],
      confidence: metrics.confidence,
      workout:
        requiresRest
          ? null
          : {
              fileName: "fabrun-reprise-periostite.tcx",
              workoutName: "FabRun Reprise Periostite",
              steps: [
                stepTime("Marche echauffement", 600, "Resting"),
                stepDistance(`Course-marche facile ${formatKm(rehabKm)} km`, Math.round(rehabKm * 1000), "Active"),
                stepTime("Marche retour au calme", 600, "Resting"),
              ],
            },
    };
  }

  if (remainingToday < 0.5) {
    return {
      type: "rest",
      title: "Repos aujourd'hui",
      plan: "Pas de course aujourd'hui. Marche douce ou cardio sans impact très facile selon ton ressenti.",
      why: [...reasons, `Limite estimée de course supplémentaire : ${formatKm(remainingToday)} km.`],
      confidence: hrCoverage >= 0.5 ? "moyenne" : "faible",
      workout: null as WorkoutExport | null,
    };
  }

  if (hadHard48h) {
    const easyKm = Math.max(0, remainingToday);
    return {
      type: "recovery",
      title: "Footing de récupération",
      plan:
        remainingToday <= 1.5
          ? `Au plus ${formatKm(remainingToday)} km très faciles, ou du repos selon ton ressenti.`
          : `${formatKm(easyKm)} km très faciles, à une allure permettant de parler sans difficulté.`,
      why: reasons,
      confidence: hrCoverage >= 0.5 ? "moyenne" : "faible",
      workout:
        easyKm < 0.5
          ? null
          : {
              fileName: "fabrun-recup.tcx",
              workoutName: "FabRun Recuperation",
              steps: distanceBudgetSteps("Endurance facile", easyKm * 1000),
            },
    };
  }

  if (remainingToday < 3) {
    return {
      type: "recovery",
      title: "Footing court",
      plan: `Au plus ${formatKm(remainingToday)} km en aisance respiratoire. Garde une allure facile.`,
      why: [...reasons, `Limite estimée de course supplémentaire : ${formatKm(remainingToday)} km.`],
      confidence: hrCoverage >= 0.5 ? "moyenne" : "faible",
      workout:
        remainingToday < 0.5
          ? null
          : {
              fileName: "fabrun-court-facile.tcx",
              workoutName: "FabRun Court Facile",
              steps: distanceBudgetSteps("Footing facile", remainingToday * 1000),
            },
    };
  }

  const qualityDistanceKm = 5.6;
  if (todaySession?.type === "interval" && acr >= 0.85 && acr <= 1.2 && remainingToday >= qualityDistanceKm) {
    const qualityWorkout: WorkoutExport | null =
      rep400 == null
        ? null
        : {
            fileName: "fabrun-6x400.tcx",
            workoutName: "FabRun 6x400",
            steps: sixByFourHundredSteps(rep400),
          };

    return {
      type: "quality",
      title: "Fractionné court",
      plan: `6 × 400 m ${rep400 ? `en ${formatDuration(rep400)}` : "à ton allure 5 km"}, avec 200 m au trot entre les répétitions. Échauffement et retour au calme inclus : ${formatKm(qualityDistanceKm)} km au total.`,
      why: [...reasons, `La proposition de ${formatKm(qualityDistanceKm)} km reste sous la limite estimée de ${formatKm(remainingToday)} km.`],
      confidence: hrCoverage >= 0.5 ? "haute" : "moyenne",
      workout: qualityWorkout,
    };
  }

  const easyKm = Math.max(0, remainingToday);
  return {
    type: "build",
    title: "Footing en endurance",
    plan: `${formatKm(easyKm)} km à une allure confortable, en aisance respiratoire.`,
    why: reasons,
    confidence: hrCoverage >= 0.5 ? "moyenne" : "faible",
    workout:
      easyKm < 0.5
        ? null
        : {
            fileName: "fabrun-endurance.tcx",
            workoutName: "FabRun Endurance Active",
            steps: distanceBudgetSteps("Endurance contrôlée", easyKm * 1000),
          },
  };
}

export default function NextSessionCard({
  rows,
  predictions,
  hasShinPain,
  embedded = false,
}: {
  rows: Activity[];
  predictions?: Predictions | null;
  hasShinPain: boolean;
  embedded?: boolean;
}) {
  const rec = analyze(rows, predictions, hasShinPain);
  const titleId = useId();
  const dataDescription =
    rec.confidence === "haute" ? "bien renseignées" : rec.confidence === "moyenne" ? "partielles" : "limitées";

  return (
    <section className={`next-session-card next-session-refined${embedded ? " next-session-embedded" : ""}`} aria-labelledby={titleId}>
      <h4 className="next-session-type" id={titleId}>{rec.title}</h4>
      <div className="next-session-plan">{rec.plan}</div>
      <details className="next-session-details">
        <summary>{rec.workout ? "Détails et export de la séance" : "Pourquoi ce conseil ?"}</summary>
        <span className="next-session-data">Données récentes : {dataDescription}</span>
        <ul className="next-session-why">
          {rec.why.map((reason, index) => (
            <li key={`${reason}-${index}`}>{reason}</li>
          ))}
        </ul>
        {rec.workout && (
          <div className="next-session-export">
            <button
              className="next-session-export-btn"
              type="button"
              onClick={() => {
                const tcx = buildTcx(rec.workout!);
                downloadTextFile(rec.workout!.fileName, tcx);
              }}
            >
              Télécharger la séance (.tcx)
            </button>
            <div className="next-session-export-hint">Pour une montre ou une application compatible TCX.</div>
          </div>
        )}
      </details>
    </section>
  );
}
