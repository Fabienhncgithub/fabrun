using FabRun.Api.Models;
using FabRun.Api.Abstractions.External;

namespace FabRun.Api.Services;

public class BestEffortsService
{
    private readonly IStravaClient _strava;

    private static readonly double[] TargetsKm = { 1.0, 5.0, 10.0, 21.097, 42.195 };

    public BestEffortsService(IStravaClient strava)
    {
        _strava = strava;
    }

    public async Task<List<BestEffortComputed>> ComputeBestEffortsAsync(
        string token,
        int daysBack = 365,
        int maxActivitiesForStreams = 60)
    {
        var activities = await _strava.FetchActivitiesAsync(token, daysBack);
        bool IsRun(Activity a) =>
            a != null &&
            !string.IsNullOrWhiteSpace(a.sport_type) &&
            (a.sport_type.Equals("Run", StringComparison.OrdinalIgnoreCase) ||
             a.sport_type.Equals("TrailRun", StringComparison.OrdinalIgnoreCase) ||
             a.sport_type.Equals("VirtualRun", StringComparison.OrdinalIgnoreCase));

        var runs = activities.Where(IsRun)
            .OrderByDescending(a => DateTime.Parse(a.start_date_local))
            .ToList();

        var bestByTarget = new Dictionary<double, BestEffortComputed>();
        int streamsRemaining = maxActivitiesForStreams;

        foreach (var act in runs)
        {
            var actDate = DateTime.Parse(act.start_date_local);
            var candidates = new List<BestEffortComputed>();

            if (streamsRemaining > 0)
            {
                var streams = await _strava.FetchActivityStreamsAsync(token, act.id);
                if (streams?.distance?.data != null && streams.time?.data != null)
                {
                    var dist = streams.distance.data.Select(x => (double)x).ToArray();
                    var time = streams.time.data.Select(x => (double)x).ToArray();
                    if (dist.Length == time.Length && dist.Length >= 2)
                    {
                        foreach (var t in TargetsKm)
                        {
                            var best = BestFromStreams(dist, time, t * 1000.0);
                            if (best != null)
                            {
                                candidates.Add(new BestEffortComputed(
                                    distanceKm: t,
                                    timeSec: (int)Math.Round(best.Value.timeSec),
                                    activityId: act.id,
                                    activityName: act.name ?? $"{t:0.#}K run",
                                    dateLocal: actDate,
                                    method: "streams",
                                    startKm: Math.Round(best.Value.startKm, 3),
                                    endKm: Math.Round(best.Value.endKm, 3)
                                ));
                            }
                        }
                    }
                }
                streamsRemaining--;
            }

            if (candidates.Count == 0)
            {
                var detail = await _strava.FetchActivityDetailAsync(token, act.id);
                if (detail?.splits_standard != null && detail.splits_standard.Count > 0)
                {
                    foreach (var t in TargetsKm)
                    {
                        var splitBest = BestFromSplits(detail.splits_standard, t * 1000.0);
                        if (splitBest != null)
                        {
                            candidates.Add(new BestEffortComputed(
                                distanceKm: t,
                                timeSec: splitBest.Value.timeSec,
                                activityId: act.id,
                                activityName: detail.name ?? $"{t:0.#}K run",
                                dateLocal: DateTime.Parse(detail.start_date_local),
                                method: "splits",
                                startKm: Math.Round(splitBest.Value.startKm, 3),
                                endKm: Math.Round(splitBest.Value.endKm, 3)
                            ));
                        }
                    }
                }
                else if (detail != null)
                {
                    foreach (var t in TargetsKm)
                    {
                        var tol = 0.03;
                        var km = detail.distance / 1000.0;
                        if (km <= 1.0 && t > 1.0) continue;
                        if (Math.Abs(km - t) / t <= tol)
                        {
                            var timeSec = detail.elapsed_time > 0 ? detail.elapsed_time : detail.moving_time;
                            candidates.Add(new BestEffortComputed(
                                distanceKm: t,
                                timeSec: timeSec,
                                activityId: act.id,
                                activityName: detail.name ?? $"{t:0.#}K run",
                                dateLocal: DateTime.Parse(detail.start_date_local),
                                method: "activity",
                                startKm: 0.0,
                                endKm: Math.Round(km, 3)
                            ));
                        }
                    }
                }
            }

            if (candidates.Count == 0)
            {
                foreach (var t in TargetsKm)
                {
                    var tol = 0.03;
                    var km = act.distance / 1000.0;
                    if (km <= 1.0 && t > 1.0) continue;
                    if (Math.Abs(km - t) / t <= tol)
                    {
                        candidates.Add(new BestEffortComputed(
                            distanceKm: t,
                            timeSec: (int)Math.Round((double)act.moving_time),
                            activityId: act.id,
                            activityName: act.name ?? $"{t:0.#}K run",
                            dateLocal: actDate,
                            method: "activity",
                            startKm: 0.0,
                            endKm: Math.Round(km, 3)
                        ));
                    }
                }
            }

            foreach (var c in candidates)
            {
                if (!bestByTarget.TryGetValue(c.distanceKm, out var current) || c.timeSec < current.timeSec)
                {
                    bestByTarget[c.distanceKm] = c;
                }
            }
        }

        return bestByTarget.Values.OrderBy(v => v.distanceKm).ToList();
    }

