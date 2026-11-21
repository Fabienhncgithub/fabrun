using System.Text.Json.Serialization;

namespace FabRun.Api.Models;

public record ProfileShoe(
    [property: JsonPropertyName("id")] string? id,
    [property: JsonPropertyName("name")] string? name,
    [property: JsonPropertyName("distance")] double? distance,
    [property: JsonPropertyName("converted_distance")] double? converted_distance,
    [property: JsonPropertyName("brand")] string? brand = null,
    [property: JsonPropertyName("retired")] bool retired = false,
    [property: JsonPropertyName("is_default")] bool is_default = false
);
