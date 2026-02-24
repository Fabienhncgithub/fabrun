using FabRun.Api.Models;
using FabRun.Api.Services;
using Xunit;

namespace FabRun.Api.Tests;

public class PredictionMathTests
{
    [Fact]
    public void TryCalibrateExponent_ClampsValue()
    {
        var now = DateTime.UtcNow;
        var e5 = new BestEffortComputed(5.0, 1500, 1, "5k", now, "streams", 0, 5);
        var e10 = new BestEffortComputed(10.0, 3200, 2, "10k", now, "streams", 0, 10);

        var ok = PredictionMath.TryCalibrateExponent(e5, e10, out var exponent);

        Assert.True(ok);
        Assert.InRange(exponent, 1.04, 1.12);
    }

    [Fact]
    public void BuildConfidence_ScoresHighForRecentStream10k()
    {
        var reference = new BestEffortComputed(10.0, 3600, 1, "10k", DateTime.UtcNow.AddDays(-10), "streams", 0, 10);
        var reasons = new List<string>();

        var confidence = PredictionMath.BuildConfidence(reference, DateTime.UtcNow, calibrated: true, reasons);

        Assert.Equal("high", confidence.level);
        Assert.Equal(100, confidence.score);
    }
}
