namespace FabRun.Api.Models;

public record GoalRace(string Id, string Label, double DistanceKm, DateOnly TargetDate);

/// <summary>
/// Brand is an explicit, athlete-editable override of what the frontend's
/// name-substring heuristic (detectBrand in ShoeUsageCard.tsx) guesses -
/// that heuristic stays as the default suggestion, this field is what wins
/// once the athlete has actually picked one. Null/empty means "still using
/// the heuristic".
/// </summary>
public record ShoePreference(string GearId, double RetirementKm, string? Brand = null);

/// <summary>
/// Small per-athlete preferences that used to live only in the browser's
/// localStorage (hasShinPain) - moved server-side so they follow the athlete
/// across devices instead of resetting on a new browser/phone.
/// </summary>
public record AthleteSettings(
    bool HasShinPain,
    List<GoalRace> GoalRaces,
    List<ShoePreference>? ShoePreferences = null,
    // Optional, used only to prioritize a heart-rate-based (Keytel) calorie
    // estimate over the generic MET fallback in activityEnergy.ts - never
    // shown or used anywhere else.
    int? AgeYears = null,
    string? Sex = null);
