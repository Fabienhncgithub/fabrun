const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const LEGACY_TOKEN_STORAGE_KEY = "fabrun_access_token";
const CSRF_HEADER = "X-CSRF-TOKEN";
let csrfToken: string | null = null;

export type Activity = {
  id: number;
  name: string;
  sport_type: string;
  distance: number;
  moving_time: number;
  start_date_local: string;
  total_elevation_gain?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  calories?: number;
  kilojoules?: number;
};

export type Kpis = {
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

export type ProfileShoe = {
  id?: string | null;
  name?: string | null;
  distance?: number | null;
  converted_distance?: number | null;
};

export type Profile = {
  weight?: number;
  shoes?: ProfileShoe[];
};

export type SleepSummary = {
  connected: boolean;
  lastSleepHours: number;
  avg7dHours: number;
  avg30dHours: number;
  sessions7d: number;
  sessions30d: number;
  totalSessions: number;
  lastSleepEndUtc?: string | null;
};

export type PredictionResponse = {
  reference: {
    distanceKm: number;
    timeSec: number;
    dateLocal: string;
    activityId: number;
    activityName: string;
    method: string;
  };
  exponentUsed: number;
  predictions: Record<string, number>;
  confidence: {
    score: number;
    level: string;
    reasons: string[];
  };
};

type DashboardResponse = {
  activities: Activity[];
  kpis: Kpis;
  kpisCurrentYear: Kpis;
  kpisPreviousYear: Kpis;
  profile: Profile;
  sleep: SleepSummary;
};

// Remove tokens left by versions that exposed the Strava token to JavaScript.
localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
if (new URLSearchParams(location.hash.slice(1)).has("access_token")) {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
}

async function fetchCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;

  const response = await fetch(`${API}/access/csrf`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Impossible d'initialiser la protection de la session.");
  }

  const payload = await response.json();
  if (typeof payload?.token !== "string" || payload.token.length === 0) {
    throw new Error("Jeton de protection de session invalide.");
  }

  const token = payload.token as string;
  csrfToken = token;
  return token;
}

export async function fetchAccessStatus(): Promise<boolean> {
  const response = await fetch(`${API}/access/status`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return false;
  const payload = await response.json();
  return payload?.authenticated === true;
}

export async function loginWithPassword(password: string): Promise<void> {
  const token = await fetchCsrfToken();
  const response = await fetch(`${API}/access/login`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [CSRF_HEADER]: token,
    },
    body: JSON.stringify({ password }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Connexion impossible.");
  }

  csrfToken = null;
}

export async function logoutAccess(): Promise<void> {
  const token = await fetchCsrfToken();
  await fetch(`${API}/access/logout`, {
    method: "POST",
    credentials: "include",
    headers: { [CSRF_HEADER]: token },
  });
  csrfToken = null;
}

export async function fetchStravaStatus(): Promise<boolean> {
  const response = await fetch(`${API}/auth/status`, { credentials: "include" });
  if (!response.ok) return false;
  const payload = await response.json();
  return payload?.connected === true;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    headers.set(CSRF_HEADER, await fetchCsrfToken());
  }

  const r = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers,
  });

  if (!r.ok) {
    let details = "";
    try {
      const payload = await r.json();
      details = payload?.error ? `: ${payload.error}` : "";
    } catch {
      // noop
    }

    if (r.status === 401 || r.status === 403) {
      if (!(await fetchAccessStatus())) {
        throw new Error("SESSION_ACCESS_EXPIRED");
      }
      throw new Error(`${r.status}: autorisation Strava invalide${details}. Reconnecte-toi.`);
    }

    throw new Error(`HTTP ${r.status}${details}`);
  }

  return (await r.json()) as T;
}

export async function fetchActivities() {
  return apiFetch<Activity[]>("/api/activities");
}

export async function fetchKpis() {
  return apiFetch<Kpis>("/api/kpis");
}

export async function fetchProfile() {
  return apiFetch<Profile>("/api/profile");
}

export async function fetchDashboard() {
  return apiFetch<DashboardResponse>("/api/dashboard");
}

export async function fetchRunningPredictions(refresh = false) {
  const url = new URL(`${API}/api/predictions/running`, location.origin);
  if (refresh) url.searchParams.set("refresh", "true");
  const pathWithQuery = `${url.pathname}${url.search}`;
  return apiFetch<PredictionResponse>(pathWithQuery);
}
