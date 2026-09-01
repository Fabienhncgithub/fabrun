using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FabRun.Api.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace FabRun.Api.Tests;

public sealed class SecurityIntegrationTests : IDisposable
{
    private const string Password = "test-password-with-more-than-20-characters";
    private const string SessionVersion = "test-session-version-0000000001";

    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public SecurityIntegrationTests()
    {
        _factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Development");
                builder.ConfigureAppConfiguration((_, configuration) =>
                    configuration.AddInMemoryCollection(new Dictionary<string, string?>
                    {
                        ["FABRUN_ACCESS_PASSWORD"] = Password,
                        ["FABRUN_SESSION_VERSION"] = SessionVersion,
                        ["STRAVA_CLIENT_ID"] = "12345",
                        ["STRAVA_CLIENT_SECRET"] = "test-strava-secret-value",
                        ["BASE_URL"] = "https://localhost",
                        ["WEB_ORIGIN"] = "https://localhost",
                        // Overrides the dev-convenience default from
                        // appsettings.Development.json: these tests exercise
                        // the real auth gate even though they run under
                        // "Development".
                        ["FABRUN_DEV_SKIP_ACCESS_PASSWORD"] = "false"
                    }));
            });

        _client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            HandleCookies = true,
            AllowAutoRedirect = false
        });
    }

    [Fact]
    public async Task AnonymousSurfaceOnlyExposesAccessBootstrap()
    {
        var accessStatus = await _client.GetAsync("/access/status");
        var csrf = await _client.GetAsync("/access/csrf");
        var stravaStatus = await _client.GetAsync("/auth/status");
        var activities = await _client.GetAsync("/api/activities");
        var settings = await _client.GetAsync("/api/settings");

        Assert.Equal(HttpStatusCode.OK, accessStatus.StatusCode);
        Assert.Equal(HttpStatusCode.OK, csrf.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, stravaStatus.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, activities.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, settings.StatusCode);
    }

    [Fact]
    public async Task LoginRejectsRequestsWithoutAntiforgeryToken()
    {
        var response = await _client.PostAsJsonAsync("/access/login", new { password = Password });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task CorsPreflight_AllowsAthleteSettingsPut()
    {
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/settings");
        request.Headers.Add("Origin", "https://localhost:5173");
        request.Headers.Add("Access-Control-Request-Method", "PUT");
        request.Headers.Add("Access-Control-Request-Headers", "content-type,x-csrf-token");

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal(
            "https://localhost:5173",
            response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Contains(
            "PUT",
            response.Headers.GetValues("Access-Control-Allow-Methods").Single(),
            StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task LoginIssuesHardenedCookieAndSessionCanBeRevoked()
    {
        var csrfResponse = await _client.GetAsync("/access/csrf");
        var csrfPayload = await csrfResponse.Content.ReadFromJsonAsync<JsonElement>();
        var csrfToken = csrfPayload.GetProperty("token").GetString();

        using var login = new HttpRequestMessage(HttpMethod.Post, "/access/login")
        {
            Content = JsonContent.Create(new { password = Password })
        };
        login.Headers.Add(SecurityHeaders.Csrf, csrfToken);

        var loginResponse = await _client.SendAsync(login);
        Assert.Equal(HttpStatusCode.OK, loginResponse.StatusCode);

        var accessCookie = loginResponse.Headers.GetValues("Set-Cookie")
            .Single(value => value.StartsWith($"{SecurityCookies.Access}=", StringComparison.Ordinal));
        Assert.Contains("secure", accessCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", accessCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", accessCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/", accessCookie, StringComparison.OrdinalIgnoreCase);

        var authenticated = await _client.GetFromJsonAsync<JsonElement>("/access/status");
        Assert.True(authenticated.GetProperty("authenticated").GetBoolean());

        _factory.Services.GetRequiredService<IConfiguration>()["FABRUN_SESSION_VERSION"] =
            "revoked-session-version-00000002";

        var revoked = await _client.GetFromJsonAsync<JsonElement>("/access/status");
        Assert.False(revoked.GetProperty("authenticated").GetBoolean());
    }

    [Fact]
    public void StravaCookieValueIsEncryptedAndAuthenticated()
    {
        var protector = new StravaTokenProtector(new EphemeralDataProtectionProvider());
        const string rawToken = "sensitive-strava-access-token";

        var protectedToken = protector.Protect(rawToken);

        Assert.DoesNotContain(rawToken, protectedToken, StringComparison.Ordinal);
        Assert.True(protector.TryUnprotect(protectedToken, out var roundTrip));
        Assert.Equal(rawToken, roundTrip);
        Assert.False(protector.TryUnprotect(protectedToken + "tampered", out _));
    }

    [Fact]
    public void ProductionRejectsPlaceholderSecrets()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("FABRUN_ACCESS_PASSWORD", "change-me-with-a-long-random-password");
                builder.UseSetting("FABRUN_SESSION_VERSION", "valid-session-version-000000001");
                builder.UseSetting("STRAVA_CLIENT_ID", "12345");
                builder.UseSetting("STRAVA_CLIENT_SECRET", "valid-strava-secret-value");
                builder.UseSetting("BASE_URL", "https://localhost");
                builder.UseSetting("WEB_ORIGIN", "https://localhost");
                builder.UseSetting("AllowedHosts", "localhost");
                builder.UseSetting("ReverseProxy:KnownProxy", "127.0.0.1");
            });

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());
        Assert.Contains("placeholder", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProductionStartsWithCompleteSecurityConfiguration()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder =>
            {
                builder.UseEnvironment("Production");
                builder.UseSetting("FABRUN_ACCESS_PASSWORD", "valid-random-access-password-00000001");
                builder.UseSetting("FABRUN_SESSION_VERSION", "valid-session-version-000000001");
                builder.UseSetting("STRAVA_CLIENT_ID", "12345");
                builder.UseSetting("STRAVA_CLIENT_SECRET", "valid-strava-secret-value");
                builder.UseSetting("BASE_URL", "https://localhost");
                builder.UseSetting("WEB_ORIGIN", "https://localhost");
                builder.UseSetting("AllowedHosts", "localhost");
                builder.UseSetting("ReverseProxy:KnownProxy", "127.0.0.1");
            });
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            AllowAutoRedirect = false
        });

        var response = await client.GetAsync("/access/status");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.CacheControl?.Private);
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
    }
}
