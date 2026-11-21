using System.IO.Compression;
using System.Text.Json;
using Dynastream.Fit;
using FabRun.Api.Abstractions.External;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;
using FabRun.Api.Services;
using Xunit;
using DateTime = System.DateTime;
using Activity = FabRun.Api.Models.Activity;
using FitDateTime = Dynastream.Fit.DateTime;

namespace FabRun.Api.Tests;

public class ShoeServiceTests
{
    private static Activity Run(long id, string date, double meters = 10_000, string sport = "Run", string? gear = null)
        => new(id, sport, meters, 3000, 0, date, null, $"run {id}", gear_id: gear);

    [Fact]
    public async Task NewRunGetsDefaultAndKeepsItWhenDefaultChanges()
    {
        var repo = new MemoryShoeRepository(new ShoeRegistry("a", Shoes("a", "b"), new()));
        var service = new ShoeService(repo);

        var first = await service.ApplyAsync(new[] { Run(1, "2026-11-01T08:00:00Z") }, new HashSet<long>());
        Assert.Equal("a", first[0].gear_id);
        Assert.Equal("a", repo.Saved!.Assignments["1"]);

        await service.SetDefaultAsync("b");
        var again = await service.ApplyAsync(new[] { Run(1, "2026-11-01T08:00:00Z"), Run(2, "2026-11-02T08:00:00Z") }, new HashSet<long>());
        Assert.Equal("a", again[0].gear_id);
        Assert.Equal("b", again[1].gear_id);
    }

    [Fact]
    public async Task ExplicitNoShoeIsNeverReplacedByDefault()
    {
        var repo = new MemoryShoeRepository(new ShoeRegistry("a", Shoes("a"), new() { ["1"] = null }));
        var result = await new ShoeService(repo).ApplyAsync(new[] { Run(1, "2026-11-01T08:00:00Z") }, new HashSet<long>());
        Assert.Null(result[0].gear_id);
    }

    [Fact]
    public async Task ArchivedRunsKeepImportedShoeAndNonRunsGetNone()
    {
        var repo = new MemoryShoeRepository(new ShoeRegistry("a", Shoes("a", "old"), new()));
        var result = await new ShoeService(repo).ApplyAsync(new[]
        {
            Run(1, "2024-01-01T08:00:00Z", gear: "old"),
            Run(2, "2026-11-01T08:00:00Z", sport: "AlpineSki"),
        }, new HashSet<long> { 1 });
        Assert.Equal("old", result[0].gear_id);
        Assert.Null(result[1].gear_id);
        Assert.Null(repo.Saved);
    }

    [Fact]
    public async Task ProfileDistanceAddsStartingMileageToAssignedRuns()
    {
        var registry = new ShoeRegistry("a", new List<ShoeEntry> { new("a", "Superblast", "asics", null, 135, false) }, new());
        var service = new ShoeService(new MemoryShoeRepository(registry));
        var shoes = await service.ProfileShoesAsync(new[]
        {
            Run(1, "2026-11-01T08:00:00Z", 10_000, gear: "a"),
            Run(2, "2026-11-02T08:00:00Z", 5_000, sport: "Walk", gear: "a"),
        });
        var shoe = Assert.Single(shoes);
        Assert.Equal(145, shoe.converted_distance);
        Assert.True(shoe.is_default);
    }

    [Fact]
    public async Task RetiringDefaultClearsIt_AndRetiredShoeCannotBecomeDefault()
    {
        var repo = new MemoryShoeRepository(new ShoeRegistry("a", Shoes("a", "b"), new()));
        var service = new ShoeService(repo);
        Assert.True(await service.SetRetiredAsync("a", true));
        Assert.Null(repo.Saved!.DefaultShoeId);
        Assert.False(await service.SetDefaultAsync("a"));
        Assert.False(await service.AssignAsync(1, "missing"));
        Assert.True(await service.AssignAsync(1, "b"));
    }

    [Fact]
    public async Task AddedShoeCanBecomeDefault()
    {
        var repo = new MemoryShoeRepository(ShoeRegistry.Empty());
        var shoe = await new ShoeService(repo).AddAsync("  Novablast  ", "asics", 12.34, makeDefault: true);
        Assert.Equal("Novablast", shoe.Name);
        Assert.Equal(12.3, shoe.InitialKm);
        Assert.Equal(shoe.Id, repo.Saved!.DefaultShoeId);
    }

