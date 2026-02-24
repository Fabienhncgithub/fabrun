using System.Text.Json;
using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.External;

public interface IStravaClient
{
    string AuthorizeUrl(string clientId, string redirectUri, string scopeCsv = "read,activity:read_all,profile:read_all", string? state = null);
    Task<JsonDocument> ExchangeCodeAsync(string clientId, string clientSecret, string code);
    Task<AthleteProfile> FetchAthleteProfileAsync(string accessToken);
    Task<List<Activity>> FetchActivitiesAsync(string accessToken, int? daysBack = 365);
    Task<StravaStreams?> FetchActivityStreamsAsync(string accessToken, long activityId);
    Task<StravaActivityDetail?> FetchActivityDetailAsync(string accessToken, long activityId);
    Task<Kpis> BuildKpisAsync(string accessToken, int? daysBack = null);
    Task<IEnumerable<BestEffort>> GetTopBest5kAsync(string token, int days, int limit);
    Task<IEnumerable<BestEffort>> GetTopBestXAsync(string token, double distMeters, string label, int days, int limit);
}
