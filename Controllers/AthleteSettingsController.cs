using System.ComponentModel.DataAnnotations;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Models;
using FabRun.Api.Security;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/settings")]
public class AthleteSettingsController : ControllerBase
{
    // Mirrors the frontend's BrandKey union (ShoeUsageCard.tsx) - kept in
    // sync by hand since it's a small, rarely-changing list of shoe brands.
    private static readonly HashSet<string> KnownBrands = new(StringComparer.Ordinal)
    {
        "nike", "adidas", "hoka", "asics", "new_balance", "on",
        "saucony", "brooks", "salomon", "puma", "mizuno", "altra", "other",
    };

    private static readonly HashSet<string> KnownSexes = new(StringComparer.Ordinal) { "male", "female" };

    private readonly IStravaClient _strava;
    private readonly AthleteSettingsService _settings;
    private readonly StravaTokenService _tokenService;

    public AthleteSettingsController(
        IStravaClient strava,
        AthleteSettingsService settings,
        StravaTokenService tokenService)
    {
        _strava = strava;
        _settings = settings;
        _tokenService = tokenService;
    }

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(token))
            return Unauthorized(new { error = "Token manquant (reconnecte-toi)." });

        var profile = await _strava.FetchAthleteProfileAsync(token, cancellationToken);
        var settings = await _settings.LoadAsync(profile.id);
        return Ok(settings);
    }

    [HttpPut]
    public async Task<IActionResult> Update(
        [FromBody] UpdateAthleteSettingsRequest request,
        CancellationToken cancellationToken)
    {
        var token = await GetAccessTokenAsync(cancellationToken);
        if (string.IsNullOrWhiteSpace(token))
            return Unauthorized(new { error = "Token manquant (reconnecte-toi)." });

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

        var profile = await _strava.FetchAthleteProfileAsync(token, cancellationToken);
        var knownShoeIds = (profile.shoes ?? new List<ProfileShoe>())
            .Select(shoe => shoe.id)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .ToHashSet(StringComparer.Ordinal);
        var shoePreferences = (request.ShoePreferences ?? new List<ShoePreferenceRequest>())
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

        await _settings.SaveAsync(profile.id, settings);
        return Ok(settings);
    }

    private static string? NormalizeBrand(string? brand)
    {
        if (string.IsNullOrWhiteSpace(brand)) return null;
        return KnownBrands.Contains(brand) ? brand : null;
    }

    private Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken)
        => _tokenService.ResolveAccessTokenAsync(HttpContext, cancellationToken);
}

public sealed record GoalRaceRequest(
    [property: StringLength(64)] string? Id,
    [property: Required, StringLength(80, MinimumLength = 1)] string Label,
    [property: Range(0.1, 500)] double DistanceKm,
    DateOnly TargetDate);

public sealed record UpdateAthleteSettingsRequest(
    bool HasShinPain,
    [property: MaxLength(8)] List<GoalRaceRequest> GoalRaces,
    [property: MaxLength(32)] List<ShoePreferenceRequest>? ShoePreferences,
    [property: Range(10, 100)] int? AgeYears,
    [property: StringLength(16)] string? Sex);

public sealed record ShoePreferenceRequest(
    [property: Required, StringLength(128, MinimumLength = 1)] string GearId,
    [property: Range(300, 1500)] double RetirementKm,
    [property: StringLength(32)] string? Brand);
