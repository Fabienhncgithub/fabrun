using System.Text.Json.Serialization;

namespace FabRun.Api.Models;

public record ProfileShoe(
    [property: JsonPropertyName("id")] string? id,
    [property: JsonPropertyName("name")] string? name,
    [property: JsonPropertyName("distance")] double? distance,
    [property: JsonPropertyName("converted_distance")] double? converted_distance
);
