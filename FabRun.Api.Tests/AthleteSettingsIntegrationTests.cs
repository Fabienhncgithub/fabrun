using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Infrastructure.External;
using FabRun.Api.Models;
using FabRun.Api.Security;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace FabRun.Api.Tests;

public sealed class AthleteSettingsIntegrationTests : IDisposable
{
    private const string Password = "settings-test-password-at-least-20-characters";
    private readonly string _tempDir = Directory.CreateTempSubdirectory("fabrun-settings-api-tests").FullName;
    private readonly WebApplicationFactory<Program> _factory;
    private readonly HttpClient _client;

    public AthleteSettingsIntegrationTests()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureAppConfiguration((_, configuration) =>
                configuration.AddInMemoryCollection(new Dictionary<string, string?>
                {
                    ["FABRUN_ACCESS_PASSWORD"] = Password,
                    ["FABRUN_SESSION_VERSION"] = "settings-tests-session-version-0001",
                    ["FABRUN_DEV_SKIP_ACCESS_PASSWORD"] = "false",
                    ["AthleteSettings:StorePath"] = Path.Combine(_tempDir, "athlete-settings.json")
                }));
            builder.ConfigureServices(services =>
            {
                services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
                services.AddHttpClient<IStravaClient, StravaApiClient>()
                    .ConfigurePrimaryHttpMessageHandler(() => new AthleteProfileHandler());
            });
        });
        _client = _factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"),
            HandleCookies = true,
            AllowAutoRedirect = false
        });
    }

    [Theory]
    [InlineData(300)]
    [InlineData(650)]
    [InlineData(1500)]
    public async Task UpdateShoeThreshold_IsReturnedAndPersistedOnReload(int retirementKm)
    {
        await AuthenticateAsync();
        var settings = ValidSettings();
        using var firstSave = await _client.PutAsJsonAsync("/api/settings", settings);
        Assert.Equal(HttpStatusCode.OK, firstSave.StatusCode);

        settings["shoePreferences"]![0]!["retirementKm"] = retirementKm;
        using var update = await _client.PutAsJsonAsync("/api/settings", settings);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await update.Content.ReadFromJsonAsync<AthleteSettings>();
        Assert.Equal(retirementKm, updated!.ShoePreferences!.Single(p => p.GearId == "g-shoe-1").RetirementKm);

        var reloaded = await _client.GetFromJsonAsync<AthleteSettings>("/api/settings");
        Assert.NotNull(reloaded);
        var preferences = Assert.IsType<List<ShoePreference>>(reloaded!.ShoePreferences);
        Assert.Equal(retirementKm, preferences.Single(p => p.GearId == "g-shoe-1").RetirementKm);
        Assert.Equal("hoka", preferences.Single(p => p.GearId == "g-shoe-1").Brand);
        Assert.Equal(900, preferences.Single(p => p.GearId == "g-shoe-2").RetirementKm);
        Assert.Equal("r1", Assert.Single(reloaded.GoalRaces).Id);
        Assert.True(reloaded.HasShinPain);
        Assert.Equal(34, reloaded.AgeYears);
        Assert.Equal("female", reloaded.Sex);

        // Read the actual store independently of the running service/cache.
        var stored = JsonSerializer.Deserialize<Dictionary<long, AthleteSettings>>(
            await File.ReadAllTextAsync(Path.Combine(_tempDir, "athlete-settings.json")));
        Assert.Equal(retirementKm, stored![42].ShoePreferences!.Single(p => p.GearId == "g-shoe-1").RetirementKm);
    }

    [Theory]
    [InlineData("shoePreferences", "retirementKm", "299")]
    [InlineData("shoePreferences", "retirementKm", "1501")]
    [InlineData("shoePreferences", "gearId", "\"\"")]
    [InlineData("goalRaces", "label", "\"\"")]
    [InlineData("goalRaces", "distanceKm", "0")]
    [InlineData(null, "ageYears", "9")]
    public async Task InvalidSettings_ReturnValidationErrorWithoutOverwritingSavedThreshold(
        string? collection, string property, string value)
    {
        await AuthenticateAsync();
        var settings = ValidSettings();
        using var initialSave = await _client.PutAsJsonAsync("/api/settings", settings);
        Assert.Equal(HttpStatusCode.OK, initialSave.StatusCode);

        var target = collection is null ? settings : settings[collection]![0]!.AsObject();
        target[property] = JsonNode.Parse(value);
        using var response = await _client.PutAsJsonAsync("/api/settings", settings);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.NotEmpty(problem.GetProperty("errors").EnumerateObject());
        var reloaded = await _client.GetFromJsonAsync<AthleteSettings>("/api/settings");
        Assert.Equal(800, reloaded!.ShoePreferences!.Single(p => p.GearId == "g-shoe-1").RetirementKm);
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

        var bundle = new StravaTokenBundle("test-access-token", "test-refresh-token",
            DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds());
        var cookie = _factory.Services.GetRequiredService<StravaTokenProtector>()
            .Protect(JsonSerializer.Serialize(bundle));
        _client.DefaultRequestHeaders.Add("Cookie", $"{SecurityCookies.StravaAccessToken}={cookie}");
        csrf = await _client.GetFromJsonAsync<JsonElement>("/access/csrf");
        _client.DefaultRequestHeaders.Add(SecurityHeaders.Csrf, csrf.GetProperty("token").GetString());
    }

    private static JsonObject ValidSettings() => JsonSerializer.SerializeToNode(new
    {
        hasShinPain = true,
        goalRaces = new[] { new { id = "r1", label = "10 km", distanceKm = 10, targetDate = "2026-10-04" } },
        shoePreferences = new[]
        {
            new { gearId = "g-shoe-1", retirementKm = 800, brand = "hoka" },
            new { gearId = "g-shoe-2", retirementKm = 900, brand = "nike" }
        },
        ageYears = 34,
        sex = "female"
    })!.AsObject();

    private sealed class AthleteProfileHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("https://www.strava.com/api/v3/athlete", request.RequestUri!.AbsoluteUri);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = JsonContent.Create(new
                {
                    id = 42,
                    shoes = new[]
                    {
                        new { id = "g-shoe-1", name = "Hoka", distance = 400000 },
                        new { id = "g-shoe-2", name = "Nike", distance = 200000 }
                    }
                })
            });
        }
    }

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        Directory.Delete(_tempDir, recursive: true);
    }
}
