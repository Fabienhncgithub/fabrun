type Activity = {
  id: number;
  name: string;
  sport_type: string;
  distance: number;        // m
  moving_time: number;     // s
  start_date_local: string;
  average_speed?: number;  // m/s
};

const fmtKm = (m:number) => (m/1000).toFixed(2);
const fmtPace = (v?:number) => {
  if (!v || v<=0) return "-";
  const secPerKm = 1000 / v;
  const m = Math.floor(secPerKm/60), s = Math.round(secPerKm%60);
  return `${m}:${String(s).padStart(2,"0")}/km`;
};

export default function ActivitiesTable({ rows }: { rows: Activity[] }) {
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
            <th className="num">Temps (min)</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0,20).map(a=>(
            <tr key={a.id}>
              <td>{new Date(a.start_date_local).toLocaleDateString()}</td>
              <td>{a.name}</td>
              <td>{a.sport_type}</td>
              <td className="num">{fmtKm(a.distance)}</td>
              <td className="num">{fmtPace(a.average_speed)}</td>
              <td className="num">{Math.round(a.moving_time/60)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
