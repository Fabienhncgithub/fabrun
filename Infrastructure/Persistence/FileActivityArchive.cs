using System.Text.Json;
using FabRun.Api.Abstractions.Persistence;
using FabRun.Api.Models;

namespace FabRun.Api.Infrastructure.Persistence;

/// <summary>Read-only: the archive is written once by the import and never changes afterwards.</summary>
public class FileActivityArchive : IActivityArchive
{
    private readonly string _path;
    private readonly ILogger<FileActivityArchive> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private ActivityArchive? _loaded;
    private bool _read;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public FileActivityArchive(IConfiguration cfg, IWebHostEnvironment env, ILogger<FileActivityArchive> logger)
    {
        _logger = logger;
        var configured = cfg["ActivityArchive:Path"];
        var rel = string.IsNullOrWhiteSpace(configured) ? "Data/strava-archive.json" : configured;
        _path = Path.IsPathRooted(rel) ? rel : Path.Combine(env.ContentRootPath, rel);
        SecureFileStorage.HardenExistingFile(_path);
    }

    public async Task<ActivityArchive?> LoadAsync()
    {
        if (_read) return _loaded;
        await _lock.WaitAsync();
        try
        {
            if (_read) return _loaded;
            if (File.Exists(_path))
            {
                try
                {
                    await using var stream = File.OpenRead(_path);
                    _loaded = await JsonSerializer.DeserializeAsync<ActivityArchive>(stream, JsonOptions);
                }
                catch (Exception ex) when (ex is IOException or JsonException)
                {
                    _logger.LogError(ex, "Failed to read activity archive at {Path}.", _path);
                    throw new InvalidDataException("The activity archive cannot be read safely.", ex);
                }
            }
            _read = true;
            return _loaded;
        }
        finally { _lock.Release(); }
    }
}
