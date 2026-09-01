import { computeTrainingLoad, type TrainingLoadActivity } from "../utils/trainingLoad";

type Kpis = {
  periodLabel: string;
  firstActivityDate: string | null;
  count: number;
  totalKm: number;
  avgPacePerKm: string;
  maxSpeedKmh: number;
  averageHeartRate: number | null;
  strengthTrainingHours: number;
  longestKm: number;
  totalElevationGain: number;
};

function KpisSection({ title, k }: { title: string; k: Kpis }) {
  return (
    <div className="kpis-section">
      <div className="kpis-section-title">{title}</div>
      <div className="kpis-grid">
        <div className="kpi-tile">
          <div className="kpi-label">Sorties</div>
          <div className="kpi-value">{k.count}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Kilométrage total (course)</div>
          <div className="kpi-value">{k.totalKm} km</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Allure moyenne</div>
          <div className="kpi-value">{k.avgPacePerKm}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Fréquence cardiaque moyenne</div>
          <div className="kpi-value">
            {k.averageHeartRate == null ? "—" : `${k.averageHeartRate} bpm`}
          </div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Musculation</div>
          <div className="kpi-value">{k.strengthTrainingHours} h</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Plus longue sortie</div>
          <div className="kpi-value">{k.longestKm} km</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Dénivelé positif (course + marche)</div>
          <div className="kpi-value">{k.totalElevationGain.toLocaleString("fr-FR")} m</div>
        </div>
      </div>
    </div>
  );
}

export default function KpisCard({
  allTime,
  currentYear,
  previousYear,
  rows,
}: {
  allTime: Kpis;
  currentYear: Kpis;
  previousYear: Kpis;
  rows: TrainingLoadActivity[];
}) {
  const year = new Date().getFullYear();
  const firstActivityLabel = allTime.firstActivityDate
    ? new Intl.DateTimeFormat("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${allTime.firstActivityDate}T00:00:00Z`))
    : "la première activité";

  // Acute:chronic load is a "right now" number, not something that varies
  // per historical year - computed once here (same function TrainingLoadCard
  // uses) instead of duplicated/mismatched per period section below.
  const load = computeTrainingLoad(rows);

  return (
    <div className="kpis-sections">
      <div className="kpis-section">
        <div className="kpis-section-title">Charge actuelle</div>
        <div className="kpis-grid">
          <div className="kpi-tile">
            <div className="kpi-label">AC Ratio (7j / 28j)</div>
            <div className="kpi-value">
              <span className={`training-zone training-zone-${load.zone}`}>
                {load.acr == null ? "—" : load.acr}
              </span>
            </div>
          </div>
          <div className="kpi-tile">
            <div className="kpi-label">Km 7 derniers jours</div>
            <div className="kpi-value">{load.acute7Km} km</div>
          </div>
          <div className="kpi-tile">
            <div className="kpi-label">Moy. km/sem. (28j)</div>
            <div className="kpi-value">{load.chronic28AvgKm} km</div>
          </div>
        </div>
      </div>
      <KpisSection title={`${year}`} k={currentYear} />
      <KpisSection title={`${year - 1}`} k={previousYear} />
      <KpisSection title={`Depuis le ${firstActivityLabel}`} k={allTime} />
    </div>
  );
}
