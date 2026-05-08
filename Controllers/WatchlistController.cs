using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.NexusPobreFlix.Controllers
{
    [ApiController]
    [Route("NexusPobreFlix/watchlist")]
    [Route("Plugins/NexusPobreFlix/watchlist")]
    public class WatchlistController : ControllerBase
    {
        private static readonly object SyncRoot = new();
        private const int MaxItemsPerUser = 500;
        private const int MaxSharesPerOwner = 2000;
        private const int MaxNoteLength = 600;

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

        private sealed class UserContext
        {
            public string UserId { get; init; } = "";
            public string UserName { get; init; } = "";
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
                var plugin = NexusPobreFlixPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
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
                var plugin = NexusPobreFlixPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
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
                var plugin = NexusPobreFlixPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
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
                var plugin = NexusPobreFlixPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
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
                return BadRequest(new { ok = false, error = "shareId obrigatório" });
            }

            lock (SyncRoot)
            {
                var plugin = NexusPobreFlixPlugin.Instance ?? throw new InvalidOperationException("Plugin not available.");
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

        private static bool TrimOwnerItems(NexusPobreFlixConfiguration cfg, string ownerUserId)
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

        private static bool TrimOwnerShares(NexusPobreFlixConfiguration cfg, string ownerUserId)
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

        private static bool NormalizeConfig(NexusPobreFlixConfiguration cfg)
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

        private static bool RegisterHistoryAdd(NexusPobreFlixConfiguration cfg, WatchlistEntry entry, UserContext user, long addedAtUtc)
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

        private static bool RegisterHistoryRemoval(NexusPobreFlixConfiguration cfg, WatchlistEntry entry, UserContext user, bool removedAfterPlayed)
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

        private static void TouchRevision(NexusPobreFlixConfiguration cfg)
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
                Request.Headers["X-NexusPobreFlix-UserName"].FirstOrDefault() ??
                Request.Headers["X-Emby-UserName"].FirstOrDefault() ??
                "";

            return new UserContext
            {
                UserId = Clean(userId),
                UserName = Clean(userName)
            };
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
