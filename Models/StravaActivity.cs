using System.Text.Json.Serialization;

namespace FabRun.Api.Models;

public class StravaActivity
{
    [JsonPropertyName("id")]
    public long Id { get; set; }

    [JsonPropertyName("name")]
    public string? Name { get; set; }

    // Vieux champ "type" et nouveau "sport_type" (on garde les deux)
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("sport_type")]
    public string? SportType { get; set; }

    // mètres
    [JsonPropertyName("distance")]
    public double Distance { get; set; }

    // secondes
    [JsonPropertyName("moving_time")]
    public int MovingTime { get; set; }

    [JsonPropertyName("start_date_local")]
    public DateTime StartDateLocal { get; set; }

    [JsonPropertyName("average_speed")]
    public double? AverageSpeed { get; set; }
}
