using System;
using System.IO;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Logging;
using Jellyfin.Plugin.JMSFusion.Controllers;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    public sealed class ImageShieldService : IDisposable
    {
        private readonly ILibraryManager _libraryManager;
        private readonly IApplicationPaths _appPaths;
        private readonly ILogger<ImageShieldService> _logger;
        private bool _isInitialized;

        public ImageShieldService(
            ILibraryManager libraryManager,
            IApplicationPaths appPaths,
            ILogger<ImageShieldService> logger)
        {
            _libraryManager = libraryManager;
            _appPaths = appPaths;
            _logger = logger;
        }

        public void Initialize()
        {
            if (_isInitialized) return;
            _isInitialized = true;

            try
            {
                _libraryManager.ItemUpdated += OnItemUpdated;
                _logger.LogInformation("[Nexus Image Shield] Serviço de proteção automática de capas inicializado com sucesso.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Nexus Image Shield] Erro ao registrar listener de ItemUpdated: {Message}", ex.Message);
            }
        }

        private void OnItemUpdated(object? sender, ItemChangeEventArgs e)
        {
            try
            {
                if (e.Item == null) return;

                // Verifica se a atualização envolveu modificação de imagem
                if (e.UpdateReason.HasFlag(ItemUpdateType.ImageUpdate))
                {
                    var item = e.Item;
                    _logger.LogInformation("[Nexus Image Shield] ⚡ Detectada atualização manual de capa na obra: '{Name}' (ID: {Id})", item.Name, item.Id);

                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            // Pequeno delay para garantir que o Jellyfin finalizou a gravação da imagem
                            await Task.Delay(1200);
                            var freshItem = _libraryManager.GetItemById(item.Id) ?? item;
                            await ImageLockController.LockItemInternalAsync(freshItem, _libraryManager, _appPaths, _logger);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "[Nexus Image Shield] Falha ao travar capa automaticamente para {Id}: {Message}", item.Id, ex.Message);
                        }
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Nexus Image Shield] Erro ao inspecionar ItemUpdated: {Message}", ex.Message);
            }
        }

        public void Dispose()
        {
            try
            {
                _libraryManager.ItemUpdated -= OnItemUpdated;
            }
            catch { }
        }
    }
}
