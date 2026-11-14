using System.Net;
using System.Text.Json;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/garmin")]
public class GarminController(GarminService garmin, ILogger<GarminController> logger) : ControllerBase
{
    [HttpGet("status")]
    public IActionResult Status() => Ok(new { configured = garmin.Configured, recovery = garmin.Snapshot });

    [HttpPost("sync")]
    [EnableRateLimiting("strava-heavy")]
    public Task<IActionResult> Sync(CancellationToken ct) => Execute(null, ct);

    [HttpPost("history")]
    [EnableRateLimiting("garmin-history")]
    public Task<IActionResult> History([FromQuery] string period, CancellationToken ct)
    {
        if (!new[] { "1d", "7d", "1m", "4m", "1y", "2y" }.Contains(period))
            return Task.FromResult<IActionResult>(BadRequest(new { error = "Période Garmin invalide." }));
        return Execute(period, ct);
    }

    [HttpPost("activities")]
    [EnableRateLimiting("garmin-history")]
    public Task<IActionResult> Activities(CancellationToken ct) => Execute("activities", ct);

    private async Task<IActionResult> Execute(string? period, CancellationToken ct)
    {
        if (!garmin.Configured)
            return BadRequest(new { error = "Configure la clé Garmin Personal API côté serveur pour activer la synchronisation." });
        try
        {
            if (period == "activities") return Ok(await garmin.ActivitiesAsync(ct));
            if (period is not null) return Ok(await garmin.HistoryAsync(period, ct));
            return Ok(await garmin.SyncAsync(ct));
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning("Garmin sync failed: status {Status}; cause {Cause}", ex.StatusCode, ex.InnerException?.GetType().Name);
            var message = ex.StatusCode switch
            {
                HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden => "Clé Garmin invalide, expirée ou accès refusé. Vérifie ta clé Personal API.",
                HttpStatusCode.TooManyRequests => "Quota Garmin atteint. Réessaie plus tard.",
                _ => "Garmin est momentanément indisponible. Réessaie plus tard."
            };
            return StatusCode(502, new { error = message });
        }
        catch (JsonException) { return StatusCode(502, new { error = "Réponse Garmin inattendue. La synchronisation n’a pas été enregistrée." }); }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        { return StatusCode(504, new { error = "Garmin met trop de temps à répondre. Réessaie plus tard." }); }
    }
}
