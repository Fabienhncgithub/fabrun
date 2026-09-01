using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Services;

public class AthleteSettingsService
{
    private readonly IAthleteSettingsRepository _repository;

    public AthleteSettingsService(IAthleteSettingsRepository repository)
    {
        _repository = repository;
    }

    public async Task<AthleteSettings> LoadAsync(long athleteId)
    {
        var settings = await _repository.LoadAsync(athleteId)
            ?? new AthleteSettings(false, new List<GoalRace>());
        return Normalize(settings);
    }

    public async Task SaveAsync(long athleteId, AthleteSettings settings)
    {
        await _repository.SaveAsync(athleteId, Normalize(settings));
    }

    private static AthleteSettings Normalize(AthleteSettings settings) => settings with
    {
        GoalRaces = settings.GoalRaces ?? new List<GoalRace>(),
        ShoePreferences = settings.ShoePreferences ?? new List<ShoePreference>()
    };
}
