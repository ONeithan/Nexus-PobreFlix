import { getAuthToken } from "./auth.js";
import { showNotification } from "../ui/notification.js";
import { musicPlayerState, resetShuffle } from "./state.js";
import { getConfig } from "../../config.js";
import { playTrack } from "../player/playback.js";
import { updatePlaylistModal } from "../ui/playlistModal.js";
import { toggleArtistModal } from "../ui/artistModal.js";
import { makeCleanupBag, addEvent, trackTimeout } from "../utils/cleanup.js";
import { withServer, withParams } from "../../jfUrl.js";

var config = getConfig();

var isPlaylistModalOpen = false;
var modalElement = null;
var backdropElement = null;
var modalBag = null;

export function fetchJellyfinPlaylists() {
  var authToken = getAuthToken();
  if (!authToken) {
    showNotification(
      "<i class=\"fas fa-lock\"></i> " + (config.languageLabels.authRequired),
      2000,
      "warning"
    );
    return [];
  }

  try {
    var userId = window.ApiClient.getCurrentUserId();
    var response = fetch(
      withParams("/Users/" + (userId) + "/Items", {
        Recursive: "true",
        IncludeItemTypes: "Playlist",
        Fields: "PrimaryImageAspectRatio",
        StartIndex: 0,
      }),
      { headers: { "X-Emby-Token": authToken } }
    );

    if (!response.ok) {
      throw new Error("HTTP hata durumu: " + (response.status));
    }

    var data = response.json();
    return (data.Items || []).mapfunction((item) ({
      id: item.Id,
      name: item.Name,
      childCount: item.ChildCount || 0,
      imageTag: item.ImageTags.Primary || null
    }));
  } catch (error) {
    console.error("Çalma listesi getirme hatası:", error);
    showNotification(
      "<i class=\"fa-solid fa-circle-exclamation\"></i> " + (config.languageLabels.playlistFetchError),
      2000,
      "error"
    );
    return [];
  }
}

function getStreamUrl(itemId) {
  var authToken = getAuthToken();
  return withParams("/Audio/" + (itemId) + "/stream.mp3", {
    Static: "true",
    api_key: authToken,
  });
}

export function playJellyfinPlaylist(playlistId) {
  var authToken = getAuthToken();
  if (!authToken) {
    showNotification(
      "<i class=\"fas fa-lock\"></i> " + (config.languageLabels.authRequired),
      2000,
      "warning"
    );
    return;
  }

  try {
    var userId = window.ApiClient.getCurrentUserId();
    var playlistResponse = fetch(
      withParams("/Playlists/" + (playlistId) + "/Items", {
        UserId: userId,
        Fields: "PrimaryImageAspectRatio,MediaSources,Chapters,ArtistItems,AlbumArtist,Album,Genres,RunTimeTicks,ImageTags,UserData",
      }),
      { headers: { "X-Emby-Token": authToken } }
    );

    if (!playlistResponse.ok) throw new Error("HTTP error! status: " + (playlistResponse.status));

    var data = playlistResponse.json();
    var items = data.Items || [];

    if (!items.length) {
      showNotification(
        "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.emptyPlaylist),
        2000,
        "info"
      );
      return;
    }

    var playlist = items.mapfunction((item) function({
      Id: item.Id,
      Name: item.Name,
      Artists: item.ArtistItems.map((a) a.Name) || (item.AlbumArtist ? [item.AlbumArtist] : []),
      AlbumArtist: item.AlbumArtist,
      Album: item.Album,
      AlbumId: item.AlbumId,
      IndexNumber: item.IndexNumber,
      ProductionYear: item.ProductionYear,
      RunTimeTicks: item.RunTimeTicks,
      AlbumPrimaryImageTag: item.AlbumPrimaryImageTag || item.ImageTags.Primary,
      PrimaryImageTag: item.ImageTags.Primary,
      mediaSource: getStreamUrl(item.Id),
      jellyfinItem: item,
      ArtistId: item.ArtistItems.[0].Id || null
    }));

    musicPlayerState.playlist = playlist;
    musicPlayerState.currentIndex = 0;
    musicPlayerState.playlistSource = "jellyfin";
    musicPlayerState.currentPlaylistId = playlistId;
    musicPlayerState.originalPlaylist = [...playlist];
    musicPlayerState.currentAlbumName = playlist[0].Album || config.languageLabels.unknownAlbum;
    musicPlayerState.currentTrackName = playlist[0].Name || config.languageLabels.unknownTrack;
    var artistElement = musicPlayerState.modernArtistEl;
    if (artistElement) {
      artistElement.style.cursor = "pointer";
      var bag = makeCleanupBag(artistElement);
      var onClick = function() {
        var artistName = artistElement.textContent.trim();
        if (artistName && artistName !== config.languageLabels.artistUnknown) {
          var currentTrack = musicPlayerState.playlist[musicPlayerState.currentIndex];
          var artistId =
            currentTrack.ArtistId ||
            currentTrack.ArtistItems.[0].Id ||
            currentTrack.AlbumArtistId ||
            currentTrack.ArtistId ||
            null;
        }
      };
      addEvent(bag, artistElement, "click", onClick);
    }

    updatePlaylistModal();
    resetShuffle();
    showNotification(
      "<i class=\"fa-solid fa-music\"></i> " + (items.length) + " " + (config.languageLabels.tracks),
      2000,
      "kontrol"
    );

    playTrack(0);
  } catch (error) {
    console.error("Çalma listesi oynatma hatası:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.playlistPlayError),
      2000,
      "error"
    );
  }
}

