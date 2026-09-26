using System.Text.Json;
using FabRun.Api.Abstractions.Persistence;

namespace FabRun.Api.Infrastructure.Persistence;

public class FileActivityCaloriesRepository : IActivityCaloriesRepository
{
    private readonly string _storePath;
    private readonly ILogger<FileActivityCaloriesRepository> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        WriteIndented = true
    };

    public FileActivityCaloriesRepository(IConfiguration cfg, IWebHostEnvironment env, ILogger<FileActivityCaloriesRepository> logger)
    {
        _logger = logger;
        var configured = cfg["ActivityCalories:StorePath"];
        var rel = string.IsNullOrWhiteSpace(configured) ? "Data/activity-calories.json" : configured;
        _storePath = Path.IsPathRooted(rel) ? rel : Path.Combine(env.ContentRootPath, rel);
        SecureFileStorage.HardenExistingFile(_storePath);
    }

    public async Task<IReadOnlyDictionary<long, double>> LoadAllAsync()
    {
        await _lock.WaitAsync();
        try
        {
            return await LoadAllUnlockedAsync();
        }
        finally
        {
            _lock.Release();
        }
    }

    public async Task SaveManyAsync(IReadOnlyDictionary<long, double> caloriesByActivityId)
    {
        if (caloriesByActivityId.Count == 0) return;

        await _lock.WaitAsync();
        try
        {
            var all = await LoadAllUnlockedAsync();
            foreach (var (activityId, calories) in caloriesByActivityId)
            {
                all[activityId] = calories;
            }

            await SecureFileStorage.WriteJsonAtomicallyAsync(_storePath, all, JsonOptions);
        }
        finally
        {
            _lock.Release();
        }
    }

    private async Task<Dictionary<long, double>> LoadAllUnlockedAsync()
    {
        if (!File.Exists(_storePath)) return new Dictionary<long, double>();
        try
        {
            await using var stream = File.OpenRead(_storePath);
            return await JsonSerializer.DeserializeAsync<Dictionary<long, double>>(stream, JsonOptions)
                   ?? new Dictionary<long, double>();
        }
        catch (Exception ex) when (ex is IOException or JsonException)
        {
            _logger.LogError(ex, "Failed to read activity calories store at {Path}.", _storePath);
            throw new InvalidDataException("The activity calories store cannot be read safely.", ex);
        }
    }
}