    internal static (double timeSec, double startKm, double endKm)? BestFromStreams(
        double[] distanceMeters,
        double[] timeSeconds,
        double targetMeters)
    {
        int n = Math.Min(distanceMeters.Length, timeSeconds.Length);
        if (n < 2) return null;

        int i = 0;
        int j = 1;
        double best = double.PositiveInfinity;
        double bestStartKm = 0;
        double bestEndKm = 0;

        while (i < n - 1 && j < n)
        {
            if (j <= i) j = i + 1;

            double baseDist = distanceMeters[i];

            while (j < n && distanceMeters[j] - baseDist < targetMeters)
            {
                if (IsPauseGap(distanceMeters, timeSeconds, j))
                {
                    i = j;
                    baseDist = distanceMeters[i];
                    j = i + 1;
                    continue;
                }

                j++;
            }

            if (j >= n) break;

            var d0 = distanceMeters[j - 1];
            var d1 = distanceMeters[j];
            var t0 = timeSeconds[j - 1];
            var t1 = timeSeconds[j];
            if (d1 <= d0)
            {
                i++;
                continue;
            }

            var distFromStart = targetMeters;
            var frac = (distFromStart - (d0 - baseDist)) / (d1 - d0);
            frac = Math.Clamp(frac, 0, 1);
            var tTarget = t0 + frac * (t1 - t0);
            var duration = tTarget - timeSeconds[i];

            if (duration > 0 && duration < best)
            {
                best = duration;
                bestStartKm = baseDist / 1000.0;
                bestEndKm = (baseDist + targetMeters) / 1000.0;
            }

            i++;
        }

        if (double.IsInfinity(best)) return null;
        return (best, bestStartKm, bestEndKm);
    }

    private static bool IsPauseGap(double[] dist, double[] time, int idx)
    {
        if (idx <= 0 || idx >= time.Length) return false;
        var dt = time[idx] - time[idx - 1];
        var dd = dist[idx] - dist[idx - 1];
        return dt >= 120 && dd < 10;
    }

    internal static (int timeSec, double startKm, double endKm)? BestFromSplits(
        List<StravaSplit> splits,
        double targetMeters)
    {
        if (splits.Count == 0) return null;

        var kmSplits = splits
            .Where(s => s.distance >= 950 && s.distance <= 1050)
            .ToList();

        if (kmSplits.Count == 0) return null;

        int needed = (int)Math.Round(targetMeters / 1000.0);
        if (needed <= 0 || kmSplits.Count < needed) return null;

        int best = int.MaxValue;
        int bestStart = 0;
        for (int i = 0; i <= kmSplits.Count - needed; i++)
        {
            int sum = 0;
            for (int j = 0; j < needed; j++)
            {
                var s = kmSplits[i + j];
                sum += s.elapsed_time > 0 ? s.elapsed_time : s.moving_time;
            }
            if (sum < best)
            {
                best = sum;
                bestStart = i;
            }
        }

        if (best == int.MaxValue) return null;
        return (best, bestStart + 1, bestStart + needed);
    }
}
