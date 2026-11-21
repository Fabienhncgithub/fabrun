namespace FabRun.Api.Models;

/// <summary>
/// One-time import of activities recorded before the Garmin watch (former Strava history).
/// AthleteId keeps the key under which settings, sleep and best efforts were already stored.
/// </summary>
public record ActivityArchive(long AthleteId, DateTimeOffset ImportedAtUtc, List<Activity> Activities);
