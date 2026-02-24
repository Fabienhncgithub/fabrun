namespace FabRun.Api.Models;

public record SleepSession(
    DateTimeOffset startUtc,
    DateTimeOffset endUtc,
    int durationMinutes,
    string source
);
