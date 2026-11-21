using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Services;

/// <summary>
/// Every activity FabRun knows: Garmin for everything since the watch, plus the imported
/// archive for older sessions. Archived sessions are only kept before the first Garmin one,
/// so the same outing is never counted twice.
/// </summary>
public sealed class ActivityService(GarminService garmin, IActivityArchive archive, ShoeService shoes)
{
    public async Task<long> OwnerIdAsync() => (await archive.LoadAsync())?.AthleteId ?? 0;

    public async Task<List<Activity>> AllAsync(bool refresh, CancellationToken ct)
    {
        // Without a Garmin key the archive still shows; the recovery page explains how to add the key.
        var recent = garmin.Configured ? await garmin.AllActivitiesAsync(refresh, ct) : new List<Activity>();
        var imported = (await archive.LoadAsync())?.Activities ?? new List<Activity>();
        var merged = Merge(recent, imported);
        var garminIds = recent.Select(a => a.id).ToHashSet();
        var archivedIds = merged.Select(a => a.id).Where(id => !garminIds.Contains(id)).ToHashSet();
        return await shoes.ApplyAsync(merged, archivedIds);
    }

    internal static List<Activity> Merge(IReadOnlyList<Activity> garmin, IReadOnlyList<Activity> archive)
    {
        var firstGarmin = garmin.Select(a => a.start_date_local).DefaultIfEmpty(null).Min(StringComparer.Ordinal);
        var garminIds = garmin.Select(a => a.id).ToHashSet();
        var older = archive.Where(a => !garminIds.Contains(a.id)
            && (firstGarmin is null || string.CompareOrdinal(a.start_date_local, firstGarmin) < 0));
        return garmin.Concat(older)
            .OrderByDescending(a => a.start_date_local, StringComparer.Ordinal)
            .ToList();
    }

    public async Task<AthleteProfile> ProfileAsync(IEnumerable<Activity> activities)
        => new(await OwnerIdAsync(), await shoes.ProfileShoesAsync(activities));

    public static string GarminUrl(long activityId) => $"https://connect.garmin.com/modern/activity/{activityId}";
}
