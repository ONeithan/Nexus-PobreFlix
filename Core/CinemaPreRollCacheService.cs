using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.JMSFusion.Core;

public sealed class CinemaPreRollCacheService
{
    private const string CacheFileName = "tmdb-cinema-preroll-cache.json";
    private const string TmdbApiBase = "https://api.themoviedb.org/3";
    private const string TmdbImageBase = "https://image.tmdb.org/t/p/original";
    private const int CacheVersion = 3;
    private const int MaxItemsPerLocale = 150;
    private const int MaxPagesPerFeed = 8;
    private const int MaxSeedCandidates = MaxItemsPerLocale * 4;
    private const int MaxConcurrentTmdbRequests = 8;
    private static readonly string[] AdultContentMarkers =
    {
        "porn",
        "porno",
        "pornographic",
        "xxx",
        "adult film",
        "adult movie",
        "erotic",
        "erotica",
        "erotik",
        "softcore",
        "hardcore",
        "hentai",
        "onlyfans",
        "jav "
    };
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromHours(24);
    private static readonly HttpClient Http = CreateHttpClient();
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = true
    };

    private readonly ILogger<CinemaPreRollCacheService> _logger;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);

    public CinemaPreRollCacheService(ILogger<CinemaPreRollCacheService> logger)
    {
        _logger = logger;
    }

    public sealed class CacheSnapshot
    {
        public string CacheFile { get; set; } = CacheFileName;
        public string CacheKey { get; set; } = string.Empty;
        public string Language { get; set; } = "tr-TR";
        public string Region { get; set; } = "TR";
        public long UpdatedAtUtc { get; set; }
        public int TargetItemCount { get; set; }
        public bool Stale { get; set; }
        public List<CacheItem> Items { get; set; } = new();
    }

    public sealed class CacheItem
    {
        public int TmdbId { get; set; }
        public string YoutubeKey { get; set; } = string.Empty;
        public string VideoName { get; set; } = string.Empty;
        public string Title { get; set; } = string.Empty;
        public string Overview { get; set; } = string.Empty;
        public string ReleaseDate { get; set; } = string.Empty;
        public string BackdropUrl { get; set; } = string.Empty;
        public string PosterUrl { get; set; } = string.Empty;
        public string SourceList { get; set; } = string.Empty;
        public bool Adult { get; set; }
    }

    private sealed class LocaleRequest
    {
        public required string Language { get; init; }
        public required string Region { get; init; }
        public required string CacheKey { get; init; }
        public required string IncludeVideoLanguage { get; init; }
    }

    private sealed class CacheFileModel
    {
        public int Version { get; set; } = CacheVersion;
        public Dictionary<string, LocaleCacheModel> Locales { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    }

    private sealed class LocaleCacheModel
    {
        public string CacheKey { get; set; } = string.Empty;
        public string Language { get; set; } = "tr-TR";
        public string Region { get; set; } = "TR";
        public long UpdatedAtUtc { get; set; }
        public int TargetItemCount { get; set; }
        public List<CacheItem> Items { get; set; } = new();
    }

    private sealed class TmdbMovieListResponse
    {
        public List<TmdbMovie>? Results { get; set; }

        [JsonPropertyName("total_pages")]
        public int TotalPages { get; set; }
    }

    private sealed class TmdbMovie
    {
        public int Id { get; set; }
        public string? Title { get; set; }

        [JsonPropertyName("original_title")]
        public string? OriginalTitle { get; set; }

        public string? Overview { get; set; }

        [JsonPropertyName("release_date")]
        public string? ReleaseDate { get; set; }

        [JsonPropertyName("backdrop_path")]
        public string? BackdropPath { get; set; }

        [JsonPropertyName("poster_path")]
        public string? PosterPath { get; set; }

        public bool Adult { get; set; }
    }

    private sealed class TmdbVideosResponse
    {
        public List<TmdbVideo>? Results { get; set; }
    }

    private sealed class TmdbVideo
    {
        public string? Site { get; set; }
        public string? Type { get; set; }
        public string? Key { get; set; }
        public string? Name { get; set; }
        public bool Official { get; set; }
        public int Size { get; set; }

        [JsonPropertyName("published_at")]
        public string? PublishedAt { get; set; }
    }

    private sealed class MovieSeed
    {
        public int TmdbId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Overview { get; set; } = string.Empty;
        public string ReleaseDate { get; set; } = string.Empty;
        public string BackdropUrl { get; set; } = string.Empty;
        public string PosterUrl { get; set; } = string.Empty;
        public string SourceList { get; set; } = string.Empty;
        public bool Adult { get; set; }
    }

    private sealed class ScoredVideo
    {
        public required TmdbVideo Video { get; init; }
        public required double Score { get; init; }
    }

    public async Task<CacheSnapshot> GetSnapshotAsync(
        string? language,
        string? region,
        string? regionMode,
        bool forceRefresh = false,
        CancellationToken ct = default)
    {
        var locale = BuildLocaleRequest(language, region, regionMode);
        var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");

        await _refreshLock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var fileModel = ReadCacheFile(plugin);
            if (!forceRefresh && TryGetFreshLocaleSnapshot(fileModel, locale.CacheKey, out var fresh))
            {
                return ToSnapshot(fresh, stale: false);
            }

            try
            {
                LocaleCacheModel? existingSnapshot = null;
                if (TryGetLocaleSnapshot(fileModel, locale.CacheKey, out var existing))
                {
                    existingSnapshot = existing;
                }

                var refreshed = await RefreshLocaleSnapshotAsync(plugin.Configuration, locale, existingSnapshot, ct).ConfigureAwait(false);
                if (refreshed is not null)
                {
                    UpsertLocaleSnapshot(fileModel, refreshed);
                    WriteCacheFile(plugin, fileModel);
                    return ToSnapshot(refreshed, stale: false);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Cinema pre-roll cache refresh failed for {CacheKey}", locale.CacheKey);
            }

            if (TryGetLocaleSnapshot(fileModel, locale.CacheKey, out var stale))
            {
                return ToSnapshot(stale, stale: true);
            }

            var empty = new LocaleCacheModel
            {
                CacheKey = locale.CacheKey,
                Language = locale.Language,
                Region = locale.Region,
                UpdatedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                TargetItemCount = MaxItemsPerLocale,
                Items = new List<CacheItem>()
            };

            UpsertLocaleSnapshot(fileModel, empty);
            WriteCacheFile(plugin, fileModel);
            return ToSnapshot(empty, stale: true);
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(45)
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("JMSFusion-CinemaPreRollCache/1.0");
        return client;
    }

    private async Task<LocaleCacheModel?> RefreshLocaleSnapshotAsync(
        JMSFusionConfiguration config,
        LocaleRequest locale,
        LocaleCacheModel? existingSnapshot,
        CancellationToken ct)
    {
        var apiKey = string.IsNullOrWhiteSpace(config?.TmdbApiKey) ? string.Empty : config.TmdbApiKey.Trim();
        if (string.IsNullOrWhiteSpace(apiKey) || string.Equals(apiKey, "CHANGE_ME", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var seeds = await FetchMovieSeedsAsync(apiKey, locale, ct).ConfigureAwait(false);
        if (seeds.Count == 0)
        {
            return BuildLocaleSnapshot(locale, NormalizeCacheItems(existingSnapshot?.Items));
        }

        var refreshedItems = await ResolveTrailerItemsAsync(apiKey, locale, seeds, ct).ConfigureAwait(false);
        if (refreshedItems.Count == 0 && existingSnapshot?.Items?.Count > 0)
        {
            return BuildLocaleSnapshot(locale, NormalizeCacheItems(existingSnapshot.Items));
        }

        var mergedItems = MergeRefreshedItemsWithExisting(existingSnapshot?.Items, refreshedItems);
        return BuildLocaleSnapshot(locale, mergedItems);
    }

    private static LocaleCacheModel BuildLocaleSnapshot(LocaleRequest locale, IReadOnlyList<CacheItem> items)
    {
        return new LocaleCacheModel
        {
            CacheKey = locale.CacheKey,
            Language = locale.Language,
            Region = locale.Region,
            UpdatedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            TargetItemCount = MaxItemsPerLocale,
            Items = NormalizeCacheItems(items)
        };
    }

    private async Task<List<MovieSeed>> FetchMovieSeedsAsync(string apiKey, LocaleRequest locale, CancellationToken ct)
    {
        var tasks = new List<Task<List<MovieSeed>>>
        {
            FetchFeedAsync(apiKey, "/movie/now_playing", "now_playing", locale, ct),
            FetchFeedAsync(apiKey, "/movie/upcoming", "upcoming", locale, ct)
        };

        if (!string.IsNullOrWhiteSpace(locale.Region))
        {
            var globalLocale = new LocaleRequest
            {
                Language = locale.Language,
                Region = string.Empty,
                CacheKey = $"{locale.Language}:GLOBAL",
                IncludeVideoLanguage = locale.IncludeVideoLanguage
            };

            tasks.Add(FetchFeedAsync(apiKey, "/movie/now_playing", "now_playing_global", globalLocale, ct));
            tasks.Add(FetchFeedAsync(apiKey, "/movie/upcoming", "upcoming_global", globalLocale, ct));
        }

        await Task.WhenAll(tasks).ConfigureAwait(false);

        var merged = new Dictionary<int, MovieSeed>();
        foreach (var seed in tasks.SelectMany(task => task.Result))
        {
            MergeSeed(merged, seed);
        }

        return merged.Values
            .OrderByDescending(seed => ParseReleaseDate(seed.ReleaseDate))
            .ThenByDescending(seed => seed.TmdbId)
            .Take(MaxSeedCandidates)
            .ToList();
    }

    private async Task<List<MovieSeed>> FetchFeedAsync(
        string apiKey,
        string path,
        string sourceList,
        LocaleRequest locale,
        CancellationToken ct)
    {
        var firstPage = await FetchTmdbJsonAsync<TmdbMovieListResponse>(
            apiKey,
            path,
            new Dictionary<string, string>
            {
                ["language"] = locale.Language,
                ["region"] = locale.Region,
                ["include_adult"] = "false",
                ["page"] = "1"
            },
            ct
        ).ConfigureAwait(false);

        var pages = new List<TmdbMovieListResponse> { firstPage };
        var totalPages = Math.Min(MaxPagesPerFeed, Math.Max(1, firstPage.TotalPages));
        if (totalPages > 1)
        {
            var followUpTasks = Enumerable.Range(2, totalPages - 1)
                .Select(page => SafeFetchFeedPageAsync(apiKey, path, locale, page, ct));

            pages.AddRange((await Task.WhenAll(followUpTasks).ConfigureAwait(false)).Where(page => page is not null)!);
        }

        return pages
            .SelectMany(page => page.Results ?? Enumerable.Empty<TmdbMovie>())
            .Where(movie =>
                movie.Id > 0 &&
                !movie.Adult &&
                !LooksAdultContent(movie.Title, movie.OriginalTitle, movie.Overview))
            .Select(movie => new MovieSeed
            {
                TmdbId = movie.Id,
                Title = string.IsNullOrWhiteSpace(movie.Title) ? string.Empty : movie.Title.Trim(),
                Overview = string.IsNullOrWhiteSpace(movie.Overview) ? string.Empty : movie.Overview.Trim(),
                ReleaseDate = string.IsNullOrWhiteSpace(movie.ReleaseDate) ? string.Empty : movie.ReleaseDate.Trim(),
                BackdropUrl = string.IsNullOrWhiteSpace(movie.BackdropPath) ? string.Empty : $"{TmdbImageBase}{movie.BackdropPath}",
                PosterUrl = string.IsNullOrWhiteSpace(movie.PosterPath) ? string.Empty : $"{TmdbImageBase}{movie.PosterPath}",
                SourceList = sourceList,
                Adult = movie.Adult
            })
            .ToList();
    }

    private async Task<List<CacheItem>> ResolveTrailerItemsAsync(
        string apiKey,
        LocaleRequest locale,
        IReadOnlyList<MovieSeed> seeds,
        CancellationToken ct)
    {
        var items = new ConcurrentBag<CacheItem>();
        using var concurrency = new SemaphoreSlim(MaxConcurrentTmdbRequests, MaxConcurrentTmdbRequests);

        var tasks = seeds.Select(async seed =>
        {
            await concurrency.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                TmdbVideosResponse videos;
                try
                {
                    videos = await FetchTmdbJsonAsync<TmdbVideosResponse>(
                        apiKey,
                        $"/movie/{seed.TmdbId}/videos",
                        new Dictionary<string, string>
                        {
                            ["language"] = locale.Language,
                            ["include_video_language"] = locale.IncludeVideoLanguage
                        },
                        ct
                    ).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Cinema pre-roll TMDb videos fetch failed for {TmdbId}", seed.TmdbId);
                    return;
                }

                var picked = PickBestTrailerVideo(videos.Results);
                if (picked is null || string.IsNullOrWhiteSpace(picked.Key))
                {
                    return;
                }
                if (seed.Adult || LooksAdultContent(seed.Title, seed.Overview, picked.Name))
                {
                    return;
                }

                items.Add(new CacheItem
                {
                    TmdbId = seed.TmdbId,
                    YoutubeKey = picked.Key.Trim(),
                    VideoName = string.IsNullOrWhiteSpace(picked.Name) ? string.Empty : picked.Name.Trim(),
                    Title = seed.Title,
                    Overview = seed.Overview,
                    ReleaseDate = seed.ReleaseDate,
                    BackdropUrl = seed.BackdropUrl,
                    PosterUrl = seed.PosterUrl,
                    SourceList = seed.SourceList,
                    Adult = seed.Adult
                });
            }
            finally
            {
                concurrency.Release();
            }
        });

        await Task.WhenAll(tasks).ConfigureAwait(false);

        return items
            .GroupBy(item => item.TmdbId)
            .Select(group => group
                .OrderByDescending(item => ScoreSourceList(item.SourceList))
                .ThenByDescending(item => ParseReleaseDate(item.ReleaseDate))
                .First())
            .OrderByDescending(item => ParseReleaseDate(item.ReleaseDate))
            .ThenByDescending(item => item.TmdbId)
            .Take(MaxItemsPerLocale)
            .ToList();
    }

    private static List<CacheItem> MergeRefreshedItemsWithExisting(
        IEnumerable<CacheItem>? existingItems,
        IEnumerable<CacheItem>? refreshedItems)
    {
        var existing = NormalizeCacheItems(existingItems);
        var refreshed = NormalizeCacheItems(refreshedItems);
        if (existing.Count == 0)
        {
            return refreshed;
        }

        if (refreshed.Count == 0)
        {
            return existing;
        }

        var refreshedById = refreshed
            .GroupBy(item => item.TmdbId)
            .ToDictionary(group => group.Key, group => group.First());
        var existingIds = existing.Select(item => item.TmdbId).ToHashSet();

        var newItems = refreshed
            .Where(item => !existingIds.Contains(item.TmdbId))
            .ToList();

        var updatedExisting = existing
            .Select(item => refreshedById.TryGetValue(item.TmdbId, out var refreshedItem)
                ? MergeCacheItem(item, refreshedItem)
                : item)
            .ToList();

        return NormalizeCacheItems(newItems.Concat(updatedExisting));
    }

    private static List<CacheItem> NormalizeCacheItems(IEnumerable<CacheItem>? items)
    {
        var output = new List<CacheItem>();
        var seen = new HashSet<int>();

        foreach (var item in items ?? Enumerable.Empty<CacheItem>())
        {
            if (
                item is null ||
                item.TmdbId <= 0 ||
                item.Adult ||
                string.IsNullOrWhiteSpace(item.YoutubeKey) ||
                LooksAdultContent(item.Title, item.VideoName, item.Overview))
            {
                continue;
            }

            if (!seen.Add(item.TmdbId))
            {
                continue;
            }

            output.Add(NormalizeCacheItem(item));
            if (output.Count >= MaxItemsPerLocale)
            {
                break;
            }
        }

        return output;
    }

    private static CacheItem NormalizeCacheItem(CacheItem item)
    {
        return new CacheItem
        {
            TmdbId = item.TmdbId,
            YoutubeKey = item.YoutubeKey.Trim(),
            VideoName = TrimOrEmpty(item.VideoName),
            Title = TrimOrEmpty(item.Title),
            Overview = TrimOrEmpty(item.Overview),
            ReleaseDate = TrimOrEmpty(item.ReleaseDate),
            BackdropUrl = TrimOrEmpty(item.BackdropUrl),
            PosterUrl = TrimOrEmpty(item.PosterUrl),
            SourceList = TrimOrEmpty(item.SourceList),
            Adult = item.Adult
        };
    }

    private static CacheItem MergeCacheItem(CacheItem existing, CacheItem refreshed)
    {
        return new CacheItem
        {
            TmdbId = existing.TmdbId,
            YoutubeKey = PreferText(refreshed.YoutubeKey, existing.YoutubeKey),
            VideoName = PreferText(refreshed.VideoName, existing.VideoName),
            Title = PreferText(refreshed.Title, existing.Title),
            Overview = PreferText(refreshed.Overview, existing.Overview),
            ReleaseDate = PreferText(refreshed.ReleaseDate, existing.ReleaseDate),
            BackdropUrl = PreferText(refreshed.BackdropUrl, existing.BackdropUrl),
            PosterUrl = PreferText(refreshed.PosterUrl, existing.PosterUrl),
            SourceList = PreferText(refreshed.SourceList, existing.SourceList),
            Adult = existing.Adult || refreshed.Adult
        };
    }

    private static string PreferText(string? preferred, string? fallback)
    {
        var value = TrimOrEmpty(preferred);
        return string.IsNullOrWhiteSpace(value) ? TrimOrEmpty(fallback) : value;
    }

    private static string TrimOrEmpty(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
    }

    private static bool LooksAdultContent(params string?[] values)
    {
        var text = string.Join(" ", values.Select(TrimOrEmpty))
            .ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        return AdultContentMarkers.Any(marker => text.Contains(marker, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<TmdbMovieListResponse?> SafeFetchFeedPageAsync(
        string apiKey,
        string path,
        LocaleRequest locale,
        int page,
        CancellationToken ct)
    {
        try
        {
            return await FetchTmdbJsonAsync<TmdbMovieListResponse>(
                apiKey,
                path,
                new Dictionary<string, string>
                {
                    ["language"] = locale.Language,
                    ["region"] = locale.Region,
                    ["include_adult"] = "false",
                    ["page"] = page.ToString(CultureInfo.InvariantCulture)
                },
                ct
            ).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Cinema pre-roll feed page fetch failed for {Path} page {Page}", path, page);
            return null;
        }
    }

    private static TmdbVideo? PickBestTrailerVideo(IEnumerable<TmdbVideo>? videos)
    {
        var best = (videos ?? Enumerable.Empty<TmdbVideo>())
            .Where(entry =>
                string.Equals(entry.Site, "YouTube", StringComparison.OrdinalIgnoreCase) &&
                !string.IsNullOrWhiteSpace(entry.Key))
            .Select(entry =>
            {
                var type = string.IsNullOrWhiteSpace(entry.Type) ? string.Empty : entry.Type.Trim().ToLowerInvariant();
                var score = 0d;
                score += type switch
                {
                    "trailer" => 300d,
                    "teaser" => 180d,
                    "clip" => 120d,
                    _ => 0d
                };
                if (entry.Official)
                {
                    score += 60d;
                }

                score += entry.Size / 10d;

                if (DateTimeOffset.TryParse(entry.PublishedAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var publishedAt))
                {
                    score += publishedAt.ToUnixTimeMilliseconds() / 1_000_000_000_000d;
                }

                return new ScoredVideo
                {
                    Video = entry,
                    Score = score
                };
            })
            .OrderByDescending(entry => entry.Score)
            .FirstOrDefault();

        return best?.Video;
    }

    private async Task<T> FetchTmdbJsonAsync<T>(
        string apiKey,
        string path,
        IReadOnlyDictionary<string, string> query,
        CancellationToken ct)
    {
        var url = BuildTmdbUrl(apiKey, path, query);
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        using var response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException($"TMDb HTTP {(int)response.StatusCode} for {path}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        var payload = await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, ct).ConfigureAwait(false);
        if (payload is null)
        {
            throw new InvalidOperationException($"TMDb response was empty for {path}");
        }

        return payload;
    }

    private static string BuildTmdbUrl(string apiKey, string path, IReadOnlyDictionary<string, string> query)
    {
        var builder = new UriBuilder($"{TmdbApiBase}{path}");
        var queryParts = new List<string> { $"api_key={Uri.EscapeDataString(apiKey)}" };
        foreach (var pair in query)
        {
            if (string.IsNullOrWhiteSpace(pair.Key) || string.IsNullOrWhiteSpace(pair.Value))
            {
                continue;
            }

            queryParts.Add($"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}");
        }

        builder.Query = string.Join("&", queryParts);
        return builder.ToString();
    }

    private static void MergeSeed(IDictionary<int, MovieSeed> target, MovieSeed seed)
    {
        if (!target.TryGetValue(seed.TmdbId, out var existing))
        {
            target[seed.TmdbId] = seed;
            return;
        }

        if (string.IsNullOrWhiteSpace(existing.Title) && !string.IsNullOrWhiteSpace(seed.Title))
        {
            existing.Title = seed.Title;
        }

        if (string.IsNullOrWhiteSpace(existing.Overview) && !string.IsNullOrWhiteSpace(seed.Overview))
        {
            existing.Overview = seed.Overview;
        }

        if (string.IsNullOrWhiteSpace(existing.ReleaseDate) && !string.IsNullOrWhiteSpace(seed.ReleaseDate))
        {
            existing.ReleaseDate = seed.ReleaseDate;
        }

        if (string.IsNullOrWhiteSpace(existing.BackdropUrl) && !string.IsNullOrWhiteSpace(seed.BackdropUrl))
        {
            existing.BackdropUrl = seed.BackdropUrl;
        }

        if (string.IsNullOrWhiteSpace(existing.PosterUrl) && !string.IsNullOrWhiteSpace(seed.PosterUrl))
        {
            existing.PosterUrl = seed.PosterUrl;
        }

        if (ScoreSourceList(seed.SourceList) > ScoreSourceList(existing.SourceList))
        {
            existing.SourceList = seed.SourceList;
        }
    }

    private static double ScoreSourceList(string? sourceList)
    {
        return sourceList?.Trim().ToLowerInvariant() switch
        {
            "now_playing" => 3d,
            "upcoming" => 2d,
            "now_playing_global" => 1.5d,
            "upcoming_global" => 1d,
            _ => 0d
        };
    }

    private static DateTime ParseReleaseDate(string? raw)
    {
        if (DateTime.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
        {
            return parsed.Date;
        }

        return DateTime.MinValue;
    }

    private static LocaleRequest BuildLocaleRequest(string? language, string? region, string? regionMode)
    {
        var normalizedLanguage = NormalizeTmdbLanguage(language);
        var normalizedRegionMode = NormalizeTmdbRegionMode(regionMode);
        var normalizedRegion = normalizedRegionMode switch
        {
            "global" => string.Empty,
            _ => NormalizeTmdbRegion(region, normalizedLanguage)
        };
        var iso639 = normalizedLanguage.Split('-')[0];
        return new LocaleRequest
        {
            Language = normalizedLanguage,
            Region = normalizedRegion,
            CacheKey = string.IsNullOrWhiteSpace(normalizedRegion)
                ? $"{normalizedLanguage}:GLOBAL"
                : $"{normalizedLanguage}:{normalizedRegion}",
            IncludeVideoLanguage = $"{iso639},en,null"
        };
    }

    private static string NormalizeTmdbRegionMode(string? raw)
    {
        var value = string.IsNullOrWhiteSpace(raw) ? "auto" : raw.Trim().ToLowerInvariant();
        return value switch
        {
            "global" => "global",
            "custom" => "custom",
            _ => "auto"
        };
    }

    private static string NormalizeTmdbLanguage(string? raw)
    {
        var value = string.IsNullOrWhiteSpace(raw) ? "tr-TR" : raw.Trim().Replace("_", "-");
        if (System.Text.RegularExpressions.Regex.IsMatch(value, "^[a-z]{2}-[A-Z]{2}$"))
        {
            return value;
        }

        var lower = value.ToLowerInvariant();
        return lower switch
        {
            "tr" or "tur" => "tr-TR",
            "en" or "eng" => "en-US",
            "de" or "deu" => "de-DE",
            "fr" or "fre" or "fra" => "fr-FR",
            "ru" or "rus" => "ru-RU",
            "es" or "spa" => "es-ES",
            _ => "tr-TR"
        };
    }

    private static string NormalizeTmdbRegion(string? raw, string normalizedLanguage)
    {
        var region = string.IsNullOrWhiteSpace(raw) ? string.Empty : raw.Trim().ToUpperInvariant();
        if (region.Length == 2)
        {
            return region;
        }

        var parts = normalizedLanguage.Split('-');
        if (parts.Length >= 2 && parts[1].Length == 2)
        {
            return parts[1].ToUpperInvariant();
        }

        return "TR";
    }

    private static bool TryGetFreshLocaleSnapshot(CacheFileModel fileModel, string cacheKey, out LocaleCacheModel snapshot)
    {
        if (TryGetLocaleSnapshot(fileModel, cacheKey, out snapshot))
        {
            var updatedAt = DateTimeOffset.FromUnixTimeMilliseconds(snapshot.UpdatedAtUtc);
            if (
                snapshot.TargetItemCount >= MaxItemsPerLocale &&
                (snapshot.Items?.Count ?? 0) >= MaxItemsPerLocale &&
                DateTimeOffset.UtcNow - updatedAt <= RefreshInterval)
            {
                return true;
            }
        }

        snapshot = new LocaleCacheModel();
        return false;
    }

    private static bool TryGetLocaleSnapshot(CacheFileModel fileModel, string cacheKey, out LocaleCacheModel snapshot)
    {
        if (fileModel.Locales.TryGetValue(cacheKey, out var existing) && existing is not null)
        {
            existing.Items = NormalizeCacheItems(existing.Items);
            snapshot = existing;
            return true;
        }

        snapshot = new LocaleCacheModel();
        return false;
    }

    private static void UpsertLocaleSnapshot(CacheFileModel fileModel, LocaleCacheModel snapshot)
    {
        if (fileModel.Locales is null)
        {
            fileModel.Locales = new Dictionary<string, LocaleCacheModel>(StringComparer.OrdinalIgnoreCase);
        }

        var cacheKey = string.IsNullOrWhiteSpace(snapshot.CacheKey)
            ? $"{snapshot.Language}:{(string.IsNullOrWhiteSpace(snapshot.Region) ? "GLOBAL" : snapshot.Region)}"
            : snapshot.CacheKey;

        snapshot.CacheKey = cacheKey;
        snapshot.TargetItemCount = MaxItemsPerLocale;
        snapshot.Items = NormalizeCacheItems(snapshot.Items);

        var reordered = new Dictionary<string, LocaleCacheModel>(StringComparer.OrdinalIgnoreCase)
        {
            [cacheKey] = snapshot
        };

        foreach (var pair in fileModel.Locales)
        {
            if (pair.Value is null || string.Equals(pair.Key, cacheKey, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            reordered[pair.Key] = pair.Value;
        }

        fileModel.Locales = reordered;
    }

    private static CacheSnapshot ToSnapshot(LocaleCacheModel snapshot, bool stale)
    {
        return new CacheSnapshot
        {
            CacheKey = snapshot.CacheKey,
            Language = snapshot.Language,
            Region = snapshot.Region,
            UpdatedAtUtc = snapshot.UpdatedAtUtc,
            TargetItemCount = snapshot.TargetItemCount,
            Stale = stale,
            Items = NormalizeCacheItems(snapshot.Items)
        };
    }

    private CacheFileModel ReadCacheFile(JMSFusionPlugin plugin)
    {
        var filePath = GetCacheFilePath(plugin);
        if (!File.Exists(filePath))
        {
            return new CacheFileModel();
        }

        try
        {
            using var stream = File.OpenRead(filePath);
            var parsed = JsonSerializer.Deserialize<CacheFileModel>(stream, JsonOptions) ?? new CacheFileModel();
            parsed.Version = CacheVersion;
            parsed.Locales = parsed.Locales is null
                ? new Dictionary<string, LocaleCacheModel>(StringComparer.OrdinalIgnoreCase)
                : new Dictionary<string, LocaleCacheModel>(parsed.Locales, StringComparer.OrdinalIgnoreCase);
            return parsed;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Cinema pre-roll cache file could not be read: {FilePath}", filePath);
            return new CacheFileModel();
        }
    }

    private void WriteCacheFile(JMSFusionPlugin plugin, CacheFileModel model)
    {
        var filePath = GetCacheFilePath(plugin);
        var tmpPath = $"{filePath}.tmp";
        Directory.CreateDirectory(Path.GetDirectoryName(filePath) ?? plugin.GetStorageDirectory());
        model.Version = CacheVersion;

        using (var stream = new FileStream(tmpPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            JsonSerializer.Serialize(stream, model, JsonOptions);
        }

        File.Move(tmpPath, filePath, true);
    }

    private static string GetCacheFilePath(JMSFusionPlugin plugin)
    {
        return Path.Combine(plugin.GetStorageDirectory(), CacheFileName);
    }
}
