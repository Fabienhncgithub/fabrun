using System.ComponentModel.DataAnnotations;
using FabRun.Api.Models;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/settings")]
public class AthleteSettingsController : ControllerBase
{
    // Mirrors the frontend's BrandKey union (ShoeUsageCard.tsx) - kept in
    // sync by hand since it's a small, rarely-changing list of shoe brands.
    internal static readonly HashSet<string> KnownBrands = new(StringComparer.Ordinal)
    {
        "nike", "adidas", "hoka", "asics", "new_balance", "on",
        "saucony", "brooks", "salomon", "puma", "mizuno", "altra", "other",
    };

    private static readonly HashSet<string> KnownSexes = new(StringComparer.Ordinal) { "male", "female" };

    private readonly ActivityService _activities;
    private readonly AthleteSettingsService _settings;
    private readonly ShoeService _shoes;

    public AthleteSettingsController(
        ActivityService activities,
        AthleteSettingsService settings,
        ShoeService shoes)
    {
        _activities = activities;
        _settings = settings;
        _shoes = shoes;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var settings = await _settings.LoadAsync(await _activities.OwnerIdAsync());
        return Ok(settings);
    }

    [HttpPut]
    public async Task<IActionResult> Update(
        [FromBody] UpdateAthleteSettingsRequest request,
        CancellationToken cancellationToken)
    {
        // The client always resends the full desired list (add/edit/delete
        // are all expressed by the array it sends). An existing goal keeps
        // the id it was loaded with; a brand new one omits it and gets a
        // fresh one here, so the frontend never has to invent identifiers.
        var goalRaces = (request.GoalRaces ?? new List<GoalRaceRequest>())
            .Select(g => new GoalRace(
                string.IsNullOrWhiteSpace(g.Id) ? Guid.NewGuid().ToString("N") : g.Id.Trim(),
                g.Label.Trim(),
                g.DistanceKm,
                g.TargetDate))
            .ToList();
        if (goalRaces.Select(goal => goal.Id).Distinct(StringComparer.Ordinal).Count() != goalRaces.Count)
            return BadRequest(new { error = "Deux objectifs ne peuvent pas partager le même identifiant." });

        var requested = request.ShoePreferences ?? new List<ShoePreferenceRequest>();
        var knownShoeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var id in requested.Select(p => p.GearId).Distinct(StringComparer.Ordinal))
            if (await _shoes.ExistsAsync(id)) knownShoeIds.Add(id);
        var shoePreferences = requested
            .Where(preference => knownShoeIds.Contains(preference.GearId))
            .DistinctBy(preference => preference.GearId, StringComparer.Ordinal)
            .Select(preference => new ShoePreference(
                preference.GearId,
                Math.Round(preference.RetirementKm, 0),
                NormalizeBrand(preference.Brand)))
            .ToList();

        if (request.Sex != null && !KnownSexes.Contains(request.Sex))
            return BadRequest(new { error = "Sexe non reconnu." });

        var settings = new AthleteSettings(
            request.HasShinPain,
            goalRaces,
            shoePreferences,
            request.AgeYears,
            request.Sex);

        await _settings.SaveAsync(await _activities.OwnerIdAsync(), settings);
        return Ok(settings);
    }

    private static string? NormalizeBrand(string? brand)
    {
        if (string.IsNullOrWhiteSpace(brand)) return null;
        return KnownBrands.Contains(brand) ? brand : null;
    }
}

// MVC validates positional records through their constructor parameters.
// Property-targeted validation attributes make the entire PUT request fail.
public sealed record GoalRaceRequest(
    [StringLength(64)] string? Id,
    [Required, StringLength(80, MinimumLength = 1)] string Label,
    [Range(0.1, 500)] double DistanceKm,
    DateOnly TargetDate);

public sealed record UpdateAthleteSettingsRequest(
    bool HasShinPain,
    [MaxLength(8)] List<GoalRaceRequest> GoalRaces,
    [MaxLength(32)] List<ShoePreferenceRequest>? ShoePreferences,
    [Range(10, 100)] int? AgeYears,
    [StringLength(16)] string? Sex);

public sealed record ShoePreferenceRequest(
    [Required, StringLength(128, MinimumLength = 1)] string GearId,
    [Range(300, 1500)] double RetirementKm,
    [StringLength(32)] string? Brand);
