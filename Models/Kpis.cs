// File: Models/Kpis.cs
namespace FabRun.Api.Models;

public record Kpis(
    string periodLabel,
    string? firstActivityDate,
    int count,
    double totalKm,
    string avgPacePerKm,
    double maxSpeedKmh,
    double? averageHeartRate,
    double strengthTrainingHours,
    double longestKm,
    double totalElevationGain,
    Dictionary<string,double> weeklyKm,
    double km4,
    double km12,
    double acuteChronicRatio
);
