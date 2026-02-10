type Kpis = {
  periodLabel: string;
  count: number;
  totalKm: number;
  avgPacePerKm: string;
  bestPacePerKm: string;
  longestKm: number;
  km4: number;
  km12: number;
  acuteChronicRatio: number;
};

export default function KpisCard({ k }: { k: Kpis }) {
  return (
    <div className="kpis-grid">
      <div className="kpi-tile"><div className="kpi-label">Sorties (12 mois)</div><div className="kpi-value">{k.count}</div></div>
      <div className="kpi-tile"><div className="kpi-label">Kilométrage total</div><div className="kpi-value">{k.totalKm} km</div></div>
      <div className="kpi-tile"><div className="kpi-label">Allure moyenne</div><div className="kpi-value">{k.avgPacePerKm}</div></div>
      <div className="kpi-tile"><div className="kpi-label">Meilleure allure</div><div className="kpi-value">{k.bestPacePerKm}</div></div>
      <div className="kpi-tile"><div className="kpi-label">Plus longue sortie</div><div className="kpi-value">{k.longestKm} km</div></div>
      <div className="kpi-tile"><div className="kpi-label">AC Ratio</div><div className="kpi-value">{k.acuteChronicRatio}</div></div>
      <div className="kpi-tile"><div className="kpi-label">Km (4 sem.)</div><div className="kpi-value">{k.km4}</div></div>
      <div className="kpi-tile"><div className="kpi-label">Km (12 sem.)</div><div className="kpi-value">{k.km12}</div></div>
    </div>
  );
}
