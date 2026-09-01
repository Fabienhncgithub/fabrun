const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const LEGACY_TOKEN_STORAGE_KEY = "fabrun_access_token";
const CSRF_HEADER = "X-CSRF-TOKEN";
let csrfToken: string | null = null;

export type ApiFailureCode = "ACCESS_SESSION_EXPIRED" | "STRAVA_CONNECTION_EXPIRED" | "HTTP_ERROR";

export class ApiRequestError extends Error {
  status: number;
  code: ApiFailureCode;

  constructor(message: string, status: number, code: ApiFailureCode) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

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
  gear_id?: string | null;
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
  bestEfforts: BestEffort[];
};

export type BestEffort = {
  distanceKm: number;
  timeSec: number;
  activityId: number;
  activityName: string;
  dateLocal: string;
  method: string;
  startKm: number;
  endKm: number;
};

export type GoalRace = {
  id: string;
  label: string;
  distanceKm: number;
  targetDate: string; // "YYYY-MM-DD"
};

export type AthleteSettings = {
  hasShinPain: boolean;
  goalRaces: GoalRace[];
  shoePreferences: ShoePreference[];
  ageYears: number | null;
  sex: "male" | "female" | null;
};

export type ShoePreference = {
  gearId: string;
  retirementKm: number;
  brand?: string | null;
};

// What we send back on save: an existing goal keeps the id it was loaded
// with, a brand new one omits it and the server assigns one.
export type GoalRaceInput = Omit<GoalRace, "id"> & { id?: string };

export type AthleteSettingsInput = {
  hasShinPain: boolean;
  goalRaces: GoalRaceInput[];
  shoePreferences: ShoePreference[];
  ageYears?: number | null;
  sex?: "male" | "female" | null;
};

type DashboardResponse = {
  activities: Activity[];
  heatmapActivities: Activity[];
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
  const response = await fetch(`${API}/access/logout`, {
    method: "POST",
    credentials: "include",
    headers: { [CSRF_HEADER]: token },
  });
  if (!response.ok) {
    throw new Error("Fermeture de la session impossible.");
  }
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
        throw new ApiRequestError(
          "La session FabRun a expiré.",
          r.status,
          "ACCESS_SESSION_EXPIRED"
        );
      }
      throw new ApiRequestError(
        `Autorisation Strava invalide${details}. Reconnecte-toi.`,
        r.status,
        "STRAVA_CONNECTION_EXPIRED"
      );
    }

    throw new ApiRequestError(`HTTP ${r.status}${details}`, r.status, "HTTP_ERROR");
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

export async function fetchDashboard(refresh = false) {
  return apiFetch<DashboardResponse>(`/api/dashboard${refresh ? "?refresh=true" : ""}`);
}

export async function fetchRunningPredictions(refresh = false) {
  const url = new URL(`${API}/api/predictions/running`, location.origin);
  if (refresh) url.searchParams.set("refresh", "true");
  const pathWithQuery = `${url.pathname}${url.search}`;
  return apiFetch<PredictionResponse>(pathWithQuery);
}

export async function fetchAthleteSettings() {
  return apiFetch<AthleteSettings>("/api/settings");
}

export async function updateAthleteSettings(settings: AthleteSettingsInput) {
  return apiFetch<AthleteSettings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}
