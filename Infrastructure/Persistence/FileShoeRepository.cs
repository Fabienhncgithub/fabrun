using System.Text.Json;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Infrastructure.Persistence;

public class FileShoeRepository : IShoeRepository
{
    private readonly string _storePath;
    private readonly ILogger<FileShoeRepository> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true
    };

    public FileShoeRepository(IConfiguration cfg, IWebHostEnvironment env, ILogger<FileShoeRepository> logger)
    {
        _logger = logger;
        var configured = cfg["Shoes:StorePath"];
        var rel = string.IsNullOrWhiteSpace(configured) ? "Data/shoes.json" : configured;
        _storePath = Path.IsPathRooted(rel) ? rel : Path.Combine(env.ContentRootPath, rel);
        SecureFileStorage.HardenExistingFile(_storePath);
    }

    public async Task<ShoeRegistry> LoadAsync()
    {
        if (!File.Exists(_storePath)) return ShoeRegistry.Empty();
        try
        {
            await using var stream = File.OpenRead(_storePath);
            var registry = await JsonSerializer.DeserializeAsync<ShoeRegistry>(stream, JsonOptions);
            return registry is null
                ? ShoeRegistry.Empty()
                : registry with
                {
                    Shoes = registry.Shoes ?? new List<ShoeEntry>(),
                    Assignments = registry.Assignments ?? new Dictionary<string, string?>()
                };
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogError(ex, "Failed to read shoe store at {Path}.", _storePath);
            throw new InvalidDataException("The shoe store cannot be read safely.", ex);
        }
    }

    public Task SaveAsync(ShoeRegistry registry)
        => SecureFileStorage.WriteJsonAtomicallyAsync(_storePath, registry, JsonOptions);
}
