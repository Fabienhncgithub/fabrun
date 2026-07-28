using FabRun.Api.Models;
using FabRun.Api.Services;

namespace FabRun.Api.Tests;

public class StravaAnalyticsTests
{
    [Fact]
    public void ComputeKpis_SumsElevationFromRunsWalksAndHikesOnly()
    {
        var activities = new[]
        {
            Activity(1, "Run", 5_000, 1_500, 120),
            Activity(2, "Walk", 3_000, 2_400, 80),
            Activity(3, "Hike", 8_000, 7_200, 450),
            Activity(4, "Ride", 20_000, 3_600, 900),
        };

        var kpis = StravaAnalytics.ComputeKpis(activities);

        Assert.Equal(650, kpis.totalElevationGain);
        Assert.Equal(5, kpis.totalKm);
    }

    [Fact]
    public void ComputeKpis_UsesMaximumRecordedRunningSpeed()
    {
        var activities = new[]
        {
            Activity(1, "Run", 5_000, 1_500, 50, maxSpeed: 5.5),
            Activity(2, "Run", 10_000, 3_000, 80, maxSpeed: 6.25),
            Activity(3, "Ride", 20_000, 3_600, 100, maxSpeed: 15),
        };

        var kpis = StravaAnalytics.ComputeKpis(activities);

        Assert.Equal(22.5, kpis.maxSpeedKmh);
    }

    [Fact]
    public void ComputeKpis_IgnoresImplausibleGpsSpeedSpikes()
    {
        var activities = new[]
        {
            Activity(1, "Run", 5_000, 1_500, 50, maxSpeed: 14.39),
            Activity(2, "Run", 10_000, 3_000, 80, maxSpeed: 6.25),
        };

        var kpis = StravaAnalytics.ComputeKpis(activities);

        Assert.Equal(22.5, kpis.maxSpeedKmh);
    }

    [Fact]
    public void ComputeKpis_WeightsAverageHeartRateByRunningTime()
    {
        var activities = new[]
        {
            Activity(1, "Run", 5_000, 1_200, 50, averageHeartRate: 140),
            Activity(2, "Run", 10_000, 2_400, 80, averageHeartRate: 155),
            Activity(3, "Walk", 3_000, 3_600, 20, averageHeartRate: 100),
        };

        var kpis = StravaAnalytics.ComputeKpis(activities);

        Assert.Equal(150, kpis.averageHeartRate);
    }

    [Fact]
    public void ComputeKpis_SumsWeightTrainingDurationInHours()
    {
        var activities = new[]
        {
            Activity(1, "WeightTraining", 0, 3_600, 0),
            Activity(2, "WeightTraining", 0, 1_800, 0),
            Activity(3, "Workout", 0, 7_200, 0),
        };

        var kpis = StravaAnalytics.ComputeKpis(activities);

        Assert.Equal(1.5, kpis.strengthTrainingHours);
    }

    [Fact]
    public void ComputeKpis_UsesEarliestActivityDate()
    {
        var activities = new[]
        {
            Activity(1, "Run", 5_000, 1_800, 0) with { start_date_local = "2025-06-12T08:00:00Z" },
            Activity(2, "Run", 5_000, 1_800, 0) with { start_date_local = "2023-04-07T08:00:00Z" },
        };

        var kpis = StravaAnalytics.ComputeKpis(activities);

        Assert.Equal("2023-04-07", kpis.firstActivityDate);
    }

    private static Activity Activity(
        long id,
        string sportType,
        double distance,
        int movingTime,
        double elevation,
        double? maxSpeed = null,
        double? averageHeartRate = null) =>
        new(
            id,
            sportType,
            distance,
            movingTime,
            elevation,
            DateTime.UtcNow.ToString("O"),
            null,
            $"Activity {id}",
            average_heartrate: averageHeartRate,
            max_speed: maxSpeed);
}
