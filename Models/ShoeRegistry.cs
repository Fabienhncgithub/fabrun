namespace FabRun.Api.Models;

/// <summary>A pair of shoes. InitialKm is mileage done before FabRun tracked it (e.g. typed in by hand).</summary>
public record ShoeEntry(string Id, string Name, string? Brand, string? Model, double InitialKm, bool Retired);

/// <summary>
/// Shoes and which pair each activity used. Garmin's API exposes no gear, so FabRun owns this.
/// An assignment present with a null value means "no shoe" and is never overwritten by the default.
/// </summary>
public record ShoeRegistry(
    string? DefaultShoeId,
    List<ShoeEntry> Shoes,
    Dictionary<string, string?> Assignments)
{
    public static ShoeRegistry Empty() => new(null, new List<ShoeEntry>(), new Dictionary<string, string?>());
}
