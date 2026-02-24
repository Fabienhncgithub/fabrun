namespace FabRun.Api.Models;

public record PredictionReference(
    double distanceKm,
    int timeSec,
    DateTime dateLocal,
    long activityId,
    string activityName,
    string method
);

public record PredictionConfidence(
    int score,
    string level,
    List<string> reasons
);

public record PredictionResponse(
    PredictionReference reference,
    double exponentUsed,
    Dictionary<string, int> predictions,
    PredictionConfidence confidence
);
