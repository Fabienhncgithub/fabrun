using FabRun.Api.Models;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/health/sleep")]
public class HealthSleepController : ControllerBase
{
    private readonly ActivityService _activities;
    private readonly HealthSleepService _sleep;

    public HealthSleepController(ActivityService activities, HealthSleepService sleep)
    {
        _activities = activities;
        _sleep = sleep;
    }

    [HttpPost]
    [RequestSizeLimit(1_048_576)]
    public async Task<IActionResult> Upload(
        [FromBody] SleepUploadRequest body,
        CancellationToken cancellationToken)
    {
        if (body.sessions is null || body.sessions.Count == 0)
            return BadRequest(new { error = "Aucune session sommeil fournie." });

        var now = DateTimeOffset.UtcNow;
        var oldestAllowed = now.AddYears(-5);
        var newestAllowed = now.AddMinutes(5);
        if (body.sessions.Any(session =>
                session.endUtc <= session.startUtc
                || session.endUtc - session.startUtc > TimeSpan.FromHours(24)
                || session.startUtc < oldestAllowed
                || session.endUtc > newestAllowed
                || string.IsNullOrWhiteSpace(session.source)
                || session.source.Length > 64))
        {
            return BadRequest(new
            {
                error = "Une session sommeil contient des dates, une durée ou une source invalides."
            });
        }

        var ownerId = await _activities.OwnerIdAsync();
        var sessions = body.sessions.Select(s => new SleepSession(
            s.startUtc,
            s.endUtc,
            0,
            s.source ?? "healthkit"
        ));

        await _sleep.UpsertSessionsAsync(ownerId, sessions);
        var summary = await _sleep.GetSummaryAsync(ownerId);
        return Ok(summary);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken cancellationToken)
    {
        var summary = await _sleep.GetSummaryAsync(await _activities.OwnerIdAsync());
        return Ok(summary);
    }
}
