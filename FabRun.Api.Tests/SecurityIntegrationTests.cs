using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FabRun.Api.Security;
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
        var activities = await _client.GetAsync("/api/activities");
        var settings = await _client.GetAsync("/api/settings");

        Assert.Equal(HttpStatusCode.OK, accessStatus.StatusCode);
        Assert.Equal(HttpStatusCode.OK, csrf.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, activities.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, settings.StatusCode);
    }

    [Theory]
    [InlineData("GET", "/api/garmin/status")]
    [InlineData("POST", "/api/garmin/sync")]
    [InlineData("POST", "/api/garmin/history?period=7d")]
    [InlineData("POST", "/api/garmin/activities")]
    [InlineData("POST", "/api/garmin/ski")]
    public async Task GarminEndpointsRejectAnonymousCallers(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        using var response = await _client.SendAsync(request);
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.BadRequest });
        Assert.DoesNotContain("recovery", await response.Content.ReadAsStringAsync());
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
    public async Task RateLimitResponseKeepsCorsHeadersForBrowserClients()
    {
        HttpResponseMessage? response = null;
        for (var i = 0; i < 121; i++)
        {
            response?.Dispose();
            using var request = new HttpRequestMessage(HttpMethod.Get, "/access/status");
            request.Headers.Add("Origin", "https://localhost:5173");
            response = await _client.SendAsync(request);
            if (response.StatusCode == HttpStatusCode.TooManyRequests) break;
        }
        using (response)
        {
            Assert.NotNull(response);
            Assert.Equal(HttpStatusCode.TooManyRequests, response.StatusCode);
            Assert.Equal("https://localhost:5173", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
        }
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

    [Theory]
    [InlineData("POST", "/api/shoes")]
    [InlineData("PUT", "/api/shoes/default")]
    [InlineData("PUT", "/api/shoes/g1/retired")]
    [InlineData("PUT", "/api/activities/1/shoe")]
    public async Task ShoeEndpointsRejectAnonymousCallers(string method, string path)
    {
        using var request = new HttpRequestMessage(new HttpMethod(method), path) { Content = JsonContent.Create(new { }) };
        using var response = await _client.SendAsync(request);
        // Antiforgery or authentication rejects it before any store is touched.
        Assert.Contains(response.StatusCode, new[] { HttpStatusCode.Unauthorized, HttpStatusCode.BadRequest });
    }

    [Fact]
    public async Task StravaAuthEndpointsAreGone()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await _client.GetAsync("/auth/login")).StatusCode);
        await AuthenticateAsync();
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/auth/status")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync("/oauth/callback")).StatusCode);
    }

    private async Task AuthenticateAsync()
    {
        var csrf = await _client.GetFromJsonAsync<JsonElement>("/access/csrf");
        using var login = new HttpRequestMessage(HttpMethod.Post, "/access/login")
        {
            Content = JsonContent.Create(new { password = Password })
        };
        login.Headers.Add(SecurityHeaders.Csrf, csrf.GetProperty("token").GetString());
        using var response = await _client.SendAsync(login);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
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
                builder.UseSetting("GARMIN_PERSONAL_API_KEY", "valid-garmin-personal-key-0001");
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
                builder.UseSetting("GARMIN_PERSONAL_API_KEY", "valid-garmin-personal-key-0001");
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
