using FabRun.Api.Models;
using FabRun.Api.Services;
using Xunit;

namespace FabRun.Api.Tests;

public class BestEffortsTests
{
    [Fact]
    public void BestFromStreams_FindsBest1k()
    {
        // 0..2000m every 100m, pace 5:00/km => 30s per 100m
        var dist = Enumerable.Range(0, 21).Select(i => i * 100.0).ToArray();
        var time = Enumerable.Range(0, 21).Select(i => i * 30.0).ToArray();

        var best = BestEffortsService.BestFromStreams(dist, time, 1000.0);

        Assert.NotNull(best);
        Assert.InRange(best!.Value.timeSec, 299.0, 301.0);
    }

    [Fact]
    public void BestFromSplits_FindsBest5kWindow()
    {
        var splits = new List<StravaSplit>
        {
            new() { split = 1, distance = 1000, elapsed_time = 320, moving_time = 320 },
            new() { split = 2, distance = 1000, elapsed_time = 310, moving_time = 310 },
            new() { split = 3, distance = 1000, elapsed_time = 300, moving_time = 300 },
            new() { split = 4, distance = 1000, elapsed_time = 305, moving_time = 305 },
            new() { split = 5, distance = 1000, elapsed_time = 315, moving_time = 315 },
            new() { split = 6, distance = 1000, elapsed_time = 330, moving_time = 330 },
        };

        var best = BestEffortsService.BestFromSplits(splits, 5000.0);

        Assert.NotNull(best);
        Assert.Equal(1550, best!.Value.timeSec); // 310+300+305+315+320? actually best 5 splits are 2..6 = 1560, 1..5=1550
    }
}
