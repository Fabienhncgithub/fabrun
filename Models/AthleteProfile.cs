using System.Text.Json.Serialization;

namespace FabRun.Api.Models;

public record AthleteProfile(
    [property: JsonPropertyName("id")] long id,
    [property: JsonPropertyName("username")] string? username,
    [property: JsonPropertyName("firstname")] string? firstname,
    [property: JsonPropertyName("lastname")] string? lastname,
    [property: JsonPropertyName("sex")] string? sex,
    [property: JsonPropertyName("weight")] double? weight,
    [property: JsonPropertyName("city")] string? city,
    [property: JsonPropertyName("state")] string? state,
    [property: JsonPropertyName("country")] string? country,
    [property: JsonPropertyName("profile")] string? profile,
    [property: JsonPropertyName("profile_medium")] string? profile_medium,
    [property: JsonPropertyName("created_at")] DateTime? created_at
);
