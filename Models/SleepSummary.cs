namespace FabRun.Api.Models;

public record SleepSummary(
    bool connected,
    double lastSleepHours,
    double avg7dHours,
    double avg30dHours,
    int sessions7d,
    int sessions30d,
    int totalSessions,
    DateTimeOffset? lastSleepEndUtc
);
