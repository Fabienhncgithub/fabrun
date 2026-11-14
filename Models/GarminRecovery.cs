namespace FabRun.Api.Models;

public record GarminNight(string Date, double Hours, double? Score, double? DeepMinutes,
    double? RemMinutes, double? AwakeMinutes)
{
    public double? NightStress { get; init; }
    public double? Respiration { get; init; }
    public double? SpO2 { get; init; }
}
public record GarminRecovery(string Date, DateTimeOffset SyncedAtUtc, List<GarminNight> Nights,
    double? HrvMs, double? HrvWeeklyMs, double? RestingHeartRate,
    double? Stress, double? BodyBattery, double? BodyBatteryAtWake)
{
    public string? HrvStatus { get; init; }
    public double? HrvBaselineLow { get; init; }
    public double? HrvBaselineHigh { get; init; }
    public double? RestingHeartRate7d { get; init; }
    public double? NightRecharge { get; init; }
    public DateTimeOffset? LastDeviceSyncUtc { get; init; }
    public double? WeightKg { get; init; }
    public string? WeightDate { get; init; }
}

public record GarminHistoryDay(string Date, double? SleepHours, double? SleepScore,
    double? HrvMs, double? RestingHeartRate, double? Stress, double? BodyBattery,
    double? CaloriesTotal = null, double? CaloriesActive = null, double? CaloriesResting = null,
    double? WeightKg = null);
public record GarminHistory(string From, string Until, List<GarminHistoryDay> Days);
