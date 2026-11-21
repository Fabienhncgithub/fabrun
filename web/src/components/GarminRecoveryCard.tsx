import GarminHistoryChart from "./GarminHistoryChart";
import type { GarminState } from "../utils/useGarmin";

import { recoveryContext, sleepHours } from "../utils/garminRecovery";
import "../styles/garminRecovery.scss";

// Garmin state is owned by the dashboard so the training page reads the same snapshot.
export default function GarminRecoveryCard({ garmin }: { garmin: GarminState }) {
  const { configured, recovery: data, loading, error, sync } = garmin;
  const context = data ? recoveryContext(data) : null;
  const night = context?.last;
  const metric = (value: number | null | undefined, unit = "") => value == null ? "Indisponible" : `${value.toLocaleString("fr-CH")}${unit}`;
  return <div className="garmin-recovery">
    <h2>Garmin · Sommeil et récupération</h2>
    {!configured && !loading && <p>Pour connecter ton compte, crée une clé dans <a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noreferrer">Garmin Connect · Personal API Key</a>, puis configure-la sur le serveur FabRun.</p>}
    {configured && <><p>Ta clé Garmin est configurée. Synchronise après avoir transféré les données de ta montre vers Garmin Connect.</p>
      <button type="button" className="btn btn-secondary" disabled={loading} onClick={sync}>{loading ? "Synchronisation…" : "Synchroniser Garmin"}</button></>}
    {error && <p role="alert">{error}</p>}
    {data && context && <>
      <p className="garmin-stamp">Actualisé le {new Date(data.syncedAtUtc).toLocaleString("fr-CH")} · Journée du {data.date}
        {data.lastDeviceSyncUtc && <> · Montre synchronisée le {new Date(data.lastDeviceSyncUtc).toLocaleString("fr-CH")}</>}
        {data.weightKg != null && <> · Poids Garmin : {metric(data.weightKg, " kg")} (pesée du {data.weightDate}), utilisé pour les estimations de calories</>}</p>
      <div className={`garmin-overview ${context.attention ? "garmin-attention" : ""}`}>
        <span className="garmin-eyebrow">Ce que disent tes données</span>
        <h3>{context.stale ? "Le sommeil du jour manque encore" : context.attention ? "Des signaux à surveiller" : "Ton bilan de récupération"}</h3>
        <p>{night ? <>Nuit du {night.date} : <strong>{sleepHours(night.hours)}</strong>.
          {context.shortfall != null && context.shortfall >= 30 ? ` C’est ${context.shortfall} minutes de moins que ta moyenne des 7 derniers jours.` : ""}</> : "Aucune nuit enregistrée dans la période."}
          {context.stale && " Synchronise ta montre avant d’utiliser ce bilan pour la journée."}</p>
        <p>{context.hrvLabel}. {context.attention ? "Tiens compte de ces signaux et de tes sensations avant de choisir l’intensité de ta séance." : "Compare ces repères à tes sensations et à ta charge récente avant de choisir ta séance."}</p>
        <small>Lecture FabRun à partir des mesures Garmin. Aucun score global de récupération n’est calculé ici.</small>
      </div>
      <div className="garmin-grid">
        <article><span className="garmin-eyebrow">01 · Sommeil</span><h3>{sleepHours(night?.hours)}</h3>
          <p>Score Garmin : <strong>{metric(night?.score, " / 100")}</strong> · nuit du {night?.date ?? "—"}</p>
          <p>Moyenne sur 7 jours : <strong>{sleepHours(context.average)}</strong> ({context.count} nuits disponibles).</p>
          <p>La comparaison décrit tes habitudes ; elle ne mesure pas ton besoin de sommeil.</p>
        </article>
        <article><span className="garmin-eyebrow">02 · Équilibre physiologique</span><h3>{context.hrvLabel}</h3>
          <p>Variabilité cardiaque (HRV) : <strong>{metric(data.hrvMs, " ms")}</strong> cette nuit ; moyenne 7 jours : {metric(data.hrvWeeklyMs, " ms")}.</p>
          <p>Plage personnelle Garmin : {metric(data.hrvBaselineLow)} à {metric(data.hrvBaselineHigh, " ms")}.</p>
          <p>La HRV se compare à ta propre plage, pas à celle d’un autre coureur. Le statut ci-dessus vient de Garmin.</p>
        </article>
        <article><span className="garmin-eyebrow">03 · Recharge</span><h3>{metric(data.bodyBatteryAtWake, " / 100")} au réveil</h3>
          <p>Recharge pendant le sommeil : <strong>{metric(data.nightRecharge, " points")}</strong>.</p>
          <p>Dernière Body Battery : {metric(data.bodyBattery, " / 100")}.</p>
          <p>Garmin estime tes réserves d’énergie. La valeur au réveil et la dernière mesure correspondent à des moments différents de la journée.</p>
        </article>
        <article><span className="garmin-eyebrow">04 · Cœur et stress</span><h3>{metric(data.restingHeartRate, " bpm")} au repos</h3>
          <p>Repère moyen sur 7 jours : <strong>{metric(data.restingHeartRate7d, " bpm")}</strong>.</p>
          <p>Stress nocturne : {metric(night?.nightStress, " / 100")} · stress du jour : {metric(data.stress, " / 100")}.</p>
          <p>Le stress Garmin reflète une réponse physiologique, pas uniquement le stress ressenti. La journée en cours reste partielle.</p>
        </article>
      </div>
      <GarminHistoryChart />
      <details className="garmin-details"><summary>Voir les nuits et les mesures détaillées</summary>
        <p>Nuit du {night?.date ?? "—"} · profond : {metric(night?.deepMinutes, " min")} · paradoxal : {metric(night?.remMinutes, " min")} · éveillé : {metric(night?.awakeMinutes, " min")}.</p>
        <p>Respiration nocturne : {metric(night?.respiration, " / min")} · SpO₂ moyenne : {metric(night?.spO2, " %")}.</p>
        <p>Les phases sont des estimations de la montre. Une mesure absente reste « Indisponible ».</p>
        {data.nights.length === 0 ? <p>Aucune nuit disponible.</p> : <div className="garmin-table"><table><caption>Sommeil · 30 derniers jours</caption><thead><tr><th>Date</th><th>Durée</th><th>Score Garmin</th></tr></thead><tbody>
          {[...data.nights].reverse().map(n => <tr key={n.date}><td>{n.date}</td><td>{sleepHours(n.hours)}</td><td>{metric(n.score, " / 100")}</td></tr>)}
        </tbody></table></div>}
      </details>
      <p className="garmin-stamp">Source : Garmin Connect. La préparation à l’entraînement et le temps de récupération Garmin ne sont pas exposés par les routes Personal utilisées ici.</p>
    </>}
  </div>;
}
