import { useId } from "react";
import type { Kpis } from "../api";
import "../styles/kpis.scss";

const decimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const heartRate = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function PeriodSummary({ title, k, current = false, allTime = false }: {
  title: string; k: Kpis; current?: boolean; allTime?: boolean;
}) {
  const id = useId();
  return (
    <section className={`activity-period-card${current ? " activity-period-current" : ""}${allTime ? " activity-period-all" : ""}`} aria-labelledby={id}>
      <header className="activity-period-header">
        <h3 id={id}>{title}</h3>
        {current && <span>Année en cours</span>}
      </header>
      <div className="activity-summary-content">
        <dl className="activity-summary-primary">
          <div><dt>Distance courue</dt><dd>{decimal.format(k.totalKm)} <span>km</span></dd></div>
          <div><dt>Sorties de course</dt><dd>{integer.format(k.count)}</dd></div>
        </dl>
        <dl className="activity-summary-metrics">
          <div><dt>Allure moyenne</dt><dd>{k.avgPacePerKm === "-" ? "—" : k.avgPacePerKm}</dd></div>
          <div><dt>FC moyenne · course</dt><dd>{k.averageHeartRate == null ? "—" : <>{heartRate.format(k.averageHeartRate)} <span>bpm</span></>}</dd></div>
          <div><dt>Plus longue course</dt><dd>{decimal.format(k.longestKm)} <span>km</span></dd></div>
          <div><dt>Dénivelé positif</dt><dd>{integer.format(k.totalElevationGain)} <span>m</span></dd><small>Course et marche</small></div>
        </dl>
        <dl className="activity-summary-strength">
          <div><dt>Musculation</dt><dd>{decimal.format(k.strengthTrainingHours)} <span>h</span></dd></div>
        </dl>
      </div>
    </section>
  );
}

export default function KpisCard({ allTime, currentYear, previousYear, twoYearsAgo }: {
  allTime: Kpis; currentYear: Kpis; previousYear: Kpis; twoYearsAgo: Kpis | null;
}) {
  const id = useId();
  const year = new Date().getFullYear();
  const firstActivity = allTime.firstActivityDate ? new Date(`${allTime.firstActivityDate}T00:00:00Z`) : null;
  const firstActivityLabel = firstActivity && !Number.isNaN(firstActivity.getTime())
    ? new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(firstActivity)
    : null;

  return (
    <section className="activity-summary" aria-labelledby={`${id}-title`}>
      <header className="activity-summary-header"><h2 id={`${id}-title`}>Bilan de course et d’activité</h2></header>
      <div className="activity-summary-years">
        {twoYearsAgo && <PeriodSummary title={`${year - 2}`} k={twoYearsAgo} />}
        <PeriodSummary title={`${year - 1}`} k={previousYear} />
        <PeriodSummary title={`${year}`} k={currentYear} current />
      </div>
      <PeriodSummary title={firstActivityLabel ? `Depuis le ${firstActivityLabel}` : "Depuis la première activité"} k={allTime} allTime />
      <details className="activity-summary-method">
        <summary>Quelles activités sont prises en compte ?</summary>
        <p>Les chiffres de course incluent la course à pied, le trail et la course virtuelle. Le dénivelé inclut aussi la marche et la randonnée.</p>
        <p>La FC moyenne concerne uniquement les courses avec une mesure cardiaque. Elle est pondérée par le temps en mouvement ; les sorties longues comptent davantage. Une décimale permet de distinguer les périodes ; « — » indique qu’aucune mesure cardiaque n’est disponible.</p>
      </details>
    </section>
  );
}
