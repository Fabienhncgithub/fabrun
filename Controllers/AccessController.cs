using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Antiforgery;
using FabRun.Api.Security;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("access")]
public sealed class AccessController : ControllerBase
{
    private readonly IConfiguration _configuration;
    private readonly IHostEnvironment _environment;
    private readonly ILogger<AccessController> _logger;
    private readonly IAntiforgery _antiforgery;

    public AccessController(
        IConfiguration configuration,
        IHostEnvironment environment,
        ILogger<AccessController> logger,
        IAntiforgery antiforgery)
    {
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
        _antiforgery = antiforgery;
    }

    [AllowAnonymous]
    [HttpGet("status")]
    public IActionResult Status() => Ok(new
    {
        // Mirrors the FABRUN_DEV_SKIP_ACCESS_PASSWORD fallback policy in
        // Program.cs so the frontend's login gate stays in sync with it.
        authenticated = BypassesAccessPassword() || User.Identity?.IsAuthenticated == true
    });

    private bool BypassesAccessPassword() =>
        _environment.IsDevelopment() && _configuration.GetValue<bool>("FABRUN_DEV_SKIP_ACCESS_PASSWORD");

    [AllowAnonymous]
    [HttpGet("csrf")]
    public IActionResult Csrf()
    {
        var tokens = _antiforgery.GetAndStoreTokens(HttpContext);
        return Ok(new { token = tokens.RequestToken });
    }

    [AllowAnonymous]
    [HttpPost("login")]
    [EnableRateLimiting("login")]
    public async Task<IActionResult> Login(
        [FromBody] AccessLoginRequest request,
        CancellationToken cancellationToken)
    {
        var configuredPassword = _configuration["FABRUN_ACCESS_PASSWORD"];
        if (string.IsNullOrWhiteSpace(configuredPassword))
        {
            _logger.LogError("FABRUN_ACCESS_PASSWORD is not configured.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "L'accès FabRun n'est pas encore configuré sur le serveur."
            });
        }

        var suppliedPassword = request.Password ?? string.Empty;
        if (suppliedPassword.Length > 256 || !PasswordsMatch(suppliedPassword, configuredPassword))
        {
            await Task.Delay(Random.Shared.Next(150, 350), cancellationToken);
            return Unauthorized(new { error = "Mot de passe incorrect." });
        }

        var sessionVersion = _configuration["FABRUN_SESSION_VERSION"];
        if (string.IsNullOrWhiteSpace(sessionVersion))
        {
            _logger.LogError("FABRUN_SESSION_VERSION is not configured.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "La gestion des sessions FabRun n'est pas configurée sur le serveur."
            });
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.Name, "FabRun"),
            new Claim(SecurityClaims.SessionVersion, sessionVersion)
        };
        var principal = new ClaimsPrincipal(
            new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            principal,
            new AuthenticationProperties
            {
                IsPersistent = true,
                AllowRefresh = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
            });

        return Ok(new { authenticated = true });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        Response.Cookies.Delete(SecurityCookies.Csrf, SecureCookieOptions());
        return Ok(new { authenticated = false });
    }

    private static CookieOptions SecureCookieOptions() => new()
    {
        HttpOnly = true,
        Secure = true,
        SameSite = SameSiteMode.Lax,
        Path = "/"
    };

    private static bool PasswordsMatch(string supplied, string configured)
    {
        var suppliedHash = SHA256.HashData(Encoding.UTF8.GetBytes(supplied));
        var configuredHash = SHA256.HashData(Encoding.UTF8.GetBytes(configured));
        return CryptographicOperations.FixedTimeEquals(suppliedHash, configuredHash);
    }
}

public sealed record AccessLoginRequest(
    [System.ComponentModel.DataAnnotations.Required]
    [System.ComponentModel.DataAnnotations.StringLength(256, MinimumLength = 1)]
    string? Password);
