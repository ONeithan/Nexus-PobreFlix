using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Collections.Generic;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.Logging;
using Jellyfin.Plugin.JMSFusion.Core;

namespace Jellyfin.Plugin.JMSFusion
{
    public class JMSFusionPlugin : BasePlugin<JMSFusionConfiguration>, IHasWebPages
    {
        public override string Name => "Nexus PobreFlix";
        public override Guid Id => Guid.Parse("d9b7f2a1-3c4e-4f80-b6d2-9e1a5c0f8b34");
        public override string Description => "Plugin Nexus PobreFlix — Injeta experiência visual premium no Jellyfin com tema roxo, layout Netflix e localização PT-BR completa. Fork de JMSFusion por ONeithan.";

        private readonly ILogger<JMSFusionPlugin> _logger;
        private readonly IApplicationPaths _paths;
        private bool _lastPhysicalPatchFallbackEnabled;
        public static JMSFusionPlugin Instance { get; private set; } = null!;

        public JMSFusionPlugin(IApplicationPaths paths, IXmlSerializer xmlSerializer, ILoggerFactory loggerFactory)
            : base(paths, xmlSerializer)
        {
            _logger = loggerFactory.CreateLogger<JMSFusionPlugin>();
            _paths = paths;
            Instance = this;
            _lastPhysicalPatchFallbackEnabled = Configuration.EnablePhysicalIndexHtmlPatchFallback;

            ConfigurationChanged += (_, __) =>
            {
                _logger.LogInformation("[Nexus PobreFlix] Configuration changed.");
                var fallbackEnabled = Configuration.EnablePhysicalIndexHtmlPatchFallback;

                if (fallbackEnabled)
                {
                    TryPatchIndexHtml();
                }
                else if (_lastPhysicalPatchFallbackEnabled)
                {
                    TryUnpatchIndexHtml();
                }

                _lastPhysicalPatchFallbackEnabled = fallbackEnabled;
            };

            if (_lastPhysicalPatchFallbackEnabled)
            {
                TryPatchIndexHtml();

                _ = Task.Run(async () =>
                {
                    for (var i = 0; i < 3; i++)
                    {
                        await Task.Delay(TimeSpan.FromSeconds(3 * (i + 1)));
                        if (!Configuration.EnablePhysicalIndexHtmlPatchFallback)
                        {
                            break;
                        }

                        TryPatchIndexHtml();
                    }
                });
            }

            try
            {
                if (Configuration.EnableTransformEngine)
                {
                    ResponseTransformation.Register(@".*index\.html(\.gz|\.br)?$",
                        req =>
                        {
                            var html = req.Contents ?? string.Empty;

                            _logger.LogInformation(
                                "[Nexus PobreFlix][DIAG] Transform hit for {Path} (len={Len})",
                                req.FilePath, html.Length
                            );

                            if (html.IndexOf("<!-- SL-INJECT BEGIN -->", StringComparison.OrdinalIgnoreCase) >= 0)
                                return html;

                            var snippet = BuildScriptsHtml();
                            var headEndIndex = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
                            if (headEndIndex >= 0)
                            {
                                return html.Insert(headEndIndex, "\n" + snippet + "\n");
                            }

                            return html + "\n" + snippet + "\n";
                        });

                    _logger.LogInformation("[Nexus PobreFlix] Registered in-memory transformation rule for .*index.html(+gz/br)");
                }
                else
                {
                    _logger.LogInformation("[Nexus PobreFlix] Transform engine disabled by configuration");
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[Nexus PobreFlix] Failed to register in-memory transformation; middleware/patch fallback will be used.");
            }
        }

        public override void OnUninstalling()
        {
            _logger.LogInformation("[Nexus PobreFlix] Plugin uninstall detected. Cleaning physical index.html patch if present.");
            TryUnpatchIndexHtml();
            base.OnUninstalling();
        }

        private string? DetectWebRoot()
        {
            try
            {
                var webPath = ApplicationPaths.WebPath;
                if (!string.IsNullOrWhiteSpace(webPath) &&
                    Directory.Exists(webPath) &&
                    File.Exists(Path.Combine(webPath, "index.html")))
                {
                    _logger.LogInformation("[Nexus PobreFlix] Using ApplicationPaths.WebPath as web root: {WebRoot}", webPath);
                    return webPath;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[Nexus PobreFlix] Failed probing ApplicationPaths.WebPath");
            }

            var candidates = new[]
            {
                "/usr/share/jellyfin/web",
                "/var/lib/jellyfin/web",
                "/opt/jellyfin/web",
                "/jellyfin/web",
                Path.Combine(Environment.CurrentDirectory, "web"),
                Path.Combine(AppContext.BaseDirectory, "web")
            };

            foreach (var p in candidates)
            {
                try
                {
                    _logger.LogInformation("[Nexus PobreFlix] Checking web root candidate: {Candidate}", p);

                    if (Directory.Exists(p) && File.Exists(Path.Combine(p, "index.html")))
                    {
                        _logger.LogInformation("[Nexus PobreFlix] Found web root: {WebRoot}", p);
                        return p;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[Nexus PobreFlix] Error checking candidate: {Candidate}", p);
                }
            }

            _logger.LogWarning("[Nexus PobreFlix] Web root not found in any candidate location");
            return null;
        }

        public void TryPatchIndexHtml()
        {
            try
            {
                var root = DetectWebRoot();
                if (string.IsNullOrWhiteSpace(root))
                {
                    _logger.LogWarning("[Nexus PobreFlix] Web root not found; skipping patch.");
                    return;
                }

                var ok = IndexPatcher.EnsurePatched(_logger, root);
                _logger.LogInformation("[Nexus PobreFlix] Patch result: {ok}", ok);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Nexus PobreFlix] TryPatchIndexHtml failed");
            }
        }

        public void TryUnpatchIndexHtml()
        {
            try
            {
                var root = DetectWebRoot();
                if (string.IsNullOrWhiteSpace(root))
                {
                    _logger.LogWarning("[Nexus PobreFlix] Web root not found; skipping unpatch.");
                    return;
                }

                var ok = IndexPatcher.EnsureUnpatched(_logger, root);
                _logger.LogInformation("[Nexus PobreFlix] Unpatch result: {ok}", ok);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Nexus PobreFlix] TryUnpatchIndexHtml failed");
            }
        }

        public string BuildScriptsHtml(string? pathBase = null)
        {
            var sb = new StringBuilder();
            sb.AppendLine("<!-- SL-INJECT BEGIN -->");
            sb.AppendLine(AssetVersioning.BuildBootstrapScript());
            sb.AppendLine($@"<script type=""module"" src=""{AssetVersioning.AppendVersionQuery("../Plugins/JMSFusion/runtime/storage-preload.js")}""></script>");
            sb.AppendLine($@"<script type=""module"" src=""{AssetVersioning.AppendVersionQuery("../slider/main.js")}""></script>");
            sb.AppendLine($@"<script type=""module"" src=""{AssetVersioning.AppendVersionQuery("../slider/modules/player/main.js")}""></script>");
            sb.AppendLine("<!-- SL-INJECT END -->");
            return sb.ToString();
        }

        public IEnumerable<PluginPageInfo> GetPages()
        {
            var ns = typeof(JMSFusionPlugin).Namespace;
            return new[]
            {
                new PluginPageInfo
                {
                    Name = "JMSFusionConfigPage",
                    EmbeddedResourcePath = $"{ns}.Web.configuration.html",
                    EnableInMainMenu = false
                }
            };
        }

        public string GetStorageDirectory(params string[] segments)
        {
            var basePath =
                ReadPathValue(_paths, "PluginConfigurationsPath") ??
                ReadPathValue(_paths, "ProgramDataPath") ??
                ReadPathValue(_paths, "DataPath") ??
                Path.GetDirectoryName(ReadPathValue(this, "ConfigurationPath") ?? string.Empty) ??
                AppContext.BaseDirectory;

            var current = Path.Combine(basePath, "JMSFusion");
            Directory.CreateDirectory(current);

            foreach (var segment in segments ?? Array.Empty<string>())
            {
                var cleanSegment = string.IsNullOrWhiteSpace(segment)
                    ? string.Empty
                    : segment.Trim().Trim(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (string.IsNullOrWhiteSpace(cleanSegment))
                {
                    continue;
                }

                current = Path.Combine(current, cleanSegment);
                Directory.CreateDirectory(current);
            }

            return current;
        }

        private static string? ReadPathValue(object? source, string propertyName)
        {
            try
            {
                return source?.GetType().GetProperty(propertyName)?.GetValue(source) as string;
            }
            catch
            {
                return null;
            }
        }
    }
}
