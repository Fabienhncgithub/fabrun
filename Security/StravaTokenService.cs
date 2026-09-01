using System.Text.Json;
using FabRun.Api.Abstractions.External;

namespace FabRun.Api.Security;

/// <summary>
/// The Strava access token plus the refresh token needed to renew it, and
/// the Unix timestamp (seconds) at which the access token stops working.
/// This whole bundle - not just the access token - is what gets encrypted
/// into the __Host-FabRun.Strava cookie.
/// </summary>
public sealed record StravaTokenBundle(string AccessToken, string RefreshToken, long ExpiresAtUnix);

/// <summary>
/// Resolves the Strava access token for the current request, transparently
/// refreshing it via the stored refresh token when it has expired or is
/// close to expiring - so a session stays connected indefinitely instead of
/// forcing the user back through Strava's consent screen every ~6 hours.
///
/// FabRun is single-user (one shared access password, one Strava account),
/// so a single in-process "last known good" slot plus one lock is enough:
/// it lets concurrent requests share the result of one refresh instead of
/// each reading the cookie they individually arrived with and racing to
/// redeem a refresh token Strava only allows to be used once (Strava
/// rotates the refresh token on every renewal).
/// </summary>
public sealed class StravaTokenService
{
    // Refresh a little before Strava's own expiry so in-flight requests have
    // margin, instead of reacting only after a call has already failed.
    private static readonly TimeSpan RefreshBuffer = TimeSpan.FromMinutes(5);

    // The bundle carries its own refresh token, so the cookie's lifetime is
    // a "remember me" ceiling rather than tied to the short-lived Strava
    // access token: as long as FabRun is opened at least once in this
    // window, the connection renews itself without a manual reconnect.
    private static readonly TimeSpan CookieLifetime = TimeSpan.FromDays(90);

