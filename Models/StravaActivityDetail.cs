namespace FabRun.Api.Models;

public class StravaActivityDetail
{
    public long id { get; set; }
    public string? name { get; set; }
    public string? sport_type { get; set; }
    public double distance { get; set; }
    public int moving_time { get; set; }
    public int elapsed_time { get; set; }
    public string start_date_local { get; set; } = "";
    public List<StravaSplit>? splits_standard { get; set; }
}