    private static List<ShoeEntry> Shoes(params string[] ids)
        => ids.Select(id => new ShoeEntry(id, id, null, null, 0, false)).ToList();
}

public class ActivityMergeTests
{
    private static Activity At(long id, string date) => new(id, "Run", 5000, 1500, 0, date, null, "");

    [Fact]
    public void ArchiveOnlyFillsHistoryBeforeTheFirstGarminActivity()
    {
        var garmin = new[] { At(10, "2024-12-15T16:32:39Z"), At(11, "2025-01-02T08:00:00Z") };
        var archive = new[] { At(1, "2024-12-01T08:00:00Z"), At(2, "2024-12-15T16:32:39Z"), At(3, "2025-01-02T08:00:00Z") };

        var merged = ActivityService.Merge(garmin, archive);

        Assert.Equal(new long[] { 11, 10, 1 }, merged.Select(a => a.id));
    }

    [Fact]
    public void WithoutGarminTheWholeArchiveIsShown()
        => Assert.Equal(2, ActivityService.Merge(Array.Empty<Activity>(), new[] { At(1, "2024-01-01T08:00:00Z"), At(2, "2024-02-01T08:00:00Z") }).Count);
}

public class GarminActivityMappingTests
{
    [Fact]
    public void MapsGarminSummaryToActivity()
    {
        using var json = JsonDocument.Parse("""
            {"activityId":25089307269,"activityName":"Geneva Course à pied","startTimeLocal":"2026-11-15 16:31:35",
             "activityType":{"typeKey":"running"},"distance":9044.7,"duration":3068.2,"movingDuration":3016.9,
             "elevationGain":137.0,"averageSpeed":2.948,"maxSpeed":5.057,"averageHR":165.0,"maxHR":184.0,"calories":780.0}
            """);
        var a = GarminService.ToActivity(json.RootElement)!;
        Assert.Equal("Run", a.sport_type);
        Assert.Equal("2026-11-15T16:31:35Z", a.start_date_local);
        Assert.Equal(3017, a.moving_time);
        Assert.Equal(137, a.total_elevation_gain);
        Assert.Equal(780, a.calories);
        Assert.Equal(165, a.average_heartrate);
        Assert.Null(a.gear_id);
    }

    [Fact]
    public void RejectsMalformedSummaries()
    {
        using var json = JsonDocument.Parse("""[{"activityId":0,"startTimeLocal":"2026-11-15 16:31:35","activityType":{"typeKey":"running"}},{"activityId":5,"startTimeLocal":"bad","activityType":{"typeKey":"running"}}]""");
        Assert.All(json.RootElement.EnumerateArray(), item => Assert.Null(GarminService.ToActivity(item)));
    }

    [Theory]
    [InlineData("running", "Run")]
    [InlineData("trail_running", "TrailRun")]
    [InlineData("treadmill_running", "VirtualRun")]
    [InlineData("strength_training", "WeightTraining")]
    [InlineData("e_bike_fitness", "EBikeRide")]
    [InlineData("resort_skiing", "AlpineSki")]
    [InlineData("hiking", "Hike")]
    [InlineData("lap_swimming", "Swim")]
    [InlineData("something_new", "Workout")]
    public void SportTypesMatchWhatAnalyticsExpect(string typeKey, string expected)
        => Assert.Equal(expected, GarminService.SportType(typeKey));
}

public class FitStreamsTests
{
    [Fact]
    public void ReadsDistanceAndElapsedTimeFromZippedFit()
    {
        var zip = ZippedFit(Enumerable.Range(0, 11).Select(i => ((uint)i * 30, i * 100f)));

        var stream = FitStreams.FromZip(zip)!;

        Assert.Equal(11, stream.Distance.Length);
        Assert.Equal(0, stream.Time[0]);
        Assert.Equal(300, stream.Time[^1]);
        Assert.Equal(1000, stream.Distance[^1], 3);
    }

