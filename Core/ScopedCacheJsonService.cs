using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core
{
    public sealed class ScopedCacheJsonService
    {
        private static readonly string EmptyPayload = "{}";
        private static readonly string[] AllowedCacheTypes =
        {
            "recentRows",
            "directorRows",
            "personalRecommendations",
            "collectionCache",
            "sliderCache",
            "gmmpMusic"
        };
        private static readonly HashSet<string> VolatileCacheFields = new(StringComparer.OrdinalIgnoreCase)
        {
            "fetchedAt",
            "expiresAt",
            "updatedAt"
        };

        private readonly ILogger<ScopedCacheJsonService> _logger;
        private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks =
            new(StringComparer.OrdinalIgnoreCase);

        public ScopedCacheJsonService(ILogger<ScopedCacheJsonService> logger)
        {
            _logger = logger;
        }

        public bool TryNormalizeCacheType(string? cacheType, out string normalizedCacheType)
        {
            var value = (cacheType ?? string.Empty).Trim();
            foreach (var allowed in AllowedCacheTypes)
            {
                if (string.Equals(allowed, value, StringComparison.OrdinalIgnoreCase))
                {
                    normalizedCacheType = allowed;
                    return true;
                }
            }

            normalizedCacheType = string.Empty;
            return false;
        }

        public async Task<string> ReadAsync(string cacheType, string scope, CancellationToken cancellationToken)
        {
            var filePath = GetFilePath(cacheType, scope);
            var gate = _locks.GetOrAdd(filePath, static _ => new SemaphoreSlim(1, 1));

            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!File.Exists(filePath))
                {
                    return EmptyPayload;
                }

                var raw = await File.ReadAllTextAsync(filePath, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
                if (string.IsNullOrWhiteSpace(raw))
                {
                    return EmptyPayload;
                }

                try
                {
                    using var _ = JsonDocument.Parse(raw);
                    return raw;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "[JMSFusion] Scoped cache JSON invalid, returning empty payload for {CacheType} {Scope}", cacheType, scope);
                    return EmptyPayload;
                }
            }
            finally
            {
                gate.Release();
            }
        }

        public async Task<bool> WriteAsync(string cacheType, string scope, string rawJson, CancellationToken cancellationToken)
        {
            var filePath = GetFilePath(cacheType, scope);
            var directory = Path.GetDirectoryName(filePath) ?? JMSFusionPlugin.Instance.GetStorageDirectory("scoped-cache", cacheType);
            Directory.CreateDirectory(directory);

            string normalizedJson;
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(rawJson) ? EmptyPayload : rawJson);
                normalizedJson = doc.RootElement.GetRawText();
            }
            catch (Exception ex)
            {
                throw new ArgumentException("Cache payload must be valid JSON.", nameof(rawJson), ex);
            }

            var gate = _locks.GetOrAdd(filePath, static _ => new SemaphoreSlim(1, 1));
            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (File.Exists(filePath))
                {
                    var existingRaw = await File.ReadAllTextAsync(filePath, Encoding.UTF8, cancellationToken).ConfigureAwait(false);
                    if (string.Equals(existingRaw, normalizedJson, StringComparison.Ordinal) ||
                        AreStableEquivalent(cacheType, existingRaw, normalizedJson))
                    {
                        return false;
                    }
                }

                var tempPath = Path.Combine(directory, $"{Path.GetFileName(filePath)}.{Guid.NewGuid():N}.tmp");
                try
                {
                    await File.WriteAllTextAsync(
                        tempPath,
                        normalizedJson,
                        new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
                        cancellationToken).ConfigureAwait(false);

                    File.Move(tempPath, filePath, true);
                    return true;
                }
                finally
                {
                    try
                    {
                        if (File.Exists(tempPath))
                        {
                            File.Delete(tempPath);
                        }
                    }
                    catch
                    {
                    }
                }
            }
            finally
            {
                gate.Release();
            }
        }

        private static bool AreStableEquivalent(string cacheType, string existingRaw, string incomingRaw)
        {
            try
            {
                using var existingDoc = JsonDocument.Parse(existingRaw);
                using var incomingDoc = JsonDocument.Parse(incomingRaw);
                return AreStableEquivalent(
                    existingDoc.RootElement,
                    incomingDoc.RootElement,
                    cacheType,
                    depth: 0);
            }
            catch
            {
                return false;
            }
        }

        private static bool AreStableEquivalent(JsonElement existing, JsonElement incoming, string cacheType, int depth)
        {
            if (existing.ValueKind != incoming.ValueKind)
            {
                return false;
            }

            switch (existing.ValueKind)
            {
                case JsonValueKind.Object:
                    return AreStableObjectsEquivalent(existing, incoming, cacheType, depth);
                case JsonValueKind.Array:
                    if (existing.GetArrayLength() != incoming.GetArrayLength())
                    {
                        return false;
                    }

                    using (var existingItems = existing.EnumerateArray())
                    using (var incomingItems = incoming.EnumerateArray())
                    {
                        while (existingItems.MoveNext() && incomingItems.MoveNext())
                        {
                            if (!AreStableEquivalent(existingItems.Current, incomingItems.Current, cacheType, depth + 1))
                            {
                                return false;
                            }
                        }
                    }

                    return true;
                case JsonValueKind.String:
                    return string.Equals(existing.GetString(), incoming.GetString(), StringComparison.Ordinal);
                case JsonValueKind.Number:
                    return string.Equals(existing.GetRawText(), incoming.GetRawText(), StringComparison.Ordinal);
                case JsonValueKind.True:
                case JsonValueKind.False:
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return true;
                default:
                    return string.Equals(existing.GetRawText(), incoming.GetRawText(), StringComparison.Ordinal);
            }
        }

        private static bool AreStableObjectsEquivalent(JsonElement existing, JsonElement incoming, string cacheType, int depth)
        {
            var existingCount = 0;
            var incomingCount = 0;

            foreach (var property in existing.EnumerateObject())
            {
                if (ShouldIgnoreStableProperty(cacheType, property.Name, depth))
                {
                    continue;
                }

                existingCount++;
                if (!incoming.TryGetProperty(property.Name, out var incomingProperty) ||
                    !AreStableEquivalent(property.Value, incomingProperty, cacheType, depth + 1))
                {
                    return false;
                }
            }

            foreach (var property in incoming.EnumerateObject())
            {
                if (!ShouldIgnoreStableProperty(cacheType, property.Name, depth))
                {
                    incomingCount++;
                }
            }

            return existingCount == incomingCount;
        }

        private static bool ShouldIgnoreStableProperty(string cacheType, string propertyName, int depth)
        {
            if (VolatileCacheFields.Contains(propertyName))
            {
                return true;
            }

            if (depth == 1 &&
                string.Equals(cacheType, "personalRecommendations", StringComparison.OrdinalIgnoreCase) &&
                propertyName.StartsWith("prc:", StringComparison.OrdinalIgnoreCase) &&
                propertyName.Contains(":lastShown:", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            return depth == 0 &&
                string.Equals(cacheType, "sliderCache", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(propertyName, "userData", StringComparison.Ordinal);
        }

        public async Task<bool> DeleteAsync(string cacheType, string scope, CancellationToken cancellationToken)
        {
            var filePath = GetFilePath(cacheType, scope);
            var gate = _locks.GetOrAdd(filePath, static _ => new SemaphoreSlim(1, 1));

            await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                if (!File.Exists(filePath))
                {
                    return false;
                }

                File.Delete(filePath);
                return true;
            }
            finally
            {
                gate.Release();
            }
        }

        private static string GetFilePath(string cacheType, string scope)
        {
            var normalizedScope = NormalizeScope(scope);
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(normalizedScope))).ToLowerInvariant();
            var directory = JMSFusionPlugin.Instance.GetStorageDirectory("scoped-cache", cacheType);
            return Path.Combine(directory, $"{hash}.json");
        }

        private static string NormalizeScope(string scope)
        {
            var normalized = (scope ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalized))
            {
                throw new ArgumentException("Scope is required.", nameof(scope));
            }

            return normalized;
        }
    }
}
