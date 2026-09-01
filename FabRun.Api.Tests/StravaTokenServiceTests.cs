using System.Text.Json;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Models;
using FabRun.Api.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace FabRun.Api.Tests;

public sealed class StravaTokenServiceTests
{
    [Fact]
    public void BundleFromTokenResponse_ParsesAccessRefreshAndExpiry()
    {
        using var doc = JsonDocument.Parse(
            """{"access_token":"acc-1","refresh_token":"ref-1","expires_at":1999999999}""");

        var bundle = StravaTokenService.BundleFromTokenResponse(doc);

        Assert.NotNull(bundle);
        Assert.Equal("acc-1", bundle!.AccessToken);
        Assert.Equal("ref-1", bundle.RefreshToken);
        Assert.Equal(1999999999, bundle.ExpiresAtUnix);
    }

    [Theory]
    [InlineData("""{"refresh_token":"ref-1","expires_at":1999999999}""")]
    [InlineData("""{"access_token":"acc-1","expires_at":1999999999}""")]
    [InlineData("""{"access_token":"","refresh_token":"ref-1","expires_at":1999999999}""")]
    public void BundleFromTokenResponse_ReturnsNull_WhenTokenMissingOrEmpty(string json)
    {
        using var doc = JsonDocument.Parse(json);

        Assert.Null(StravaTokenService.BundleFromTokenResponse(doc));
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_ReturnsStoredToken_WithoutRefreshing_WhenFarFromExpiry()
    {
        var strava = new FakeStravaClient();
        var service = CreateService(strava, out var protector);
        var bundle = new StravaTokenBundle("acc-valid", "ref-valid", UnixSecondsFromNow(TimeSpan.FromHours(2)));
        var context = ContextWithStravaCookie(protector, bundle);

        var token = await service.ResolveAccessTokenAsync(context, CancellationToken.None);

        Assert.Equal("acc-valid", token);
        Assert.Equal(0, strava.RefreshCallCount);
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_RefreshesAndRotatesCookie_WhenExpiringSoon()
    {
        var strava = new FakeStravaClient
        {
            OnRefresh = refreshToken =>
            {
                Assert.Equal("ref-old", refreshToken);
                return JsonDocument.Parse(
                    """{"access_token":"acc-new","refresh_token":"ref-new","expires_at":9999999999}""");
            }
        };
        var service = CreateService(strava, out var protector);
        var bundle = new StravaTokenBundle("acc-old", "ref-old", UnixSecondsFromNow(TimeSpan.FromMinutes(1)));
        var context = ContextWithStravaCookie(protector, bundle);

        var token = await service.ResolveAccessTokenAsync(context, CancellationToken.None);

        Assert.Equal("acc-new", token);
        Assert.Equal(1, strava.RefreshCallCount);
        var setCookie = context.Response.Headers["Set-Cookie"].ToString();
        Assert.Contains(SecurityCookies.StravaAccessToken, setCookie, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_DoesNotRefreshTwice_WhenAnotherRequestAlreadyRefreshed()
    {
        var strava = new FakeStravaClient
        {
            OnRefresh = _ => JsonDocument.Parse(
                """{"access_token":"acc-new","refresh_token":"ref-new","expires_at":9999999999}""")
        };
        var service = CreateService(strava, out var protector);
        var bundle = new StravaTokenBundle("acc-old", "ref-old", UnixSecondsFromNow(TimeSpan.FromMinutes(1)));

        // Two "requests" carrying the same stale cookie, as if they had both
        // arrived at the server before either got a chance to see a rotated
        // Set-Cookie from the other.
        var firstRequest = ContextWithStravaCookie(protector, bundle);
        var secondRequest = ContextWithStravaCookie(protector, bundle);

        var firstToken = await service.ResolveAccessTokenAsync(firstRequest, CancellationToken.None);
        var secondToken = await service.ResolveAccessTokenAsync(secondRequest, CancellationToken.None);

        Assert.Equal("acc-new", firstToken);
        Assert.Equal("acc-new", secondToken);
        Assert.Equal(1, strava.RefreshCallCount);
        Assert.Contains(
            SecurityCookies.StravaAccessToken,
            secondRequest.Response.Headers.SetCookie.ToString(),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_ClearsCookieAndReturnsNull_WhenRefreshTokenIsRejected()
    {
        var strava = new FakeStravaClient
        {
            OnRefresh = _ => throw new HttpRequestException("invalid_grant", null, System.Net.HttpStatusCode.BadRequest)
        };
        var service = CreateService(strava, out var protector);
        var bundle = new StravaTokenBundle("acc-old", "ref-revoked", UnixSecondsFromNow(TimeSpan.FromMinutes(1)));
        var context = ContextWithStravaCookie(protector, bundle);

        var token = await service.ResolveAccessTokenAsync(context, CancellationToken.None);

        Assert.Null(token);
        var setCookie = context.Response.Headers["Set-Cookie"].ToString();
        Assert.Contains(SecurityCookies.StravaAccessToken, setCookie, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_ReturnsNull_WhenNoCookiePresent()
    {
        var service = CreateService(new FakeStravaClient(), out _);
        var context = new DefaultHttpContext();

        var token = await service.ResolveAccessTokenAsync(context, CancellationToken.None);

        Assert.Null(token);
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_DoesNotShareInMemoryToken_WithRequestWithoutCookie()
    {
        var service = CreateService(new FakeStravaClient(), out var protector);
        var connectedContext = ContextWithStravaCookie(
            protector,
            new StravaTokenBundle("acc-valid", "ref-valid", UnixSecondsFromNow(TimeSpan.FromHours(2))));
        await service.ResolveAccessTokenAsync(connectedContext, CancellationToken.None);

        var contextWithoutCookie = new DefaultHttpContext();
        var token = await service.ResolveAccessTokenAsync(contextWithoutCookie, CancellationToken.None);

        Assert.Null(token);
    }

    [Fact]
    public async Task ResolveAccessTokenAsync_PreservesCookie_WhenRefreshFailsTemporarily()
    {
        var strava = new FakeStravaClient
        {
            OnRefresh = _ => throw new HttpRequestException(
                "temporary outage",
                null,
                System.Net.HttpStatusCode.ServiceUnavailable)
        };
        var service = CreateService(strava, out var protector);
        var context = ContextWithStravaCookie(
            protector,
            new StravaTokenBundle("acc-old", "ref-valid", UnixSecondsFromNow(TimeSpan.FromMinutes(1))));

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            service.ResolveAccessTokenAsync(context, CancellationToken.None));

        Assert.DoesNotContain(
            SecurityCookies.StravaAccessToken,
            context.Response.Headers.SetCookie.ToString(),
            StringComparison.Ordinal);
    }

    private static StravaTokenService CreateService(IStravaClient strava, out StravaTokenProtector protector)
    {
        protector = new StravaTokenProtector(new EphemeralDataProtectionProvider());
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["STRAVA_CLIENT_ID"] = "test-client-id",
                ["STRAVA_CLIENT_SECRET"] = "test-client-secret"
            })
            .Build();
        return new StravaTokenService(strava, protector, configuration, NullLogger<StravaTokenService>.Instance);
    }

    private static DefaultHttpContext ContextWithStravaCookie(StravaTokenProtector protector, StravaTokenBundle bundle)
    {
        var protectedValue = protector.Protect(JsonSerializer.Serialize(bundle));
        var context = new DefaultHttpContext();
        context.Request.Headers.Cookie = $"{SecurityCookies.StravaAccessToken}={protectedValue}";
        return context;
    }

    private static long UnixSecondsFromNow(TimeSpan offset) =>
        DateTimeOffset.UtcNow.Add(offset).ToUnixTimeSeconds();

    private sealed class FakeStravaClient : IStravaClient
    {
        public Func<string, JsonDocument>? OnRefresh { get; init; }
        public int RefreshCallCount { get; private set; }

        public Task<JsonDocument> RefreshTokenAsync(
            string clientId, string clientSecret, string refreshToken, CancellationToken cancellationToken = default)
        {
            RefreshCallCount++;
            if (OnRefresh is null) throw new InvalidOperationException("Refresh was not expected in this test.");
            return Task.FromResult(OnRefresh(refreshToken));
        }

        public string AuthorizeUrl(string clientId, string redirectUri, string scopeCsv = "read,activity:read_all,profile:read_all", string? state = null)
            => throw new NotImplementedException();

        public Task<JsonDocument> ExchangeCodeAsync(string clientId, string clientSecret, string code, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();

        public Task DeauthorizeAsync(string accessToken, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();

        public Task<AthleteProfile> FetchAthleteProfileAsync(
            string accessToken,
            CancellationToken cancellationToken = default,
            bool forceRefresh = false)
            => throw new NotImplementedException();

        public Task<List<Activity>> FetchActivitiesAsync(
            string accessToken,
            int? daysBack = 365,
            CancellationToken cancellationToken = default,
            bool forceRefresh = false)
            => throw new NotImplementedException();

        public Task<StravaStreams?> FetchActivityStreamsAsync(string accessToken, long activityId, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();

        public Task<StravaActivityDetail?> FetchActivityDetailAsync(string accessToken, long activityId, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();

        public Task<Kpis> BuildKpisAsync(string accessToken, int? daysBack = null, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();

        public Task<IEnumerable<BestEffort>> GetTopBest5kAsync(string token, int days, int limit, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();

        public Task<IEnumerable<BestEffort>> GetTopBestXAsync(string token, double distMeters, string label, int days, int limit, CancellationToken cancellationToken = default)
            => throw new NotImplementedException();
    }
}
