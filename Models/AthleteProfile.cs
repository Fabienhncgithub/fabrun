using System.Text.Json.Serialization;

namespace FabRun.Api.Models;

/// <summary>Owner of this private instance. Weight comes from Garmin on the client side.</summary>
public record AthleteProfile(
    [property: JsonPropertyName("id")] long id,
    [property: JsonPropertyName("shoes")] List<ProfileShoe> shoes
);
