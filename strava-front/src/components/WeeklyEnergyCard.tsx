import { activeCalories } from "../utils/activityEnergy";

type Activity = {
  id: number;
  sport_type: string;
  moving_time: number;
  total_elevation_gain?: number;
  start_date_local: string;
  average_speed?: number;
  calories?: number;
};

function summarize(
  rows: Activity[],
  start: Date,
  end: Date,
  athleteWeightKg?: number
) {
  const activities = rows.filter((activity) => {
    const date = new Date(activity.start_date_local);
    return date >= start && date < end;
  });
  const energy = activities
    .map((activity) => activeCalories(activity, athleteWeightKg))
    .filter((value): value is NonNullable<typeof value> => value != null);

  return {
    kcal: energy.reduce((sum, item) => sum + item.value, 0),
    activeHours: activities.reduce(
      (sum, activity) => sum + Math.max(0, activity.moving_time),
      0
    ) / 3600,
    estimated: energy.some((item) => item.estimated),
    coveredActivities: energy.length,
    totalActivities: activities.length,
  };
}

export default function WeeklyEnergyCard({
  rows,
  athleteWeightKg,
}: {
  rows: Activity[];
  athleteWeightKg?: number;
}) {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(now.getDate() - 14);

  const current = summarize(rows, sevenDaysAgo, now, athleteWeightKg);
  const previous = summarize(rows, fourteenDaysAgo, sevenDaysAgo, athleteWeightKg);
  const delta =
    previous.kcal > 0 ? ((current.kcal - previous.kcal) / previous.kcal) * 100 : null;
  const formatKcal = (value: number) =>
    Math.round(value).toLocaleString("fr-FR");

  return (
    <section className="weekly-energy-card">
      <div className="panel-head">Énergie et activité — 7 jours</div>
      <div className="weekly-energy-grid">
        <div className="kpi-tile">
          <div className="kpi-label">Calories actives</div>
          <div className="kpi-value">
            {current.coveredActivities > 0 ? `${formatKcal(current.kcal)} kcal` : "—"}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Temps d’activité</div>
          <div className="kpi-value">{current.activeHours.toFixed(1)} h</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Évolution sur 7 jours</div>
          <div className="kpi-value">
            {delta == null ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta)} %`}
          </div>
        </div>
      </div>
      <p className="training-meta">
        {current.coveredActivities === 0
          ? "Calories indisponibles: renseigne ton poids dans Strava pour permettre l’estimation."
          : `${current.estimated ? "Estimation" : "Mesure Strava"} sur ${current.coveredActivities}/${current.totalActivities} activité(s). Comparaison avec les 7 jours précédents.`}
      </p>
    </section>
  );
}
