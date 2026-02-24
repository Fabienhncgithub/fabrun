using FabRun.Api.Models;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/health/sleep")]
public class HealthSleepController : ControllerBase
{
    private readonly IStravaClient _strava;
    private readonly HealthSleepService _sleep;

    public HealthSleepController(IStravaClient strava, HealthSleepService sleep)
    {
        _strava = strava;
        _sleep = sleep;
    }

    [HttpPost]
    public async Task<IActionResult> Upload([FromBody] SleepUploadRequest body)
    {
        var token = GetBearerOrCookie();
        if (string.IsNullOrWhiteSpace(token))
            return Unauthorized(new { error = "Token manquant (reconnecte-toi)." });

        if (body.sessions is null || body.sessions.Count == 0)
            return BadRequest(new { error = "Aucune session sommeil fournie." });

        var profile = await _strava.FetchAthleteProfileAsync(token);
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
    public async Task<IActionResult> Summary()
    {
        var token = GetBearerOrCookie();
        if (string.IsNullOrWhiteSpace(token))
            return Unauthorized(new { error = "Token manquant (reconnecte-toi)." });

        var profile = await _strava.FetchAthleteProfileAsync(token);
        var summary = await _sleep.GetSummaryAsync(profile.id);
        return Ok(summary);
    }

    private string? GetBearerOrCookie()
    {
        var auth = Request.Headers.Authorization.ToString();
        const string bearerPrefix = "Bearer ";
        if (!string.IsNullOrWhiteSpace(auth) &&
            auth.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return auth[bearerPrefix.Length..].Trim();
        }

        if (Request.Cookies.TryGetValue("strava_access_token", out var cookieToken))
            return cookieToken;

        return null;
    }
}
