using System.Text.Json;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Infrastructure.Persistence;

public class FileSleepRepository : ISleepRepository
{
    private readonly string _storePath;
    private readonly ILogger<FileSleepRepository> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public FileSleepRepository(IConfiguration cfg, IWebHostEnvironment env, ILogger<FileSleepRepository> logger)
    {
        _logger = logger;
        var configured = cfg["HealthSleep:StorePath"];
        var rel = string.IsNullOrWhiteSpace(configured) ? "Data/health-sleep.json" : configured;
        _storePath = Path.IsPathRooted(rel) ? rel : Path.Combine(env.ContentRootPath, rel);
        SecureFileStorage.HardenExistingFile(_storePath);
    }

    public async Task<List<SleepSession>> LoadAsync(long athleteId)
    {
        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllAsync();
            return all.TryGetValue(athleteId, out var sessions) ? sessions : new List<SleepSession>();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task SaveAsync(long athleteId, List<SleepSession> sessions)
    {
        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllAsync();
            all[athleteId] = sessions;
            await SaveAllAsync(all);
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<Dictionary<long, List<SleepSession>>> LoadAllAsync()
    {
        if (!File.Exists(_storePath)) return new Dictionary<long, List<SleepSession>>();
        try
        {
            await using var stream = File.OpenRead(_storePath);
            return await JsonSerializer.DeserializeAsync<Dictionary<long, List<SleepSession>>>(stream, JsonOptions)
                   ?? new Dictionary<long, List<SleepSession>>();
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogError(ex, "Failed to read sleep store at {Path}.", _storePath);
            throw new InvalidDataException("The sleep store cannot be read safely.", ex);
        }
    }

    private async Task SaveAllAsync(Dictionary<long, List<SleepSession>> data)
    {
        await SecureFileStorage.WriteJsonAtomicallyAsync(_storePath, data, JsonOptions);
    }
}
