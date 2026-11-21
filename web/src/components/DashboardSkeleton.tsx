// Shown only on the very first load (no data yet). A refresh keeps the
// existing cards visible instead of swapping back to this - see the
// `loading && !rows` gate in App.tsx.
const SHAPES = ["chart", "grid", "text", "grid", "text", "chart"] as const;

export default function DashboardSkeleton() {
  return (
    <div className="skeleton-stack" aria-busy="true" aria-live="polite">
      <span className="sr-only">Chargement du dashboard...</span>
      {SHAPES.map((shape, index) => (
        <section className="panel skeleton-panel" key={`${shape}-${index}`} aria-hidden="true">
          <div className="skeleton-line skeleton-title" />
          {shape === "chart" && <div className="skeleton-block skeleton-chart" />}
          {shape === "grid" && (
            <div className="skeleton-tile-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="skeleton-block skeleton-tile" key={i} />
              ))}
            </div>
          )}
          {shape === "text" && (
            <>
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-line-short" />
            </>
          )}
        </section>
      ))}
    </div>
  );
}
