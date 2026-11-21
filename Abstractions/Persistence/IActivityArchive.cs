using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.Persistence;

public interface IActivityArchive
{
    /// <summary>Null when no archive was imported.</summary>
    Task<ActivityArchive?> LoadAsync();
}
