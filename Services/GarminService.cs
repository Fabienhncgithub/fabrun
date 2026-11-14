using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using FabRun.Api.Models;

namespace FabRun.Api.Services;

// Personal API: a single account configured by the owner of this private dashboard.
public sealed class GarminService(IHttpClientFactory clients, IConfiguration config)
{
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(15);
    private const int WeightLookbackDays = 180;

    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly SemaphoreSlim tokenGate = new(1, 1);
    private readonly Dictionary<string, (DateTimeOffset Time, List<GarminHistoryDay> Days)> historyCache = new();
    private string? accessToken;
    private DateTimeOffset tokenExpires;
    private GarminRecovery? recovery;

    public bool Configured => !string.IsNullOrWhiteSpace(config["GARMIN_PERSONAL_API_KEY"]);
    public GarminRecovery? Snapshot => recovery;

    private static DateOnly Today() => DateOnly.FromDateTime(
        TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTimeOffset.UtcNow, "Europe/Zurich").DateTime);

    public async Task<GarminRecovery> SyncAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (recovery is not null && recovery.SyncedAtUtc > DateTimeOffset.UtcNow - CacheDuration)
                return recovery;
            using var client = clients.CreateClient("Garmin");
            var today = Today();
            var date = today.ToString("yyyy-MM-dd");
            using var sleep = await GetAsync(client,
                $"sleep-service/sleep/dailySleepSummariesByDate?startDate={today.AddDays(-29):yyyy-MM-dd}&endDate={date}", ct);
            var daily = GetAsync(client, $"usersummary-service/usersummary/daily?calendarDate={date}", ct);
            var hrv = GetAsync(client, $"hrv-service/hrv/{date}", ct);
            var weight = GetAsync(client, $"weight-service/weight/range/{today.AddDays(1 - WeightLookbackDays):yyyy-MM-dd}/{date}", ct);
            using var dailyDoc = await daily;
            using var hrvDoc = await hrv;
            using var weightDoc = await weight;
            recovery = Parse(date, sleep.RootElement, dailyDoc.RootElement, hrvDoc.RootElement, weightDoc.RootElement);
            return recovery;
        }
        finally { gate.Release(); }
    }

    private GarminActivityBatch? activityCache;

    public async Task<GarminActivityBatch> ActivitiesAsync(CancellationToken ct)
    {
        await gate.WaitAsync(ct);
        try
        {
            if (activityCache is not null && activityCache.SyncedAtUtc > DateTimeOffset.UtcNow - CacheDuration)
                return activityCache;
            using var client = clients.CreateClient("Garmin");
            var today = Today();
            var from = today.AddDays(-365);
            var activities = new List<GarminActivity>();
            const int limit = 99, maxPages = 11;
            var truncated = false;
            for (var page = 0; page < maxPages; page++)
            {
                using var json = await GetAsync(client,
                    $"activitylist-service/activities/search/activities?start={page * limit}&limit={limit}&startDate={from:yyyy-MM-dd}&endDate={today:yyyy-MM-dd}&sortOrder=desc&excludeChildren=true", ct);
                if (json.RootElement.ValueKind == JsonValueKind.Null) break;
                if (json.RootElement.ValueKind != JsonValueKind.Array) throw new JsonException("Unexpected Garmin activities response.");
                activities.AddRange(ParseActivities(json.RootElement));
                if (json.RootElement.GetArrayLength() < limit) break;
                truncated = page == maxPages - 1;
            }
            activityCache = new GarminActivityBatch(from.ToString("yyyy-MM-dd"), today.ToString("yyyy-MM-dd"),
                DateTimeOffset.UtcNow, activities.DistinctBy(a => a.Id).ToList(), truncated);
            return activityCache;
        }
        finally { gate.Release(); }
    }

    internal static List<GarminActivity> ParseActivities(JsonElement array)
    {
        var result = new List<GarminActivity>();
        if (array.ValueKind != JsonValueKind.Array) return result;
        foreach (var item in array.EnumerateArray())
        {
            var id = Child(item, "activityId");
            var start = Child(item, "startTimeLocal");
            var sport = Child(Child(item, "activityType"), "typeKey");
            var moving = Number(item, "movingDuration");
            var duration = moving is > 0 ? moving : Number(item, "duration");
            if (id.ValueKind != JsonValueKind.Number || !id.TryGetInt64(out var key) || key <= 0
                || start.ValueKind != JsonValueKind.String || !DateTime.TryParseExact(start.GetString(), "yyyy-MM-dd HH:mm:ss",
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out _)
                || sport.ValueKind != JsonValueKind.String || Number(item, "distance") is not { } distance
                || duration is not > 0) continue;
            result.Add(new GarminActivity(key, start.GetString()!, sport.GetString()!, distance,
                duration.Value,
                Number(item, "activityTrainingLoad"), Number(item, "aerobicTrainingEffect", 5), Number(item, "anaerobicTrainingEffect", 5)));
        }
        return result;
    }

    public async Task<GarminHistory> HistoryAsync(string period, CancellationToken ct)
    {
        var today = Today();
        var from = period switch
        {
            "1d" => today, "7d" => today.AddDays(-6), "1m" => today.AddMonths(-1).AddDays(1),
            "4m" => today.AddMonths(-4).AddDays(1), "1y" => today.AddYears(-1).AddDays(1),
            "2y" => today.AddYears(-2).AddDays(1), _ => throw new ArgumentException("Invalid Garmin period.")
        };
        await gate.WaitAsync(ct);
        try
        {
            var expired = DateTimeOffset.UtcNow - CacheDuration;
            foreach (var stale in historyCache.Where(e => e.Value.Time < expired).Select(e => e.Key).ToList())
                historyCache.Remove(stale);

            using var client = clients.CreateClient("Garmin");
            var days = new List<GarminHistoryDay>();
            // Anchor 31-day blocks at today so changing period reuses recent blocks.
            for (var end = today; end >= from; end = end.AddDays(-31))
            {
                var start = end.AddDays(-30);
                var key = $"{start:yyyy-MM-dd}/{end:yyyy-MM-dd}";
                if (!historyCache.TryGetValue(key, out var cached))
                {
                    // First call runs alone so a token refresh happens once, then the rest in parallel.
                    using var sleep = await GetAsync(client, $"sleep-service/sleep/dailySleepSummariesByDate?startDate={start:yyyy-MM-dd}&endDate={end:yyyy-MM-dd}", ct);
                    var hrv = GetAsync(client, $"hrv-service/hrv/daily/{start:yyyy-MM-dd}/{end:yyyy-MM-dd}", ct);
                    var daily = GetAsync(client, $"usersummary-service/v2/dailysummaries?startDate={start:yyyy-MM-dd}&endDate={end:yyyy-MM-dd}", ct);
                    var weight = GetAsync(client, $"weight-service/weight/range/{start:yyyy-MM-dd}/{end:yyyy-MM-dd}", ct);
                    using var hrvDoc = await hrv;
                    using var dailyDoc = await daily;
                    using var weightDoc = await weight;
                    cached = (DateTimeOffset.UtcNow, ParseHistory(sleep.RootElement, hrvDoc.RootElement, dailyDoc.RootElement, weightDoc.RootElement));
                    historyCache[key] = cached;
                }
                days.AddRange(cached.Days);
            }
            var fromText = from.ToString("yyyy-MM-dd");
            var todayText = today.ToString("yyyy-MM-dd");
            return new GarminHistory(fromText, todayText,
                days.Where(d => string.CompareOrdinal(d.Date, fromText) >= 0 && string.CompareOrdinal(d.Date, todayText) <= 0)
                    .DistinctBy(d => d.Date).OrderBy(d => d.Date).ToList());
        }
        finally { gate.Release(); }
    }

    internal static List<GarminHistoryDay> ParseHistory(JsonElement sleep, JsonElement hrv, JsonElement daily, JsonElement weight = default)
    {
        var map = new Dictionary<string, GarminHistoryDay>();
        GarminHistoryDay? Day(JsonElement item, string field = "calendarDate")
        {
            if (ValidDate(Child(item, field)) is not { } key) return null;
            return map.TryGetValue(key, out var day) ? day : new GarminHistoryDay(key, null, null, null, null, null, null);
        }
        if (sleep.ValueKind == JsonValueKind.Array)
            foreach (var item in sleep.EnumerateArray())
                if (Day(item) is { } day)
                    map[day.Date] = day with { SleepHours = Number(item, "sleepTimeSeconds", 86400) is > 0 and var seconds ? seconds / 3600 : null,
                        SleepScore = Number(Child(Child(item, "sleepScores"), "overall"), "value", 100) };
        var summaries = Child(hrv, "hrvSummaries");
        if (summaries.ValueKind == JsonValueKind.Array)
            foreach (var item in summaries.EnumerateArray())
                if (Day(item) is { } day) map[day.Date] = day with { HrvMs = Number(item, "lastNightAvg") };
        var data = Child(daily, "data");
        if (data.ValueKind == JsonValueKind.Array)
            foreach (var item in data.EnumerateArray())
                if (Day(item) is { } day)
                {
                    var calories = Child(item, "calories");
                    map[day.Date] = day with {
                        RestingHeartRate = Number(Child(item, "heartRate"), "restingValue"),
                        Stress = Number(Child(item, "stress"), "avgLevel", 100),
                        BodyBattery = Number(Child(item, "bodyBattery"), "latestValue", 100),
                        CaloriesTotal = Number(calories, "burnedTotal", MaxDailyKcal) is > 0 and var total ? total : null,
                        CaloriesActive = Number(calories, "burnedActive", MaxDailyKcal),
                        CaloriesResting = Number(calories, "burnedResting", MaxDailyKcal) is > 0 and var resting ? resting : null };
                }
        var weights = Child(weight, "dailyWeightSummaries");
        if (weights.ValueKind == JsonValueKind.Array)
            foreach (var item in weights.EnumerateArray())
                if (Day(item, "summaryDate") is { } day && Kilograms(Child(item, "latestWeight")) is { } kg)
                    map[day.Date] = day with { WeightKg = kg };
        return map.Values.OrderBy(d => d.Date).ToList();
    }

    private async Task EnsureTokenAsync(HttpClient client, string? rejected, CancellationToken ct)
    {
        await tokenGate.WaitAsync(ct);
        try
        {
            // Another request may already have replaced the rejected token.
            if (accessToken is not null && accessToken != rejected && tokenExpires > DateTimeOffset.UtcNow) return;
            using var request = new HttpRequestMessage(HttpMethod.Post,
                "personalapitoken-service/personal-api/personal-api-key/token");
            request.Headers.Authorization = new AuthenticationHeaderValue("ApiKey", config["GARMIN_PERSONAL_API_KEY"]);
            using var response = await client.SendAsync(request, ct);
            response.EnsureSuccessStatusCode();
            var payload = (await response.Content.ReadAsStringAsync(ct)).Trim();
            string? token;
            if (payload.StartsWith('{'))
            {
                using var json = JsonDocument.Parse(payload);
                var value = Child(json.RootElement, "access_token");
                if (value.ValueKind != JsonValueKind.String) throw new JsonException("Missing Garmin access token.");
                token = value.GetString();
            }
            else
            {
                // Garmin Personal returns the JWT directly as text/plain.
                token = payload;
            }
            if (string.IsNullOrWhiteSpace(token) || token.Any(char.IsWhiteSpace))
                throw new JsonException("Invalid Garmin access token.");
            accessToken = token;
            tokenExpires = DateTimeOffset.UtcNow.AddHours(23);
        }
        finally { tokenGate.Release(); }
    }

    private async Task<JsonDocument> GetAsync(HttpClient client, string path, CancellationToken ct)
    {
        string? rejected = null;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            if (accessToken is null || accessToken == rejected || tokenExpires <= DateTimeOffset.UtcNow)
                await EnsureTokenAsync(client, rejected, ct);
            var token = accessToken;
            using var get = new HttpRequestMessage(HttpMethod.Get, path);
            get.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var result = await client.SendAsync(get, ct);
            if (result.StatusCode == HttpStatusCode.Unauthorized && attempt == 0)
            {
                rejected = token;
                continue;
            }
            if (result.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.NoContent)
                return JsonDocument.Parse("null");
            result.EnsureSuccessStatusCode();
            return JsonDocument.Parse(await result.Content.ReadAsStringAsync(ct));
        }
        throw new HttpRequestException("Garmin authentication failed.", null, HttpStatusCode.Unauthorized);
    }

    internal static GarminRecovery Parse(string date, JsonElement sleep, JsonElement daily, JsonElement hrv, JsonElement weight = default)
    {
        var nights = new List<GarminNight>();
        if (sleep.ValueKind == JsonValueKind.Array)
            foreach (var night in sleep.EnumerateArray())
            {
                var seconds = Number(night, "sleepTimeSeconds");
                if (ValidDate(Child(night, "calendarDate")) is not { } day || seconds is null or <= 0 or > 86400) continue;
                nights.Add(new GarminNight(day, Math.Round(seconds.Value / 3600, 2),
                    Number(Child(Child(night, "sleepScores"), "overall"), "value", 100),
                    Minutes(night, "deepSleepSeconds"), Minutes(night, "remSleepSeconds"), Minutes(night, "awakeSleepSeconds"))
                {
                    NightStress = Number(night, "avgSleepStress", 100),
                    Respiration = Number(night, "averageRespirationValue"),
                    SpO2 = Number(night, "averageSpO2Value", 100)
                });
            }
        var summary = Child(hrv, "hrvSummary");
        var (weightKg, weightDate) = LatestWeight(weight);
        return new GarminRecovery(date, DateTimeOffset.UtcNow,
            nights.DistinctBy(n => n.Date).OrderBy(n => n.Date).ToList(),
            Number(summary, "lastNightAvg"), Number(summary, "weeklyAvg"),
            Number(daily, "restingHeartRate"), Number(daily, "averageStressLevel", 100),
            Number(daily, "bodyBatteryMostRecentValue", 100), Number(daily, "bodyBatteryAtWakeTime", 100))
        {
            HrvStatus = Child(summary, "status").ValueKind == JsonValueKind.String ? Child(summary, "status").GetString() : null,
            HrvBaselineLow = Number(Child(summary, "baseline"), "balancedLow"),
            HrvBaselineHigh = Number(Child(summary, "baseline"), "balancedUpper"),
            RestingHeartRate7d = Number(daily, "lastSevenDaysAvgRestingHeartRate"),
            NightRecharge = Number(daily, "bodyBatteryDuringSleep", 100),
            LastDeviceSyncUtc = Child(daily, "lastSyncTimestampGMT") is var stamp
                && stamp.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(stamp.GetString(),
                    CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var time) ? time : null,
            WeightKg = weightKg,
            WeightDate = weightDate,
        };
    }

    // Most recent weigh-in in the range, falling back to the last one before it.
    private static (double? Kg, string? Date) LatestWeight(JsonElement range)
    {
        var summaries = Child(range, "dailyWeightSummaries");
        if (summaries.ValueKind == JsonValueKind.Array)
        {
            var latest = summaries.EnumerateArray()
                .Select(s => (Date: ValidDate(Child(s, "summaryDate")), Kg: Kilograms(Child(s, "latestWeight"))))
                .Where(s => s.Date is not null && s.Kg is not null)
                .OrderByDescending(s => s.Date, StringComparer.Ordinal)
                .FirstOrDefault();
            if (latest.Date is not null) return (latest.Kg, latest.Date);
        }
        var previous = Child(range, "previousDateWeight");
        return Kilograms(previous) is { } kg && ValidDate(Child(previous, "calendarDate")) is { } date ? (kg, date) : (null, null);
    }

    private const double MaxDailyKcal = 20000;

    // The Swagger documents kilograms, but the live API returns grams (e.g. 89699 for 89.7 kg).
    // Accept both, then reject anything outside a plausible adult range.
    internal static double? Kilograms(JsonElement entry)
    {
        if (Number(entry, "weight") is not { } raw) return null;
        var kg = raw > 1000 ? raw / 1000 : raw;
        return kg is >= 25 and <= 350 ? Math.Round(kg, 1) : null;
    }

    private static string? ValidDate(JsonElement value)
        => value.ValueKind == JsonValueKind.String && DateOnly.TryParseExact(value.GetString(), "yyyy-MM-dd",
            CultureInfo.InvariantCulture, DateTimeStyles.None, out _) ? value.GetString() : null;
    private static double? Minutes(JsonElement e, string key) => Number(e, key) is { } value ? Math.Round(value / 60, 1) : null;
    private static JsonElement Child(JsonElement e, string key) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var value) ? value : default;
    private static double? Number(JsonElement e, string key, double max = double.MaxValue)
        => Child(e, key) is var v && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var n) && double.IsFinite(n) && n >= 0 && n <= max ? n : null;
}
