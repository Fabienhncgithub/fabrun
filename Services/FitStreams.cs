using System.IO.Compression;
using Dynastream.Fit;

namespace FabRun.Api.Services;

/// <summary>Cumulative distance (m) and elapsed time (s) samples, same shape as the old Strava streams.</summary>
public record DistanceStream(double[] Distance, double[] Time);

public static class FitStreams
{
    private const long MaxFitBytes = 32 * 1024 * 1024;

    /// <summary>Garmin returns the original file zipped. Non-FIT content (GPX/TCX uploads) yields null.</summary>
    public static DistanceStream? FromZip(byte[] zip)
    {
        try
        {
            using var archive = new ZipArchive(new MemoryStream(zip), ZipArchiveMode.Read);
            var entry = archive.Entries.FirstOrDefault(e => e.FullName.EndsWith(".fit", StringComparison.OrdinalIgnoreCase));
            if (entry is null || entry.Length > MaxFitBytes) return null;
            using var input = entry.Open();
            using var buffer = new MemoryStream();
            input.CopyTo(buffer);
            buffer.Position = 0;
            return FromFit(buffer);
        }
        catch (InvalidDataException) { return null; }
    }

    public static DistanceStream? FromFit(Stream fit)
    {
        var decode = new Decode();
        if (!decode.IsFIT(fit)) return null;
        fit.Position = 0;
        var samples = new List<(uint Time, double Distance)>();
        var broadcaster = new MesgBroadcaster();
        broadcaster.RecordMesgEvent += (_, e) =>
        {
            var record = (RecordMesg)e.mesg;
            var distance = record.GetDistance();
            var timestamp = record.GetTimestamp();
            if (distance is { } d && float.IsFinite(d) && d >= 0 && timestamp is not null)
                samples.Add((timestamp.GetTimeStamp(), d));
        };
        decode.MesgEvent += broadcaster.OnMesg;
        try
        {
            if (!decode.Read(fit)) return null;
        }
        catch (FitException) { return null; }
        return Build(samples);
    }

    /// <summary>Sorts by time and drops samples where distance goes backwards, so sliding windows stay valid.</summary>
    internal static DistanceStream? Build(IEnumerable<(uint Time, double Distance)> samples)
    {
        var ordered = samples.OrderBy(s => s.Time).ToList();
        if (ordered.Count < 2) return null;
        var start = ordered[0].Time;
        var distance = new List<double>();
        var time = new List<double>();
        foreach (var (t, d) in ordered)
        {
            if (distance.Count > 0 && (d < distance[^1] || t - start == time[^1])) continue;
            distance.Add(d);
            time.Add(t - start);
        }
        return distance.Count < 2 ? null : new DistanceStream(distance.ToArray(), time.ToArray());
    }
}
