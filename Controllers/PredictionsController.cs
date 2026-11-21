using FabRun.Api.Models;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/predictions")]
public class PredictionsController : ControllerBase
{
    private readonly ActivityService _activities;
    private readonly BestEffortsService _bestEfforts;
    private readonly BestEffortsStoreService _store;

    public PredictionsController(
        ActivityService activities,
        BestEffortsService bestEfforts,
        BestEffortsStoreService store)
    {
        _activities = activities;
        _bestEfforts = bestEfforts;
        _store = store;
    }

    [HttpGet("running")]
    [EnableRateLimiting("activities-analysis")]
    public async Task<IActionResult> GetRunning(
        [FromQuery] bool refresh = false,
        CancellationToken cancellationToken = default)
    {
        var ownerId = await _activities.OwnerIdAsync();
        var snapshot = await _store.LoadAsync(ownerId);
        var now = DateTimeOffset.UtcNow;

        if (!refresh && snapshot != null && (now - snapshot.calculatedAtUtc).TotalHours < 6)
        {
            return Ok(BuildResponse(snapshot.efforts));
        }

        var activities = await _activities.AllAsync(refresh, cancellationToken);
        var efforts = await _bestEfforts.ComputeBestEffortsAsync(
            activities,
            daysBack: 365,
            cancellationToken: cancellationToken);
        var newSnapshot = new BestEffortSnapshot(now, efforts);
        await _store.SaveAsync(ownerId, newSnapshot);

        return Ok(BuildResponse(efforts));
    }

    private static PredictionResponse BuildResponse(List<BestEffortComputed> efforts)
    {
        if (efforts == null || efforts.Count == 0)
        {
            return new PredictionResponse(
                new PredictionReference(0, 0, DateTime.MinValue, 0, "-", "none"),
                1.06,
                new Dictionary<string, int>(),
                new PredictionConfidence(0, "low", new List<string> { "Aucun effort trouvé." }),
                new List<BestEffortComputed>()
            );
        }

        var now = DateTime.UtcNow;
        var cutoff180 = now.AddDays(-180);
        var cutoff42 = now.AddDays(-42);

        BestEffortComputed? pick = PickReference(efforts, cutoff180);
        if (pick == null)
        {
            pick = efforts.OrderByDescending(e => e.dateLocal).First();
        }

        var exponent = 1.06;
        var reasons = new List<string>();
        var hasCalibration = TryCalibrate(efforts, cutoff180, out var calibrated);
        if (hasCalibration)
        {
            exponent = calibrated;
            reasons.Add("Exponent calibré avec 5K + 10K récents.");
        }

        var predictions = BuildPredictions(pick, exponent);
        var confidence = PredictionMath.BuildConfidence(pick, now, hasCalibration, reasons);

        var reference = new PredictionReference(
            pick.distanceKm,
            pick.timeSec,
            pick.dateLocal,
            pick.activityId,
            pick.activityName,
            pick.method
        );

        return new PredictionResponse(
            reference,
            exponent,
            predictions,
            confidence,
            efforts.OrderBy(effort => effort.distanceKm).ToList());
    }

    private static BestEffortComputed? PickReference(List<BestEffortComputed> efforts, DateTime cutoff180)
    {
        BestEffortComputed? BestFor(double km) =>
            efforts.Where(e => Math.Abs(e.distanceKm - km) < 0.02 && e.dateLocal >= cutoff180)
                .OrderBy(e => e.timeSec)
                .FirstOrDefault();

        return BestFor(10.0) ?? BestFor(5.0) ?? BestFor(21.097) ?? BestFor(1.0);
    }

    private static bool TryCalibrate(List<BestEffortComputed> efforts, DateTime cutoff180, out double exponent)
    {
        var e5 = efforts.Where(e => Math.Abs(e.distanceKm - 5.0) < 0.02 && e.dateLocal >= cutoff180)
            .OrderBy(e => e.timeSec)
            .FirstOrDefault();
        var e10 = efforts.Where(e => Math.Abs(e.distanceKm - 10.0) < 0.02 && e.dateLocal >= cutoff180)
            .OrderBy(e => e.timeSec)
            .FirstOrDefault();

        return PredictionMath.TryCalibrateExponent(e5, e10, out exponent);
    }

    private static Dictionary<string, int> BuildPredictions(BestEffortComputed reference, double exponent)
    {
        var targets = new Dictionary<string, double>
        {
            ["5k"] = 5.0,
            ["10k"] = 10.0,
            ["half"] = 21.097,
            ["marathon"] = 42.195
        };

        var result = new Dictionary<string, int>();
        foreach (var (label, km) in targets)
        {
            if (Math.Abs(reference.distanceKm - km) < 0.02)
            {
                result[label] = reference.timeSec;
                continue;
            }

            var predicted = (int)Math.Round(reference.timeSec * Math.Pow(km / reference.distanceKm, exponent));
            result[label] = Math.Max(predicted, 1);
        }

        return result;
    }

    }
