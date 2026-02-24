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

type TemplateDay = {
  type: SessionType;
  ratio: number;
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

function paceFromSecPerKm(secPerKm: number) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function buildTemplate(level: "high" | "medium" | "low"): TemplateDay[] {
  // Default template kept as fallback only.
  if (level === "high") {
    return [
      { type: "rest", ratio: 0 },
      { type: "easy", ratio: 0.35 },
      { type: "rest", ratio: 0 },
      { type: "easy", ratio: 0.25 },
      { type: "rest", ratio: 0 },
      { type: "rest", ratio: 0 },
      { type: "long", ratio: 0.4 },
    ];
  }

  if (level === "medium") {
    return [
      { type: "rest", ratio: 0 },
      { type: "interval", ratio: 0.26 },
      { type: "easy", ratio: 0.18 },
      { type: "rest", ratio: 0 },
      { type: "tempo", ratio: 0.24 },
      { type: "rest", ratio: 0 },
      { type: "long", ratio: 0.32 },
    ];
  }

  return [
    { type: "easy", ratio: 0.18 },
    { type: "rest", ratio: 0 },
    { type: "interval", ratio: 0.24 },
    { type: "easy", ratio: 0.16 },
    { type: "rest", ratio: 0 },
    { type: "tempo", ratio: 0.18 },
    { type: "long", ratio: 0.24 },
  ];
}

function minKmForType(type: SessionType) {
  if (type === "rest") return 0;
  if (type === "long") return 8;
  return 5;
}

function templateMinKm(template: TemplateDay[]) {
  return template.reduce((acc, t) => acc + minKmForType(t.type), 0);
}

function hasConsecutiveRuns(template: TemplateDay[]) {
  for (let i = 1; i < template.length; i++) {
    if (template[i - 1].type !== "rest" && template[i].type !== "rest") return true;
  }
  return false;
}

function getCandidateTemplates(level: "high" | "medium" | "low"): TemplateDay[][] {
  if (level === "high") {
    return [
      // 3 runs, no consecutive days
      [
        { type: "rest", ratio: 0 },
        { type: "easy", ratio: 0.35 },
        { type: "rest", ratio: 0 },
        { type: "easy", ratio: 0.25 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "long", ratio: 0.4 },
      ],
      // 2 runs, no consecutive days
      [
        { type: "rest", ratio: 0 },
        { type: "easy", ratio: 0.42 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "long", ratio: 0.58 },
      ],
    ];
  }

  if (level === "medium") {
    return [
      // 4 runs, fully spaced
      [
        { type: "rest", ratio: 0 },
        { type: "interval", ratio: 0.26 },
        { type: "easy", ratio: 0.18 },
        { type: "rest", ratio: 0 },
        { type: "tempo", ratio: 0.24 },
        { type: "rest", ratio: 0 },
        { type: "long", ratio: 0.32 },
      ],
      // 3 runs, fully spaced
      [
        { type: "rest", ratio: 0 },
        { type: "interval", ratio: 0.3 },
        { type: "rest", ratio: 0 },
        { type: "easy", ratio: 0.24 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "long", ratio: 0.46 },
      ],
      // 2 runs fallback
      [
        { type: "rest", ratio: 0 },
        { type: "easy", ratio: 0.4 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "rest", ratio: 0 },
        { type: "long", ratio: 0.6 },
      ],
    ];
  }

  return [
    // 5 runs with no consecutive days
    [
      { type: "easy", ratio: 0.18 },
      { type: "rest", ratio: 0 },
      { type: "interval", ratio: 0.24 },
      { type: "easy", ratio: 0.16 },
      { type: "rest", ratio: 0 },
      { type: "tempo", ratio: 0.18 },
      { type: "long", ratio: 0.24 },
    ],
    // 4 runs fallback
    [
      { type: "rest", ratio: 0 },
      { type: "interval", ratio: 0.25 },
      { type: "easy", ratio: 0.2 },
      { type: "rest", ratio: 0 },
      { type: "tempo", ratio: 0.22 },
      { type: "rest", ratio: 0 },
      { type: "long", ratio: 0.33 },
    ],
    // 3 runs fallback
    [
      { type: "rest", ratio: 0 },
      { type: "interval", ratio: 0.28 },
      { type: "rest", ratio: 0 },
      { type: "easy", ratio: 0.24 },
      { type: "rest", ratio: 0 },
      { type: "rest", ratio: 0 },
      { type: "long", ratio: 0.48 },
    ],
  ];
}

function buildPlan(rows: Activity[], predictions?: Predictions | null) {
  const now = new Date();
  const runs = rows
    .filter((r) => RUN_TYPES.has(r.sport_type))
    .map((r) => ({ ...r, date: toDate(r.start_date_local) }))
    .filter((r) => r.date != null)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime());

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
  const km7 = runs7.reduce((acc, r) => acc + r.distance / 1000, 0);
  const km28 = runs28.reduce((acc, r) => acc + r.distance / 1000, 0);
  const chronicWeek = km28 / 4;
  const acr = chronicWeek > 0 ? km7 / chronicWeek : 0;

  const hrSamples = runs28.filter((r) => typeof r.average_heartrate === "number");
  const hrCoverage = runs28.length > 0 ? hrSamples.length / runs28.length : 0;

  let level: "high" | "medium" | "low" = "medium";
  if (acr > 1.3) level = "high";
  else if (acr < 0.85) level = "low";

  // Anchor next week on recent reality (last 7d) to avoid incoherent drops.
  // Even in a deload week, we cap the drop relative to last week.
  let targetKm = chronicWeek;
  if (level === "high") {
    // Deload but avoid collapsing too far below recent load.
    targetKm = Math.max(chronicWeek * 0.9, km7 * 0.9);
  } else if (level === "low") {
    // Progression block: slight increase from recent week.
    targetKm = Math.max(chronicWeek * 1.04, km7 * 1.03);
  } else {
    // Stabilization around current week/chronic blend.
    targetKm = Math.max(chronicWeek, km7 * 0.98);
  }

  targetKm = clamp(targetKm, 10, Math.max(18, km7 * 1.08, chronicWeek * 1.15));
  targetKm = round1(targetKm);

  // 4-week microcycle: progressive ramp, with deload first when ACR is high.
  const progressionFactors =
    level === "high"
      ? [1.0, 1.06, 1.1, 0.92]
      : level === "medium"
      ? [1.0, 1.04, 1.08, 0.9]
      : [1.0, 1.05, 1.1, 0.92];
  const progression: WeekTarget[] = progressionFactors.map((f, i) => ({
    label: `S+${i + 1}`,
    km: round1(targetKm * f),
  }));

  const candidates = getCandidateTemplates(level);
  const template =
    candidates.find((c) => templateMinKm(c) <= targetKm && !hasConsecutiveRuns(c)) ??
    candidates.find((c) => templateMinKm(c) <= targetKm) ??
    buildTemplate(level);
  const monday = nextMonday(now);
  const sessions: PlannedSession[] = template.map((item, idx) => ({
    date: addDays(monday, idx),
    type: item.type,
    ratio: item.ratio,
    km: 0,
    title: "",
    details: "",
  }));

  const runIndexes = sessions.map((s, i) => (s.type === "rest" ? -1 : i)).filter((i) => i >= 0);
  let allocated = 0;
  for (const idx of runIndexes) {
    const km = round1(targetKm * sessions[idx].ratio);
    sessions[idx].km = Math.max(minKmForType(sessions[idx].type), km);
    allocated += sessions[idx].km;
  }
  const diff = round1(targetKm - allocated);
  if (runIndexes.length > 0 && Math.abs(diff) >= 0.1) {
    const lastRun = runIndexes[runIndexes.length - 1];
    sessions[lastRun].km = round1(Math.max(3, sessions[lastRun].km + diff));
  }

  const fiveKSec = predictions?.predictions?.["5k"];
  const pace5k = typeof fiveKSec === "number" && fiveKSec > 0 ? fiveKSec / 5 : null;
  const rep400Sec = pace5k ? Math.round(pace5k * 0.4) : null;
  const rep1000Pace = pace5k ? paceFromSecPerKm(pace5k + 12) : null;

  for (const s of sessions) {
    if (s.type === "rest") {
      s.title = "Repos / mobilité";
      s.details = "Repos complet ou 20 min mobilité/renfo léger.";
      continue;
    }
    if (s.type === "easy") {
      s.title = "Endurance facile";
      s.details = `${s.km.toFixed(1)} km facile, respiration aisée (zone confortable).`;
      continue;
    }
    if (s.type === "tempo") {
      s.title = "Tempo contrôlé";
      s.details = `${s.km.toFixed(1)} km dont 15-20 min soutenu mais contrôlé.`;
      continue;
    }
    if (s.type === "long") {
      s.title = "Sortie longue";
      s.details = `${s.km.toFixed(1)} km en endurance, régulier sans forcer.`;
      continue;
    }
    const intervalPartKm = Math.max(1.6, s.km - 3);
    const reps = Math.max(4, Math.min(10, Math.round(intervalPartKm / 0.4)));
    s.title = "Fractionné";
    s.details = rep400Sec
      ? `${s.km.toFixed(1)} km total: 2 km échauff + ${reps} x 400 m en ${rep400Sec}s (récup 200 m trot) + retour calme.`
      : `${s.km.toFixed(1)} km total: 2 km échauff + ${reps} x 400 m allure 5K + retour calme.`;
    if (rep1000Pace) {
      s.details += ` Alternative: 4 x 1 km en ${rep1000Pace}.`;
    }
  }

  const reasons = [
    `Charge récente: 7j ${round1(km7)} km, 28j ${round1(km28)} km (ACR ${round1(acr)}).`,
    `Objectif semaine prochaine: ${targetKm.toFixed(1)} km (${level === "high" ? "allégée contrôlée" : level === "low" ? "progressive" : "stabilisée"}).`,
    `Ancrage dernière semaine: ${round1(km7)} km (évite une chute de charge trop forte).`,
    `Répartition: ${runIndexes.length} séance(s), sans enchaînement dur sur jours consécutifs.`,
    `Progression prévue ensuite: hausse graduelle, puis semaine de délestage.`,
    `Couverture FC: ${Math.round(hrCoverage * 100)}%.`,
  ];

  return { targetKm, level, sessions, progression, reasons };
}

const DAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function WeeklyTrainingPlanCard({
  rows,
  predictions,
}: {
  rows: Activity[];
  predictions?: Predictions | null;
}) {
  const plan = buildPlan(rows, predictions);

  return (
    <section className="weekly-plan-card">
      <div className="weekly-plan-head">
        <div className="weekly-plan-title">Plan semaine suivante</div>
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
