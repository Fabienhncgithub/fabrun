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
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read best-efforts store at {Path}. Starting fresh.", _storePath);
            return new Dictionary<long, BestEffortSnapshot>();
        }
    }

    private async Task SaveAllAsync(Dictionary<long, BestEffortSnapshot> data)
    {
        var dir = Path.GetDirectoryName(_storePath);
        if (!string.IsNullOrWhiteSpace(dir))
        {
            Directory.CreateDirectory(dir);
        }

        await using var stream = File.Create(_storePath);
        await JsonSerializer.SerializeAsync(stream, data, JsonOptions);
    }
}
