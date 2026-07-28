using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.Persistence;

public interface ISleepRepository
{
    Task<List<SleepSession>> LoadAsync(long athleteId);
    Task SaveAsync(long athleteId, List<SleepSession> sessions);
}
