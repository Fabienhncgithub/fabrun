export type EnergyActivity = {
  sport_type: string;
  moving_time: number;
  average_speed?: number;
  total_elevation_gain?: number;
  calories?: number;
};

const GRAVITY_M_S2 = 9.80665;
const JOULES_PER_KCAL = 4184;
const CLIMBING_EFFICIENCY = 0.25;

function climbingCalories(activity: EnergyActivity, athleteWeightKg: number): number {
  if (activity.sport_type !== "TrailRun") return 0;

  const elevationGainMeters = Math.max(0, activity.total_elevation_gain ?? 0);
  const mechanicalEnergyJoules =
    athleteWeightKg * GRAVITY_M_S2 * elevationGainMeters;

  return mechanicalEnergyJoules / (JOULES_PER_KCAL * CLIMBING_EFFICIENCY);
}

function estimateMet(activity: EnergyActivity): number | null {
  const kmh = activity.average_speed ? activity.average_speed * 3.6 : null;

  switch (activity.sport_type) {
    case "Run":
    case "TrailRun":
    case "VirtualRun":
      if (kmh == null) return 9.8;
      if (kmh < 8) return 8.3;
      if (kmh < 9.5) return 9.8;
      if (kmh < 10.8) return 10.5;
      if (kmh < 12.2) return 11.5;
      if (kmh < 13.8) return 12.3;
      if (kmh < 16) return 12.8;
      return 14.5;
    case "AlpineSki":
      return 4.8;
    case "WeightTraining":
      return 3.5;
    case "Ride":
    case "VirtualRide":
      return 7;
    case "Walk":
      return 3.5;
    case "Hike":
      return 5.3;
    default:
      return null;
  }
}

export function activeCalories(
  activity: EnergyActivity,
  athleteWeightKg?: number
): { value: number; estimated: boolean } | null {
  if (activity.calories && activity.calories > 0) {
    return { value: activity.calories, estimated: false };
  }

  if (!athleteWeightKg || athleteWeightKg <= 0 || activity.moving_time <= 0) {
    return null;
  }

  const met = estimateMet(activity);
  if (!met) return null;

  const hours = activity.moving_time / 3600;
  const metCalories = Math.max(0, (met - 1) * athleteWeightKg * hours);
  return {
    value: metCalories + climbingCalories(activity, athleteWeightKg),
    estimated: true,
  };
}
