import { computeTrainingLoad } from "../utils/trainingLoad";

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

type SessionType = "rest" | "easy" | "tempo" | "interval" | "long";

type PlannedSession = {
  date: Date;
  type: SessionType;
  ratio: number;
  km: number;
  title: string;
  details: string;
};

type WeekTarget = {
  label: string;
  km: number;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function toDate(value: string) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function nextMonday(from: Date) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const jsDay = d.getDay(); // 0 sunday
  const offset = jsDay === 0 ? 1 : 8 - jsDay;
  d.setDate(d.getDate() + offset);
  return d;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getRuns(rows: Activity[]) {
  return rows
    .filter((r) => RUN_TYPES.has(r.sport_type))
    .map((r) => ({ ...r, date: toDate(r.start_date_local) }))
    .filter((r) => r.date != null)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime());
}

function buildNormalPlan(rows: Activity[]) {
  const now = new Date();
  const runs = getRuns(rows);
  if (runs.length === 0) {
    return {
      targetKm: 0,
      level: "high" as const,
      sessions: [] as PlannedSession[],
      progression: [] as WeekTarget[],
      reasons: ["Aucune sortie run exploitable pour construire une semaine."],
    };
  }

  const inLastDays = (days: number) =>
    runs.filter((r) => now.getTime() - r.date!.getTime() <= days * 24 * 3600 * 1000);
  const runs7 = inLastDays(7);
  const runs28 = inLastDays(28);
  const km7 = runs7.reduce((sum, run) => sum + run.distance / 1000, 0);
  const km28 = runs28.reduce((sum, run) => sum + run.distance / 1000, 0);
  const chronicWeek = km28 / 4;
  const acr = chronicWeek > 0 ? km7 / chronicWeek : 0;
  const level: "high" | "medium" | "low" = acr > 1.3 ? "high" : acr < 0.85 ? "low" : "medium";

  let targetKm =
    level === "high"
      ? Math.max(chronicWeek * 0.9, km7 * 0.9)
      : level === "low"
      ? Math.max(chronicWeek * 1.04, km7 * 1.03)
      : Math.max(chronicWeek, km7 * 0.98);
  targetKm = round1(clamp(targetKm, 10, Math.max(18, km7 * 1.08, chronicWeek * 1.15)));

  const templates: Record<"high" | "medium" | "low", { day: number; type: SessionType; ratio: number }[]> = {
    high: [
      { day: 1, type: "easy", ratio: 0.35 },
      { day: 3, type: "easy", ratio: 0.25 },
      { day: 6, type: "long", ratio: 0.4 },
    ],
    medium: [
      { day: 1, type: "interval", ratio: 0.26 },
      { day: 3, type: "easy", ratio: 0.18 },
      { day: 5, type: "tempo", ratio: 0.24 },
      { day: 6, type: "long", ratio: 0.32 },
    ],
    low: [
      { day: 0, type: "easy", ratio: 0.18 },
      { day: 2, type: "interval", ratio: 0.24 },
      { day: 4, type: "easy", ratio: 0.16 },
      { day: 5, type: "tempo", ratio: 0.18 },
      { day: 6, type: "long", ratio: 0.24 },
    ],
  };
  const template = templates[level];
  const monday = nextMonday(now);
  const sessions: PlannedSession[] = Array.from({ length: 7 }, (_, day) => {
    const planned = template.find((item) => item.day === day);
    if (!planned) {
      return {
        date: addDays(monday, day), type: "rest", ratio: 0, km: 0,
        title: "Repos / mobilité", details: "Repos complet ou 20 min de mobilité/renforcement léger.",
      };
    }
    const km = round1(targetKm * planned.ratio);
    const descriptions: Record<Exclude<SessionType, "rest">, [string, string]> = {
      easy: ["Endurance facile", `${km.toFixed(1)} km facile, respiration aisée.`],
      interval: ["Fractionné", `${km.toFixed(1)} km total avec fractionné court et récupération au trot.`],
      tempo: ["Tempo contrôlé", `${km.toFixed(1)} km dont 15–20 min soutenues mais contrôlées.`],
      long: ["Sortie longue", `${km.toFixed(1)} km en endurance régulière, sans forcer.`],
    };
    const [title, details] = descriptions[planned.type as Exclude<SessionType, "rest">];
    return { date: addDays(monday, day), ...planned, km, title, details };
  });

  const factors = level === "high" ? [1, 1.06, 1.1, 0.92] : level === "medium" ? [1, 1.04, 1.08, 0.9] : [1, 1.05, 1.1, 0.92];
  const progression = factors.map((factor, index) => ({ label: `S+${index + 1}`, km: round1(targetKm * factor) }));
  const reasons = [
    `Mode normal: charge 7j ${round1(km7)} km, moyenne 28j ${round1(chronicWeek)} km/sem. (ACR ${round1(acr)}).`,
    `Objectif semaine prochaine: ${targetKm.toFixed(1)} km (${level === "high" ? "allégée" : level === "low" ? "progressive" : "stabilisée"}).`,
    "Calcul normal conservé; active Douleur périostite = Oui pour passer au plan de reprise prudent.",
  ];
  return { targetKm, level, sessions, progression, reasons };
}

