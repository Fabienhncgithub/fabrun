using Microsoft.AspNetCore.Mvc;
using FabRun.Api.Abstractions.External;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.AspNetCore.DataProtection;
using System.Text;
using System.Security.Cryptography;
using System.ComponentModel.DataAnnotations;
using FabRun.Api.Security;

namespace FabRun.Api.Controllers;

[ApiController]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _cfg;
    private readonly IStravaClient _strava;
    private readonly ILogger<AuthController> _logger;
    private readonly ITimeLimitedDataProtector _stateProtector;
    private readonly StravaTokenProtector _tokenProtector;

    public AuthController(
        IConfiguration cfg,
        IStravaClient strava,
        ILogger<AuthController> logger,
        IDataProtectionProvider dataProtection,
        StravaTokenProtector tokenProtector)
    {
        _cfg = cfg;
        _strava = strava;
        _logger = logger;
        _stateProtector = dataProtection
            .CreateProtector("FabRun.StravaOAuth.State.v2")
            .ToTimeLimitedDataProtector();
        _tokenProtector = tokenProtector;
    }

    [HttpGet("/auth/login")]
    public IActionResult Login([FromQuery, StringLength(2048)] string? front = null)
    {
        var clientId = _cfg["STRAVA_CLIENT_ID"] ?? throw new Exception("STRAVA_CLIENT_ID missing in config");
        var baseUrl  = _cfg["BASE_URL"] ?? _cfg["FrontendOrigin"]!;
        var redirectPath = _cfg["RedirectPath"] ?? "/oauth/callback";
        var redirectUri = $"{baseUrl}{redirectPath}";
        var frontOrigin = ResolveFrontOrigin(front);
        var nonce = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var protectedState = _stateProtector.Protect(
            $"{nonce}\n{frontOrigin}",
            TimeSpan.FromMinutes(10));
        var state = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(protectedState));
        Response.Cookies.Append(SecurityCookies.OAuthState, nonce, SecureCookieOptions(TimeSpan.FromMinutes(10)));
        _logger.LogInformation(
            "Starting Strava OAuth for client {ClientId}; callback {RedirectUri}; frontend {FrontOrigin}",
            clientId,
            redirectUri,
            frontOrigin);
        return Redirect(_strava.AuthorizeUrl(clientId, redirectUri, state: state));
    }

    [HttpGet("/oauth/callback")]
    public async Task<IActionResult> Callback(
        [FromQuery, StringLength(1024)] string? code,
        [FromQuery, StringLength(4096)] string? state,
        [FromQuery, StringLength(1024)] string? scope,
        [FromQuery, StringLength(1024)] string? error,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Received Strava OAuth callback; code present: {HasCode}; scope present: {HasScope}; error present: {HasError}",
            !string.IsNullOrWhiteSpace(code),
            !string.IsNullOrWhiteSpace(scope),
            !string.IsNullOrWhiteSpace(error));

        if (!string.IsNullOrWhiteSpace(error))
            return BadRequest(new { error = "Autorisation Strava refusée." });
        if (string.IsNullOrEmpty(code))
            return BadRequest(new { error = "Code Strava manquant." });
        if (!TryValidateState(state, out var frontOrigin))
            return BadRequest(new { error = "État OAuth invalide ou expiré. Recommence la connexion." });

        var id         = _cfg["STRAVA_CLIENT_ID"]     ?? throw new Exception("STRAVA_CLIENT_ID missing in config");
        var secret     = _cfg["STRAVA_CLIENT_SECRET"] ?? throw new Exception("STRAVA_CLIENT_SECRET missing in config");

        using var doc = await _strava.ExchangeCodeAsync(id, secret, code, cancellationToken);
        var access = doc.RootElement.GetProperty("access_token").GetString();
        if (string.IsNullOrWhiteSpace(access) || access.Length > 2048)
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "Strava n'a pas renvoyé de jeton." });

        var expiresAt = doc.RootElement.TryGetProperty("expires_at", out var expiresElement)
            && expiresElement.TryGetInt64(out var unixExpires)
                ? DateTimeOffset.FromUnixTimeSeconds(unixExpires)
                : DateTimeOffset.UtcNow.AddHours(6);
        var lifetime = expiresAt - DateTimeOffset.UtcNow;
        if (lifetime <= TimeSpan.Zero)
            return StatusCode(StatusCodes.Status502BadGateway, new { error = "Strava a renvoyé un jeton expiré." });
        lifetime = TimeSpan.FromTicks(Math.Min(lifetime.Ticks, TimeSpan.FromHours(12).Ticks));

        Response.Cookies.Append(
            SecurityCookies.StravaAccessToken,
            _tokenProtector.Protect(access),
            SecureCookieOptions(lifetime));
        Response.Cookies.Delete(SecurityCookies.OAuthState, SecureCookieOptions());
        _logger.LogInformation(
            "Strava OAuth exchange succeeded; access token present: {HasAccessToken}; redirecting to {FrontOrigin}",
            !string.IsNullOrWhiteSpace(access),
            frontOrigin);
        return Redirect(frontOrigin);
    }

    [HttpGet("/auth/status")]
    public IActionResult Status()
    {
        var connected = Request.Cookies.TryGetValue(SecurityCookies.StravaAccessToken, out var cookie)
            && _tokenProtector.TryUnprotect(cookie, out _);
        return Ok(new { connected });
    }

    private string ResolveFrontOrigin(string? candidate)
    {
        var fallback = _cfg["WEB_ORIGIN"] ?? _cfg["FrontendOrigin"] ?? throw new Exception("Frontend origin missing in config");
        if (string.IsNullOrWhiteSpace(candidate))
        {
            return fallback;
        }

        var allowed = (_cfg.GetSection("FrontendOrigins").Get<string[]>() ?? Array.Empty<string>())
            .Append(fallback)
            .Where(v => !string.IsNullOrWhiteSpace(v))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var parsed))
        {
            return fallback;
        }

        var normalized = $"{parsed.Scheme}://{parsed.Authority}";
        return allowed.Contains(normalized) ? normalized : fallback;
    }

    private bool TryValidateState(string? state, out string frontOrigin)
    {
        frontOrigin = ResolveFrontOrigin(null);
        if (string.IsNullOrWhiteSpace(state))
            return false;

        try
        {
            var raw = WebEncoders.Base64UrlDecode(state);
            var protectedState = Encoding.UTF8.GetString(raw);
            var decoded = _stateProtector.Unprotect(protectedState, out _);
            var separator = decoded.IndexOf('\n');
            if (separator <= 0)
                return false;

            var expectedNonce = decoded[..separator];
            var suppliedNonce = Request.Cookies[SecurityCookies.OAuthState];
            if (string.IsNullOrWhiteSpace(suppliedNonce)
                || !CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(expectedNonce),
                    Encoding.UTF8.GetBytes(suppliedNonce)))
                return false;

            frontOrigin = ResolveFrontOrigin(decoded[(separator + 1)..]);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static CookieOptions SecureCookieOptions(TimeSpan? lifetime = null) => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        IsEssential = true,
        Expires = lifetime is { } value && value > TimeSpan.Zero
            ? DateTimeOffset.UtcNow.Add(value)
            : null
    };
}
