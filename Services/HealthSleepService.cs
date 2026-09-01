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

        // HealthKit may send several asleep segments for one night (and two
        // sources can describe the same interval). Merge overlaps first,
        // then group blocks separated by less than two hours into one sleep
        // episode. Gaps are not counted as sleep duration.
        var episodes = BuildEpisodes(list);
        if (episodes.Count == 0)
        {
            return new SleepSummary(false, 0, 0, 0, 0, 0, 0, null);
        }

        var last = episodes[^1];
        var in7 = episodes.Where(s => s.EndUtc >= cutoff7).ToList();
        var in30 = episodes.Where(s => s.EndUtc >= cutoff30).ToList();

        double AvgHours(List<SleepEpisode> items) =>
            items.Count == 0 ? 0 : Math.Round(items.Average(s => s.DurationMinutes) / 60.0, 1);

        return new SleepSummary(
            true,
            Math.Round(last.DurationMinutes / 60.0, 1),
            AvgHours(in7),
            AvgHours(in30),
            in7.Count,
            in30.Count,
            episodes.Count,
            last.EndUtc
        );
    }

    private static List<SleepEpisode> BuildEpisodes(IEnumerable<SleepSession> sessions)
    {
        var ordered = sessions
            .Where(session => session.endUtc > session.startUtc)
            .OrderBy(session => session.startUtc)
            .ToList();
        var blocks = new List<SleepBlock>();

        foreach (var session in ordered)
        {
            if (blocks.Count == 0 || session.startUtc > blocks[^1].EndUtc)
            {
                blocks.Add(new SleepBlock(session.startUtc, session.endUtc));
                continue;
            }

            var current = blocks[^1];
            if (session.endUtc > current.EndUtc)
            {
                blocks[^1] = current with { EndUtc = session.endUtc };
            }
        }

        var episodes = new List<SleepEpisode>();
        foreach (var block in blocks)
        {
            var durationMinutes = (int)Math.Round((block.EndUtc - block.StartUtc).TotalMinutes);
            if (episodes.Count == 0 || block.StartUtc - episodes[^1].EndUtc > TimeSpan.FromHours(2))
            {
                episodes.Add(new SleepEpisode(block.EndUtc, durationMinutes));
                continue;
            }

            var current = episodes[^1];
            episodes[^1] = new SleepEpisode(
                block.EndUtc,
                current.DurationMinutes + durationMinutes);
        }

        return episodes;
    }

    private static string Key(SleepSession s) => $"{s.startUtc:o}|{s.endUtc:o}|{s.source}";

    private sealed record SleepBlock(DateTimeOffset StartUtc, DateTimeOffset EndUtc);
    private sealed record SleepEpisode(DateTimeOffset EndUtc, int DurationMinutes);
}
