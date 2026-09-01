using System.Text.Json;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Infrastructure.Persistence;

public class FileAthleteSettingsRepository : IAthleteSettingsRepository
{
    private readonly string _storePath;
    private readonly ILogger<FileAthleteSettingsRepository> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public FileAthleteSettingsRepository(IConfiguration cfg, IWebHostEnvironment env, ILogger<FileAthleteSettingsRepository> logger)
    {
        _logger = logger;
        var configured = cfg["AthleteSettings:StorePath"];
        var rel = string.IsNullOrWhiteSpace(configured) ? "Data/athlete-settings.json" : configured;
        _storePath = Path.IsPathRooted(rel) ? rel : Path.Combine(env.ContentRootPath, rel);
        SecureFileStorage.HardenExistingFile(_storePath);
    }

    public async Task<AthleteSettings?> LoadAsync(long athleteId)
    {
        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllAsync();
            return all.TryGetValue(athleteId, out var settings) ? settings : null;
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task SaveAsync(long athleteId, AthleteSettings settings)
    {
        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllAsync();
            all[athleteId] = settings;
            await SecureFileStorage.WriteJsonAtomicallyAsync(_storePath, all, JsonOptions);
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<Dictionary<long, AthleteSettings>> LoadAllAsync()
    {
        if (!File.Exists(_storePath)) return new Dictionary<long, AthleteSettings>();
        try
        {
            await using var stream = File.OpenRead(_storePath);
            return await JsonSerializer.DeserializeAsync<Dictionary<long, AthleteSettings>>(stream, JsonOptions)
                   ?? new Dictionary<long, AthleteSettings>();
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogError(ex, "Failed to read athlete settings store at {Path}.", _storePath);
            throw new InvalidDataException("The athlete settings store cannot be read safely.", ex);
        }
    }
}
