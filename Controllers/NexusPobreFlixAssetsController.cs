using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using IOFile = System.IO.File;

namespace Jellyfin.Plugin.NexusPobreFlix.Controllers
{
    [ApiController]
    [Route("Plugins/NexusPobreFlix/assets")]
    public class NexusPobreFlixAssetsController : ControllerBase
    {
        private readonly ILogger<NexusPobreFlixAssetsController> _logger;
        public NexusPobreFlixAssetsController(ILogger<NexusPobreFlixAssetsController> logger) => _logger = logger;

        [HttpGet("ui.js")]
        public IActionResult GetUiJs() => ServeEmbeddedJavascript("assets:ui-js", "Web.ui.js", "ui.js error");

        [HttpGet("settings.js")]
        public IActionResult GetWebSettingsJs() => ServeEmbeddedJavascript("assets:web-settings-js", "Web.settings.js", "settings.js error");

        [HttpGet("storage-preload.js")]
        public IActionResult GetStoragePreloadJs() => ServeEmbeddedJavascript("assets:storage-preload-js", "RuntimeModules.storagePreload.js", "storagePreload.js error");

        [HttpGet("api.js")]
        public IActionResult GetApiJs() => ServeEmbeddedJavascript("assets:api-js", "RuntimeModules.api.js", "api.js error");

        [HttpGet("auth.js")]
        public IActionResult GetAuthJs() => ServeEmbeddedJavascript("assets:auth-js", "RuntimeModules.auth.js", "auth.js error");

        private IActionResult ServeEmbeddedJavascript(string cacheKey, string resourcePath, string errorLogMessage)
        {
            try
            {
                if (AssetVersioning.TryHandleConditionalGet(HttpContext, cacheKey))
                {
                    return StatusCode(304);
                }

                var asm = typeof(NexusPobreFlixPlugin).Assembly;
                var resName = $"Jellyfin.Plugin.NexusPobreFlix.{resourcePath}";

                using var stream = asm.GetManifestResourceStream(resName);
                if (stream == null)
                {
                    _logger.LogWarning("[NexusPobreFlix] Recurso não encontrado: {ResourceName}", resName);
                    return NotFound();
                }

                using var ms = new MemoryStream();
                stream.CopyTo(ms);
                return File(ms.ToArray(), "application/javascript; charset=utf-8");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, errorLogMessage);
                return StatusCode(500, "Internal server error");
            }
        }
    }
}
