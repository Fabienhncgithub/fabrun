using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.Persistence;

public interface IAthleteSettingsRepository
{
    Task<AthleteSettings?> LoadAsync(long athleteId);
    Task SaveAsync(long athleteId, AthleteSettings settings);
}
