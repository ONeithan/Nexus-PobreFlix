using System;
using System.Collections.Generic;
using System.Linq;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.JMSFusion.Controllers
{
    [ApiController]
    [Route("JMSFusion/watchlist")]
    [Route("Plugins/JMSFusion/watchlist")]
    public class WatchlistController : ControllerBase
    {
        private static readonly object SyncRoot = new();
        private const int MaxItemsPerUser = 500;
        private const int MaxSharesPerOwner = 2000;
        private const int MaxNoteLength = 600;
        private const int SmartDefaultMovieCount = 4;
        private const int SmartDefaultSeriesCount = 4;
        private const int SmartDefaultMusicCount = 5;
        private const int SmartDefaultAlbumCount = 0;
        private const int SmartMaxPerBucket = 12;
        private const int SmartHistoryLimit = 30;
        private const int SmartCommunityPerUserLimit = 10;
        private const int SmartCommunityUserLimit = 10;
        private const int SmartCandidateLimit = 180;
        private const int SmartBroadCandidateLimit = 260;
        private readonly IUserManager _users;
        private readonly ILibraryManager _libraryManager;
        private readonly IUserDataManager _userDataManager;

        public sealed class AddItemRequest
        {
            public string? ItemId { get; set; }
            public string? ItemType { get; set; }
            public string? Name { get; set; }
            public string? Overview { get; set; }
            public int? ProductionYear { get; set; }
            public long? RunTimeTicks { get; set; }
            public double? CommunityRating { get; set; }
            public string? OfficialRating { get; set; }
            public List<string>? Genres { get; set; }
            public string? AlbumArtist { get; set; }
            public List<string>? Artists { get; set; }
            public string? ParentName { get; set; }
        }

        public sealed class ShareItemRequest
        {
            public string? ItemId { get; set; }
            public List<ShareTargetDto>? Targets { get; set; }
            public string? Note { get; set; }
        }

        public sealed class ShareTargetDto
        {
            public string? UserId { get; set; }
            public string? UserName { get; set; }
        }

        public sealed class SmartFillRequest
        {
            public int? Movies { get; set; }
            public int? Series { get; set; }
            public int? Music { get; set; }
            public int? Albums { get; set; }
            public bool? ForceCommunityFallback { get; set; }
        }

        private sealed class UserContext
        {
            public string UserId { get; init; } = "";
            public string UserName { get; init; } = "";
        }

        private enum SmartBucket
        {
            Movies,
            Series,
            Music,
            Albums
        }

        private sealed class SmartProfile
        {
            public Dictionary<string, double> Genres { get; } = new(StringComparer.OrdinalIgnoreCase);
            public Dictionary<string, double> Studios { get; } = new(StringComparer.OrdinalIgnoreCase);
            public Dictionary<string, double> Artists { get; } = new(StringComparer.OrdinalIgnoreCase);
            public int SeedCount { get; set; }
            public bool HasSignal => Genres.Count > 0 || Studios.Count > 0 || Artists.Count > 0;
        }

        private sealed class SmartBucketResult
        {
            public SmartBucket Bucket { get; init; }
            public string Source { get; set; } = "none";
            public int SeedCount { get; set; }
            public int CandidateCount { get; set; }
            public List<BaseItem> Items { get; } = new();
        }

        public WatchlistController(IUserManager users, ILibraryManager libraryManager, IUserDataManager userDataManager)
        {
            _users = users;
            _libraryManager = libraryManager;
            _userDataManager = userDataManager;
        }

        [HttpGet]
        public IActionResult GetDashboard()
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);
                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                var myItems = cfg.WatchlistEntries
                    .Where(entry => Same(entry.OwnerUserId, user.UserId))
                    .OrderByDescending(entry => entry.AddedAtUtc)
                    .ToList();

                var entryById = cfg.WatchlistEntries
                    .Where(entry => !string.IsNullOrWhiteSpace(entry.Id))
                    .GroupBy(entry => entry.Id!, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

                var sharedWithMe = cfg.WatchlistShares
                    .Where(share => Same(share.TargetUserId, user.UserId))
                    .OrderByDescending(share => share.SharedAtUtc)
                    .Select(share => new
                    {
                        share.Id,
                        share.ItemId,
                        share.Note,
                        share.SharedAtUtc,
                        share.OwnerUserId,
                        share.OwnerUserName,
                        share.TargetUserId,
                        share.TargetUserName,
                        Entry = ResolveSharedEntry(share, entryById)
                    })
                    .Where(row => row.Entry is not null)
                    .ToList();

                var outgoingShares = cfg.WatchlistShares
                    .Where(share => Same(share.OwnerUserId, user.UserId))
                    .OrderByDescending(share => share.SharedAtUtc)
                    .Select(share => new
                    {
                        share.Id,
                        share.ItemId,
                        share.Note,
                        share.SharedAtUtc,
                        share.TargetUserId,
                        share.TargetUserName,
                        Entry = ResolveSharedEntry(share, entryById)
                    })
                    .Where(row => row.Entry is not null)
                    .ToList();

                var historyEntries = cfg.WatchlistHistoryEntries
                    .Where(entry => Same(entry.OwnerUserId, user.UserId))
                    .OrderByDescending(entry => entry.LastAddedAtUtc)
                    .ToList();

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.WatchlistRevision,
                    myItems,
                    sharedWithMe,
                    outgoingShares,
                    historyEntries
                });
            }
        }

        [HttpPost("items")]
        public IActionResult AddItem([FromBody] AddItemRequest req)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var itemId = Clean(req.ItemId);
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return BadRequest(new { ok = false, error = "itemId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);
                var created = false;

                var existing = cfg.WatchlistEntries.FirstOrDefault(entry =>
                    Same(entry.OwnerUserId, user.UserId) &&
                    Same(entry.ItemId, itemId));

                if (existing is null)
                {
                    created = true;
                    existing = new WatchlistEntry
                    {
                        Id = Guid.NewGuid().ToString("N"),
                        ItemId = itemId,
                        AddedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                        OwnerUserId = user.UserId,
                        OwnerUserName = user.UserName
                    };
                    cfg.WatchlistEntries.Add(existing);
                    changed = true;
                }

                changed |= ApplySnapshot(existing, req, user);
                if (created)
                {
                    changed |= RegisterHistoryAdd(cfg, existing, user, existing.AddedAtUtc);
                }
                changed |= TrimOwnerItems(cfg, user.UserId);

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    inWatchlist = true,
                    revision = cfg.WatchlistRevision,
                    item = existing
                });
            }
        }

        [HttpDelete("items/{itemId}")]
        public IActionResult RemoveItem(string itemId)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var cleanItemId = Clean(itemId);
            if (string.IsNullOrWhiteSpace(cleanItemId))
            {
                return BadRequest(new { ok = false, error = "itemId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);
                var removedAfterPlayed = IsTrue(Request.Query["played"].FirstOrDefault()) || IsTrue(Request.Query["completed"].FirstOrDefault());

                var hasOwnEntry = cfg.WatchlistEntries.Any(entry =>
                    Same(entry.OwnerUserId, user.UserId) &&
                    Same(entry.ItemId, cleanItemId));

                if (hasOwnEntry)
                {
                    var removedEntries = cfg.WatchlistEntries
                        .Where(entry =>
                            Same(entry.OwnerUserId, user.UserId) &&
                            Same(entry.ItemId, cleanItemId))
                        .Select(CloneEntry)
                        .ToList();

                    changed |= cfg.WatchlistEntries.RemoveAll(entry =>
                        Same(entry.OwnerUserId, user.UserId) &&
                        Same(entry.ItemId, cleanItemId)) > 0;

                    foreach (var removedEntry in removedEntries)
                    {
                        changed |= RegisterHistoryRemoval(cfg, removedEntry, user, removedAfterPlayed);
                    }
                }
                else
                {
                    changed |= cfg.WatchlistShares.RemoveAll(share =>
                        Same(share.TargetUserId, user.UserId) &&
                        Same(share.ItemId, cleanItemId)) > 0;
                }

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    inWatchlist = false,
                    revision = cfg.WatchlistRevision
                });
            }
        }

        [HttpPost("shares")]
        public IActionResult ShareItem([FromBody] ShareItemRequest req)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var itemId = Clean(req.ItemId);
            if (string.IsNullOrWhiteSpace(itemId))
            {
                return BadRequest(new { ok = false, error = "itemId gerekli" });
            }

            var targets = (req.Targets ?? new List<ShareTargetDto>())
                .Select(target => new
                {
                    UserId = Clean(target.UserId),
                    UserName = Clean(target.UserName)
                })
                .Where(target => !string.IsNullOrWhiteSpace(target.UserId) && !Same(target.UserId, user.UserId))
                .GroupBy(target => target.UserId!, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .ToList();

            if (targets.Count == 0)
            {
                return BadRequest(new { ok = false, error = "En az bir kullanıcı seçilmeli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var entry = cfg.WatchlistEntries.FirstOrDefault(candidate =>
                    Same(candidate.OwnerUserId, user.UserId) &&
                    Same(candidate.ItemId, itemId));

                if (entry is null)
                {
                    return NotFound(new { ok = false, error = "Öğe watchlist içinde bulunamadı" });
                }

                var note = NormalizeNote(req.Note);
                var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

                foreach (var target in targets)
                {
                    var share = cfg.WatchlistShares.FirstOrDefault(candidate =>
                        Same(candidate.OwnerUserId, user.UserId) &&
                        Same(candidate.TargetUserId, target.UserId) &&
                        Same(candidate.ItemId, itemId));

                    if (share is null)
                    {
                        share = new WatchlistShareEntry
                        {
                            Id = Guid.NewGuid().ToString("N"),
                            WatchlistEntryId = entry.Id,
                            ItemId = entry.ItemId,
                            OwnerUserId = user.UserId,
                            OwnerUserName = user.UserName,
                            TargetUserId = target.UserId,
                            TargetUserName = target.UserName,
                            Note = note,
                            SharedAtUtc = now
                        };
                        cfg.WatchlistShares.Add(share);
                        changed = true;
                    }

                    if (!Same(share.WatchlistEntryId, entry.Id)) { share.WatchlistEntryId = entry.Id; changed = true; }
                    if (!Same(share.OwnerUserName, user.UserName)) { share.OwnerUserName = user.UserName; changed = true; }
                    if (!Same(share.TargetUserName, target.UserName) && !string.IsNullOrWhiteSpace(target.UserName))
                    {
                        share.TargetUserName = target.UserName;
                        changed = true;
                    }
                    if (!Same(share.Note, note)) { share.Note = note; changed = true; }
                    if (share.SharedAtUtc != now) { share.SharedAtUtc = now; changed = true; }
                    changed |= ApplyShareSnapshot(share, entry);
                }

                changed |= TrimOwnerShares(cfg, user.UserId);

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.WatchlistRevision,
                    sharedCount = targets.Count
                });
            }
        }

        [HttpDelete("shares/{shareId}")]
        public IActionResult RemoveShare(string shareId)
        {
            var user = ReadUserContext();
            if (string.IsNullOrWhiteSpace(user.UserId))
            {
                return Unauthorized(new { ok = false, error = "X-Emby-UserId gerekli" });
            }

            var cleanShareId = Clean(shareId);
            if (string.IsNullOrWhiteSpace(cleanShareId))
            {
                return BadRequest(new { ok = false, error = "shareId gerekli" });
            }

            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);

                var share = cfg.WatchlistShares.FirstOrDefault(candidate => Same(candidate.Id, cleanShareId));
                if (share is null)
                {
                    return NotFound(new { ok = false, error = "Paylaşım bulunamadı" });
                }

                if (!Same(share.OwnerUserId, user.UserId) && !Same(share.TargetUserId, user.UserId))
                {
                    return StatusCode(403, new { ok = false, error = "Bu paylaşımı kaldıramazsın" });
                }

                changed |= cfg.WatchlistShares.RemoveAll(candidate => Same(candidate.Id, cleanShareId)) > 0;

                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                NoCache();
                return Ok(new
                {
                    ok = true,
                    revision = cfg.WatchlistRevision
                });
            }
        }

        [HttpPost("smart-fill")]
        public IActionResult GetSmartFill([FromBody] SmartFillRequest? request)
        {
            var userCheck = TryGetRequestUserEntity();
            if (userCheck.Result is not null)
            {
                return userCheck.Result;
            }

            var currentUser = userCheck.User ?? throw new InvalidOperationException("User not available.");
            var currentUserContext = userCheck.Context ?? throw new InvalidOperationException("User context not available.");
            var useCommunityFallback = request?.ForceCommunityFallback == true;
            var blockedItemIds = GetSmartBlockedItemIds(currentUserContext.UserId);
            var targets = new Dictionary<SmartBucket, int>
            {
                [SmartBucket.Movies] = ClampSmartTargetCount(request?.Movies, SmartDefaultMovieCount),
                [SmartBucket.Series] = ClampSmartTargetCount(request?.Series, SmartDefaultSeriesCount),
                [SmartBucket.Music] = ClampSmartTargetCount(request?.Music, SmartDefaultMusicCount),
                [SmartBucket.Albums] = ClampSmartTargetCount(request?.Albums, SmartDefaultAlbumCount)
            };

            var results = targets
                .Where(entry => entry.Value > 0)
                .Select(entry => BuildSmartBucketResult(currentUser, entry.Key, entry.Value, blockedItemIds, useCommunityFallback))
                .ToList();

            var responseItems = results
                .SelectMany(result => result.Items.Select(item => ToSmartResponseItem(result.Bucket, item)))
                .ToList();

            var hasAnySignal = results.Any(result => result.SeedCount > 0 && !Same(result.Source, "none"));
            var message = responseItems.Count > 0
                ? string.Empty
                : hasAnySignal
                    ? "İzlenmemiş veya dinlenmemiş uygun içerik bulunamadı."
                    : "Akıllı öneri üretmek için yeterli izleme geçmişi bulunamadı.";

            NoCache();
            return Ok(new
            {
                ok = true,
                usedCommunityFallback = results.Any(result => Same(result.Source, "community")),
                breakdown = new
                {
                    movies = results.FirstOrDefault(result => result.Bucket == SmartBucket.Movies)?.Items.Count ?? 0,
                    series = results.FirstOrDefault(result => result.Bucket == SmartBucket.Series)?.Items.Count ?? 0,
                    music = results.FirstOrDefault(result => result.Bucket == SmartBucket.Music)?.Items.Count ?? 0,
                    albums = results.FirstOrDefault(result => result.Bucket == SmartBucket.Albums)?.Items.Count ?? 0
                },
                sources = new
                {
                    movies = results.FirstOrDefault(result => result.Bucket == SmartBucket.Movies)?.Source ?? "none",
                    series = results.FirstOrDefault(result => result.Bucket == SmartBucket.Series)?.Source ?? "none",
                    music = results.FirstOrDefault(result => result.Bucket == SmartBucket.Music)?.Source ?? "none",
                    albums = results.FirstOrDefault(result => result.Bucket == SmartBucket.Albums)?.Source ?? "none"
                },
                items = responseItems,
                message
            });
        }

        private static object? ResolveSharedEntry(
            WatchlistShareEntry share,
            IReadOnlyDictionary<string, WatchlistEntry> entryById)
        {
            var entryId = Clean(share.WatchlistEntryId);
            if (!string.IsNullOrWhiteSpace(entryId) && entryById.TryGetValue(entryId, out var entry))
            {
                return entry;
            }

            return HasShareSnapshot(share) ? share.EntrySnapshot : null;
        }

        private static bool ApplySnapshot(WatchlistEntry entry, AddItemRequest req, UserContext user)
        {
            var changed = false;
            var itemType = Clean(req.ItemType);
            var name = Clean(req.Name);
            var overview = Clean(req.Overview);
            var officialRating = Clean(req.OfficialRating);
            var albumArtist = Clean(req.AlbumArtist);
            var parentName = Clean(req.ParentName);

            if (!Same(entry.ItemType, itemType))
            {
                entry.ItemType = itemType;
                changed = true;
            }

            if (!Same(entry.Name, name))
            {
                entry.Name = name;
                changed = true;
            }

            if (!Same(entry.Overview, overview))
            {
                entry.Overview = overview;
                changed = true;
            }

            if (!Same(entry.OfficialRating, officialRating))
            {
                entry.OfficialRating = officialRating;
                changed = true;
            }

            if (!Same(entry.AlbumArtist, albumArtist))
            {
                entry.AlbumArtist = albumArtist;
                changed = true;
            }

            if (!Same(entry.ParentName, parentName))
            {
                entry.ParentName = parentName;
                changed = true;
            }

            if (!string.IsNullOrWhiteSpace(user.UserName) && !Same(entry.OwnerUserName, user.UserName))
            {
                entry.OwnerUserName = user.UserName;
                changed = true;
            }

            if (entry.ProductionYear != req.ProductionYear)
            {
                entry.ProductionYear = req.ProductionYear;
                changed = true;
            }

            if (entry.RunTimeTicks != req.RunTimeTicks)
            {
                entry.RunTimeTicks = req.RunTimeTicks;
                changed = true;
            }

            if (entry.CommunityRating != req.CommunityRating)
            {
                entry.CommunityRating = req.CommunityRating;
                changed = true;
            }

            var genres = NormalizeStringList(req.Genres);
            if (!ListsEqual(entry.Genres, genres))
            {
                entry.Genres = genres;
                changed = true;
            }

            var artists = NormalizeStringList(req.Artists);
            if (!ListsEqual(entry.Artists, artists))
            {
                entry.Artists = artists;
                changed = true;
            }

            return changed;
        }

        private SmartBucketResult BuildSmartBucketResult(
            User currentUser,
            SmartBucket bucket,
            int targetCount,
            IReadOnlyCollection<string> blockedItemIds,
            bool forceCommunityFallback)
        {
            var historyItems = QuerySmartHistoryItems(currentUser, bucket, SmartHistoryLimit);
            var historyExcludeIds = GetSmartHistoryExcludeIds(historyItems, bucket);
            var personalProfile = BuildSmartProfile(currentUser, historyItems, bucket);
            var profile = personalProfile;
            var source = personalProfile.HasSignal && !forceCommunityFallback ? "personal" : "none";

            if (forceCommunityFallback || !personalProfile.HasSignal)
            {
                var communityProfile = BuildSmartCommunityProfile(currentUser.Id, bucket);
                if (communityProfile.HasSignal)
                {
                    profile = communityProfile;
                    source = "community";
                }
                else if (personalProfile.HasSignal)
                {
                    profile = personalProfile;
                    source = "personal";
                }
            }

            var result = new SmartBucketResult
            {
                Bucket = bucket,
                Source = source,
                SeedCount = profile.SeedCount
            };

            if (!profile.HasSignal || targetCount <= 0)
            {
                return result;
            }

            var exclusions = new HashSet<string>(blockedItemIds ?? Array.Empty<string>(), StringComparer.OrdinalIgnoreCase);
            foreach (var id in historyExcludeIds)
            {
                exclusions.Add(id);
            }

            var candidates = CollectSmartCandidatePool(currentUser, bucket, profile, exclusions, targetCount);
            result.CandidateCount = candidates.Count;
            result.Items.AddRange(RankSmartCandidates(bucket, candidates, profile, exclusions, targetCount));
            return result;
        }

        private IReadOnlyList<BaseItem> QuerySmartHistoryItems(User user, SmartBucket bucket, int limit)
        {
            try
            {
                var query = new InternalItemsQuery
                {
                    User = user,
                    Recursive = true,
                    IncludeItemTypes = GetSmartHistoryKinds(bucket),
                    IsPlayed = true,
                    Limit = Math.Max(1, limit),
                    EnableTotalRecordCount = false,
                    OrderBy = new[]
                    {
                        (ItemSortBy.DatePlayed, SortOrder.Descending),
                        (ItemSortBy.PlayCount, SortOrder.Descending),
                        (ItemSortBy.DateCreated, SortOrder.Descending)
                    }
                };

                return _libraryManager.GetItemList(query) ?? Array.Empty<BaseItem>();
            }
            catch
            {
                return Array.Empty<BaseItem>();
            }
        }

        private SmartProfile BuildSmartCommunityProfile(Guid currentUserId, SmartBucket bucket)
        {
            var merged = new SmartProfile();

            foreach (var otherUser in (_users.Users ?? Array.Empty<User>())
                .Where(user => user is not null && user.Id != Guid.Empty && user.Id != currentUserId)
                .OrderByDescending(user => user.LastActivityDate ?? DateTime.MinValue)
                .ThenBy(user => user.Username ?? string.Empty, StringComparer.OrdinalIgnoreCase)
                .Take(SmartCommunityUserLimit))
            {
                var historyItems = QuerySmartHistoryItems(otherUser, bucket, SmartCommunityPerUserLimit);
                var profile = BuildSmartProfile(otherUser, historyItems, bucket);
                if (!profile.HasSignal) continue;

                MergeSmartProfile(merged, profile, 0.72);
            }

            return merged;
        }

        private SmartProfile BuildSmartProfile(User user, IReadOnlyList<BaseItem> historyItems, SmartBucket bucket)
        {
            var profile = new SmartProfile();
            var seenSignalIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var rank = 0;

            foreach (var historyItem in historyItems ?? Array.Empty<BaseItem>())
            {
                if (historyItem is null) continue;

                var signalItem = GetSmartProfileSourceItem(bucket, historyItem) ?? historyItem;
                var signalId = NormalizeItemId(signalItem);
                if (string.IsNullOrWhiteSpace(signalId) || !seenSignalIds.Add(signalId)) continue;

                var userData = SafeGetUserData(user, historyItem);
                var weight = ComputeSmartHistoryWeight(userData, rank);
                rank += 1;

                if (weight <= 0) continue;

                profile.SeedCount += 1;
                AddWeightedValues(profile.Genres, signalItem.Genres, weight * 2.15);
                AddWeightedValues(profile.Studios, signalItem.Studios, weight * ((bucket == SmartBucket.Music || bucket == SmartBucket.Albums) ? 0.35 : 1.2));
                AddWeightedValues(profile.Artists, GetSmartArtists(signalItem), weight * ((bucket == SmartBucket.Music || bucket == SmartBucket.Albums) ? 2.65 : 0.45));
            }

            return profile;
        }

        private IReadOnlyList<BaseItem> CollectSmartCandidatePool(
            User currentUser,
            SmartBucket bucket,
            SmartProfile profile,
            HashSet<string> exclusions,
            int targetCount)
        {
            var merged = new List<BaseItem>();
            var seenItemIds = new HashSet<string>(exclusions ?? new HashSet<string>(StringComparer.OrdinalIgnoreCase), StringComparer.OrdinalIgnoreCase);
            var primaryGenres = GetTopWeightedKeys(profile.Genres, bucket == SmartBucket.Music || bucket == SmartBucket.Albums ? 4 : 3);

            if (primaryGenres.Count > 0)
            {
                AddSmartCandidates(
                    merged,
                    seenItemIds,
                    QuerySmartCandidateItems(currentUser, bucket, Math.Max(SmartCandidateLimit, targetCount * 18), primaryGenres.Take(3).ToArray()));

                if (primaryGenres.Count > 3)
                {
                    AddSmartCandidates(
                        merged,
                        seenItemIds,
                        QuerySmartCandidateItems(currentUser, bucket, Math.Max(SmartCandidateLimit, targetCount * 18), primaryGenres.Take(6).ToArray()));
                }
            }

            AddSmartCandidates(
                merged,
                seenItemIds,
                QuerySmartCandidateItems(currentUser, bucket, Math.Max(SmartBroadCandidateLimit, targetCount * 24), null));

            return merged;
        }

        private IReadOnlyList<BaseItem> QuerySmartCandidateItems(
            User currentUser,
            SmartBucket bucket,
            int limit,
            IReadOnlyList<string>? genres)
        {
            try
            {
                var query = new InternalItemsQuery
                {
                    User = currentUser,
                    Recursive = true,
                    IncludeItemTypes = GetSmartCandidateKinds(bucket),
                    IsPlayed = false,
                    Limit = Math.Max(1, limit),
                    EnableTotalRecordCount = false,
                    MinCommunityRating = bucket == SmartBucket.Movies || bucket == SmartBucket.Series ? 5.0 : null,
                    OrderBy = new[]
                    {
                        (ItemSortBy.CommunityRating, SortOrder.Descending),
                        (ItemSortBy.DateCreated, SortOrder.Descending)
                    }
                };

                if (genres is not null && genres.Count > 0)
                {
                    query.Genres = genres.ToArray();
                }

                return _libraryManager.GetItemList(query) ?? Array.Empty<BaseItem>();
            }
            catch
            {
                return Array.Empty<BaseItem>();
            }
        }

        private IReadOnlyList<BaseItem> RankSmartCandidates(
            SmartBucket bucket,
            IReadOnlyList<BaseItem> candidates,
            SmartProfile profile,
            HashSet<string> exclusions,
            int limit)
        {
            return (candidates ?? Array.Empty<BaseItem>())
                .Where(item =>
                {
                    var itemId = NormalizeItemId(item);
                    return !string.IsNullOrWhiteSpace(itemId) && !exclusions.Contains(itemId);
                })
                .Select(item => new
                {
                    Item = item,
                    Score = ScoreSmartCandidate(bucket, item, profile)
                })
                .Where(entry => entry.Score > 0)
                .OrderByDescending(entry => entry.Score)
                .ThenByDescending(entry => entry.Item.CommunityRating ?? 0)
                .ThenByDescending(entry => entry.Item.PremiereDate ?? entry.Item.DateCreated)
                .Take(Math.Max(1, limit))
                .Select(entry => entry.Item)
                .ToList();
        }

        private static double ScoreSmartCandidate(SmartBucket bucket, BaseItem item, SmartProfile profile)
        {
            if (item is null) return 0;

            var score = 0d;
            var matches = 0;

            matches += AccumulateSignalScore(profile.Genres, item.Genres, 1.85, ref score);
            matches += AccumulateSignalScore(profile.Studios, item.Studios, (bucket == SmartBucket.Music || bucket == SmartBucket.Albums) ? 0.2 : 1.1, ref score);
            matches += AccumulateSignalScore(profile.Artists, GetSmartArtists(item), (bucket == SmartBucket.Music || bucket == SmartBucket.Albums) ? 2.35 : 0.4, ref score);

            if (matches <= 0)
            {
                return 0;
            }

            if (item.CommunityRating.HasValue)
            {
                score += Math.Clamp(item.CommunityRating.Value, 0, 10) / 10d * ((bucket == SmartBucket.Music || bucket == SmartBucket.Albums) ? 0.55 : 0.95);
            }

            var releaseDate = item.PremiereDate ?? item.DateCreated;
            var ageDays = Math.Max(0, (DateTime.UtcNow - releaseDate).TotalDays);
            if (ageDays <= 3650)
            {
                score += Math.Max(0.05, 0.28 - ((ageDays / 3650d) * 0.18));
            }

            return score;
        }

        private static int AccumulateSignalScore(
            IReadOnlyDictionary<string, double> weights,
            IEnumerable<string>? values,
            double multiplier,
            ref double score)
        {
            if (weights.Count == 0 || multiplier <= 0) return 0;

            var matches = 0;
            foreach (var value in NormalizeStringList(values))
            {
                if (!weights.TryGetValue(value, out var weight)) continue;
                score += weight * multiplier;
                matches += 1;
            }

            return matches;
        }

        private static void AddSmartCandidates(
            ICollection<BaseItem> target,
            ISet<string> seenItemIds,
            IEnumerable<BaseItem>? candidates)
        {
            foreach (var item in candidates ?? Array.Empty<BaseItem>())
            {
                var itemId = NormalizeItemId(item);
                if (string.IsNullOrWhiteSpace(itemId) || !seenItemIds.Add(itemId)) continue;
                target.Add(item);
            }
        }

        private static SmartProfile MergeSmartProfile(SmartProfile target, SmartProfile source, double factor)
        {
            target.SeedCount += source.SeedCount;

            foreach (var entry in source.Genres)
            {
                target.Genres[entry.Key] = target.Genres.TryGetValue(entry.Key, out var current)
                    ? current + (entry.Value * factor)
                    : entry.Value * factor;
            }

            foreach (var entry in source.Studios)
            {
                target.Studios[entry.Key] = target.Studios.TryGetValue(entry.Key, out var current)
                    ? current + (entry.Value * factor)
                    : entry.Value * factor;
            }

            foreach (var entry in source.Artists)
            {
                target.Artists[entry.Key] = target.Artists.TryGetValue(entry.Key, out var current)
                    ? current + (entry.Value * factor)
                    : entry.Value * factor;
            }

            return target;
        }

        private static void AddWeightedValues(IDictionary<string, double> target, IEnumerable<string>? values, double weight)
        {
            if (weight <= 0) return;

            foreach (var value in NormalizeStringList(values))
            {
                target[value] = target.TryGetValue(value, out var existing)
                    ? existing + weight
                    : weight;
            }
        }

        private static List<string> GetTopWeightedKeys(IReadOnlyDictionary<string, double> weights, int limit)
        {
            return weights
                .OrderByDescending(entry => entry.Value)
                .ThenBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)
                .Take(Math.Max(0, limit))
                .Select(entry => entry.Key)
                .ToList();
        }

        private static double ComputeSmartHistoryWeight(UserItemData? userData, int rank)
        {
            var recencyWeight = Math.Max(0.42, 1.4 - (rank * 0.08));
            var playCount = Math.Max(1, userData?.PlayCount ?? (userData?.Played == true ? 1 : 0));
            var playBoost = Math.Min(1.8, 1.0 + ((playCount - 1) * 0.18));
            var freshnessBoost = 1.0;

            if (userData?.LastPlayedDate is DateTime lastPlayedDate)
            {
                var ageDays = Math.Max(0, (DateTime.UtcNow - lastPlayedDate).TotalDays);
                if (ageDays <= 30) freshnessBoost = 1.22;
                else if (ageDays <= 90) freshnessBoost = 1.12;
                else if (ageDays <= 180) freshnessBoost = 1.0;
                else if (ageDays <= 365) freshnessBoost = 0.92;
                else freshnessBoost = 0.84;
            }

            return recencyWeight * playBoost * freshnessBoost;
        }

        private UserItemData? SafeGetUserData(User user, BaseItem item)
        {
            try
            {
                return _userDataManager.GetUserData(user, item);
            }
            catch
            {
                return null;
            }
        }

        private static HashSet<string> GetSmartHistoryExcludeIds(IEnumerable<BaseItem>? historyItems, SmartBucket bucket)
        {
            var excludedIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var item in historyItems ?? Array.Empty<BaseItem>())
            {
                foreach (var id in GetSmartHistoryExcludeIdsForItem(bucket, item))
                {
                    if (!string.IsNullOrWhiteSpace(id))
                    {
                        excludedIds.Add(id);
                    }
                }
            }

            return excludedIds;
        }

        private static IEnumerable<string> GetSmartHistoryExcludeIdsForItem(SmartBucket bucket, BaseItem item)
        {
            switch (bucket)
            {
                case SmartBucket.Series:
                    if (item is Episode episode && episode.SeriesId != Guid.Empty)
                    {
                        yield return NormalizeGuidString(episode.SeriesId);
                        yield break;
                    }

                    if (item is Season season && season.SeriesId != Guid.Empty)
                    {
                        yield return NormalizeGuidString(season.SeriesId);
                        yield break;
                    }

                    yield return NormalizeItemId(item);
                    yield break;

                case SmartBucket.Albums:
                    if (item is Audio audio && audio.AlbumEntity is not null)
                    {
                        yield return NormalizeItemId(audio.AlbumEntity);
                        yield break;
                    }

                    yield return NormalizeItemId(item);
                    yield break;

                default:
                    yield return NormalizeItemId(item);
                    yield break;
            }
        }

        private static BaseItemKind[] GetSmartHistoryKinds(SmartBucket bucket)
        {
            return bucket switch
            {
                SmartBucket.Movies => new[]
                {
                    BaseItemKind.Movie,
                    BaseItemKind.Series,
                    BaseItemKind.Season,
                    BaseItemKind.Episode
                },
                SmartBucket.Series => new[]
                {
                    BaseItemKind.Movie,
                    BaseItemKind.Series,
                    BaseItemKind.Season,
                    BaseItemKind.Episode
                },
                SmartBucket.Music => new[]
                {
                    BaseItemKind.Audio
                },
                SmartBucket.Albums => new[]
                {
                    BaseItemKind.Audio,
                    BaseItemKind.MusicAlbum
                },
                _ => Array.Empty<BaseItemKind>()
            };
        }

        private static BaseItemKind[] GetSmartCandidateKinds(SmartBucket bucket)
        {
            return bucket switch
            {
                SmartBucket.Movies => new[] { BaseItemKind.Movie },
                SmartBucket.Series => new[] { BaseItemKind.Series },
                SmartBucket.Music => new[] { BaseItemKind.Audio },
                SmartBucket.Albums => new[] { BaseItemKind.MusicAlbum },
                _ => Array.Empty<BaseItemKind>()
            };
        }

        private static BaseItem GetSmartProfileSourceItem(SmartBucket bucket, BaseItem item)
        {
            if ((bucket == SmartBucket.Movies || bucket == SmartBucket.Series) && item is Episode episode && episode.Series is not null)
            {
                return episode.Series;
            }

            if ((bucket == SmartBucket.Movies || bucket == SmartBucket.Series) && item is Season season && season.Series is not null)
            {
                return season.Series;
            }

            if (bucket == SmartBucket.Albums && item is Audio audio && audio.AlbumEntity is not null)
            {
                return audio.AlbumEntity;
            }

            return item;
        }

        private static IEnumerable<string> GetSmartArtists(BaseItem item)
        {
            if (item is MusicAlbum album)
            {
                return NormalizeStringList((album.Artists ?? Array.Empty<string>())
                    .Concat(album.AlbumArtists ?? Array.Empty<string>())
                    .Concat(new[] { album.AlbumArtist }));
            }

            if (item is Audio audio)
            {
                return NormalizeStringList((audio.Artists ?? Array.Empty<string>())
                    .Concat(audio.AlbumArtists ?? Array.Empty<string>()));
            }

            return Array.Empty<string>();
        }

        private static string GetSmartAlbumArtist(BaseItem item)
        {
            if (item is MusicAlbum album)
            {
                return Clean(album.AlbumArtist) is string direct && !string.IsNullOrWhiteSpace(direct)
                    ? direct
                    : Clean((album.AlbumArtists ?? Array.Empty<string>()).FirstOrDefault());
            }

            if (item is Audio audio)
            {
                return Clean((audio.AlbumArtists ?? Array.Empty<string>()).FirstOrDefault());
            }

            return string.Empty;
        }

        private static string GetSmartAlbumName(BaseItem item)
        {
            if (item is Audio audio)
            {
                return Clean(audio.Album);
            }

            if (item is MusicAlbum album)
            {
                return Clean(album.Album);
            }

            return string.Empty;
        }

        private static string GetSmartParentName(BaseItem item)
        {
            if (item is Audio audio)
            {
                return Clean(audio.Album);
            }

            if (item is Episode episode)
            {
                return Clean(episode.SeriesName);
            }

            if (item is Season season)
            {
                return Clean(season.SeriesName);
            }

            return string.Empty;
        }

        private HashSet<string> GetSmartBlockedItemIds(string ownerUserId)
        {
            lock (SyncRoot)
            {
                var plugin = JMSFusionPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
                var cfg = plugin.Configuration;
                var changed = NormalizeConfig(cfg);
                if (changed)
                {
                    TouchRevision(cfg);
                    plugin.UpdateConfiguration(cfg);
                }

                var blockedIds = cfg.WatchlistEntries
                    .Where(entry => Same(entry.OwnerUserId, ownerUserId))
                    .Select(entry => Clean(entry.ItemId))
                    .Where(id => !string.IsNullOrWhiteSpace(id))
                    .ToHashSet(StringComparer.OrdinalIgnoreCase);

                foreach (var sharedItemId in cfg.WatchlistShares
                    .Where(share => Same(share.TargetUserId, ownerUserId))
                    .Select(share => Clean(share.ItemId))
                    .Where(id => !string.IsNullOrWhiteSpace(id)))
                {
                    blockedIds.Add(sharedItemId);
                }

                return blockedIds;
            }
        }

        private static object ToSmartResponseItem(SmartBucket bucket, BaseItem item)
        {
            return new
            {
                Id = NormalizeItemId(item),
                Type = item.GetType().Name,
                Name = Clean(item.Name),
                Overview = Clean(item.Overview),
                ProductionYear = item.ProductionYear,
                RunTimeTicks = item.RunTimeTicks,
                CommunityRating = item.CommunityRating.HasValue ? Convert.ToDouble(item.CommunityRating.Value) : (double?)null,
                OfficialRating = Clean(item.OfficialRating),
                Genres = NormalizeStringList(item.Genres),
                AlbumArtist = GetSmartAlbumArtist(item),
                Artists = NormalizeStringList(GetSmartArtists(item)),
                Album = GetSmartAlbumName(item),
                ParentName = GetSmartParentName(item),
                Bucket = GetSmartBucketKey(bucket)
            };
        }

        private static string GetSmartBucketKey(SmartBucket bucket)
        {
            return bucket switch
            {
                SmartBucket.Movies => "movies",
                SmartBucket.Series => "series",
                SmartBucket.Music => "music",
                SmartBucket.Albums => "albums",
                _ => "movies"
            };
        }

        private static string NormalizeItemId(BaseItem? item)
        {
            return item is null ? string.Empty : NormalizeGuidString(item.Id);
        }

        private static string NormalizeGuidString(Guid guid)
        {
            return guid == Guid.Empty ? string.Empty : guid.ToString("N");
        }

        private static int ClampSmartTargetCount(int? value, int fallback)
        {
            var normalized = value ?? fallback;
            return Math.Max(0, Math.Min(SmartMaxPerBucket, normalized));
        }

        private static bool TrimOwnerItems(JMSFusionConfiguration cfg, string ownerUserId)
        {
            var ownerItems = cfg.WatchlistEntries
                .Where(entry => Same(entry.OwnerUserId, ownerUserId))
                .OrderByDescending(entry => entry.AddedAtUtc)
                .ToList();

            if (ownerItems.Count <= MaxItemsPerUser) return false;

            var removeIds = ownerItems
                .Skip(MaxItemsPerUser)
                .Select(entry => Clean(entry.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var removed = cfg.WatchlistEntries.RemoveAll(entry =>
                Same(entry.OwnerUserId, ownerUserId) &&
                removeIds.Contains(Clean(entry.Id))) > 0;

            return removed;
        }

        private static bool TrimOwnerShares(JMSFusionConfiguration cfg, string ownerUserId)
        {
            var shares = cfg.WatchlistShares
                .Where(share => Same(share.OwnerUserId, ownerUserId))
                .OrderByDescending(share => share.SharedAtUtc)
                .ToList();

            if (shares.Count <= MaxSharesPerOwner) return false;

            var removeIds = shares
                .Skip(MaxSharesPerOwner)
                .Select(share => Clean(share.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            return cfg.WatchlistShares.RemoveAll(share =>
                Same(share.OwnerUserId, ownerUserId) &&
                removeIds.Contains(Clean(share.Id))) > 0;
        }

        private static bool NormalizeConfig(JMSFusionConfiguration cfg)
        {
            var changed = false;

            cfg.WatchlistEntries ??= new List<WatchlistEntry>();
            cfg.WatchlistShares ??= new List<WatchlistShareEntry>();
            cfg.WatchlistHistoryEntries ??= new List<WatchlistHistoryEntry>();

            var uniqueEntries = new Dictionary<string, WatchlistEntry>(StringComparer.OrdinalIgnoreCase);
            var normalizedEntries = new List<WatchlistEntry>();

            foreach (var raw in cfg.WatchlistEntries)
            {
                if (raw is null) { changed = true; continue; }

                var entry = NormalizeEntry(raw);
                if (string.IsNullOrWhiteSpace(entry.ItemId) || string.IsNullOrWhiteSpace(entry.OwnerUserId))
                {
                    changed = true;
                    continue;
                }

                var dedupeKey = $"{entry.OwnerUserId}::{entry.ItemId}";
                if (uniqueEntries.TryGetValue(dedupeKey, out var existing))
                {
                    if (MergeEntry(existing, entry)) changed = true;
                    changed = true;
                    continue;
                }

                uniqueEntries[dedupeKey] = entry;
                normalizedEntries.Add(entry);
                if (!ReferenceEquals(raw, entry)) changed = true;
            }

            cfg.WatchlistEntries = normalizedEntries;

            var validEntryIds = normalizedEntries
                .Select(entry => Clean(entry.Id))
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var entryById = normalizedEntries
                .Where(entry => !string.IsNullOrWhiteSpace(entry.Id))
                .GroupBy(entry => entry.Id!, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.OrdinalIgnoreCase);

            var uniqueShares = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var normalizedShares = new List<WatchlistShareEntry>();

            foreach (var raw in cfg.WatchlistShares)
            {
                if (raw is null) { changed = true; continue; }

                var share = NormalizeShare(raw);
                if (NormalizeShareSnapshot(share)) changed = true;

                var hasValidEntryRef =
                    !string.IsNullOrWhiteSpace(share.WatchlistEntryId) &&
                    validEntryIds.Contains(share.WatchlistEntryId);

                if (hasValidEntryRef &&
                    entryById.TryGetValue(share.WatchlistEntryId!, out var linkedEntry) &&
                    ApplyShareSnapshot(share, linkedEntry))
                {
                    changed = true;
                }

                if (string.IsNullOrWhiteSpace(share.Id) ||
                    string.IsNullOrWhiteSpace(share.ItemId) ||
                    string.IsNullOrWhiteSpace(share.OwnerUserId) ||
                    string.IsNullOrWhiteSpace(share.TargetUserId) ||
                    (!hasValidEntryRef && !HasShareSnapshot(share)))
                {
                    changed = true;
                    continue;
                }

                var dedupeKey = $"{share.OwnerUserId}::{share.TargetUserId}::{share.ItemId}";
                if (!uniqueShares.Add(dedupeKey))
                {
                    changed = true;
                    continue;
                }

                normalizedShares.Add(share);
                if (!ReferenceEquals(raw, share)) changed = true;
            }

            cfg.WatchlistShares = normalizedShares;

            var historyByKey = new Dictionary<string, WatchlistHistoryEntry>(StringComparer.OrdinalIgnoreCase);
            var normalizedHistoryEntries = new List<WatchlistHistoryEntry>();

            foreach (var raw in cfg.WatchlistHistoryEntries)
            {
                if (raw is null) { changed = true; continue; }

                var entry = NormalizeHistoryEntry(raw);
                if (string.IsNullOrWhiteSpace(entry.ItemId) || string.IsNullOrWhiteSpace(entry.OwnerUserId))
                {
                    changed = true;
                    continue;
                }

                var dedupeKey = BuildHistoryKey(entry.OwnerUserId, entry.ItemId);
                if (historyByKey.TryGetValue(dedupeKey, out var existing))
                {
                    if (MergeHistoryEntry(existing, entry)) changed = true;
                    changed = true;
                    continue;
                }

                historyByKey[dedupeKey] = entry;
                normalizedHistoryEntries.Add(entry);
                if (!ReferenceEquals(raw, entry)) changed = true;
            }

            foreach (var entry in normalizedEntries)
            {
                var dedupeKey = BuildHistoryKey(entry.OwnerUserId, entry.ItemId);
                if (!historyByKey.TryGetValue(dedupeKey, out var history))
                {
                    history = CreateHistoryEntryFromWatchlist(entry);
                    historyByKey[dedupeKey] = history;
                    normalizedHistoryEntries.Add(history);
                    changed = true;
                    continue;
                }

                if (ApplyHistorySnapshot(history, entry)) changed = true;
                if (history.FirstAddedAtUtc <= 0)
                {
                    history.FirstAddedAtUtc = entry.AddedAtUtc;
                    changed = true;
                }
                if (history.LastAddedAtUtc <= 0)
                {
                    history.LastAddedAtUtc = entry.AddedAtUtc;
                    changed = true;
                }
                if (history.AddCount <= 0)
                {
                    history.AddCount = 1;
                    changed = true;
                }
            }

            cfg.WatchlistHistoryEntries = normalizedHistoryEntries;

            return changed;
        }

        private static WatchlistEntry NormalizeEntry(WatchlistEntry source)
        {
            source.Id = Clean(source.Id);
            if (string.IsNullOrWhiteSpace(source.Id))
            {
                source.Id = Guid.NewGuid().ToString("N");
            }

            source.ItemId = Clean(source.ItemId);
            source.ItemType = Clean(source.ItemType);
            source.Name = Clean(source.Name);
            source.Overview = Clean(source.Overview);
            source.OfficialRating = Clean(source.OfficialRating);
            source.AlbumArtist = Clean(source.AlbumArtist);
            source.ParentName = Clean(source.ParentName);
            source.OwnerUserId = Clean(source.OwnerUserId);
            source.OwnerUserName = Clean(source.OwnerUserName);
            source.Genres = NormalizeStringList(source.Genres);
            source.Artists = NormalizeStringList(source.Artists);
            if (source.AddedAtUtc <= 0) source.AddedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return source;
        }

        private static WatchlistShareEntry NormalizeShare(WatchlistShareEntry source)
        {
            source.Id = Clean(source.Id);
            if (string.IsNullOrWhiteSpace(source.Id))
            {
                source.Id = Guid.NewGuid().ToString("N");
            }

            source.WatchlistEntryId = Clean(source.WatchlistEntryId);
            source.ItemId = Clean(source.ItemId);
            source.OwnerUserId = Clean(source.OwnerUserId);
            source.OwnerUserName = Clean(source.OwnerUserName);
            source.TargetUserId = Clean(source.TargetUserId);
            source.TargetUserName = Clean(source.TargetUserName);
            source.Note = NormalizeNote(source.Note);
            if (source.SharedAtUtc <= 0) source.SharedAtUtc = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return source;
        }

        private static WatchlistHistoryEntry NormalizeHistoryEntry(WatchlistHistoryEntry source)
        {
            source.ItemId = Clean(source.ItemId);
            source.ItemType = Clean(source.ItemType);
            source.Name = Clean(source.Name);
            source.OwnerUserId = Clean(source.OwnerUserId);
            source.OwnerUserName = Clean(source.OwnerUserName);
            if (source.FirstAddedAtUtc < 0) source.FirstAddedAtUtc = 0;
            if (source.LastAddedAtUtc < 0) source.LastAddedAtUtc = 0;
            if (source.LastRemovedAtUtc < 0) source.LastRemovedAtUtc = 0;
            if (source.AddCount < 0) source.AddCount = 0;
            if (source.RemoveCount < 0) source.RemoveCount = 0;
            return source;
        }

        private static string BuildHistoryKey(string? ownerUserId, string? itemId)
        {
            return $"{Clean(ownerUserId)}::{Clean(itemId)}";
        }

        private static WatchlistHistoryEntry CreateHistoryEntryFromWatchlist(WatchlistEntry entry)
        {
            return new WatchlistHistoryEntry
            {
                ItemId = Clean(entry.ItemId),
                ItemType = Clean(entry.ItemType),
                Name = Clean(entry.Name),
                OwnerUserId = Clean(entry.OwnerUserId),
                OwnerUserName = Clean(entry.OwnerUserName),
                FirstAddedAtUtc = entry.AddedAtUtc,
                LastAddedAtUtc = entry.AddedAtUtc,
                AddCount = 1
            };
        }

        private static bool ApplyHistorySnapshot(WatchlistHistoryEntry target, WatchlistEntry source)
        {
            var changed = false;

            if (!Same(target.ItemType, source.ItemType) && !string.IsNullOrWhiteSpace(Clean(source.ItemType)))
            {
                target.ItemType = Clean(source.ItemType);
                changed = true;
            }

            if (!Same(target.Name, source.Name) && !string.IsNullOrWhiteSpace(Clean(source.Name)))
            {
                target.Name = Clean(source.Name);
                changed = true;
            }

            if (!Same(target.OwnerUserName, source.OwnerUserName) && !string.IsNullOrWhiteSpace(Clean(source.OwnerUserName)))
            {
                target.OwnerUserName = Clean(source.OwnerUserName);
                changed = true;
            }

            return changed;
        }

        private static bool MergeHistoryEntry(WatchlistHistoryEntry target, WatchlistHistoryEntry incoming)
        {
            var changed = false;

            if (string.IsNullOrWhiteSpace(Clean(target.ItemType)) && !string.IsNullOrWhiteSpace(Clean(incoming.ItemType)))
            {
                target.ItemType = Clean(incoming.ItemType);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.Name)) && !string.IsNullOrWhiteSpace(Clean(incoming.Name)))
            {
                target.Name = Clean(incoming.Name);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.OwnerUserName)) && !string.IsNullOrWhiteSpace(Clean(incoming.OwnerUserName)))
            {
                target.OwnerUserName = Clean(incoming.OwnerUserName);
                changed = true;
            }

            if (target.FirstAddedAtUtc <= 0 || (incoming.FirstAddedAtUtc > 0 && incoming.FirstAddedAtUtc < target.FirstAddedAtUtc))
            {
                target.FirstAddedAtUtc = incoming.FirstAddedAtUtc;
                changed = true;
            }

            if (incoming.LastAddedAtUtc > target.LastAddedAtUtc)
            {
                target.LastAddedAtUtc = incoming.LastAddedAtUtc;
                changed = true;
            }

            if (incoming.LastRemovedAtUtc > target.LastRemovedAtUtc)
            {
                target.LastRemovedAtUtc = incoming.LastRemovedAtUtc;
                changed = true;
            }

            if (incoming.AddCount > target.AddCount)
            {
                target.AddCount = incoming.AddCount;
                changed = true;
            }

            if (incoming.RemoveCount > target.RemoveCount)
            {
                target.RemoveCount = incoming.RemoveCount;
                changed = true;
            }

            if (!target.RemovedAfterPlayed && incoming.RemovedAfterPlayed)
            {
                target.RemovedAfterPlayed = true;
                changed = true;
            }

            return changed;
        }

        private static bool RegisterHistoryAdd(JMSFusionConfiguration cfg, WatchlistEntry entry, UserContext user, long addedAtUtc)
        {
            var history = cfg.WatchlistHistoryEntries.FirstOrDefault(candidate =>
                Same(candidate.OwnerUserId, user.UserId) &&
                Same(candidate.ItemId, entry.ItemId));
            var timestamp = addedAtUtc > 0 ? addedAtUtc : DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            if (history is null)
            {
                history = CreateHistoryEntryFromWatchlist(entry);
                history.OwnerUserId = user.UserId;
                history.OwnerUserName = string.IsNullOrWhiteSpace(user.UserName) ? Clean(entry.OwnerUserName) : user.UserName;
                history.FirstAddedAtUtc = timestamp;
                history.LastAddedAtUtc = history.FirstAddedAtUtc;
                history.AddCount = 1;
                cfg.WatchlistHistoryEntries.Add(history);
                return true;
            }

            var changed = ApplyHistorySnapshot(history, entry);
            if (!Same(history.OwnerUserId, user.UserId))
            {
                history.OwnerUserId = user.UserId;
                changed = true;
            }
            if (!string.IsNullOrWhiteSpace(user.UserName) && !Same(history.OwnerUserName, user.UserName))
            {
                history.OwnerUserName = user.UserName;
                changed = true;
            }
            if (history.FirstAddedAtUtc <= 0)
            {
                history.FirstAddedAtUtc = timestamp;
                changed = true;
            }
            if (timestamp > history.LastAddedAtUtc)
            {
                history.LastAddedAtUtc = timestamp;
                changed = true;
            }
            history.AddCount += 1;
            return true;
        }

        private static bool RegisterHistoryRemoval(JMSFusionConfiguration cfg, WatchlistEntry entry, UserContext user, bool removedAfterPlayed)
        {
            var history = cfg.WatchlistHistoryEntries.FirstOrDefault(candidate =>
                Same(candidate.OwnerUserId, user.UserId) &&
                Same(candidate.ItemId, entry.ItemId));

            var changed = false;
            if (history is null)
            {
                history = CreateHistoryEntryFromWatchlist(entry);
                history.OwnerUserId = user.UserId;
                history.OwnerUserName = string.IsNullOrWhiteSpace(user.UserName) ? Clean(entry.OwnerUserName) : user.UserName;
                cfg.WatchlistHistoryEntries.Add(history);
                changed = true;
            }

            changed |= ApplyHistorySnapshot(history, entry);
            if (!Same(history.OwnerUserId, user.UserId))
            {
                history.OwnerUserId = user.UserId;
                changed = true;
            }
            if (!string.IsNullOrWhiteSpace(user.UserName) && !Same(history.OwnerUserName, user.UserName))
            {
                history.OwnerUserName = user.UserName;
                changed = true;
            }
            if (history.FirstAddedAtUtc <= 0)
            {
                history.FirstAddedAtUtc = entry.AddedAtUtc;
                changed = true;
            }
            if (history.LastAddedAtUtc <= 0)
            {
                history.LastAddedAtUtc = entry.AddedAtUtc;
                changed = true;
            }
            if (history.AddCount <= 0)
            {
                history.AddCount = 1;
                changed = true;
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (history.LastRemovedAtUtc != now)
            {
                history.LastRemovedAtUtc = now;
                changed = true;
            }

            history.RemoveCount += 1;
            changed = true;

            if (removedAfterPlayed && !history.RemovedAfterPlayed)
            {
                history.RemovedAfterPlayed = true;
                changed = true;
            }

            return changed;
        }

        private static bool ApplyShareSnapshot(WatchlistShareEntry share, WatchlistEntry entry)
        {
            var snapshot = CreateShareSnapshot(entry, share);
            if (EntriesEqual(share.EntrySnapshot, snapshot))
            {
                return false;
            }

            share.EntrySnapshot = snapshot;
            return true;
        }

        private static bool NormalizeShareSnapshot(WatchlistShareEntry share)
        {
            if (share.EntrySnapshot is null)
            {
                return false;
            }

            var snapshot = CreateShareSnapshot(share.EntrySnapshot, share);
            if (EntriesEqual(share.EntrySnapshot, snapshot))
            {
                return false;
            }

            share.EntrySnapshot = snapshot;
            return true;
        }

        private static bool HasShareSnapshot(WatchlistShareEntry share)
        {
            return !string.IsNullOrWhiteSpace(Clean(share.EntrySnapshot?.ItemId));
        }

        private static WatchlistEntry CreateShareSnapshot(WatchlistEntry source, WatchlistShareEntry share)
        {
            var snapshot = CloneEntry(source);
            var snapshotId = Clean(share.WatchlistEntryId);
            if (!string.IsNullOrWhiteSpace(snapshotId))
            {
                snapshot.Id = snapshotId;
            }

            snapshot.ItemId = Clean(share.ItemId);
            snapshot.OwnerUserId = Clean(share.OwnerUserId);
            if (!string.IsNullOrWhiteSpace(Clean(share.OwnerUserName)))
            {
                snapshot.OwnerUserName = Clean(share.OwnerUserName);
            }

            NormalizeEntry(snapshot);
            return snapshot;
        }

        private static WatchlistEntry CloneEntry(WatchlistEntry source)
        {
            return new WatchlistEntry
            {
                Id = Clean(source.Id),
                ItemId = Clean(source.ItemId),
                ItemType = Clean(source.ItemType),
                Name = Clean(source.Name),
                Overview = Clean(source.Overview),
                ProductionYear = source.ProductionYear,
                RunTimeTicks = source.RunTimeTicks,
                CommunityRating = source.CommunityRating,
                OfficialRating = Clean(source.OfficialRating),
                Genres = NormalizeStringList(source.Genres),
                AlbumArtist = Clean(source.AlbumArtist),
                Artists = NormalizeStringList(source.Artists),
                ParentName = Clean(source.ParentName),
                AddedAtUtc = source.AddedAtUtc,
                OwnerUserId = Clean(source.OwnerUserId),
                OwnerUserName = Clean(source.OwnerUserName)
            };
        }

        private static bool MergeEntry(WatchlistEntry target, WatchlistEntry incoming)
        {
            var changed = false;

            if (incoming.AddedAtUtc > target.AddedAtUtc)
            {
                target.AddedAtUtc = incoming.AddedAtUtc;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.Name)) && !string.IsNullOrWhiteSpace(Clean(incoming.Name)))
            {
                target.Name = Clean(incoming.Name);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.Overview)) && !string.IsNullOrWhiteSpace(Clean(incoming.Overview)))
            {
                target.Overview = Clean(incoming.Overview);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.ItemType)) && !string.IsNullOrWhiteSpace(Clean(incoming.ItemType)))
            {
                target.ItemType = Clean(incoming.ItemType);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.OfficialRating)) && !string.IsNullOrWhiteSpace(Clean(incoming.OfficialRating)))
            {
                target.OfficialRating = Clean(incoming.OfficialRating);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.AlbumArtist)) && !string.IsNullOrWhiteSpace(Clean(incoming.AlbumArtist)))
            {
                target.AlbumArtist = Clean(incoming.AlbumArtist);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.ParentName)) && !string.IsNullOrWhiteSpace(Clean(incoming.ParentName)))
            {
                target.ParentName = Clean(incoming.ParentName);
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(Clean(target.OwnerUserName)) && !string.IsNullOrWhiteSpace(Clean(incoming.OwnerUserName)))
            {
                target.OwnerUserName = Clean(incoming.OwnerUserName);
                changed = true;
            }

            if (!target.ProductionYear.HasValue && incoming.ProductionYear.HasValue)
            {
                target.ProductionYear = incoming.ProductionYear;
                changed = true;
            }

            if (!target.RunTimeTicks.HasValue && incoming.RunTimeTicks.HasValue)
            {
                target.RunTimeTicks = incoming.RunTimeTicks;
                changed = true;
            }

            if (!target.CommunityRating.HasValue && incoming.CommunityRating.HasValue)
            {
                target.CommunityRating = incoming.CommunityRating;
                changed = true;
            }

            if (target.Genres.Count == 0 && incoming.Genres.Count > 0)
            {
                target.Genres = incoming.Genres;
                changed = true;
            }

            if (target.Artists.Count == 0 && incoming.Artists.Count > 0)
            {
                target.Artists = incoming.Artists;
                changed = true;
            }

            return changed;
        }

        private static bool EntriesEqual(WatchlistEntry? left, WatchlistEntry? right)
        {
            if (left is null || right is null)
            {
                return left is null && right is null;
            }

            return
                Same(left.Id, right.Id) &&
                Same(left.ItemId, right.ItemId) &&
                Same(left.ItemType, right.ItemType) &&
                Same(left.Name, right.Name) &&
                Same(left.Overview, right.Overview) &&
                left.ProductionYear == right.ProductionYear &&
                left.RunTimeTicks == right.RunTimeTicks &&
                left.CommunityRating == right.CommunityRating &&
                Same(left.OfficialRating, right.OfficialRating) &&
                ListsEqual(left.Genres, right.Genres) &&
                Same(left.AlbumArtist, right.AlbumArtist) &&
                ListsEqual(left.Artists, right.Artists) &&
                Same(left.ParentName, right.ParentName) &&
                left.AddedAtUtc == right.AddedAtUtc &&
                Same(left.OwnerUserId, right.OwnerUserId) &&
                Same(left.OwnerUserName, right.OwnerUserName);
        }

        private static List<string> NormalizeStringList(IEnumerable<string?>? list)
        {
            return (list ?? Array.Empty<string?>())
                .Select(Clean)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        private static string NormalizeNote(string? note)
        {
            var clean = Clean(note);
            if (clean.Length <= MaxNoteLength) return clean;
            return clean[..MaxNoteLength];
        }

        private static void TouchRevision(JMSFusionConfiguration cfg)
        {
            cfg.WatchlistRevision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        private UserContext ReadUserContext()
        {
            var userId =
                Request.Headers["X-Emby-UserId"].FirstOrDefault() ??
                Request.Headers["X-MediaBrowser-UserId"].FirstOrDefault() ??
                "";

            var userName =
                Request.Headers["X-JMSFusion-UserName"].FirstOrDefault() ??
                Request.Headers["X-Emby-UserName"].FirstOrDefault() ??
                "";

            return new UserContext
            {
                UserId = Clean(userId),
                UserName = Clean(userName)
            };
        }

        private (UserContext? Context, User? User, IActionResult? Result) TryGetRequestUserEntity()
        {
            var context = ReadUserContext();
            if (!Guid.TryParse(context.UserId, out var userId) || userId == Guid.Empty)
            {
                return (null, null, Unauthorized(new { ok = false, error = "Geçerli X-Emby-UserId gerekli" }));
            }

            var user = _users.GetUserById(userId);
            if (user is null)
            {
                return (null, null, Unauthorized(new { ok = false, error = "Kullanıcı bulunamadı" }));
            }

            if (string.IsNullOrWhiteSpace(context.UserName))
            {
                context = new UserContext
                {
                    UserId = context.UserId,
                    UserName = Clean(user.Username)
                };
            }

            return (context, user, null);
        }

        private void NoCache()
        {
            Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0";
            Response.Headers["Pragma"] = "no-cache";
            Response.Headers["Expires"] = "0";
        }

        private static bool ListsEqual(IReadOnlyList<string>? left, IReadOnlyList<string>? right)
        {
            var l = left ?? Array.Empty<string>();
            var r = right ?? Array.Empty<string>();
            if (l.Count != r.Count) return false;
            for (var i = 0; i < l.Count; i++)
            {
                if (!Same(l[i], r[i])) return false;
            }
            return true;
        }

        private static bool IsTrue(string? value)
        {
            var clean = Clean(value);
            return
                clean.Equals("1", StringComparison.OrdinalIgnoreCase) ||
                clean.Equals("true", StringComparison.OrdinalIgnoreCase) ||
                clean.Equals("yes", StringComparison.OrdinalIgnoreCase) ||
                clean.Equals("on", StringComparison.OrdinalIgnoreCase);
        }

        private static bool Same(string? left, string? right)
        {
            return string.Equals(Clean(left), Clean(right), StringComparison.OrdinalIgnoreCase);
        }

        private static string Clean(string? value)
        {
            return (value ?? "").Trim();
        }

    }
}
