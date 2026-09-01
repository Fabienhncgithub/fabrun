using FabRun.Api.Infrastructure.Persistence;
using FabRun.Api.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;

namespace FabRun.Api.Tests;

/// <summary>Minimal IWebHostEnvironment - the concrete HostingEnvironment class isn't public.</summary>
file sealed class FakeWebHostEnvironment : IWebHostEnvironment
{
    public string EnvironmentName { get; set; } = "Test";
    public string ApplicationName { get; set; } = "FabRun.Api.Tests";
    public string ContentRootPath { get; set; } = "";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    public string WebRootPath { get; set; } = "";
    public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
}

public sealed class FileAthleteSettingsRepositoryTests : IDisposable
{
    private readonly string _tempDir = Directory.CreateTempSubdirectory("fabrun-settings-tests").FullName;

    [Fact]
    public async Task SaveThenLoad_RoundTripsGoalRaceIncludingDateOnly()
    {
        var repository = CreateRepository();
        var settings = new AthleteSettings(
            true,
            new List<GoalRace> { new("r1", "20 km de Bruxelles", 20.0, new DateOnly(2026, 10, 4)) });

        await repository.SaveAsync(42, settings);
        var loaded = await repository.LoadAsync(42);

        Assert.NotNull(loaded);
        Assert.True(loaded!.HasShinPain);
        var race = Assert.Single(loaded.GoalRaces);
        Assert.Equal("r1", race.Id);
        Assert.Equal("20 km de Bruxelles", race.Label);
        Assert.Equal(20.0, race.DistanceKm);
        Assert.Equal(new DateOnly(2026, 10, 4), race.TargetDate);
    }

    [Fact]
    public async Task LoadAsync_ReturnsNull_ForAthleteWithNoStoredSettings()
    {
        var repository = CreateRepository();

        Assert.Null(await repository.LoadAsync(999));
    }

    [Fact]
    public async Task SaveAsync_KeepsEachAthletesSettingsIndependent()
    {
        var repository = CreateRepository();

        await repository.SaveAsync(1, new AthleteSettings(true, new List<GoalRace>()));
        await repository.SaveAsync(2, new AthleteSettings(false, new List<GoalRace>()));

        Assert.True((await repository.LoadAsync(1))!.HasShinPain);
        Assert.False((await repository.LoadAsync(2))!.HasShinPain);
    }

    [Fact]
    public async Task SaveAsync_CanClearGoalRacesBackToEmpty()
    {
        var repository = CreateRepository();
        await repository.SaveAsync(7, new AthleteSettings(
            false,
            new List<GoalRace> { new("r1", "Semi", 21.0975, new DateOnly(2026, 5, 1)) }));

        await repository.SaveAsync(7, new AthleteSettings(false, new List<GoalRace>()));

        Assert.Empty((await repository.LoadAsync(7))!.GoalRaces);
    }

    [Fact]
    public async Task SaveThenLoad_RoundTripsMultipleGoalRaces()
    {
        var repository = CreateRepository();
        var settings = new AthleteSettings(false, new List<GoalRace>
        {
            new("r1", "10K local", 10.0, new DateOnly(2026, 9, 6)),
            new("r2", "Marathon objectif", 42.195, new DateOnly(2027, 4, 18)),
        });

        await repository.SaveAsync(3, settings);
        var loaded = await repository.LoadAsync(3);

        Assert.Equal(2, loaded!.GoalRaces.Count);
        Assert.Contains(loaded.GoalRaces, g => g.Id == "r1");
        Assert.Contains(loaded.GoalRaces, g => g.Id == "r2");
    }

    [Fact]
    public async Task SaveThenLoad_RoundTripsShoePreferences()
    {
        var repository = CreateRepository();
        var settings = new AthleteSettings(
            false,
            new List<GoalRace>(),
            new List<ShoePreference>
            {
                new("g-shoe-1", 650),
                new("g-shoe-2", 900),
            });

        await repository.SaveAsync(12, settings);
        var loaded = await repository.LoadAsync(12);

        Assert.Equal(2, loaded!.ShoePreferences!.Count);
        Assert.Contains(loaded.ShoePreferences, preference =>
            preference.GearId == "g-shoe-1" && preference.RetirementKm == 650);
    }

    [Fact]
    public async Task SaveThenLoad_RoundTripsShoeBrandAndCalorieProfile()
    {
        var repository = CreateRepository();
        var settings = new AthleteSettings(
            false,
            new List<GoalRace>(),
            new List<ShoePreference> { new("g-shoe-1", 650, "hoka") },
            34,
            "female");

        await repository.SaveAsync(21, settings);
        var loaded = await repository.LoadAsync(21);

        Assert.Equal("hoka", loaded!.ShoePreferences!.Single().Brand);
        Assert.Equal(34, loaded.AgeYears);
        Assert.Equal("female", loaded.Sex);
    }

    private FileAthleteSettingsRepository CreateRepository()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["AthleteSettings:StorePath"] = Path.Combine(_tempDir, "athlete-settings.json")
            })
            .Build();
        var environment = new FakeWebHostEnvironment { ContentRootPath = _tempDir };
        return new FileAthleteSettingsRepository(configuration, environment, NullLogger<FileAthleteSettingsRepository>.Instance);
    }

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);
}
