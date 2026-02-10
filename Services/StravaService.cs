using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using FabRun.Api.Models;
using Microsoft.AspNetCore.WebUtilities;

namespace FabRun.Api.Services
{
    public class StravaService
    {
        private readonly HttpClient _http;
        private readonly ILogger<StravaService> _logger;

        public StravaService(HttpClient http, ILogger<StravaService> logger)
        {
            _http = http;
            _logger = logger;
        }

        // ---------- OAuth ----------
        public string AuthorizeUrl(string clientId, string redirectUri, string scopeCsv = "read,activity:read_all,profile:read_all")
        {
            var baseUrl = "https://www.strava.com/oauth/authorize";
            var url = QueryHelpers.AddQueryString(baseUrl, new Dictionary<string, string?>
            {
                ["client_id"] = clientId,
                ["redirect_uri"] = redirectUri,
                ["response_type"] = "code",
                ["approval_prompt"] = "auto",
                ["scope"] = scopeCsv
            });
            return url;
        }

        public async Task<JsonDocument> ExchangeCodeAsync(string clientId, string clientSecret, string code)
        {
            var body = new
            {
                client_id = clientId,
                client_secret = clientSecret,
                code,
                grant_type = "authorization_code"
            };
            var content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            var resp = await _http.PostAsync("https://www.strava.com/oauth/token", content);
            resp.EnsureSuccessStatusCode();
            var json = await resp.Content.ReadAsStringAsync();
            return JsonDocument.Parse(json);
        }

        public async Task<AthleteProfile> FetchAthleteProfileAsync(string accessToken)
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.strava.com/api/v3/athlete");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            var resp = await _http.SendAsync(req);
            resp.EnsureSuccessStatusCode();

            var json = await resp.Content.ReadAsStringAsync();
            var athlete = JsonSerializer.Deserialize<AthleteProfile>(
                json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (athlete is null)
            {
                throw new InvalidOperationException("Unable to parse Strava athlete profile.");
            }

            return athlete;
        }

        // ---------- Data ----------
        public async Task<List<Activity>> FetchActivitiesAsync(string accessToken, int? daysBack = 365)
        {
            long? after = daysBack.HasValue
                ? DateTimeOffset.UtcNow.AddDays(-daysBack.Value).ToUnixTimeSeconds()
                : null;

            var all = new List<Activity>();
            int page = 1;
            while (true)
            {
                var query = new Dictionary<string, string?>
                {
                    ["per_page"] = "200",
                    ["page"] = page.ToString()
                };

                if (after.HasValue)
                {
                    query["after"] = after.Value.ToString();
                }

                var url = QueryHelpers.AddQueryString("https://www.strava.com/api/v3/athlete/activities", query);
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
                var resp = await _http.SendAsync(req);
                resp.EnsureSuccessStatusCode();
                var json = await resp.Content.ReadAsStringAsync();
                var batch = JsonSerializer.Deserialize<List<Activity>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
                if (batch.Count == 0) break;
                all.AddRange(batch);
                page++;
                if (page > 100)
                {
                    _logger.LogWarning("Stopping Strava pagination at page {Page} (daysBack={DaysBack}).", page, daysBack);
                    break;
                }
            }
            return all;
        }

        // ---------- KPIs ----------
        public static Kpis ComputeKpis(IEnumerable<Activity> activities)
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
                var m = (int)Math.Floor(s / 60); var ss = (int)Math.Round(s % 60);
                return $"{m}:{ss:00}/km";
            }

            return new Kpis(
                "all_time",
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

        public async Task<Kpis> BuildKpisAsync(string accessToken, int? daysBack = null)
        {
            var acts = await FetchActivitiesAsync(accessToken, daysBack);
            return ComputeKpis(acts);
        }

        // ---------- Référence course & prédiction ----------
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

        // ---------- Best Efforts (simple: activité entière proche de la distance) ----------
        public async Task<IEnumerable<BestEffort>> GetTopBest5kAsync(string token, int days, int limit)
        {
            return await GetTopBestXAsync(token, 5_000, "5K", days, limit);
        }

        public async Task<IEnumerable<BestEffort>> GetTopBestXAsync(
            string token,
            double distMeters,
            string label,
            int days,
            int limit)
        {
            var acts = await FetchActivitiesAsync(token, days);

            bool IsRun(Activity a) =>
                a != null &&
                !string.IsNullOrWhiteSpace(a.sport_type) &&
                (a.sport_type.Equals("Run", StringComparison.OrdinalIgnoreCase) ||
                 a.sport_type.Equals("TrailRun", StringComparison.OrdinalIgnoreCase) ||
                 a.sport_type.Equals("VirtualRun", StringComparison.OrdinalIgnoreCase));

            var runs = acts.Where(IsRun).ToList();

            var targetKm = distMeters / 1000.0;
            var tolKm = targetKm switch
            {
                <= 5.1 => 0.25,
                <= 10.5 => 0.50,
                <= 22.0 => 0.80,
                _ => 1.00
            };

            var candidates = runs
                .Select(a => new
                {
                    A = a,
                    Km = a.distance / 1000.0,
                    Sec = (int)Math.Round((double)a.moving_time),
                    DateLocal = DateTime.Parse(a.start_date_local)
                })
                .Where(x => Math.Abs(x.Km - targetKm) <= tolKm && x.Km > 2.0 && x.Sec > 600)
                .OrderBy(x => x.Sec)
                .Take(limit)
                .Select(x => new BestEffort(
                    activityId: x.A.id,
                    activityName: x.A.name ?? $"{label} run",
                    dateLocal: x.DateLocal,
                    distKm: Math.Round(x.Km, 2),
                    seconds: x.Sec,
                    startKm: 0.0,
                    endKm: Math.Round(x.Km, 2)
                ))
                .ToList();

            return candidates;
        }
    }
}
