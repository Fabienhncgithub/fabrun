using System.Text.Json;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Infrastructure.Persistence;

public class FileBestEffortsRepository : IBestEffortsRepository
{
    private readonly string _storePath;
    private readonly ILogger<FileBestEffortsRepository> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public FileBestEffortsRepository(IConfiguration cfg, IWebHostEnvironment env, ILogger<FileBestEffortsRepository> logger)
    {
        _logger = logger;
        var configured = cfg["BestEfforts:StorePath"];
        var rel = string.IsNullOrWhiteSpace(configured) ? "Data/best-efforts.json" : configured;
        _storePath = Path.IsPathRooted(rel) ? rel : Path.Combine(env.ContentRootPath, rel);
        SecureFileStorage.HardenExistingFile(_storePath);
    }

    public async Task<BestEffortSnapshot?> LoadAsync(long athleteId)
    {
        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllAsync();
            return all.TryGetValue(athleteId, out var snap) ? snap : null;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task SaveAsync(long athleteId, BestEffortSnapshot snapshot)
    {
        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllAsync();
            all[athleteId] = snapshot;
            await SaveAllAsync(all);
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<Dictionary<long, BestEffortSnapshot>> LoadAllAsync()
    {
        if (!File.Exists(_storePath)) return new Dictionary<long, BestEffortSnapshot>();
        try
        {
            await using var stream = File.OpenRead(_storePath);
            return await JsonSerializer.DeserializeAsync<Dictionary<long, BestEffortSnapshot>>(stream, JsonOptions)
                   ?? new Dictionary<long, BestEffortSnapshot>();
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogError(ex, "Failed to read best-efforts store at {Path}.", _storePath);
            throw new InvalidDataException("The best-efforts store cannot be read safely.", ex);
        }
    }

    private async Task SaveAllAsync(Dictionary<long, BestEffortSnapshot> data)
    {
        await SecureFileStorage.WriteJsonAtomicallyAsync(_storePath, data, JsonOptions);
    }
}
