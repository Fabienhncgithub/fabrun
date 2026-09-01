using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;
using FabRun.Api.Services;

namespace FabRun.Api.Tests;

public sealed class HealthSleepServiceTests
{
    [Fact]
    public async Task UpsertSessions_NormalizesDurationAndIgnoresDuplicates()
    {
        var repository = new InMemorySleepRepository();
        var service = new HealthSleepService(repository);
        var start = DateTimeOffset.UtcNow.AddHours(-8);
        var session = new SleepSession(start, start.AddHours(7.5), 0, "manual-web");

        await service.UpsertSessionsAsync(42, new[] { session, session });

        var stored = Assert.Single(await repository.LoadAsync(42));
        Assert.Equal(450, stored.durationMinutes);
        Assert.Equal("manual-web", stored.source);
    }

    [Fact]
    public async Task UpsertSessions_KeepsOnlyFourHundredNewestSessions()
    {
        var repository = new InMemorySleepRepository();
        var service = new HealthSleepService(repository);
        var firstStart = DateTimeOffset.UtcNow.AddDays(-405);
        var sessions = Enumerable.Range(0, 405)
            .Select(index => new SleepSession(
                firstStart.AddDays(index),
                firstStart.AddDays(index).AddHours(8),
                0,
                "healthkit"));

        await service.UpsertSessionsAsync(7, sessions);

        var stored = await repository.LoadAsync(7);
        Assert.Equal(400, stored.Count);
        Assert.Equal(firstStart.AddDays(5), stored[0].startUtc);
    }

    [Fact]
    public async Task GetSummary_ComputesSevenAndThirtyDayWindows()
    {
        var repository = new InMemorySleepRepository();
        var service = new HealthSleepService(repository);
        var now = DateTimeOffset.UtcNow;
        await service.UpsertSessionsAsync(9, new[]
        {
            SessionEndingAt(now.AddDays(-1), 8),
            SessionEndingAt(now.AddDays(-5), 7),
            SessionEndingAt(now.AddDays(-20), 6),
            SessionEndingAt(now.AddDays(-40), 5),
        });

        var summary = await service.GetSummaryAsync(9);

        Assert.True(summary.connected);
        Assert.Equal(8, summary.lastSleepHours);
        Assert.Equal(7.5, summary.avg7dHours);
        Assert.Equal(7, summary.avg30dHours);
        Assert.Equal(2, summary.sessions7d);
        Assert.Equal(3, summary.sessions30d);
        Assert.Equal(4, summary.totalSessions);
    }

    [Fact]
    public async Task GetSummary_MergesOverlappingSourcesAndSegmentsFromOneNight()
    {
        var repository = new InMemorySleepRepository();
        var service = new HealthSleepService(repository);
        var end = DateTimeOffset.UtcNow.AddHours(-1);
        var firstStart = end.AddHours(-8);
        await service.UpsertSessionsAsync(11, new[]
        {
            new SleepSession(firstStart, firstStart.AddHours(4), 0, "healthkit"),
            new SleepSession(firstStart, firstStart.AddHours(4), 0, "manual-web"),
            new SleepSession(firstStart.AddHours(4.5), end, 0, "healthkit"),
        });

        var summary = await service.GetSummaryAsync(11);

        Assert.Equal(7.5, summary.lastSleepHours);
        Assert.Equal(1, summary.sessions7d);
        Assert.Equal(1, summary.totalSessions);
    }

    private static SleepSession SessionEndingAt(DateTimeOffset end, int hours) =>
        new(end.AddHours(-hours), end, 0, "healthkit");

    private sealed class InMemorySleepRepository : ISleepRepository
    {
        private readonly Dictionary<long, List<SleepSession>> _sessions = new();

        public Task<List<SleepSession>> LoadAsync(long athleteId) =>
            Task.FromResult(_sessions.TryGetValue(athleteId, out var value)
                ? value.ToList()
                : new List<SleepSession>());

        public Task SaveAsync(long athleteId, List<SleepSession> sessions)
        {
            _sessions[athleteId] = sessions.ToList();
            return Task.CompletedTask;
        }
    }
}
