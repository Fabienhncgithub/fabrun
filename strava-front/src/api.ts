const API = import.meta.env.VITE_API_BASE as string;

export function getAccessToken(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get("access_token");
}

export async function fetchActivities() {
  const token = getAccessToken();
  if (!token) throw new Error("Token manquant (reconnecte-toi).");
  const r = await fetch(`${API}/api/activities`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchKpis() {
  const token = getAccessToken();
  if (!token) throw new Error("Token manquant (reconnecte-toi).");
  const r = await fetch(`${API}/api/kpis`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchAutoPrediction() {
  const token = getAccessToken();
  if (!token) throw new Error("Token manquant");
  const r = await fetch(`${API}/api/predict?windowDays=365&exponent=1.06`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
