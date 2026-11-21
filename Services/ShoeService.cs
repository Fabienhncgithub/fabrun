using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Services;

public sealed class ShoeService(IShoeRepository repository)
{
    private static readonly HashSet<string> RunTypes = new(StringComparer.OrdinalIgnoreCase) { "Run", "TrailRun", "VirtualRun" };
    private readonly SemaphoreSlim _lock = new(1, 1);

    public static bool IsRun(Activity activity) => RunTypes.Contains(activity.sport_type);

    /// <summary>
    /// Sets gear_id on every activity. A run that has never been assigned gets the current default,
    /// and that choice is saved so changing the default later does not rewrite past runs.
    /// Archived activities keep their imported shoe unless an assignment overrides it.
    /// </summary>
    public async Task<List<Activity>> ApplyAsync(IReadOnlyList<Activity> activities, IReadOnlySet<long> archivedIds)
    {
        await _lock.WaitAsync();
        try
        {
            var registry = await repository.LoadAsync();
            var changed = false;
            var result = new List<Activity>(activities.Count);
            foreach (var activity in activities)
            {
                var key = activity.id.ToString();
                if (registry.Assignments.TryGetValue(key, out var assigned))
                {
                    result.Add(activity with { gear_id = assigned });
                    continue;
                }
                if (!archivedIds.Contains(activity.id) && IsRun(activity))
                {
                    registry.Assignments[key] = registry.DefaultShoeId;
                    changed = true;
                    result.Add(activity with { gear_id = registry.DefaultShoeId });
                    continue;
                }
                result.Add(archivedIds.Contains(activity.id) ? activity : activity with { gear_id = null });
            }
            if (changed) await repository.SaveAsync(registry);
            return result;
        }
        finally { _lock.Release(); }
    }

    /// <summary>Shoes with lifetime distance: hand-entered starting mileage plus every assigned run.</summary>
    public async Task<List<ProfileShoe>> ProfileShoesAsync(IEnumerable<Activity> activitiesWithGear)
    {
        var registry = await repository.LoadAsync();
        var meters = activitiesWithGear
            .Where(a => IsRun(a) && !string.IsNullOrEmpty(a.gear_id))
            .GroupBy(a => a.gear_id!)
            .ToDictionary(g => g.Key, g => g.Sum(a => Math.Max(0, a.distance)));
        return registry.Shoes.Select(shoe =>
        {
            var distance = shoe.InitialKm * 1000 + meters.GetValueOrDefault(shoe.Id);
            return new ProfileShoe(shoe.Id, shoe.Name, distance, Math.Round(distance / 1000, 1),
                shoe.Brand, shoe.Retired, shoe.Id == registry.DefaultShoeId);
        }).ToList();
    }

    public Task<ShoeEntry> AddAsync(string name, string? brand, double initialKm, bool makeDefault)
        => MutateAsync(registry =>
        {
            var shoe = new ShoeEntry($"s{Guid.NewGuid():N}", name.Trim(), brand, null, Math.Round(initialKm, 1), false);
            registry.Shoes.Add(shoe);
            return (makeDefault ? registry with { DefaultShoeId = shoe.Id } : registry, shoe);
        });

    /// <summary>Null clears the default: new runs then stay without a shoe.</summary>
    public Task<bool> SetDefaultAsync(string? shoeId)
        => MutateAsync(registry =>
        {
            if (shoeId is not null && registry.Shoes.All(s => s.Id != shoeId || s.Retired)) return (registry, false);
            return (registry with { DefaultShoeId = shoeId }, true);
        });

    public Task<bool> SetRetiredAsync(string shoeId, bool retired)
        => MutateAsync(registry =>
        {
            var index = registry.Shoes.FindIndex(s => s.Id == shoeId);
            if (index < 0) return (registry, false);
            registry.Shoes[index] = registry.Shoes[index] with { Retired = retired };
            return (retired && registry.DefaultShoeId == shoeId ? registry with { DefaultShoeId = null } : registry, true);
        });

    /// <summary>Null means "no shoe" for that activity. The caller checks the activity exists.</summary>
    public Task<bool> AssignAsync(long activityId, string? shoeId)
        => MutateAsync(registry =>
        {
            if (shoeId is not null && registry.Shoes.All(s => s.Id != shoeId)) return (registry, false);
            registry.Assignments[activityId.ToString()] = shoeId;
            return (registry, true);
        });

    public async Task<bool> ExistsAsync(string shoeId)
        => (await repository.LoadAsync()).Shoes.Any(s => s.Id == shoeId);

    private async Task<T> MutateAsync<T>(Func<ShoeRegistry, (ShoeRegistry Registry, T Result)> change)
    {
        await _lock.WaitAsync();
        try
        {
            var registry = await repository.LoadAsync();
            var (updated, result) = change(registry);
            await repository.SaveAsync(updated);
            return result;
        }
        finally { _lock.Release(); }
    }
}
