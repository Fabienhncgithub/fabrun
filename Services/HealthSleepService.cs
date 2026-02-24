using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Services;

public class HealthSleepService
{
    private readonly ISleepRepository _repository;

    public HealthSleepService(ISleepRepository repository)
    {
        _repository = repository;
    }

    public async Task UpsertSessionsAsync(long athleteId, IEnumerable<SleepSession> sessions)
    {
        var normalized = sessions
            .Where(s => s.endUtc > s.startUtc)
            .Select(s =>
            {
                var duration = (int)Math.Round((s.endUtc - s.startUtc).TotalMinutes);
                var source = string.IsNullOrWhiteSpace(s.source) ? "healthkit" : s.source;
                return s with { durationMinutes = Math.Max(duration, 1), source = source };
            })
            .ToList();

        if (normalized.Count == 0) return;

        var list = await _repository.LoadAsync(athleteId);

        var existing = new HashSet<string>(list.Select(Key));
        foreach (var s in normalized)
        {
            var key = Key(s);
            if (existing.Add(key))
            {
                list.Add(s);
            }
        }

        list.Sort((a, b) => a.endUtc.CompareTo(b.endUtc));
        if (list.Count > 400)
        {
            list.RemoveRange(0, list.Count - 400);
        }

        await _repository.SaveAsync(athleteId, list);
    }

    public async Task<SleepSummary> GetSummaryAsync(long athleteId)
    {
        var list = await _repository.LoadAsync(athleteId);
        if (list.Count == 0)
        {
            return new SleepSummary(false, 0, 0, 0, 0, 0, 0, null);
        }

        var now = DateTimeOffset.UtcNow;
        var cutoff7 = now.AddDays(-7);
        var cutoff30 = now.AddDays(-30);

        var last = list.OrderByDescending(s => s.endUtc).First();
        var in7 = list.Where(s => s.endUtc >= cutoff7).ToList();
        var in30 = list.Where(s => s.endUtc >= cutoff30).ToList();

        double AvgHours(List<SleepSession> items) =>
            items.Count == 0 ? 0 : Math.Round(items.Average(s => s.durationMinutes) / 60.0, 1);

        return new SleepSummary(
            true,
            Math.Round(last.durationMinutes / 60.0, 1),
            AvgHours(in7),
            AvgHours(in30),
            in7.Count,
            in30.Count,
            list.Count,
            last.endUtc
        );
    }

    private static string Key(SleepSession s) => $"{s.startUtc:o}|{s.endUtc:o}|{s.source}";
}
