type Shoe = {
  id?: string | null;
  name?: string | null;
  distance?: number | null; // meters
  converted_distance?: number | null; // optional, from Strava
};

const round1 = (v: number) => Math.round(v * 10) / 10;

function kmFromShoe(shoe: Shoe): number {
  if (typeof shoe.distance === "number" && shoe.distance > 0) {
    return shoe.distance / 1000;
  }
  if (typeof shoe.converted_distance === "number" && shoe.converted_distance > 0) {
    return shoe.converted_distance;
  }
  return 0;
}

export default function ShoeUsageCard({ shoes }: { shoes: Shoe[] }) {
  const sorted = [...(shoes ?? [])]
    .map((s) => ({ ...s, km: kmFromShoe(s) }))
    .filter((s) => s.km > 0 || (s.name && s.name.trim().length > 0))
    .sort((a, b) => b.km - a.km);

  if (sorted.length === 0) {
    return (
      <div className="shoes-card">
        <div className="panel-head">Chaussures utilisées</div>
        <p className="shoes-empty">Aucune chaussure trouvée dans le profil Strava.</p>
      </div>
    );
  }

  return (
    <div className="shoes-card">
      <div className="panel-head">Chaussures utilisées</div>
      <div className="shoes-list">
        {sorted.map((shoe, idx) => (
          <article key={shoe.id ?? `${shoe.name}-${idx}`} className="shoe-item">
            <div className="shoe-left">
              <span className="shoe-icon" aria-hidden>
                👟
              </span>
              <div>
                <div className="shoe-name">{shoe.name?.trim() || "Modèle inconnu"}</div>
                <div className="shoe-sub">ID: {shoe.id ?? "—"}</div>
              </div>
            </div>
            <div className="shoe-km-block">
              <div className="shoe-km">{round1(shoe.km).toFixed(1)} km</div>
              <div className="shoe-sub">Distance totale</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
