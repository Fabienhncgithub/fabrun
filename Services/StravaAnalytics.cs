using FabRun.Api.Models;

namespace FabRun.Api.Services;

public static class StravaAnalytics
{
    public static Kpis ComputeKpis(IEnumerable<Activity> activities, string periodLabel = "all_time")
    {
        bool IsRun(Activity a) => new[] { "Run", "TrailRun", "VirtualRun" }.Contains(a.sport_type);
        var runs = activities.Where(IsRun).ToList();

        double totalKm = runs.Sum(a => a.distance / 1000.0);
        double totalSec = runs.Sum(a => (double)a.moving_time);
        double avg = totalKm > 0 ? totalSec / totalKm : 0.0;

        double best = runs
            .Select(a => { var km = a.distance / 1000.0; return km > 0 ? a.moving_time / km : double.PositiveInfinity; })
            .DefaultIfEmpty(double.PositiveInfinity).Min();

        double longest = runs.Select(a => a.distance / 1000.0).DefaultIfEmpty(0).Max();

        var weekly = new Dictionary<string, double>();
        foreach (var a in runs)
        {
            var d = DateTime.Parse(a.start_date_local);
            var y = System.Globalization.ISOWeek.GetYear(d);
            var w = System.Globalization.ISOWeek.GetWeekOfYear(d);
            var key = $"{y}-W{w:00}";
            weekly[key] = (weekly.TryGetValue(key, out var v) ? v : 0) + a.distance / 1000.0;
        }
        var sorted = weekly.OrderBy(kv => kv.Key).ToList();
        double SumLast(int n) => sorted.TakeLast(n).Sum(kv => kv.Value);
        var km4 = SumLast(4);
        var km12 = SumLast(12);
        var acr = km12 > 0 ? (km4 / 4.0) / (km12 / 12.0) : 0.0;

        static string F(double s)
        {
            if (s <= 0 || double.IsInfinity(s) || double.IsNaN(s)) return "-";
            var m = (int)Math.Floor(s / 60);
            var ss = (int)Math.Round(s % 60);
            return $"{m}:{ss:00}/km";
        }

        return new Kpis(
            periodLabel,
            runs.Count,
            Math.Round(totalKm, 1),
            F(avg),
            F(best),
            Math.Round(longest, 1),
            sorted.ToDictionary(k => k.Key, v => Math.Round(v.Value, 1)),
            Math.Round(km4, 1),
            Math.Round(km12, 1),
            Math.Round(acr, 2)
        );
    }

    public static RaceRef? PickBestReferenceFromActivities(IEnumerable<Activity> acts, DateTime sinceUtc)
    {
        var runTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "Run", "TrailRun", "VirtualRun" };

        var cand = acts
            .Select(a =>
            {
                var local = DateTime.Parse(a.start_date_local);
                var utc = local.Kind == DateTimeKind.Utc ? local
                         : DateTime.SpecifyKind(local, DateTimeKind.Local).ToUniversalTime();

                return new
                {
                    a,
                    startUtc = utc,
                    km = a.distance / 1000.0,
                    sec = (int)Math.Round((double)a.moving_time)
                };
            })
            .Where(x => x.startUtc >= sinceUtc && x.km > 2.0 && x.sec > 600)
            .Where(x => !string.IsNullOrWhiteSpace(x.a.sport_type) && runTypes.Contains(x.a.sport_type))
            .Select(x => new { x.km, x.sec, x.startUtc })
            .ToList();

        var targets = new (string kind, double targetKm, double tolKm)[]
        {
            ("5K",   5.0,     0.25),
            ("10K",  10.0,    0.5),
            ("HM",   21.0975, 0.8),
        };

        RaceRef? best = null;
        int Rank(string k) => k == "HM" ? 3 : k == "10K" ? 2 : 1;

        foreach (var t in targets)
        {
            var near = cand
                .Where(x => Math.Abs(x.km - t.targetKm) <= t.tolKm)
                .OrderBy(x => x.sec)
                .FirstOrDefault();

            if (near != null)
            {
                var rr = new RaceRef(t.kind, near.km, near.sec, near.startUtc);
                if (best == null || Rank(rr.kind) > Rank(best.kind))
                    best = rr;
            }
        }

        return best;
    }

    public static int RiegelPredictSeconds(int t1, double d1Km, double d2Km, double exponent = 1.06)
    {
        var t2 = t1 * Math.Pow(d2Km / d1Km, exponent);
        return (int)Math.Round(t2);
    }
}
