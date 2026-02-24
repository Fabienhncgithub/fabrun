using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Models;
using FabRun.Api.Services;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.Caching.Memory;

namespace FabRun.Api.Infrastructure.External;

public class StravaApiClient : IStravaClient
{
    private readonly HttpClient _http;
    private readonly ILogger<StravaApiClient> _logger;
    private readonly IMemoryCache _cache;

    public StravaApiClient(HttpClient http, ILogger<StravaApiClient> logger, IMemoryCache cache)
    {
        _http = http;
        _logger = logger;
        _cache = cache;
    }

    public string AuthorizeUrl(
        string clientId,
        string redirectUri,
        string scopeCsv = "read,activity:read_all,profile:read_all",
        string? state = null)
    {
        var baseUrl = "https://www.strava.com/oauth/authorize";
        var query = new Dictionary<string, string?>
        {
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["response_type"] = "code",
            ["approval_prompt"] = "auto",
            ["scope"] = scopeCsv
        };

        if (!string.IsNullOrWhiteSpace(state))
        {
            query["state"] = state;
        }

        return QueryHelpers.AddQueryString(baseUrl, query);
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
        var cacheKey = $"strava:profile:{TokenKey(accessToken)}";
        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);

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
        }) ?? throw new InvalidOperationException("Unable to load Strava athlete profile.");
    }

    public async Task<List<Activity>> FetchActivitiesAsync(string accessToken, int? daysBack = 365)
    {
        var daysKey = daysBack?.ToString() ?? "all";
        var cacheKey = $"strava:activities:{TokenKey(accessToken)}:{daysKey}";

        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(2);

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
        }) ?? new List<Activity>();
    }

    public async Task<StravaStreams?> FetchActivityStreamsAsync(string accessToken, long activityId)
    {
        var cacheKey = $"strava:streams:{TokenKey(accessToken)}:{activityId}";
        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);

            var url = $"https://www.strava.com/api/v3/activities/{activityId}/streams?keys=distance,time&key_by_type=true";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<StravaStreams>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        });
    }

    public async Task<StravaActivityDetail?> FetchActivityDetailAsync(string accessToken, long activityId)
    {
        var cacheKey = $"strava:activity:{TokenKey(accessToken)}:{activityId}";
        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30);

            var url = $"https://www.strava.com/api/v3/activities/{activityId}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<StravaActivityDetail>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        });
    }

    public async Task<Kpis> BuildKpisAsync(string accessToken, int? daysBack = null)
    {
        var acts = await FetchActivitiesAsync(accessToken, daysBack);
        return StravaAnalytics.ComputeKpis(acts);
    }

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

    private static string TokenKey(string accessToken)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(accessToken));
        return Convert.ToHexString(bytes);
    }
}
