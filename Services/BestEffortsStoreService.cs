using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Services;

public class BestEffortsStoreService
{
    private readonly IBestEffortsRepository _repository;

    public BestEffortsStoreService(IBestEffortsRepository repository)
    {
        _repository = repository;
    }

    public async Task<BestEffortSnapshot?> LoadAsync(long athleteId)
    {
        return await _repository.LoadAsync(athleteId);
    }

    public async Task SaveAsync(long athleteId, BestEffortSnapshot snapshot)
    {
        await _repository.SaveAsync(athleteId, snapshot);
    }
}
