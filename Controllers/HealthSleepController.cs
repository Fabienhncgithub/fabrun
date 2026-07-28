using FabRun.Api.Models;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;
using FabRun.Api.Security;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/health/sleep")]
public class HealthSleepController : ControllerBase
{
    private readonly IStravaClient _strava;
    private readonly HealthSleepService _sleep;
    private readonly StravaTokenProtector _tokenProtector;

    public HealthSleepController(
        IStravaClient strava,
        HealthSleepService sleep,
        StravaTokenProtector tokenProtector)
    {
        _strava = strava;
        _sleep = sleep;
        _tokenProtector = tokenProtector;
    }

    [HttpPost]
    [RequestSizeLimit(1_048_576)]
    public async Task<IActionResult> Upload(
        [FromBody] SleepUploadRequest body,
        CancellationToken cancellationToken)
    {
        var token = GetBearerOrCookie();
        if (string.IsNullOrWhiteSpace(token))
            return Unauthorized(new { error = "Token manquant (reconnecte-toi)." });

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

        var profile = await _strava.FetchAthleteProfileAsync(token, cancellationToken);
        var sessions = body.sessions.Select(s => new SleepSession(
            s.startUtc,
            s.endUtc,
            0,
            s.source ?? "healthkit"
        ));

        await _sleep.UpsertSessionsAsync(profile.id, sessions);
        var summary = await _sleep.GetSummaryAsync(profile.id);
        return Ok(summary);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken cancellationToken)
    {
        var token = GetBearerOrCookie();
        if (string.IsNullOrWhiteSpace(token))
            return Unauthorized(new { error = "Token manquant (reconnecte-toi)." });

        var profile = await _strava.FetchAthleteProfileAsync(token, cancellationToken);
        var summary = await _sleep.GetSummaryAsync(profile.id);
        return Ok(summary);
    }

    private string? GetBearerOrCookie()
        => StravaTokenResolver.Resolve(Request, _tokenProtector);
}
