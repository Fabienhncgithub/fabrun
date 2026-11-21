using FabRun.Api.Models;

namespace FabRun.Api.Abstractions.Persistence;

public interface IShoeRepository
{
    Task<ShoeRegistry> LoadAsync();
    Task SaveAsync(ShoeRegistry registry);
}
