using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.Persistence;

public interface IBestEffortsRepository
{
    Task<BestEffortSnapshot?> LoadAsync(long athleteId);
    Task SaveAsync(long athleteId, BestEffortSnapshot snapshot);
}
