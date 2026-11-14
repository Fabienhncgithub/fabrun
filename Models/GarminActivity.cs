namespace FabRun.Api.Models;

public record GarminActivity(long Id, string StartLocal, string Sport, double Distance,
    double Duration, double? Load, double? Aerobic, double? Anaerobic);
public record GarminActivityBatch(string From, string Until, DateTimeOffset SyncedAtUtc,
    List<GarminActivity> Activities, bool Truncated);