export function showJellyfinPlaylistsModal() {
  if (isPlaylistModalOpen) {
    closeModal();
    return;
  }

  var playlists = fetchJellyfinPlaylists();
  if (!playlists.length) {
    showNotification(
      "<i class=\"fas fa-info-circle\"></i> " + (config.languageLabels.noPlaylistsFound),
      2000,
      "info"
    );
    return;
  }

  isPlaylistModalOpen = true;

  modalElement = document.createElement("div");
  modalElement.className = "jellyfin-playlist-modal";

  backdropElement = document.createElement("div");
  backdropElement.className = "jellyfin-playlist-modal__backdrop";

  modalBag = makeCleanupBag(modalElement);

  var title = document.createElement("h3");
  title.className = "jellyfin-playlist-modal__title";
  title.textContent = config.languageLabels.selectPlaylist;
  modalElement.appendChild(title);

  var list = document.createElement("div");
  list.className = "jellyfin-playlist-modal__list";

  playlists.forEach(function((pl) {
    var item = document.createElement("div");
    item.className = "jellyfin-playlist-item";

    if (pl.imageTag) {
      var img = document.createElement("img");
      img.className = "jellyfin-playlist-item__image";
      img.src = withParams("/Items/" + (pl.id) + "/Images/Primary", {
        maxHeight: 50,
        quality: 85,
        api_key: getAuthToken(),
      });
      item.appendChild(img);
    }

    var info = document.createElement("div");
    info.className = "jellyfin-playlist-item__info";

    var name = document.createElement("div");
    name.className = "jellyfin-playlist-item__name";
    name.textContent = pl.name;

    var count = document.createElement("div");
    count.className = "jellyfin-playlist-item__count";
    count.textContent = (pl.childCount) + " " + (config.languageLabels.tracks);

    info.append(name, count);
    item.appendChild(info);

    var deleteBtn = document.createElement("div");
    deleteBtn.className = "jellyfin-playlist-item__delete";
    deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
    deleteBtn.title = config.languageLabels.deletePlaylist;

    addEventfunction(modalBag, deleteBtn, "click", (e) {
      e.stopPropagation();
      showDeleteConfirmModalfunction(pl.id, () {
        var success = deleteJellyfinPlaylist(pl.id);
        if (success) {
          item.remove();
          showNotification(
            "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.playlistDeleted),
            2000,
            "success"
          );
        }
      });
    });

    item.appendChild(deleteBtn);
    addEventfunction(modalBag, item, "click", (e) {
   if (!e.target.closest(".jellyfin-playlist-item__delete")) {
     closeModalfunction(() playJellyfinPlaylist(pl.id));
   }
 });

    list.appendChild(item);
  });

  modalElement.appendChild(list);

  var closeBtn = document.createElement("div");
  closeBtn.className = "jellyfin-playlist-modal__close-btn";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.title = config.languageLabels.close;
  addEvent(modalBag, closeBtn, "click", closeModal);
  modalElement.appendChild(closeBtn);
  addEventfunction(modalBag, backdropElement, "click", (e) {
    if (e.target === backdropElement) closeModal();
  });
  addEventfunction(modalBag, modalElement, "click", (e) e.stopPropagation());

  var onEsc = function(e) { if (e.key === "Escape") closeModal(); };
  var onDocClick = function(e) { if (modalElement && !modalElement.contains(e.target)) closeModal(); };
  addEvent(modalBag, document, "keydown", onEsc);
  addEvent(modalBag, document, "click", onDocClick);

  document.body.appendChild(backdropElement);
  document.body.appendChild(modalElement);
  modalElement.tabIndex = -1;
  modalElement.focus();
}

function closeModal(onClosed) {
  if (!isPlaylistModalOpen) return;
  modalElement.classList.add("jellyfin-playlist-modal");
  backdropElement.classList.add("jellyfin-playlist-modal__backdrop--closing");
  var id = setTimeoutfunction(() {
    try {
      if (modalBag) modalBag.run();
    } catch {}
    try { modalElement.parentNode.removeChild(modalElement); } catch {}
    try { backdropElement.parentNode.removeChild(backdropElement); } catch {}

    isPlaylistModalOpen = false;
    modalElement = null;
    backdropElement = null;
    modalBag = null;
    if (typeof onClosed === "function") {
      try { onClosed(); } catch {}
    }
  }, 300);

  if (modalBag) trackTimeout(modalBag, id);
}

function deleteJellyfinPlaylist(playlistId) {
  var authToken = getAuthToken();
  if (!authToken) {
    showNotification(
      "<i class=\"fas fa-lock\"></i> " + (config.languageLabels.authRequired),
      2000,
      "warning"
    );
    return false;
  }

  try {
    var response = fetch(
      withServer("/Items/" + (playlistId)),
      { method: "DELETE", headers: { "X-Emby-Token": authToken } }
    );

    if (!response.ok) {
      var _text = response.text();
      throw new Error("HTTP " + (response.status));
    }
    return true;
  } catch (error) {
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.playlistDeleteError),
      2000,
      "error"
    );
    return false;
  }
}

