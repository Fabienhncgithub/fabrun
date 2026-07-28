using System.Text.Json;

namespace FabRun.Api.Infrastructure.Persistence;

internal static class SecureFileStorage
{
    private const UnixFileMode DirectoryMode =
        UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
    private const UnixFileMode FileMode =
        UnixFileMode.UserRead | UnixFileMode.UserWrite;

    public static void HardenExistingFile(string path)
    {
        if (!OperatingSystem.IsWindows() && File.Exists(path))
        {
            File.SetUnixFileMode(path, FileMode);
        }
    }

    public static async Task WriteJsonAtomicallyAsync<T>(
        string path,
        T value,
        JsonSerializerOptions options)
    {
        var directory = Path.GetDirectoryName(path)
            ?? throw new InvalidOperationException("The storage path must have a parent directory.");
        Directory.CreateDirectory(directory);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(directory, DirectoryMode);
        }

        var temporaryPath = Path.Combine(
            directory,
            $".{Path.GetFileName(path)}.{Guid.NewGuid():N}.tmp");

        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                System.IO.FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 16 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(stream, value, options);
                await stream.FlushAsync();
            }

            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(temporaryPath, FileMode);
            }

            File.Move(temporaryPath, path, overwrite: true);
            HardenExistingFile(path);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }
}
