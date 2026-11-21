using FabRun.Api.Models;

namespace FabRun.Api.Services;

public static class ActivityAnalytics
{
    public static Kpis ComputeKpis(IEnumerable<Activity> activities, string periodLabel = "all_time")
    {
        var activityList = activities.ToList();
        var firstActivityDate = activityList
            .Select(a => DateTime.TryParse(a.start_date_local, out var parsed)
                ? parsed
                : (DateTime?)null)
            .Where(date => date.HasValue)
            .Select(date => date!.Value)
            .OrderBy(date => date)
            .FirstOrDefault();
        bool IsRun(Activity a) => new[] { "Run", "TrailRun", "VirtualRun" }.Contains(a.sport_type);
        bool HasRelevantElevation(Activity a) =>
            new[] { "Run", "TrailRun", "VirtualRun", "Walk", "Hike" }.Contains(a.sport_type);
        var runs = activityList.Where(IsRun).ToList();
        var strengthTrainingHours = activityList
            .Where(a => a.sport_type.Equals("WeightTraining", StringComparison.OrdinalIgnoreCase))
            .Sum(a => Math.Max(0, a.moving_time)) / 3600.0;
        var totalElevationGain = activityList
            .Where(HasRelevantElevation)
            .Sum(a => Math.Max(0, a.total_elevation_gain));

        double totalKm = runs.Sum(a => a.distance / 1000.0);
        double totalSec = runs.Sum(a => (double)a.moving_time);
        double avg = totalKm > 0 ? totalSec / totalKm : 0.0;

        const double maximumPlausibleRunningSpeedKmh = 30;
        double maxSpeedKmh = runs
            .Select(a => Math.Max(0, a.max_speed ?? 0) * 3.6)
            .Where(speed => speed <= maximumPlausibleRunningSpeedKmh)
            .DefaultIfEmpty(0)
            .Max();
        var runsWithHeartRate = runs
            .Where(a => a.average_heartrate is > 0 && a.moving_time > 0)
            .ToList();
        double? averageHeartRate = runsWithHeartRate.Count > 0
            ? runsWithHeartRate.Sum(a => a.average_heartrate!.Value * a.moving_time)
              / runsWithHeartRate.Sum(a => (double)a.moving_time)
            : null;

        double longest = runs.Select(a => a.distance / 1000.0).DefaultIfEmpty(0).Max();

        // Acute:chronic load (km4/km12/ACR) used to be computed here too, but
        // it's a "right now" metric - it doesn't make sense recomputed against
        // an arbitrary activities subset (this method also runs once per
        // year filter for the dashboard's per-year sections) or duplicated
        // against the frontend's own always-current-day computation in
        // web/src/utils/trainingLoad.ts. That one is now the single
        // source of truth for training load, shared by the daily advice and weekly plan.
        static string F(double s)
        {
            if (s <= 0 || double.IsInfinity(s) || double.IsNaN(s)) return "-";
            var m = (int)Math.Floor(s / 60);
            var ss = (int)Math.Round(s % 60);
            return $"{m}:{ss:00}/km";
        }

        return new Kpis(
            periodLabel,
            firstActivityDate == default ? null : firstActivityDate.ToString("yyyy-MM-dd"),
            runs.Count,
            Math.Round(totalKm, 1),
            F(avg),
            Math.Round(maxSpeedKmh, 1),
            averageHeartRate is null ? null : Math.Round(averageHeartRate.Value, 1),
            Math.Round(strengthTrainingHours, 1),
            Math.Round(longest, 1),
            Math.Round(totalElevationGain)
        );
    }
}
