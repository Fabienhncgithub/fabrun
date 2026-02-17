using Microsoft.AspNetCore.Mvc;
using FabRun.Api.Services;
using Microsoft.AspNetCore.WebUtilities;
using System.Text;

namespace FabRun.Api.Controllers;

[ApiController]
public class AuthController : ControllerBase
{
    private readonly IConfiguration _cfg;
    private readonly StravaService _strava;

    public AuthController(IConfiguration cfg, StravaService strava)
    {
        _cfg = cfg;
        _strava = strava;
    }

    [HttpGet("/auth/login")]
    public IActionResult Login([FromQuery] string? front = null)
    {
        var clientId = _cfg["STRAVA_CLIENT_ID"] ?? throw new Exception("STRAVA_CLIENT_ID missing in config");
        var baseUrl  = _cfg["BASE_URL"] ?? _cfg["FrontendOrigin"]!;
        var redirectPath = _cfg["RedirectPath"] ?? "/oauth/callback";
        var redirectUri = $"{baseUrl}{redirectPath}";
        var frontOrigin = ResolveFrontOrigin(front);
        var state = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(frontOrigin));
        return Redirect(_strava.AuthorizeUrl(clientId, redirectUri, state: state));
    }

    [HttpGet("/oauth/callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state)
    {
        if (string.IsNullOrEmpty(code)) return BadRequest("Missing code");

        var id         = _cfg["STRAVA_CLIENT_ID"]     ?? throw new Exception("STRAVA_CLIENT_ID missing in config");
        var secret     = _cfg["STRAVA_CLIENT_SECRET"] ?? throw new Exception("STRAVA_CLIENT_SECRET missing in config");
        var frontOrigin= ResolveFrontOriginFromState(state);

        var doc = await _strava.ExchangeCodeAsync(id, secret, code);
        var access = doc.RootElement.GetProperty("access_token").GetString();
        return Redirect($"{frontOrigin}/#access_token={access}");
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

    private string ResolveFrontOriginFromState(string? state)
    {
        if (string.IsNullOrWhiteSpace(state))
        {
            return ResolveFrontOrigin(null);
        }

        try
        {
            var raw = WebEncoders.Base64UrlDecode(state);
            var decoded = Encoding.UTF8.GetString(raw);
            return ResolveFrontOrigin(decoded);
        }
        catch
        {
            return ResolveFrontOrigin(null);
        }
    }
}
