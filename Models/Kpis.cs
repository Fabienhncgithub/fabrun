// File: Models/Kpis.cs
namespace FabRun.Api.Models;

public record Kpis(
    string periodLabel,
    int count,
    double totalKm,
    string avgPacePerKm,
    string bestPacePerKm,
    double longestKm,
    Dictionary<string,double> weeklyKm,
    double km4,
    double km12,
    double acuteChronicRatio
);