    [Fact]
    public void NonFitContentYieldsNull()
    {
        using var buffer = new MemoryStream();
        using (var archive = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
            using (var writer = new StreamWriter(archive.CreateEntry("ride.gpx").Open()))
                writer.Write("<gpx/>");
        Assert.Null(FitStreams.FromZip(buffer.ToArray()));
        Assert.Null(FitStreams.FromZip(new byte[] { 1, 2, 3 }));
    }

    [Fact]
    public void DropsBackwardsDistanceAndDuplicateTimestamps()
    {
        var stream = FitStreams.Build(new (uint, double)[] { (100, 0), (101, 5), (101, 6), (102, 4), (103, 10) })!;
        Assert.Equal(new double[] { 0, 5, 10 }, stream.Distance);
        Assert.Equal(new double[] { 0, 1, 3 }, stream.Time);
    }

    internal static byte[] ZippedFit(IEnumerable<(uint Offset, float Meters)> samples)
    {
        const uint start = 1_100_000_000;
        using var fit = new MemoryStream();
        var encoder = new Encode(ProtocolVersion.V20);
        encoder.Open(fit);
        var fileId = new FileIdMesg();
        fileId.SetType(Dynastream.Fit.File.Activity);
        fileId.SetManufacturer(Manufacturer.Development);
        fileId.SetSerialNumber(1);
        fileId.SetTimeCreated(new FitDateTime(start));
        encoder.Write(fileId);
        foreach (var (offset, meters) in samples)
        {
            var record = new RecordMesg();
            record.SetTimestamp(new FitDateTime(start + offset));
            record.SetDistance(meters);
            encoder.Write(record);
        }
        encoder.Close();

        using var zip = new MemoryStream();
        using (var archive = new ZipArchive(zip, ZipArchiveMode.Create, leaveOpen: true))
            using (var entry = archive.CreateEntry("1_ACTIVITY.fit").Open())
                entry.Write(fit.ToArray());
        return zip.ToArray();
    }
}

public class BestEffortsComputeTests
{
    [Fact]
    public async Task UsesStreamsForRecentRunsAndWholeActivityForOlderRaces()
    {
        var today = DateTime.Today;
        string Day(int daysAgo) => today.AddDays(-daysAgo).ToString("yyyy-MM-dd'T'08:00:00'Z'");
        var activities = new[]
        {
            // 2 km at 4:00/km with a 1 km stream: best 1K = 240 s.
            new Activity(1, "Run", 2000, 480, 0, Day(1), null, "Fractionné"),
            // Older 10 km race found without any stream.
            new Activity(2, "Run", 10_050, 2400, 0, Day(200), null, "10 km de Genève"),
            new Activity(3, "AlpineSki", 50_000, 20_000, 0, Day(2), null, "Ski"),
            new Activity(4, "Run", 10_000, 1800, 0, Day(400), null, "Hors fenêtre"),
        };
        var streams = new FakeStreams(new Dictionary<long, DistanceStream?>
        {
            [1] = new(Enumerable.Range(0, 21).Select(i => i * 100.0).ToArray(), Enumerable.Range(0, 21).Select(i => i * 24.0).ToArray()),
            [2] = null,
        });

        var efforts = await new BestEffortsService(streams).ComputeBestEffortsAsync(activities, daysBack: 365);

        var oneK = efforts.Single(e => e.distanceKm == 1.0);
        Assert.Equal("streams", oneK.method);
        Assert.InRange(oneK.timeSec, 239, 241);
        var tenK = efforts.Single(e => e.distanceKm == 10.0);
        Assert.Equal(2, tenK.activityId);
        Assert.Equal("activity", tenK.method);
        Assert.DoesNotContain(3L, streams.Requested);
        Assert.DoesNotContain(4L, streams.Requested);
    }

    private sealed class FakeStreams(Dictionary<long, DistanceStream?> data) : IActivityStreams
    {
        public List<long> Requested { get; } = new();
        public Task<DistanceStream?> DistanceStreamAsync(long activityId, CancellationToken ct)
        {
            Requested.Add(activityId);
            return Task.FromResult(data.GetValueOrDefault(activityId));
        }
    }
}

internal sealed class MemoryShoeRepository(ShoeRegistry initial) : IShoeRepository
{
    private ShoeRegistry _current = initial;
    public ShoeRegistry? Saved { get; private set; }

    // Deep-ish copy so the service cannot mutate what the test asserts against by reference.
    public Task<ShoeRegistry> LoadAsync() => Task.FromResult(_current with
    {
        Shoes = _current.Shoes.ToList(),
        Assignments = new Dictionary<string, string?>(_current.Assignments)
    });

    public Task SaveAsync(ShoeRegistry registry)
    {
        _current = registry;
        Saved = registry;
        return Task.CompletedTask;
    }
}
