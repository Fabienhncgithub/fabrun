import { useMemo, useState } from "react";

type Kpis = {
  km_last_12_weeks: number; // total sur 12 semaines
  longest_run_km: number; // plus longue sortie (km)
};

const MARATHON = 42.195;

// --- Utils sûrs ---
function toNumberLocaleAware(x: string): number {
  if (!x) return 0;
  return Number(x.replace(",", "."));
}
function clampInt(x: any, min = 0, max = 359): number {
  const n = Number.parseInt(String(x || 0), 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function hmsToSeconds(h: number, m: number, s: number) {
  return Math.max(0, Math.round(h * 3600 + m * 60 + s));
}
function secondsToHMS(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round(total % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function paceFromTotalSecondsFor(distanceKm: number, totalSeconds: number) {
  const secPerKm = totalSeconds / distanceKm;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

const raceDistances = [
  { label: "5 km", value: 5.0 },
  { label: "10 km", value: 10.0 },
  { label: "Semi (21,1 km)", value: 21.0975 },
  // ⚠️ on peut laisser le marathon, mais on traite le cas spécial proprement
  { label: "Marathon (42,195 km)", value: 42.195 },
  { label: "Autre (km)", value: 0 },
];

export default function MarathonPredictor({ kpis }: { kpis?: Kpis }) {
  const [dist, setDist] = useState<number>(10);
  const [customDist, setCustomDist] = useState<string>("");
  const [h, setH] = useState<string>("0");
  const [m, setM] = useState<string>("45");
  const [s, setS] = useState<string>("00");
  const [exponent, setExponent] = useState<number>(1.06);

  const weeklyAvg = kpis ? kpis.km_last_12_weeks / 12 : undefined; // km/sem
  const longest = kpis?.longest_run_km;

  const result = useMemo(() => {
    // Parse propre
    const baseDist = dist > 0 ? dist : toNumberLocaleAware(customDist);
    const H = clampInt(h, 0, 99);
    const M = clampInt(m, 0, 59);
    const S = clampInt(s, 0, 59);
    const t1 = hmsToSeconds(H, M, S);

    // Validations d'usage
    if (!baseDist || baseDist <= 0 || !Number.isFinite(baseDist)) {
      return { error: "Distance de référence invalide." };
    }
    if (baseDist > MARATHON + 1e-6) {
      return {
        error: "La distance de référence ne peut pas dépasser 42,195 km.",
      };
    }
    if (!t1) {
      return { error: "Temps de référence manquant." };
    }

    // Cas spécial : on a saisi un temps sur marathon → pas de Riegel
    if (Math.abs(baseDist - MARATHON) < 1e-6) {
      // Sanity check simple : marathon réaliste > ~120 minutes
      if (t1 < 2 * 3600) {
        return {
          error:
            "Temps marathon irréaliste (< 2h). Utilise plutôt 10 km / semi en référence.",
        };
      }
      const raw = t1;
      const adj = t1; // aucun ajustement quand base == cible
      return {
        input: { baseDist, t1, H, M, S },
        raw,
        adj,
        marathonPace: paceFromTotalSecondsFor(MARATHON, adj),
        splits5k: buildSplits5k(adj),
      };
    }

    // --- Riegel correct ---
    // T2 = T1 * (D2 / D1) ^ exponent
    const raw = t1 * Math.pow(MARATHON / baseDist, exponent);

    // Ajustements prudents (charge / long run) : uniquement si base < marathon
    let penalty = 0;
    if (weeklyAvg !== undefined) {
      if (weeklyAvg < 25) penalty += 4 * 60;
      else if (weeklyAvg < 35) penalty += 2 * 60;
      else if (weeklyAvg < 40) penalty += 60;
    }
    if (longest !== undefined) {
      if (longest < 24) penalty += 3 * 60;
      else if (longest < 28) penalty += 2 * 60;
      else if (longest < 30) penalty += 60;
    }

    const adj = Math.round(raw + penalty);

    return {
      input: { baseDist, t1, H, M, S },
      raw: Math.round(raw),
      adj,
      marathonPace: paceFromTotalSecondsFor(MARATHON, adj),
      splits5k: buildSplits5k(adj),
    };
  }, [dist, customDist, h, m, s, exponent, weeklyAvg, longest]);

  return (
    <div
      style={{
        marginTop: 24,
        padding: 16,
        border: "1px solid #eee",
        borderRadius: 12,
      }}
    >
      <h2>Prévision Marathon (Riegel)</h2>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(2,minmax(0,1fr))",
        }}
      >
        <label>
          Course de référence
          <select
            value={dist}
            onChange={(e) => setDist(parseFloat(e.target.value))}
            style={{ display: "block", marginTop: 4 }}
          >
            {raceDistances.map((d) => (
              <option key={d.label} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>

        {dist === 0 && (
          <label>
            Distance (km)
            <input
              value={customDist}
              onChange={(e) => setCustomDist(e.target.value)}
              placeholder="Ex: 15,0"
              style={{ display: "block", marginTop: 4 }}
            />
          </label>
        )}

        <label>
          Temps (hh:mm:ss)
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input value={h} onChange={(e) => setH(e.target.value)} size={2} />
            :
            <input value={m} onChange={(e) => setM(e.target.value)} size={2} />
            :
            <input value={s} onChange={(e) => setS(e.target.value)} size={2} />
          </div>
        </label>

        <label title="Exposant de Riegel. 1,06 par défaut (1,04 = optimiste, 1,08 = conservateur).">
          Exposant Riegel
          <input
            type="number"
            step="0.01"
            min="1.02"
            max="1.12"
            value={exponent}
            onChange={(e) => setExponent(parseFloat(e.target.value))}
            style={{ display: "block", marginTop: 4 }}
          />
        </label>
      </div>

      {kpis && (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Volume moyen 12 sem: <b>{(weeklyAvg ?? 0).toFixed(1)} km/sem</b> •
          Plus longue sortie: <b>{(longest ?? 0).toFixed(1)} km</b>
        </div>
      )}

      {"error" in result ? (
        <div style={{ color: "crimson", marginTop: 12 }}>{result.error}</div>
      ) : (
        result && (
          <div style={{ marginTop: 16 }}>
            <div>
              <b>Temps Riegel (brut) :</b> {secondsToHMS(result.raw)}
            </div>
            <div>
              <b>Prévision ajustée :</b> {secondsToHMS(result.adj)}{" "}
              &nbsp;•&nbsp;
              <b>Allure cible :</b> {result.marathonPace}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
              NB : ajustement léger si volume &lt; 40 km/sem ou plus longue
              sortie &lt; 28 km.
            </div>

            <div style={{ marginTop: 12 }}>
              <b>Passages tous les 5 km</b>
              <ul style={{ marginTop: 6 }}>
                {result.splits5k.map((p) => (
                  <li key={p.km}>
                    {p.km} km : {p.hhmmss}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// Génère les splits 5 km en HH:MM:SS à partir d'un temps marathon
function buildSplits5k(totalMarathonSeconds: number) {
  const paceSec = totalMarathonSeconds / MARATHON; // s/km
  const out: { km: number; hhmmss: string }[] = [];
  let acc = 0;
  for (let km = 5; km <= 40; km += 5) {
    acc += paceSec * 5;
    out.push({ km, hhmmss: secondsToHMS(Math.round(acc)) });
  }
  return out;
}
