import { useCallback, useEffect, useState } from "react";
import { fetchGarminStatus, syncGarmin, type GarminRecovery } from "../api";
import { swissNow } from "./genevaWeather";

export type GarminState = {
  configured: boolean;
  recovery: GarminRecovery | null;
  loading: boolean;
  error: string;
  sync: () => Promise<void>;
};

/**
 * Garmin recovery shared by the training and recovery pages. When the server
 * snapshot is missing or dated from a previous day, one sync is started
 * automatically so the morning advice does not depend on a manual click.
 */
export function useGarmin(enabled: boolean): GarminState {
  const [configured, setConfigured] = useState(false);
  const [recovery, setRecovery] = useState<GarminRecovery | null>(null);
  // Starts true: the first status check begins as soon as the dashboard is ready.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const sync = useCallback(async () => {
    setLoading(true); setError("");
    try { setRecovery(await syncGarmin()); }
    catch (e) { setError(e instanceof Error ? e.message : "Synchronisation Garmin impossible."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    fetchGarminStatus().then(async status => {
      if (!active) return;
      setConfigured(status.configured);
      setRecovery(status.recovery);
      if (status.configured && status.recovery?.date !== swissNow().date) {
        try { const fresh = await syncGarmin(); if (active) setRecovery(fresh); }
        catch (e) { if (active) setError(e instanceof Error ? e.message : "Synchronisation Garmin impossible."); }
      }
    }).catch(() => { if (active) setError("Impossible de vérifier la connexion Garmin."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled]);

  return { configured, recovery, loading, error, sync };
}
