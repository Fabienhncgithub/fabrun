type Activity = {
  id: number;
  name: string;
  sport_type: string;
  distance: number; // m
  moving_time: number; // s
  start_date_local: string;
  average_speed?: number; // m/s
  calories?: number;
  kilojoules?: number;
};

const fmtKm = (m: number) => (m / 1000).toFixed(2);
const fmtPace = (v?: number) => {
  if (!v || v <= 0) return "-";
  const secPerKm = 1000 / v;
  const m = Math.floor(secPerKm / 60),
    s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

const kcalText = (value: number) => Math.round(value).toLocaleString("fr-FR");

const estimateMet = (activity: Activity): number | null => {
  const kmh = activity.average_speed ? activity.average_speed * 3.6 : null;

  switch (activity.sport_type) {
    case "Run":
    case "TrailRun":
    case "VirtualRun":
      if (kmh == null) return 9.8;
      if (kmh < 8) return 8.3;
      if (kmh < 9.5) return 9.8;
      if (kmh < 10.8) return 10.5;
      if (kmh < 12.2) return 11.5;
      if (kmh < 13.8) return 12.3;
      if (kmh < 16) return 12.8;
      return 14.5;
    case "AlpineSki":
      // Conservative average for recreational alpine skiing.
      return 4.8;
    case "WeightTraining":
      // Typical mixed strength session including rest between sets.
      return 3.5;
    case "Ride":
      return 7.0;
    case "Walk":
      return 3.5;
    case "Hike":
      return 5.3;
    default:
      return null;
  }
};

const estimateActiveCalories = (met: number, weightKg: number, movingTimeSec: number) => {
  const hours = movingTimeSec / 3600;
  // Active calories (without resting baseline), closer to sport tracker outputs.
  return Math.max(0, (met - 1) * weightKg * hours);
};

const fmtCalories = (activity: Activity, athleteWeightKg?: number) => {
  const measured = activity.calories ?? activity.kilojoules;
  if (measured && measured > 0) {
    return kcalText(measured);
  }

  if (!athleteWeightKg || athleteWeightKg <= 0) {
    return "-";
  }

  const met = estimateMet(activity);
  if (!met) {
    return "-";
  }

  const estimated = estimateActiveCalories(met, athleteWeightKg, activity.moving_time);
  return `~${kcalText(estimated)}`;
};

type SportVisual = {
  icon: string;
  className: string;
};

const SPORT_VISUALS: Record<string, SportVisual> = {
  Run: { icon: "🏃", className: "sport-run" },
  TrailRun: { icon: "🏃", className: "sport-run" },
  VirtualRun: { icon: "🏃", className: "sport-run" },
  AlpineSki: { icon: "⛷", className: "sport-ski" },
  WeightTraining: { icon: "🏋", className: "sport-strength" },
  Ride: { icon: "🚴", className: "sport-bike" },
  Walk: { icon: "🚶", className: "sport-walk" },
  Hike: { icon: "🥾", className: "sport-hike" },
};

const getSportVisual = (sportType: string): SportVisual =>
  SPORT_VISUALS[sportType] ?? { icon: "🏅", className: "sport-other" };

function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);

  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h${minutes.toString().padStart(2, "0")}`;
}

export default function ActivitiesTable({
  rows,
  athleteWeightKg,
}: {
  rows: Activity[];
  athleteWeightKg?: number;
}) {
  const sorted = [...rows].sort((a, b) => {
    const da = Date.parse(a.start_date_local);
    const db = Date.parse(b.start_date_local);
    return db - da;
  });
  return (
    <div className="activities-table-wrap">
      <table className="activities-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Nom</th>
            <th>Type</th>
            <th className="num">Km</th>
            <th className="num">Allure</th>
            <th className="num">Temps</th>
            <th className="num">Calories(estimation)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 20).map((a) => {
            const visual = getSportVisual(a.sport_type);
            return (
              <tr key={a.id}>
                <td>{new Date(a.start_date_local).toLocaleDateString()}</td>
                <td>{a.name}</td>
                <td className="type-cell">
                  <span className={`sport-badge ${visual.className}`}>
                    <span className="sport-icon" aria-hidden>
                      {visual.icon}
                    </span>
                    <span>{a.sport_type}</span>
                  </span>
                </td>
                <td className="num">{fmtKm(a.distance)}</td>
                <td className="num">{fmtPace(a.average_speed)}</td>
                <td className="num">{formatDuration(a.moving_time)}</td>
                <td className="num">{fmtCalories(a, athleteWeightKg)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
