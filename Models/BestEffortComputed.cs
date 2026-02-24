namespace FabRun.Api.Models;

public record BestEffortComputed(
    double distanceKm,
    int timeSec,
    long activityId,
    string activityName,
    DateTime dateLocal,
    string method,
    double startKm,
    double endKm
);
