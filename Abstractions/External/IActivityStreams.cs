using FabRun.Api.Services;

namespace FabRun.Api.Abstractions.External;

public interface IActivityStreams
{
    /// <summary>Distance/time samples for one activity, or null when unavailable.</summary>
    Task<DistanceStream?> DistanceStreamAsync(long activityId, CancellationToken ct);
}
