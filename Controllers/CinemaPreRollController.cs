using Jellyfin.Plugin.JMSFusion.Core;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers;

[ApiController]
[Route("JMSFusion/cinema-preroll")]
[Route("Plugins/JMSFusion/cinema-preroll")]
public class CinemaPreRollController : ControllerBase
{
    private readonly CinemaPreRollCacheService _cacheService;

    public CinemaPreRollController(CinemaPreRollCacheService cacheService)
    {
        _cacheService = cacheService;
    }

    [HttpGet("cache")]
    public async Task<IActionResult> GetCache(
        [FromQuery] string? language,
        [FromQuery] string? region,
        [FromQuery] string? regionMode,
        [FromQuery] bool force,
        CancellationToken ct)
    {
        var snapshot = await _cacheService.GetSnapshotAsync(language, region, regionMode, force, ct).ConfigureAwait(false);
        NoCache();
        return Ok(snapshot);
    }

    private void NoCache()
    {
        Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
        Response.Headers["Pragma"] = "no-cache";
        Response.Headers["Expires"] = "0";
    }
}
