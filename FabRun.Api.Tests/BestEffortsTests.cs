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

}
