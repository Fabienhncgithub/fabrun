namespace FabRun.Api.Models;

public record SleepUploadRequest(List<SleepSessionInput> sessions);

public record SleepSessionInput(
    DateTimeOffset startUtc,
    DateTimeOffset endUtc,
    string? source
);
