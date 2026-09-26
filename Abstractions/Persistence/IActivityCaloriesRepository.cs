namespace FabRun.Api.Abstractions.Persistence;

public interface IActivityCaloriesRepository
{
    Task<IReadOnlyDictionary<long, double>> LoadAllAsync();
    Task SaveManyAsync(IReadOnlyDictionary<long, double> caloriesByActivityId);
}
