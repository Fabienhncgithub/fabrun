using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
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
                    ["AthleteSettings:StorePath"] = Path.Combine(_tempDir, "athlete-settings.json"),
                    ["Shoes:StorePath"] = Path.Combine(_tempDir, "shoes.json"),
                    ["ActivityArchive:Path"] = Path.Combine(_tempDir, "archive.json"),
                    // No Garmin key: these tests never reach the network.
                    ["GARMIN_PERSONAL_API_KEY"] = ""
                }));
            builder.ConfigureServices(services =>
                services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider()));
        });
        // Settings are keyed by the archive's athlete; shoes come from FabRun's own registry.
        File.WriteAllText(Path.Combine(_tempDir, "archive.json"),
            """
            {"athleteId":42,"importedAtUtc":"2026-01-01T00:00:00Z","activities":[
              {"id":7,"sport_type":"Run","distance":10000,"moving_time":3000,"total_elevation_gain":0,"start_date_local":"2024-01-01T08:00:00Z","name":"Course","gear_id":"g-shoe-1"},
              {"id":8,"sport_type":"AlpineSki","distance":50000,"moving_time":20000,"total_elevation_gain":0,"start_date_local":"2024-01-02T08:00:00Z","name":"Ski"}]}
            """);
        File.WriteAllText(Path.Combine(_tempDir, "shoes.json"),
            """{"defaultShoeId":null,"shoes":[{"id":"g-shoe-1","name":"Hoka","initialKm":400,"retired":false},{"id":"g-shoe-2","name":"Nike","initialKm":200,"retired":false}],"assignments":{}}""");
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

    [Fact]
    public async Task ShoeEndpoints_ValidateAndPersist()
    {
        await AuthenticateAsync();

        using var add = await _client.PostAsJsonAsync("/api/shoes", new { name = "Novablast", brand = "asics", initialKm = 12, makeDefault = true });
        Assert.Equal(HttpStatusCode.OK, add.StatusCode);
        var added = (await add.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetString();
        using var badBrand = await _client.PostAsJsonAsync("/api/shoes", new { name = "X", brand = "unknown", initialKm = 0 });
        Assert.Equal(HttpStatusCode.BadRequest, badBrand.StatusCode);
        using var tooFar = await _client.PostAsJsonAsync("/api/shoes", new { name = "X", initialKm = 99999 });
        Assert.Equal(HttpStatusCode.BadRequest, tooFar.StatusCode);

        using var retire = await _client.PutAsJsonAsync("/api/shoes/g-shoe-2/retired", new { retired = true });
        Assert.Equal(HttpStatusCode.NoContent, retire.StatusCode);
        using var retiredDefault = await _client.PutAsJsonAsync("/api/shoes/default", new { shoeId = "g-shoe-2" });
        Assert.Equal(HttpStatusCode.BadRequest, retiredDefault.StatusCode);
        using var unknownShoe = await _client.PutAsJsonAsync("/api/shoes/nope/retired", new { retired = true });
        Assert.Equal(HttpStatusCode.NotFound, unknownShoe.StatusCode);

        using var assign = await _client.PutAsJsonAsync("/api/activities/7/shoe", new { shoeId = added });
        Assert.Equal(HttpStatusCode.NoContent, assign.StatusCode);
        using var ski = await _client.PutAsJsonAsync("/api/activities/8/shoe", new { shoeId = added });
        Assert.Equal(HttpStatusCode.BadRequest, ski.StatusCode);
        using var missing = await _client.PutAsJsonAsync("/api/activities/999/shoe", new { shoeId = added });
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        var profile = await _client.GetFromJsonAsync<JsonElement>("/api/profile");
        var shoes = profile.GetProperty("shoes").EnumerateArray().ToList();
        var nova = shoes.Single(s => s.GetProperty("id").GetString() == added);
        Assert.True(nova.GetProperty("is_default").GetBoolean());
        Assert.Equal(22, nova.GetProperty("converted_distance").GetDouble());
        Assert.True(shoes.Single(s => s.GetProperty("id").GetString() == "g-shoe-2").GetProperty("retired").GetBoolean());
        Assert.Equal(400, shoes.Single(s => s.GetProperty("id").GetString() == "g-shoe-1").GetProperty("converted_distance").GetDouble());
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

    public void Dispose()
    {
        _client.Dispose();
        _factory.Dispose();
        Directory.Delete(_tempDir, recursive: true);
    }
}