    private readonly IStravaClient _strava;
    private readonly StravaTokenProtector _tokenProtector;
    private readonly IConfiguration _configuration;
    private readonly ILogger<StravaTokenService> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);

    private StravaTokenBundle? _lastKnownGood;

    public StravaTokenService(
        IStravaClient strava,
        StravaTokenProtector tokenProtector,
        IConfiguration configuration,
        ILogger<StravaTokenService> logger)
    {
        _strava = strava;
        _tokenProtector = tokenProtector;
        _configuration = configuration;
        _logger = logger;
    }

    /// <summary>
    /// Returns a Strava access token usable right now, refreshing it first
    /// if needed. Returns null if there is no stored connection, or if the
    /// stored refresh token is no longer valid (revoked, deauthorized) - in
    /// which case the stale cookie is deleted so the frontend's "connect to
    /// Strava" gate reappears instead of repeatedly failing.
    /// </summary>
    public async Task<string?> ResolveAccessTokenAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        await _lock.WaitAsync(cancellationToken);
        try
        {
            var cookieBundle = ReadFromCookie(httpContext.Request);
            if (cookieBundle is null)
            {
                return null;
            }

            // The in-memory copy only coordinates refresh-token rotation
            // between concurrent requests that already carry a valid FabRun
            // Strava cookie. It must never create a connection for a browser
            // that has no Strava cookie of its own.
            var bundle = _lastKnownGood ?? cookieBundle;
            var cookieNeedsSync = bundle != cookieBundle;

            if (!IsExpiringSoon(bundle))
            {
                _lastKnownGood = bundle;
                if (cookieNeedsSync)
                {
                    WriteCookie(httpContext, bundle);
                }
                return bundle.AccessToken;
            }

            var refreshed = await RefreshAsync(bundle.RefreshToken, cancellationToken);
            if (refreshed is null)
            {
                _lastKnownGood = null;
                httpContext.Response.Cookies.Delete(SecurityCookies.StravaAccessToken, RevokedCookieOptions());
                return null;
            }

            _lastKnownGood = refreshed;
            WriteCookie(httpContext, refreshed);
            return refreshed.AccessToken;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>Stores a freshly obtained bundle (OAuth callback) as the current connection.</summary>
    public void Store(HttpContext httpContext, StravaTokenBundle bundle)
    {
        _lastKnownGood = bundle;
        WriteCookie(httpContext, bundle);
    }

    /// <summary>Forgets the connection (logout) so a stale in-memory bundle can't resurrect it after a fresh login.</summary>
    public void Clear(HttpContext httpContext)
    {
        _lastKnownGood = null;
        httpContext.Response.Cookies.Delete(SecurityCookies.StravaAccessToken, RevokedCookieOptions());
    }

    private async Task<StravaTokenBundle?> RefreshAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var clientId = _configuration["STRAVA_CLIENT_ID"];
        var clientSecret = _configuration["STRAVA_CLIENT_SECRET"];
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            _logger.LogError("Cannot refresh the Strava token: STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET missing in config.");
            return null;
        }

        try
        {
            using var doc = await _strava.RefreshTokenAsync(clientId, clientSecret, refreshToken, cancellationToken);
            var refreshed = BundleFromTokenResponse(doc);
            if (refreshed is null)
            {
                _logger.LogWarning("Strava refresh token response did not contain a usable token bundle.");
            }
            return refreshed;
        }
        catch (HttpRequestException ex) when (
            ex.StatusCode is System.Net.HttpStatusCode.BadRequest
                or System.Net.HttpStatusCode.Unauthorized)
        {
            _logger.LogWarning(ex, "Strava rejected the refresh token; the user will need to reconnect.");
            return null;
        }
        catch (HttpRequestException ex)
        {
            // A timeout, quota response or Strava outage does not invalidate
            // the refresh token. Preserve the encrypted cookie and let the
            // regular upstream-error middleware return a retryable response.
            _logger.LogWarning(ex, "Strava token refresh failed temporarily; preserving the current connection.");
            throw;
        }
    }

    private static bool IsExpiringSoon(StravaTokenBundle bundle) =>
        DateTimeOffset.FromUnixTimeSeconds(bundle.ExpiresAtUnix) - DateTimeOffset.UtcNow <= RefreshBuffer;

    /// <summary>Builds a bundle from a Strava /oauth/token response (code exchange or refresh - same shape). Null if the response is missing a usable token.</summary>
    public static StravaTokenBundle? BundleFromTokenResponse(JsonDocument doc)
    {
        var root = doc.RootElement;
        var access = root.TryGetProperty("access_token", out var accessEl) ? accessEl.GetString() : null;
        var refresh = root.TryGetProperty("refresh_token", out var refreshEl) ? refreshEl.GetString() : null;
        var expiresAtUnix = root.TryGetProperty("expires_at", out var expiresEl) && expiresEl.TryGetInt64(out var unix)
            ? unix
            : DateTimeOffset.UtcNow.AddHours(6).ToUnixTimeSeconds();

        const int maximumTokenLength = 2048;
        if (string.IsNullOrWhiteSpace(access) || access.Length > maximumTokenLength
            || string.IsNullOrWhiteSpace(refresh) || refresh.Length > maximumTokenLength)
        {
            return null;
        }

        return new StravaTokenBundle(access, refresh, expiresAtUnix);
    }

    private string Protect(StravaTokenBundle bundle) =>
        _tokenProtector.Protect(JsonSerializer.Serialize(bundle));

    private void WriteCookie(HttpContext httpContext, StravaTokenBundle bundle) =>
        httpContext.Response.Cookies.Append(
            SecurityCookies.StravaAccessToken,
            Protect(bundle),
            IssuedCookieOptions());

    private StravaTokenBundle? ReadFromCookie(HttpRequest request)
    {
        if (!request.Cookies.TryGetValue(SecurityCookies.StravaAccessToken, out var cookie)
            || !_tokenProtector.TryUnprotect(cookie, out var payload))
        {
            return null;
        }

        try
        {
            var bundle = JsonSerializer.Deserialize<StravaTokenBundle>(payload);
            return bundle is not null
                && !string.IsNullOrWhiteSpace(bundle.AccessToken)
                && !string.IsNullOrWhiteSpace(bundle.RefreshToken)
                    ? bundle
                    : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static CookieOptions IssuedCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        IsEssential = true,
        Expires = DateTimeOffset.UtcNow.Add(CookieLifetime)
    };

    private static CookieOptions RevokedCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/"
    };
}
