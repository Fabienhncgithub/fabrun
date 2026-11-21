using FabRun.Api.Models;
using FabRun.Api.Abstractions.External;

namespace FabRun.Api.Services;

public class BestEffortsService
{
    private readonly IActivityStreams _streams;

    private static readonly double[] TargetsKm = { 1.0, 5.0, 10.0, 21.097, 42.195 };

    public BestEffortsService(IActivityStreams streams)
    {
        _streams = streams;
    }

    /// <summary>
    /// Best 1K/5K/10K/half/marathon over the window. The most recent runs are scanned
    /// second by second from their FIT file; every run also counts as a whole-activity effort.
    /// </summary>
    public async Task<List<BestEffortComputed>> ComputeBestEffortsAsync(
        IEnumerable<Activity> activities,
        int daysBack = 365,
        int maxActivitiesForStreams = 40,
        CancellationToken cancellationToken = default)
    {
        var since = DateTime.Today.AddDays(-daysBack);
        var runs = activities
            .Where(ShoeService.IsRun)
            .Select(a => (Activity: a, Ok: DateTime.TryParse(a.start_date_local, out var d), Date: d))
            .Where(x => x.Ok && x.Date >= since)
            .OrderByDescending(x => x.Date)
            .ToList();

        var bestByTarget = new Dictionary<double, BestEffortComputed>();
        void Offer(BestEffortComputed c)
        {
            if (!bestByTarget.TryGetValue(c.distanceKm, out var current) || c.timeSec < current.timeSec)
                bestByTarget[c.distanceKm] = c;
        }

        // Downloads are capped for latency and Garmin's quota.
        foreach (var (act, _, actDate) in runs.Take(Math.Clamp(maxActivitiesForStreams, 0, 40)))
        {
            var stream = await _streams.DistanceStreamAsync(act.id, cancellationToken);
            if (stream is null || stream.Distance.Length != stream.Time.Length || stream.Distance.Length < 2) continue;
            foreach (var t in TargetsKm)
            {
                var best = BestFromStreams(stream.Distance, stream.Time, t * 1000.0);
                if (best is null) continue;
                Offer(new BestEffortComputed(
                    distanceKm: t,
                    timeSec: (int)Math.Round(best.Value.timeSec),
                    activityId: act.id,
                    activityName: string.IsNullOrWhiteSpace(act.name) ? $"{t:0.#}K run" : act.name,
                    dateLocal: actDate,
                    method: "streams",
                    startKm: Math.Round(best.Value.startKm, 3),
                    endKm: Math.Round(best.Value.endKm, 3)));
            }
        }

        // Whole-activity efforts cost nothing, so the full window is scanned:
        // an older race stays visible even when more than 40 runs followed it.
        foreach (var (act, _, actDate) in runs)
        {
            if (act.moving_time <= 0) continue;
            var km = act.distance / 1000.0;
            foreach (var targetKm in TargetsKm)
            {
                if (km <= 1.0 && targetKm > 1.0) continue;
                if (Math.Abs(km - targetKm) / targetKm > 0.03) continue;
                Offer(new BestEffortComputed(
                    distanceKm: targetKm,
                    timeSec: act.moving_time,
                    activityId: act.id,
                    activityName: string.IsNullOrWhiteSpace(act.name) ? $"{targetKm:0.#}K run" : act.name,
                    dateLocal: actDate,
                    method: "activity",
                    startKm: 0.0,
                    endKm: Math.Round(km, 3)));
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
}
