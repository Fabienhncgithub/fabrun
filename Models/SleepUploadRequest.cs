using System.ComponentModel.DataAnnotations;

namespace FabRun.Api.Models;

public record SleepUploadRequest(
    [Required]
    [MinLength(1)]
    [MaxLength(400)]
    List<SleepSessionInput> sessions);

public record SleepSessionInput(
    DateTimeOffset startUtc,
    DateTimeOffset endUtc,
    [Required]
    [StringLength(64, MinimumLength = 1)]
    string? source
);
