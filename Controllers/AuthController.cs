using Microsoft.AspNetCore.Mvc;
using FabRun.Api.Services;

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
    public IActionResult Login()
    {
        var clientId = _cfg["STRAVA_CLIENT_ID"] ?? throw new Exception("STRAVA_CLIENT_ID missing in config");
        var baseUrl  = _cfg["BASE_URL"] ?? _cfg["FrontendOrigin"]!;
        var redirectPath = _cfg["RedirectPath"] ?? "/oauth/callback";
        var redirectUri = $"{baseUrl}{redirectPath}";
        return Redirect(_strava.AuthorizeUrl(clientId, redirectUri));
    }

    [HttpGet("/oauth/callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code)
    {
        if (string.IsNullOrEmpty(code)) return BadRequest("Missing code");

        var id         = _cfg["STRAVA_CLIENT_ID"]     ?? throw new Exception("STRAVA_CLIENT_ID missing in config");
        var secret     = _cfg["STRAVA_CLIENT_SECRET"] ?? throw new Exception("STRAVA_CLIENT_SECRET missing in config");
        var frontOrigin= _cfg["WEB_ORIGIN"]           ?? _cfg["FrontendOrigin"]!;

        var doc = await _strava.ExchangeCodeAsync(id, secret, code);
        var access = doc.RootElement.GetProperty("access_token").GetString();
        return Redirect($"{frontOrigin}/#access_token={access}");
    }
}
