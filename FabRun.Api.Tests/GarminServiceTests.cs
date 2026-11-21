using System.Net;
using System.Text.Json;
using FabRun.Api.Services;
using Microsoft.Extensions.Configuration;

namespace FabRun.Api.Tests;

public class GarminServiceTests
{
    [Fact]
    public void ParseUsesMeasuredSleepRatherThanTimeInBedAndIgnoresMissingValues()
    {
        using var sleep = JsonDocument.Parse("""[{"calendarDate":"2026-11-14","sleepTimeSeconds":25200,"awakeSleepSeconds":3600,"sleepScores":{"overall":{"value":82}}}]""");
        using var daily = JsonDocument.Parse("""{"averageStressLevel":-1,"bodyBatteryMostRecentValue":62}""");
        using var hrv = JsonDocument.Parse("""{"hrvSummary":{"lastNightAvg":48}}""");
        var result = GarminService.Parse("2026-11-14", sleep.RootElement, daily.RootElement, hrv.RootElement);
        Assert.Equal(7, Assert.Single(result.Nights).Hours);
        Assert.Equal(82d, result.Nights[0].Score);
        Assert.Null(result.Stress);
        Assert.Null(result.RestingHeartRate);
        Assert.Equal(48d, result.HrvMs);
    }

    [Fact]
    public async Task SyncRenewsRejectedTokenAndCachesSuccessfulSnapshot()
    {
        var handler = new GarminHandler();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["GARMIN_PERSONAL_API_KEY"] = "test-key" }).Build();
        var service = new GarminService(new Factory(handler), config);
        var result = await service.SyncAsync(default);
        Assert.Same(result, await service.SyncAsync(default));
        Assert.Equal(2, handler.Tokens);
        Assert.Equal(7, handler.Requests);
    }
    [Fact]
    public void HistoryJoinsDatesAndPreservesMissingMetrics()
    {
        using var sleep = JsonDocument.Parse("""[{"calendarDate":"2026-11-14","sleepTimeSeconds":25200}]""");
        using var hrv = JsonDocument.Parse("""{"hrvSummaries":[{"calendarDate":"2026-11-14","lastNightAvg":30}]}""");
        using var daily = JsonDocument.Parse("""{"data":[{"calendarDate":"2026-11-14","stress":{"avgLevel":-1},"bodyBattery":{"latestValue":42}},{"calendarDate":"bad"}]}""");
        var day = Assert.Single(GarminService.ParseHistory(sleep.RootElement, hrv.RootElement, daily.RootElement));
        Assert.Equal(7d, day.SleepHours);
        Assert.Equal(30d, day.HrvMs);
        Assert.Equal(42d, day.BodyBattery);
        Assert.Null(day.RestingHeartRate);
        Assert.Null(day.Stress);
    }

    [Fact]
    public void HistoryReadsGarminCaloriesAndConvertsWeightFromGrams()
    {
        using var daily = JsonDocument.Parse("""{"data":[{"calendarDate":"2026-11-13","calories":{"burnedResting":2294,"burnedActive":1335,"burnedTotal":3629}}]}""");
        using var weight = JsonDocument.Parse("""{"dailyWeightSummaries":[{"summaryDate":"2026-11-13","latestWeight":{"weight":89699.0}},{"summaryDate":"2026-11-12","latestWeight":{"weight":12.0}}]}""");
        var days = GarminService.ParseHistory(default, default, daily.RootElement, weight.RootElement);
        var day = Assert.Single(days);
        Assert.Equal(3629d, day.CaloriesTotal);
        Assert.Equal(1335d, day.CaloriesActive);
        Assert.Equal(2294d, day.CaloriesResting);
        Assert.Equal(89.7, day.WeightKg);
    }

    [Fact]
    public void ParseKeepsLatestWeighInAndFallsBackToPreviousWeight()
    {
        using var empty = JsonDocument.Parse("[]");
        using var recent = JsonDocument.Parse("""{"dailyWeightSummaries":[{"summaryDate":"2026-11-12","latestWeight":{"weight":90500.0}},{"summaryDate":"2026-11-14","latestWeight":{"weight":89699.0}}]}""");
        var result = GarminService.Parse("2026-11-14", empty.RootElement, default, default, recent.RootElement);
        Assert.Equal(89.7, result.WeightKg);
        Assert.Equal("2026-11-14", result.WeightDate);

        using var older = JsonDocument.Parse("""{"dailyWeightSummaries":[],"previousDateWeight":{"calendarDate":"2026-05-13","weight":90.5}}""");
        var fallback = GarminService.Parse("2026-11-14", empty.RootElement, default, default, older.RootElement);
        Assert.Equal(90.5, fallback.WeightKg);
        Assert.Equal("2026-05-13", fallback.WeightDate);
    }

    [Fact]
    public async Task HistoryReusesBlocksAcrossPeriodsAndRejectsUnboundedRanges()
    {
        var handler = new GarminHandler();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["GARMIN_PERSONAL_API_KEY"] = "test-key" }).Build();
        var service = new GarminService(new Factory(handler), config);
        var week = await service.HistoryAsync("7d", default);
        var month = await service.HistoryAsync("1m", default);
        Assert.Equal(7, handler.Requests);
        Assert.Equal(6, DateOnly.Parse(week.Until).DayNumber - DateOnly.Parse(week.From).DayNumber);
        Assert.True(string.CompareOrdinal(month.From, week.From) < 0);
        await Assert.ThrowsAsync<ArgumentException>(() => service.HistoryAsync("all", default));
    }

    [Fact]
    public void ActivitiesParserValidatesMeasurementsAndPreservesZeroEffects()
    {
        using var json = JsonDocument.Parse("""[{"activityId":12,"startTimeLocal":"2026-11-14 09:30:00","activityType":{"typeKey":"running"},"distance":10000,"duration":3700,"movingDuration":3600,"activityTrainingLoad":125,"aerobicTrainingEffect":3.5,"anaerobicTrainingEffect":0},{"activityId":13,"startTimeLocal":"bad"}]""");
        var activity = Assert.Single(GarminService.ParseActivities(json.RootElement));
        Assert.Equal(3600d, activity.Duration);
        Assert.Equal(125d, activity.Load);
        Assert.Equal(0d, activity.Anaerobic);
        Assert.Equal(3.5d, activity.Aerobic);
    }

    [Fact]
    public void SkiParserKeepsOnlySkiActivities()
    {
        using var json = JsonDocument.Parse("""[{"activityId":1,"startTimeLocal":"2026-01-10 09:00:00","activityType":{"typeKey":"resort_skiing"},"distance":61000,"duration":21000,"elevationLoss":6500,"maxSpeed":21.4},{"activityId":2,"startTimeLocal":"2026-01-11 09:00:00","activityType":{"typeKey":"running"},"distance":10000,"duration":3000},{"activityId":3,"startTimeLocal":"2026-01-12 09:00:00","activityType":{"typeKey":"backcountry_skiing"},"distance":12000,"duration":14000}]""");
        var days = GarminService.ParseSki(json.RootElement);
        Assert.Equal(new long[] { 1, 3 }, days.Select(d => d.Id));
        Assert.Equal(6500d, days[0].ElevationLoss);
        Assert.Null(days[1].ElevationLoss);
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, false) { BaseAddress = new Uri("https://personal.connectapi.garmin.com/") };
    }
    private sealed class GarminHandler : HttpMessageHandler
    {
        private int tokens;
        private int requests;
        public int Tokens => tokens;
        public int Requests => requests;
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var current = Interlocked.Increment(ref requests);
            if (request.Method == HttpMethod.Post)
            {
                Assert.Equal("ApiKey", request.Headers.Authorization?.Scheme);
                Interlocked.Increment(ref tokens);
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("header.payload.signature", System.Text.Encoding.UTF8, "text/plain") });
            }
            Assert.Equal("Bearer", request.Headers.Authorization?.Scheme);
            if (current == 2) return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
            var json = request.RequestUri!.AbsolutePath.Contains("sleep") ? "[]" : "{}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json) });
        }
    }
}
