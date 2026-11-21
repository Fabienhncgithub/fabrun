using FabRun.Api.Models;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api")]
public class ActivitiesController(ActivityService activities, HealthSleepService sleep) : ControllerBase
{
    // Garmin upstream failures are mapped to JSON errors by the middleware in Program.cs.

    [HttpGet("activities")]
    public async Task<IActionResult> GetActivities(CancellationToken cancellationToken)
    {
        var all = await activities.AllAsync(false, cancellationToken);
        var cutoff = DateTime.Today.AddDays(-365);
        return Ok(all.Where(a => StartsOnOrAfter(a, cutoff)).ToList());
    }

    [HttpGet("kpis")]
    public async Task<IActionResult> GetKpis(CancellationToken cancellationToken)
        => Ok(ActivityAnalytics.ComputeKpis(await activities.AllAsync(false, cancellationToken)));

    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile(CancellationToken cancellationToken)
        => Ok(await activities.ProfileAsync(await activities.AllAsync(false, cancellationToken)));

    [HttpGet("dashboard")]
    [EnableRateLimiting("activities-heavy")]
    public async Task<IActionResult> GetDashboard(
        [FromQuery] bool refresh = false,
        CancellationToken cancellationToken = default)
    {
        // Whole history so "since the first activity" totals are right.
        var all = await activities.AllAsync(refresh, cancellationToken);
        var currentYear = DateTime.Now.Year;
        List<Activity> InYears(int from, int to) => all
            .Where(a => DateTime.TryParse(a.start_date_local, out var d) && d.Year >= from && d.Year <= to)
            .ToList();

        var profile = await activities.ProfileAsync(all);
        return Ok(new
        {
            // The table stays bounded to the last 12 months to remain readable.
            activities = all.Where(a => StartsOnOrAfter(a, DateTime.Today.AddDays(-365))).ToList(),
            heatmapActivities = InYears(currentYear - 1, currentYear),
            kpis = ActivityAnalytics.ComputeKpis(all, "all_time"),
            kpisCurrentYear = ActivityAnalytics.ComputeKpis(InYears(currentYear, currentYear), "current_year"),
            kpisPreviousYear = ActivityAnalytics.ComputeKpis(InYears(currentYear - 1, currentYear - 1), "previous_year"),
            kpisTwoYearsAgo = ActivityAnalytics.ComputeKpis(InYears(currentYear - 2, currentYear - 2), "two_years_ago"),
            profile,
            sleep = await sleep.GetSummaryAsync(profile.id)
        });
    }

    private static bool StartsOnOrAfter(Activity activity, DateTime cutoff)
        => DateTime.TryParse(activity.start_date_local, out var parsed) && parsed >= cutoff;
}