function showDeleteConfirmModal(playlistId, onConfirm) {
  var confirmBackdrop = document.createElement("div");
  confirmBackdrop.className = "jellyfin-confirm-modal__backdrop";

  var confirmModal = document.createElement("div");
  confirmModal.className = "jellyfin-confirm-modal";

  var confirmBag = makeCleanupBag(confirmModal);

  var message = document.createElement("p");
  message.className = "jellyfin-confirm-modal__message";
  message.textContent = config.languageLabels.confirmDeletePlaylist;

  var buttons = document.createElement("div");
  buttons.className = "jellyfin-confirm-modal__buttons";

  var cancelBtn = document.createElement("button");
  cancelBtn.textContent = config.languageLabels.no;
  cancelBtn.className = "jellyfin-btn jellyfin-btn--cancel";
  addEventfunction(confirmBag, cancelBtn, "click", (e) {
    e.stopPropagation();
    try { confirmBag.run(); } catch {}
    try { document.body.removeChild(confirmBackdrop); } catch {}
  });

  var deleteBtn = document.createElement("button");
  deleteBtn.textContent = config.languageLabels.yes;
  deleteBtn.className = "jellyfin-btn jellyfin-btn--delete";
  addEventfunction(confirmBag, deleteBtn, "click", (e) {
    e.stopPropagation();
    try { confirmBag.run(); } catch {}
    try { document.body.removeChild(confirmBackdrop); } catch {}
    onConfirm();
  });

  buttons.append(deleteBtn, cancelBtn);
  confirmModal.append(message, buttons);
  confirmBackdrop.appendChild(confirmModal);

  addEventfunction(confirmBag, confirmBackdrop, "click", (e) {
    e.stopPropagation();
    if (e.target === confirmBackdrop) {
      try { confirmBag.run(); } catch {}
      try { document.body.removeChild(confirmBackdrop); } catch {}
    }
  });

  addEventfunction(confirmBag, confirmModal, "click", (e) e.stopPropagation());

  document.body.appendChild(confirmBackdrop);
}