function buildRehabPlan(rows: Activity[]) {
  const now = new Date();
  const runs = getRuns(rows);

  if (runs.length === 0) {
    return {
      targetKm: 0,
      level: "high" as const,
      sessions: [] as PlannedSession[],
      progression: [] as WeekTarget[],
      reasons: ["Aucune sortie run exploitable pour construire une semaine."],
    };
  }

  const rehab = computeTrainingLoad(rows).periostitis;
  const targetKm = rehab.weeklyCapKm;
  const monday = nextMonday(now);
  const runDays = targetKm < 6 ? [1, 5] : [1, 3, 6];
  const ratios = runDays.length === 2 ? [0.45, 0.55] : [0.3, 0.3, 0.4];
  const sessions: PlannedSession[] = Array.from({ length: 7 }, (_, idx) => {
    const runPosition = runDays.indexOf(idx);
    if (runPosition < 0) {
      return {
        date: addDays(monday, idx),
        type: "rest",
        ratio: 0,
        km: 0,
        title: "Repos / sans impact",
        details: "Repos, mobilité douce, natation ou vélo facile si totalement indolore.",
      };
    }

    const km = round1(targetKm * ratios[runPosition]);
    return {
      date: addDays(monday, idx),
      type: "easy",
      ratio: ratios[runPosition],
      km,
      title: runPosition === 0 ? "Course-marche test" : "Endurance très facile",
      details: `${km.toFixed(1)} km max, plat et sans objectif d'allure. Arrêt immédiat si la douleur augmente.`,
    };
  });

  const progression: WeekTarget[] = rehab.progression.map((week, index) => ({
    label: `S+${index + 1}`,
    km: week.km,
  }));
  const reasons = [
    `Mode reprise périostite: ${runDays.length} sorties faciles, toujours séparées par au moins un jour sans course.`,
    `Semaine précédente: ${rehab.previousWeekKm.toFixed(1)} km; plafond proposé: ${targetKm.toFixed(1)} km (+10 % maximum).`,
    "Aucun fractionné, tempo, côte ou sortie longue pendant cette phase.",
    "Ne progresse que si la marche et la course sont indolores et si aucune réaction ne persiste au-delà de 24–48 h.",
    "En cas de douleur: stop, repos et retour à la semaine précédente; avis médical si douleur vive, localisée ou persistante.",
  ];

  return { targetKm, level: "high" as const, sessions, progression, reasons };
}

const DAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function WeeklyTrainingPlanCard({
  rows,
  hasShinPain,
}: {
  rows: Activity[];
  predictions?: Predictions | null;
  hasShinPain: boolean;
}) {
  const plan = hasShinPain ? buildRehabPlan(rows) : buildNormalPlan(rows);

  return (
    <section className="weekly-plan-card">
      <div className="weekly-plan-head">
        <div className="weekly-plan-title">
          Plan semaine suivante {hasShinPain ? "• reprise périostite" : "• normal"}
        </div>
        <div className="weekly-plan-target">{plan.targetKm.toFixed(1)} km cible</div>
      </div>

      <div className="weekly-plan-grid">
        {plan.sessions.map((s, idx) => (
          <article key={`${s.date.toISOString()}-${idx}`} className={`weekly-plan-item weekly-plan-${s.type}`}>
            <div className="weekly-plan-day">
              {DAY_SHORT[s.date.getDay()]} {s.date.getDate()}
            </div>
            <div className="weekly-plan-item-title">{s.title}</div>
            <div className="weekly-plan-km">{s.type === "rest" ? "0 km" : `${s.km.toFixed(1)} km`}</div>
            <div className="weekly-plan-detail">{s.details}</div>
          </article>
        ))}
      </div>

      {plan.progression.length > 0 && (
        <div className="weekly-plan-ramp">
          {plan.progression.map((w, i) => (
            <div key={`${w.label}-${i}`} className={`weekly-plan-ramp-item ${i === 0 ? "weekly-plan-ramp-current" : ""}`}>
              <div className="weekly-plan-ramp-label">{w.label}</div>
              <div className="weekly-plan-ramp-km">{w.km.toFixed(1)} km</div>
            </div>
          ))}
        </div>
      )}

      <ul className="weekly-plan-notes">
        {plan.reasons.map((r, i) => (
          <li key={`${r}-${i}`}>{r}</li>
        ))}
      </ul>
    </section>
  );
}
