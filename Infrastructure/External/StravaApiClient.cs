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
            ["approval_prompt"] = "force",
            ["scope"] = scopeCsv
        };

        if (!string.IsNullOrWhiteSpace(state))
        {
            query["state"] = state;
        }

        return QueryHelpers.AddQueryString(baseUrl, query);
    }

    public Task<JsonDocument> ExchangeCodeAsync(
        string clientId,
        string clientSecret,
        string code,
        CancellationToken cancellationToken = default)
    {
        var body = new
        {
            client_id = clientId,
            client_secret = clientSecret,
            code,
            grant_type = "authorization_code"
        };
        return PostTokenRequestAsync(body, "code exchange", cancellationToken);
    }

    public Task<JsonDocument> RefreshTokenAsync(
        string clientId,
        string clientSecret,
        string refreshToken,
        CancellationToken cancellationToken = default)
    {
        var body = new
        {
            client_id = clientId,
            client_secret = clientSecret,
            refresh_token = refreshToken,
            grant_type = "refresh_token"
        };
        return PostTokenRequestAsync(body, "token refresh", cancellationToken);
    }

    private async Task<JsonDocument> PostTokenRequestAsync(
        object body,
        string operationName,
        CancellationToken cancellationToken)
    {
        var content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        using var resp = await _http.PostAsync(
            "https://www.strava.com/oauth/token",
            content,
            cancellationToken);
        var json = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode)
        {
            _logger.LogWarning("Strava {Operation} failed with status {StatusCode}", operationName, (int)resp.StatusCode);
            resp.EnsureSuccessStatusCode();
        }

        var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        // Refresh responses don't carry a "scope" field (only the initial
        // code exchange does) - grantedScope simply logs as "not returned"
        // for those, which is expected rather than a sign of a problem.
        var grantedScope = root.TryGetProperty("scope", out var scope) ? scope.GetString() : null;
        var expiresAt = root.TryGetProperty("expires_at", out var expiration) ? expiration.GetInt64() : 0;
        _logger.LogInformation(
            "Strava {Operation} returned scopes {GrantedScope}; expiration timestamp present: {HasExpiration}",
            operationName,
            grantedScope ?? "<not returned>",
            expiresAt > 0);
        return document;
    }

    public async Task DeauthorizeAsync(
        string accessToken,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://www.strava.com/oauth/deauthorize");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    public async Task<AthleteProfile> FetchAthleteProfileAsync(
        string accessToken,
        CancellationToken cancellationToken = default,
        bool forceRefresh = false)
    {
        var cacheKey = $"strava:profile:{TokenKey(accessToken)}";
        if (forceRefresh)
        {
            _cache.Remove(cacheKey);
        }

        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);

            using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.strava.com/api/v3/athlete");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            using var resp = await _http.SendAsync(req, cancellationToken);
            resp.EnsureSuccessStatusCode();

            var json = await resp.Content.ReadAsStringAsync(cancellationToken);
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

    public async Task<List<Activity>> FetchActivitiesAsync(
        string accessToken,
        int? daysBack = 365,
        CancellationToken cancellationToken = default,
        bool forceRefresh = false)
    {
        var daysKey = daysBack?.ToString() ?? "all";
        var cacheKey = $"strava:activities:{TokenKey(accessToken)}:{daysKey}";
        if (forceRefresh)
        {
            _cache.Remove(cacheKey);
        }

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
                using var resp = await _http.SendAsync(req, cancellationToken);
                if (!resp.IsSuccessStatusCode)
                {
                    var errorBody = await resp.Content.ReadAsStringAsync(cancellationToken);
                    _logger.LogWarning(
                        "Strava activities request failed with status {StatusCode}",
                        (int)resp.StatusCode);

                    if (resp.StatusCode == System.Net.HttpStatusCode.Forbidden &&
                        errorBody.Contains("\"code\":\"Inactive\"", StringComparison.OrdinalIgnoreCase))
                    {
                        throw new HttpRequestException(
                            "L'application API Strava est inactive. Active-la depuis les paramètres API Strava du compte propriétaire.",
                            null,
                            resp.StatusCode);
                    }
                }
                resp.EnsureSuccessStatusCode();
                var json = await resp.Content.ReadAsStringAsync(cancellationToken);
                var batch = JsonSerializer.Deserialize<List<Activity>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
                if (batch.Count == 0) break;
                all.AddRange(batch);
                page++;
                if (page > 25)
                {
                    _logger.LogWarning("Stopping Strava pagination at page {Page} (daysBack={DaysBack}).", page, daysBack);
                    break;
                }
            }

            return all;
        }) ?? new List<Activity>();
    }

    public async Task<StravaStreams?> FetchActivityStreamsAsync(
        string accessToken,
        long activityId,
        CancellationToken cancellationToken = default)
    {
        var cacheKey = $"strava:streams:{TokenKey(accessToken)}:{activityId}";
        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);

            var url = $"https://www.strava.com/api/v3/activities/{activityId}/streams?keys=distance,time&key_by_type=true";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            using var resp = await _http.SendAsync(req, cancellationToken);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(cancellationToken);
            return JsonSerializer.Deserialize<StravaStreams>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        });
    }

    public async Task<StravaActivityDetail?> FetchActivityDetailAsync(
        string accessToken,
        long activityId,
        CancellationToken cancellationToken = default)
    {
        var cacheKey = $"strava:activity:{TokenKey(accessToken)}:{activityId}";
        return await _cache.GetOrCreateAsync(cacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30);

            var url = $"https://www.strava.com/api/v3/activities/{activityId}";
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

            using var resp = await _http.SendAsync(req, cancellationToken);
            if (!resp.IsSuccessStatusCode) return null;
            var json = await resp.Content.ReadAsStringAsync(cancellationToken);
            return JsonSerializer.Deserialize<StravaActivityDetail>(json, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            });
        });
    }

    public async Task<Kpis> BuildKpisAsync(
        string accessToken,
        int? daysBack = null,
        CancellationToken cancellationToken = default)
    {
        var acts = await FetchActivitiesAsync(accessToken, daysBack, cancellationToken);
        return StravaAnalytics.ComputeKpis(acts);
    }

    public async Task<IEnumerable<BestEffort>> GetTopBest5kAsync(
        string token,
        int days,
        int limit,
        CancellationToken cancellationToken = default)
    {
        return await GetTopBestXAsync(token, 5_000, "5K", days, limit, cancellationToken);
    }

    public async Task<IEnumerable<BestEffort>> GetTopBestXAsync(
        string token,
        double distMeters,
        string label,
        int days,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var acts = await FetchActivitiesAsync(token, days, cancellationToken);

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
                HasValidDate = DateTime.TryParse(a.start_date_local, out var dateLocal),
                DateLocal = dateLocal
            })
            .Where(x => x.HasValidDate && Math.Abs(x.Km - targetKm) <= tolKm && x.Km > 2.0 && x.Sec > 600)
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
