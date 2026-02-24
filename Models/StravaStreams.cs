namespace FabRun.Api.Models;

public class StravaStream
{
    public List<double>? data { get; set; }
}

public class StravaStreams
{
    public StravaStream? distance { get; set; }
    public StravaStream? time { get; set; }
}
