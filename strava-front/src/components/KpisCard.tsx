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
  km4: number;
  km12: number;
  acuteChronicRatio: number;
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
        <div className="kpi-tile">
          <div className="kpi-label">AC Ratio</div>
          <div className="kpi-value">{k.acuteChronicRatio}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Km (4 sem.)</div>
          <div className="kpi-value">{k.km4}</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Km (12 sem.)</div>
          <div className="kpi-value">{k.km12}</div>
        </div>
      </div>
    </div>
  );
}

export default function KpisCard({
  allTime,
  currentYear,
  previousYear,
}: {
  allTime: Kpis;
  currentYear: Kpis;
  previousYear: Kpis;
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

  return (
    <div className="kpis-sections">
      <KpisSection title={`${year}`} k={currentYear} />
      <KpisSection title={`${year - 1}`} k={previousYear} />
      <KpisSection title={`Depuis le ${firstActivityLabel}`} k={allTime} />
    </div>
  );
}
