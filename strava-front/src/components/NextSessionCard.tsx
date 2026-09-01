import { computeTrainingLoad } from "../utils/trainingLoad";
import { parseStravaLocalDate } from "../utils/dateBuckets";
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

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

function paceFromSecPerKm(secPerKm: number) {
  const rounded = Math.round(secPerKm);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}:${String(s).padStart(2, "0")}/km`;
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

  const inLastDays = (days: number) =>
    runs.filter((r) => {
      const ageMs = now.getTime() - r.date!.getTime();
      return ageMs >= 0 && ageMs <= days * 24 * 3600 * 1000;
    });

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

  const remainingToday = metrics.remainingNow;

  const fiveKSec = predictions?.predictions?.["5k"];
  const pace5k = typeof fiveKSec === "number" && fiveKSec > 0 ? fiveKSec / 5 : null;
  const rep400 = pace5k ? Math.round(pace5k * 0.4) : null;
  const rep1000 = pace5k ? Math.round(pace5k + 12) : null; // ~5K pace + 12s/km

  const reasons: string[] = [];
  reasons.push(`Charge 7j ${round1(km7)} km, 28j ${round1(km28)} km (ACR ${round1(acr)}).`);
  if (hrCoverage > 0) reasons.push(`Données FC sur ${Math.round(hrCoverage * 100)}% des sorties récentes.`);
  if (hadHard48h) reasons.push("Séance intense détectée dans les 48 dernières heures.");

  if (hasShinPain) {
    const rehabKm = metrics.periostitis.remainingTodayKm;
    const requiresRest = metrics.periostitis.ranYesterday || rehabKm < 0.5;
    return {
      type: "rehab",
      title: requiresRest ? "Repos périostite" : "Reprise périostite très progressive",
      plan: requiresRest
        ? "Pas de course aujourd'hui. Marche uniquement si indolore, ou cardio sans impact très facile."
        : `Course-marche très facile: maximum ${round1(rehabKm)} km, terrain plat, sans fractionné ni côtes. Arrête si la douleur apparaît ou augmente.`,
      why: [
        ...reasons,
        `Plafond périostite cette semaine: ${metrics.periostitis.weeklyCapKm.toFixed(1)} km.`,
        metrics.periostitis.ranYesterday
          ? "Une sortie a été détectée hier: au moins un jour sans impact est conseillé."
          : "Progression limitée à 10% maximum par semaine.",
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
                stepDistance(`Course-marche facile ${round1(rehabKm)} km`, Math.round(rehabKm * 1000), "Active"),
                stepTime("Marche retour au calme", 600, "Resting"),
              ],
            },
    };
  }

  if (hadHard48h) {
    const easyKm = Math.max(0, Math.min(remainingToday, 6.0));
    return {
      type: "recovery",
      title: "Séance récupération",
      plan:
        remainingToday <= 1.5
          ? `0-${round1(remainingToday)} km très facile (ou vélo doux / repos).`
          : `${easyKm.toFixed(1)} km très faciles, allure confortable.`,
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
      title: "Séance courte uniquement",
      plan: `Budget du jour limité: max ${round1(remainingToday)} km facile. Pas de fractionné aujourd'hui.`,
      why: [...reasons, `Budget restant calculé aujourd'hui: ${round1(remainingToday)} km.`],
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
  if (acr >= 0.85 && acr <= 1.2 && remainingToday >= qualityDistanceKm) {
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
      title: "Séance qualité (fractionné)",
      plan:
        rep400 && rep1000
          ? `Option A: 6 x 400 m en ${rep400}s (récup 200 m trot). Option B: 4 x 1 km en ${paceFromSecPerKm(
              rep1000
            )} (récup 2').`
          : "Option A: 6 x 400 m allure 5K (récup 200 m trot). Option B: 4 x 1 km allure 10K (récup 2').",
      why: [...reasons, `Séance exportée : ${qualityDistanceKm.toFixed(1)} km sur un budget de ${round1(remainingToday)} km.`],
      confidence: hrCoverage >= 0.5 ? "haute" : "moyenne",
      workout: qualityWorkout,
    };
  }

  const easyKm = Math.max(0, Math.min(remainingToday, 8.0));
  return {
    type: "build",
    title: "Séance endurance active",
    plan: `${easyKm.toFixed(1)} km en endurance contrôlée.`,
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
}: {
  rows: Activity[];
  predictions?: Predictions | null;
  hasShinPain: boolean;
}) {
  const rec = analyze(rows, predictions, hasShinPain);
  const confClass =
    rec.confidence === "haute" ? "next-conf-high" : rec.confidence === "moyenne" ? "next-conf-medium" : "next-conf-low";

  return (
    <section className="next-session-card">
      <div className="next-session-head">
        <div className="next-session-title">Prochaine séance conseillée</div>
        <span className={`next-session-conf ${confClass}`}>Fiabilité {rec.confidence}</span>
      </div>
      <div className="next-session-type">{rec.title}</div>
      <div className="next-session-plan">{rec.plan}</div>
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
          <div className="next-session-export-hint">
            Fichier TCX pour montre ou application d'entraînement compatible.
          </div>
        </div>
      )}
      <ul className="next-session-why">
        {rec.why.map((r, i) => (
          <li key={`${r}-${i}`}>{r}</li>
        ))}
      </ul>
    </section>
  );
}
