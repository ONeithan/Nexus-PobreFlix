using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using IOFile = System.IO.File;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    public class LockImageRequest
    {
        [JsonPropertyName("itemId")]
        public string ItemId { get; set; } = string.Empty;

        [JsonPropertyName("itemTitle")]
        public string? ItemTitle { get; set; }

        [JsonPropertyName("imageUrl")]
        public string? ImageUrl { get; set; }
    }

    public class LockedImageInfo
    {
        [JsonPropertyName("itemId")]
        public string ItemId { get; set; } = string.Empty;

        [JsonPropertyName("itemTitle")]
        public string ItemTitle { get; set; } = string.Empty;

        [JsonPropertyName("lockedAt")]
        public DateTime LockedAt { get; set; } = DateTime.UtcNow;

        [JsonPropertyName("imagePath")]
        public string ImagePath { get; set; } = string.Empty;
    }

    [ApiController]
    [Route("Plugins/JMSFusion/Images")]
    public class ImageLockController : ControllerBase
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IApplicationPaths _appPaths;
        private readonly ILogger<ImageLockController> _logger;
        private static readonly ConcurrentDictionary<string, LockedImageInfo> _lockedCache = new();
        private static bool _cacheLoaded = false;
        private static readonly object _fileLock = new();

        public ImageLockController(
            ILibraryManager libraryManager,
            IApplicationPaths appPaths,
            ILogger<ImageLockController> logger)
        {
            _libraryManager = libraryManager;
            _appPaths = appPaths;
            _logger = logger;
            EnsureCacheLoaded();
        }

        private string GetStorageDir()
        {
            var dir = Path.Combine(_appPaths.DataPath, "JMSFusion", "locked_images");
            Directory.CreateDirectory(dir);
            return dir;
        }

        private string GetRegistryFile()
        {
            var dir = Path.Combine(_appPaths.DataPath, "JMSFusion");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "locked_images.json");
        }

        private void EnsureCacheLoaded()
        {
            if (_cacheLoaded) return;
            lock (_fileLock)
            {
                if (_cacheLoaded) return;
                try
                {
                    var file = GetRegistryFile();
                    if (IOFile.Exists(file))
                    {
                        var json = IOFile.ReadAllText(file);
                        var list = JsonSerializer.Deserialize<List<LockedImageInfo>>(json);
                        if (list != null)
                        {
                            foreach (var item in list)
                            {
                                if (IOFile.Exists(item.ImagePath))
                                {
                                    _lockedCache[item.ItemId] = item;
                                }
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Nexus PobreFlix] Erro ao carregar registry de imagens travadas: {Message}", ex.Message);
                }
                finally
                {
                    _cacheLoaded = true;
                }
            }
        }

        private void SaveRegistry()
        {
            lock (_fileLock)
            {
                try
                {
                    var file = GetRegistryFile();
                    var list = _lockedCache.Values.ToList();
                    var json = JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true });
                    IOFile.WriteAllText(file, json);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[Nexus PobreFlix] Erro ao salvar registry de imagens travadas: {Message}", ex.Message);
                }
            }
        }

        [HttpGet("List")]
        public IActionResult GetLockedList()
        {
            EnsureCacheLoaded();
            return Ok(new
            {
                success = true,
                count = _lockedCache.Count,
                items = _lockedCache.Values.OrderByDescending(x => x.LockedAt).ToList()
            });
        }

        [HttpGet("Serve/{itemId}")]
        public IActionResult ServeLockedImage([FromRoute] string itemId)
        {
            EnsureCacheLoaded();
            if (_lockedCache.TryGetValue(itemId, out var info) && IOFile.Exists(info.ImagePath))
            {
                Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                return PhysicalFile(info.ImagePath, "image/jpeg");
            }

            var fallbackPath = Path.Combine(GetStorageDir(), $"{itemId}.jpg");
            if (IOFile.Exists(fallbackPath))
            {
                Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                return PhysicalFile(fallbackPath, "image/jpeg");
            }

            return NotFound();
        }

        [HttpPost("Lock")]
        public async Task<IActionResult> LockItemImage([FromBody] LockImageRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.ItemId))
            {
                return BadRequest(new { success = false, message = "ItemId obrigatório." });
            }

            var cleanId = req.ItemId.Trim().Replace("-", "");
            var storageDir = GetStorageDir();
            var targetFilePath = Path.Combine(storageDir, $"{cleanId}.jpg");

            byte[]? imageBytes = null;
            string title = req.ItemTitle ?? cleanId;

            // 1. Tenta obter a imagem original diretamente da biblioteca do Jellyfin
            try
            {
                if (Guid.TryParse(req.ItemId, out var guid))
                {
                    var item = _libraryManager.GetItemById(guid);
                    if (item != null)
                    {
                        title = item.Name ?? title;
                        var localImgPath = item.GetImagePath(ImageType.Primary);
                        if (!string.IsNullOrWhiteSpace(localImgPath) && IOFile.Exists(localImgPath))
                        {
                            imageBytes = await IOFile.ReadAllBytesAsync(localImgPath);
                            _logger.LogInformation("[Nexus PobreFlix] Imagem lida diretamente do arquivo local: {Path}", localImgPath);
                        }

                        // Protege arquivo local de capa se existir pasta física da obra
                        try
                        {
                            var folder = item.ContainingFolderPath;
                            if (!string.IsNullOrWhiteSpace(folder) && Directory.Exists(folder))
                            {
                                var posterLocal = Path.Combine(folder, "poster.jpg");
                                if (imageBytes != null && (!IOFile.Exists(posterLocal) || (await IOFile.ReadAllBytesAsync(posterLocal)).Length != imageBytes.Length))
                                {
                                    await IOFile.WriteAllBytesAsync(posterLocal, imageBytes);
                                }
                            }
                        }
                        catch { }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[Nexus PobreFlix] Falha ao extrair imagem do item localmente: {Message}", ex.Message);
            }

            // 2. Se não conseguiu localmente, baixa via URL fornecida ou endpoint interno do Jellyfin
            if (imageBytes == null || imageBytes.Length == 0)
            {
                try
                {
                    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                    var downloadUrl = !string.IsNullOrWhiteSpace(req.ImageUrl)
                        ? req.ImageUrl
                        : $"http://localhost:8096/Items/{req.ItemId}/Images/Primary";

                    var resp = await client.GetAsync(downloadUrl);
                    if (resp.IsSuccessStatusCode)
                    {
                        var downloaded = await resp.Content.ReadAsByteArrayAsync();
                        if (downloaded.Length > 1000)
                        {
                            imageBytes = downloaded;
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[Nexus PobreFlix] Falha ao baixar imagem via HTTP: {Message}", ex.Message);
                }
            }

            if (imageBytes == null || imageBytes.Length < 1000)
            {
                return BadRequest(new { success = false, message = "Não foi possível obter os dados da imagem para travamento." });
            }

            // Salva persistentemente no diretório protegido do plugin
            await IOFile.WriteAllBytesAsync(targetFilePath, imageBytes);

            var info = new LockedImageInfo
            {
                ItemId = cleanId,
                ItemTitle = title,
                LockedAt = DateTime.UtcNow,
                ImagePath = targetFilePath
            };

            _lockedCache[cleanId] = info;
            SaveRegistry();

            _logger.LogInformation("[Nexus PobreFlix] 🔒 Capa travada com sucesso para '{Title}' (ID: {Id})!", title, cleanId);

            return Ok(new
            {
                success = true,
                message = $"Capa de '{title}' travada com sucesso contra alterações automáticas!",
                item = info
            });
        }

        [HttpPost("Unlock")]
        [HttpDelete("Unlock/{itemId}")]
        public IActionResult UnlockItemImage([FromRoute] string? itemId, [FromBody] LockImageRequest? bodyReq)
        {
            var idToUnlock = (itemId ?? bodyReq?.ItemId ?? string.Empty).Trim().Replace("-", "");
            if (string.IsNullOrWhiteSpace(idToUnlock))
            {
                return BadRequest(new { success = false, message = "ItemId obrigatório." });
            }

            EnsureCacheLoaded();
            if (_lockedCache.TryRemove(idToUnlock, out var info))
            {
                try
                {
                    if (IOFile.Exists(info.ImagePath))
                    {
                        IOFile.Delete(info.ImagePath);
                    }
                }
                catch { }

                SaveRegistry();
                _logger.LogInformation("[Nexus PobreFlix] 🔓 Capa destravada para ID {Id}", idToUnlock);
                return Ok(new { success = true, message = $"Capa de '{info.ItemTitle}' destravada com sucesso!" });
            }

            return Ok(new { success = true, message = "Item já não estava travado." });
        }
    }
}
