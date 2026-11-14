import type { GarminActivity } from "../api";

type Matchable = { id: number; sport_type: string; start_date_local: string; distance: number; moving_time: number };
function family(sport: string) {
  if (["Run", "TrailRun", "VirtualRun", "running", "trail_running", "treadmill_running", "track_running", "indoor_running", "ultra_run"].includes(sport)) return "run";
  if (["Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "cycling", "road_biking", "mountain_biking", "indoor_cycling", "gravel_cycling"].includes(sport)) return "bike";
  if (["Walk", "walking", "casual_walking", "speed_walking"].includes(sport)) return "walk";
  if (["Hike", "hiking"].includes(sport)) return "hike";
  if (["WeightTraining", "strength_training"].includes(sport)) return "strength";
  if (["AlpineSki", "resort_skiing"].includes(sport)) return "ski";
  return null;
}
// Both APIs expose a local wall clock here; do not convert one through the browser timezone.
function localTime(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(value);
  return match ? Date.parse(`${match[1]}T${match[2]}Z`) : NaN;
}
export function matchGarminActivities(rows: Matchable[], garmin: GarminActivity[]) {
  const candidates = new Map<number, GarminActivity[]>();
  const uses = new Map<number, number>();
  for (const row of rows) {
    const sport = family(row.sport_type);
    const matches = garmin.filter(g => sport != null && sport === family(g.sport)
      && Math.abs(localTime(row.start_date_local) - localTime(g.startLocal)) <= 120000
      && Math.abs(row.distance - g.distance) <= Math.max(100, row.distance * .03)
      && row.moving_time > 0 && Math.abs(row.moving_time - g.duration) <= Math.max(60, row.moving_time * .1));
    candidates.set(row.id, matches);
    for (const g of matches) uses.set(g.id, (uses.get(g.id) ?? 0) + 1);
  }
  const result = new Map<number, GarminActivity>();
  for (const [id, matches] of candidates) {
    if (matches.length === 1 && uses.get(matches[0].id) === 1) result.set(id, matches[0]);
  }
  return result;
}
