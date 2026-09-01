using System.Text.Json;
using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.External;

public interface IStravaClient
{
    string AuthorizeUrl(string clientId, string redirectUri, string scopeCsv = "read,activity:read_all,profile:read_all", string? state = null);
    Task<JsonDocument> ExchangeCodeAsync(
        string clientId,
        string clientSecret,
        string code,
        CancellationToken cancellationToken = default);
    Task<JsonDocument> RefreshTokenAsync(
        string clientId,
        string clientSecret,
        string refreshToken,
        CancellationToken cancellationToken = default);
    Task DeauthorizeAsync(string accessToken, CancellationToken cancellationToken = default);
    Task<AthleteProfile> FetchAthleteProfileAsync(
        string accessToken,
        CancellationToken cancellationToken = default,
        bool forceRefresh = false);
    Task<List<Activity>> FetchActivitiesAsync(
        string accessToken,
        int? daysBack = 365,
        CancellationToken cancellationToken = default,
        bool forceRefresh = false);
    Task<StravaStreams?> FetchActivityStreamsAsync(
        string accessToken,
        long activityId,
        CancellationToken cancellationToken = default);
    Task<StravaActivityDetail?> FetchActivityDetailAsync(
        string accessToken,
        long activityId,
        CancellationToken cancellationToken = default);
    Task<Kpis> BuildKpisAsync(
        string accessToken,
        int? daysBack = null,
        CancellationToken cancellationToken = default);
    Task<IEnumerable<BestEffort>> GetTopBest5kAsync(
        string token,
        int days,
        int limit,
        CancellationToken cancellationToken = default);
    Task<IEnumerable<BestEffort>> GetTopBestXAsync(
        string token,
        double distMeters,
        string label,
        int days,
        int limit,
        CancellationToken cancellationToken = default);
}
