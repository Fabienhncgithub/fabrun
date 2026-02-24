const API = import.meta.env.VITE_API_BASE as string;
const TOKEN_STORAGE_KEY = "fabrun_access_token";

export function getAccessToken(): string | null {
  const hashToken = new URLSearchParams(location.hash.slice(1)).get("access_token");
  if (hashToken) {
    localStorage.setItem(TOKEN_STORAGE_KEY, hashToken);
    // Clean URL once the token is captured, keeps reload/share cleaner.
    if (location.hash.includes("access_token=")) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
    return hashToken;
  }

  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = getAccessToken();
  if (!token) {
    throw new Error("Token manquant (reconnecte-toi via le bouton Strava).");
  }

  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!r.ok) {
    let details = "";
    try {
      const payload = await r.json();
      details = payload?.error ? `: ${payload.error}` : "";
    } catch {
      // noop
    }

    if (r.status === 401) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      throw new Error(`401: token Strava invalide/expire${details}. Reconnecte-toi.`);
    }

    throw new Error(`HTTP ${r.status}${details}`);
  }

  return r.json();
}

export async function fetchActivities() {
  return apiFetch("/api/activities");
}

export async function fetchKpis() {
  return apiFetch("/api/kpis");
}

export async function fetchProfile() {
  return apiFetch("/api/profile");
}

export async function fetchDashboard() {
  return apiFetch("/api/dashboard");
}

export async function fetchRunningPredictions(refresh = false) {
  const url = new URL(`${API}/api/predictions/running`);
  if (refresh) url.searchParams.set("refresh", "true");
  const pathWithQuery = `${url.pathname}${url.search}`;
  return apiFetch(pathWithQuery);
}
