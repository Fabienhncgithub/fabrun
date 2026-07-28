namespace FabRun.Api.Models;

public record BestEffortSnapshot(
    DateTimeOffset calculatedAtUtc,
    List<BestEffortComputed> efforts
);
