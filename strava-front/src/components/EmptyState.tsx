import type { ReactNode } from "react";

// Shared empty-state block. Cards previously hand-rolled their own "nothing
// to show yet" markup (ShoeUsageCard, PerformancePredictionsCard); new cards
// (heatmap, PR board, ...) should use this instead so the tone/spacing stays
// consistent across the dashboard.
export default function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon ? (
        <span className="empty-state-icon" aria-hidden>
          {icon}
        </span>
      ) : null}
      <div className="empty-state-title">{title}</div>
      <p className="empty-state-message">{message}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
