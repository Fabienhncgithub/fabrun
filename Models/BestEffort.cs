namespace FabRun.Api.Models;

public record BestEffort(
    long activityId,
    string activityName,
    DateTime dateLocal,
    double distKm,
    int seconds,
    double startKm,
    double endKm
);
