import { useEffect, useRef } from "react";
import ThemeToggle from "./ThemeToggle";
import type { Theme } from "../utils/theme";

type Props = {
  theme: Theme;
  onToggleTheme: () => void;
  stravaConnected: boolean | null;
  lastUpdatedAt: Date | null;
  loading: boolean;
  accessLoading: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
};

export default function DashboardHeader({ theme, onToggleTheme, stravaConnected,
  lastUpdatedAt, loading, accessLoading, onRefresh, onDisconnect }: Props) {
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeMenu = (event: PointerEvent | KeyboardEvent) => {
      const menu = accountMenuRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (event instanceof PointerEvent && !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, []);

  return (
      <header className="topbar">
        <div className="brand-block">
          <a className="brand-title" href="#entrainement" aria-label="FabRun — accueil">Fab<span>Run</span><i aria-hidden="true" /></a>
          <div className="brand-sub">Ton carnet d’entraînement</div>
        </div>
        <div className="topbar-actions">
          {stravaConnected && lastUpdatedAt && (
            <span className="topbar-last-sync" role="status">
              <i aria-hidden="true" /> À jour à {lastUpdatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          {stravaConnected && (
            <button className="btn sync-button" type="button" aria-label={loading ? "Synchronisation en cours" : "Synchroniser les activités Strava"} onClick={onRefresh} disabled={loading}>
              <span className={loading ? "sync-icon sync-icon-loading" : "sync-icon"} aria-hidden="true">↻</span>
              <span className="sync-button-label">{loading ? "Synchronisation…" : "Synchroniser"}</span>
            </button>
          )}
          <details className="account-menu" ref={accountMenuRef}>
            <summary aria-label="Menu du compte">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg>
            </summary>
            <div className="account-menu-panel">
              <span>{stravaConnected ? "Strava connecté" : "Strava non connecté"}</span>
              <button type="button" onClick={onDisconnect} disabled={accessLoading}>
                {accessLoading ? "Déconnexion…" : "Se déconnecter"}
              </button>
            </div>
          </details>
        </div>
      </header>
  );
}
