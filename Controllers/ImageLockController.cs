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
            EnsureCacheLoaded(_appPaths, _logger);
        }

        public static string GetStorageDir(IApplicationPaths appPaths)
        {
            var dir = Path.Combine(appPaths.DataPath, "JMSFusion", "locked_images");
            Directory.CreateDirectory(dir);
            return dir;
        }

        public static string GetRegistryFile(IApplicationPaths appPaths)
        {
            var dir = Path.Combine(appPaths.DataPath, "JMSFusion");
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, "locked_images.json");
        }

        public static void EnsureCacheLoaded(IApplicationPaths appPaths, ILogger? logger = null)
        {
            if (_cacheLoaded) return;
            lock (_fileLock)
            {
                if (_cacheLoaded) return;
                try
                {
                    var file = GetRegistryFile(appPaths);
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
                    logger?.LogError(ex, "[Nexus PobreFlix] Erro ao carregar registry de imagens travadas: {Message}", ex.Message);
                }
                finally
                {
                    _cacheLoaded = true;
                }
            }
        }

        public static void SaveRegistry(IApplicationPaths appPaths, ILogger? logger = null)
        {
            lock (_fileLock)
            {
                try
                {
                    var file = GetRegistryFile(appPaths);
                    var list = _lockedCache.Values.ToList();
                    var json = JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true });
                    IOFile.WriteAllText(file, json);
                }
                catch (Exception ex)
                {
                    logger?.LogError(ex, "[Nexus PobreFlix] Erro ao salvar registry de imagens travadas: {Message}", ex.Message);
                }
            }
        }

        public static bool IsLocked(string cleanId)
        {
            if (string.IsNullOrWhiteSpace(cleanId)) return false;
            var id = cleanId.Trim().Replace("-", "");
            return _lockedCache.ContainsKey(id);
        }

        [HttpGet("List")]
        public IActionResult GetLockedList()
        {
            EnsureCacheLoaded(_appPaths, _logger);
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
            EnsureCacheLoaded(_appPaths, _logger);
            var cleanId = (itemId ?? string.Empty).Trim().Replace("-", "");

            if (_lockedCache.TryGetValue(cleanId, out var info) && IOFile.Exists(info.ImagePath))
            {
                Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                return PhysicalFile(info.ImagePath, "image/jpeg");
            }

            var fallbackPath = Path.Combine(GetStorageDir(_appPaths), $"{cleanId}.jpg");
            if (IOFile.Exists(fallbackPath))
            {
                Response.Headers["Cache-Control"] = "public, max-age=31536000, immutable";
                return PhysicalFile(fallbackPath, "image/jpeg");
            }

            return NotFound();
        }

        public static async Task<LockedImageInfo?> LockItemInternalAsync(
            BaseItem item,
            ILibraryManager? libraryManager,
            IApplicationPaths appPaths,
            ILogger? logger)
        {
            try
            {
                EnsureCacheLoaded(appPaths, logger);

                var cleanId = item.Id.ToString("N");
                var title = item.Name ?? cleanId;
                byte[]? imageBytes = null;

                // 1. Tenta obter arquivo local da imagem primária
                var localImgPath = item.GetImagePath(ImageType.Primary);
                if (!string.IsNullOrWhiteSpace(localImgPath) && IOFile.Exists(localImgPath))
                {
                    imageBytes = await IOFile.ReadAllBytesAsync(localImgPath);
                    logger?.LogInformation("[Nexus Image Shield] Imagem lida do caminho local: {Path}", localImgPath);
                }

                // 2. Se falhar ou estiver vazio, tenta via API local interna do Jellyfin
                if (imageBytes == null || imageBytes.Length < 1000)
                {
                    try
                    {
                        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                        var downloadUrl = $"http://localhost:8096/Items/{item.Id}/Images/Primary";
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
                        logger?.LogWarning(ex, "[Nexus Image Shield] Falha ao baixar imagem via HTTP interno: {Message}", ex.Message);
                    }
                }

                if (imageBytes == null || imageBytes.Length < 1000)
                {
                    logger?.LogWarning("[Nexus Image Shield] Nenhum dado de imagem válido encontrado para o item: {Name} ({Id})", title, cleanId);
                    return null;
                }

                var storageDir = GetStorageDir(appPaths);
                var targetFilePath = Path.Combine(storageDir, $"{cleanId}.jpg");
                await IOFile.WriteAllBytesAsync(targetFilePath, imageBytes);

                // Também assegura poster.jpg na pasta física da obra se existir
                try
                {
                    var names = Enum.GetNames<MetadataField>();
                    logger?.LogInformation("[Nexus Image Shield] MetadataFields: {Fields}", string.Join(", ", names));
                }
                catch { }

                try
                {
                    var folder = item.ContainingFolderPath;
                    if (!string.IsNullOrWhiteSpace(folder) && Directory.Exists(folder))
                    {
                        var posterLocal = Path.Combine(folder, "poster.jpg");
                        await IOFile.WriteAllBytesAsync(posterLocal, imageBytes);
                    }
                }
                catch { }

                var info = new LockedImageInfo
                {
                    ItemId = cleanId,
                    ItemTitle = title,
                    LockedAt = DateTime.UtcNow,
                    ImagePath = targetFilePath
                };

                _lockedCache[cleanId] = info;
                SaveRegistry(appPaths, logger);

                logger?.LogInformation("[Nexus Image Shield] 🔒 Capa travada com sucesso para '{Title}' (ID: {Id})!", title, cleanId);
                return info;
            }
            catch (Exception ex)
            {
                logger?.LogError(ex, "[Nexus Image Shield] Erro ao travar capa do item {Id}: {Message}", item.Id, ex.Message);
                return null;
            }
        }

        [HttpPost("Lock")]
        public async Task<IActionResult> LockItemImage([FromBody] LockImageRequest req)
        {
            if (string.IsNullOrWhiteSpace(req.ItemId))
            {
                return BadRequest(new { success = false, message = "ItemId obrigatório." });
            }

            var cleanId = req.ItemId.Trim().Replace("-", "");

            if (Guid.TryParse(req.ItemId, out var guid))
            {
                var item = _libraryManager.GetItemById(guid);
                if (item != null)
                {
                    var locked = await LockItemInternalAsync(item, _libraryManager, _appPaths, _logger);
                    if (locked != null)
                    {
                        return Ok(new
                        {
                            success = true,
                            message = $"Capa de '{locked.ItemTitle}' travada com sucesso!",
                            item = locked
                        });
                    }
                }
            }

            // Fallback caso não ache o BaseItem no libraryManager mas tenha recebido via URL
            byte[]? imageBytes = null;
            string title = req.ItemTitle ?? cleanId;

            if (!string.IsNullOrWhiteSpace(req.ImageUrl))
            {
                try
                {
                    using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
                    var resp = await client.GetAsync(req.ImageUrl);
                    if (resp.IsSuccessStatusCode)
                    {
                        var downloaded = await resp.Content.ReadAsByteArrayAsync();
                        if (downloaded.Length > 1000) imageBytes = downloaded;
                    }
                }
                catch { }
            }

            if (imageBytes != null && imageBytes.Length > 1000)
            {
                var targetFilePath = Path.Combine(GetStorageDir(_appPaths), $"{cleanId}.jpg");
                await IOFile.WriteAllBytesAsync(targetFilePath, imageBytes);

                var info = new LockedImageInfo
                {
                    ItemId = cleanId,
                    ItemTitle = title,
                    LockedAt = DateTime.UtcNow,
                    ImagePath = targetFilePath
                };

                _lockedCache[cleanId] = info;
                SaveRegistry(_appPaths, _logger);

                return Ok(new
                {
                    success = true,
                    message = $"Capa de '{title}' travada com sucesso contra alterações automáticas!",
                    item = info
                });
            }

            return BadRequest(new { success = false, message = "Não foi possível obter os dados da imagem para travamento." });
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

            EnsureCacheLoaded(_appPaths, _logger);
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

                SaveRegistry(_appPaths, _logger);
                _logger.LogInformation("[Nexus PobreFlix] 🔓 Capa destravada para ID {Id}", idToUnlock);
                return Ok(new { success = true, message = $"Capa de '{info.ItemTitle}' destravada com sucesso!" });
            }

            return Ok(new { success = true, message = "Item já não estava travado." });
        }
    }
}
