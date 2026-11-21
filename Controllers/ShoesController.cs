using System.ComponentModel.DataAnnotations;
using FabRun.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FabRun.Api.Controllers;

[ApiController]
[Route("api/shoes")]
public class ShoesController(ShoeService shoes, ActivityService activities) : ControllerBase
{
    private static readonly HashSet<string> KnownBrands = AthleteSettingsController.KnownBrands;

    [HttpPost]
    public async Task<IActionResult> Add([FromBody] AddShoeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Donne un nom à la paire." });
        var brand = string.IsNullOrWhiteSpace(request.Brand) ? null : request.Brand;
        if (brand is not null && !KnownBrands.Contains(brand))
            return BadRequest(new { error = "Marque non reconnue." });
        var shoe = await shoes.AddAsync(request.Name, brand, request.InitialKm, request.MakeDefault);
        return Ok(shoe);
    }

    [HttpPut("default")]
    public async Task<IActionResult> SetDefault([FromBody] DefaultShoeRequest request)
        => await shoes.SetDefaultAsync(request.ShoeId)
            ? NoContent()
            : BadRequest(new { error = "Cette paire n’existe pas ou est retirée." });

    [HttpPut("{shoeId}/retired")]
    public async Task<IActionResult> SetRetired(string shoeId, [FromBody] RetireShoeRequest request)
        => await shoes.SetRetiredAsync(shoeId, request.Retired) ? NoContent() : NotFound(new { error = "Paire introuvable." });

    [HttpPut("/api/activities/{activityId:long}/shoe")]
    public async Task<IActionResult> Assign(long activityId, [FromBody] AssignShoeRequest request, CancellationToken cancellationToken)
    {
        var all = await activities.AllAsync(false, cancellationToken);
        var activity = all.FirstOrDefault(a => a.id == activityId);
        if (activity is null) return NotFound(new { error = "Activité introuvable." });
        if (!ShoeService.IsRun(activity)) return BadRequest(new { error = "Seules les courses ont une chaussure." });
        return await shoes.AssignAsync(activityId, request.ShoeId)
            ? NoContent()
            : BadRequest(new { error = "Cette paire n’existe pas." });
    }
}

public record AddShoeRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Name,
    [StringLength(32)] string? Brand,
    [Range(0, 5000)] double InitialKm = 0,
    bool MakeDefault = false);
public record DefaultShoeRequest([StringLength(64)] string? ShoeId);
public record RetireShoeRequest(bool Retired);
public record AssignShoeRequest([StringLength(64)] string? ShoeId);
