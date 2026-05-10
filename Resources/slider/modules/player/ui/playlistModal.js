import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { showNotification } from "../ui/notification.js";
import { playTrack } from "../player/playback.js";
import { saveCurrentPlaylistToJellyfin, removeItemsFromPlaylist } from "../core/playlist.js";
import { fetchJellyfinPlaylists } from "../core/jellyfinPlaylists.js";
import { readID3Tags } from "../lyrics/id3Reader.js";
import { showGenreFilterModal } from "./genreFilterModal.js";
import { withServer, withParams } from "../../jfUrl.js";
import { getAuthToken } from "../core/auth.js";
import { isRadioTrack, resolveRadioStationArtUrl } from "../core/radio.js";
import { enhanceFormAccessibility } from "../../accessibility.js";

var config = getConfig();

var playlistItemsObserver = null;
var outsideClickListener = null;

export function createPlaylistModal() {
  var modal = document.createElement("div");
  modal.id = "playlist-modal";
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("role", "dialog");

  var container = document.createElement("div");
  container.className = "playlist-container";

  var header = document.createElement("div");
  header.className = "playlist-header";

  var title = document.createElement("h3");
  title.className = "playlist-title";
  title.textContent = config.languageLabels.playlist;
  title.id = "playlist-modal-title";

  var closeBtn = document.createElement("button");
  closeBtn.className = "playlist-close";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.title = config.languageLabels.close || "Fechar";
  closeBtn.setAttribute("aria-label", "Close playlist");
  closeBtn.onclick = togglePlaylistModal;

  var selectAllBtn = document.createElement("button");
  selectAllBtn.className = "playlist-select-all";
  selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
  selectAllBtn.title = config.languageLabels.selectAll || "Selecionar/Desmarcar Todos";
  selectAllBtn.setAttribute("aria-label", "Select all tracks");
  selectAllBtn.onclick = function(e) {
    e.stopPropagation();
    toggleSelectAll();
  };

  var saveBtn = document.createElement("button");
  saveBtn.className = "playlist-save";
  saveBtn.innerHTML = '<i class="fas fa-save"></i>';
  saveBtn.title = config.languageLabels.savePlaylist;
  saveBtn.setAttribute("aria-label", "Save playlist");
  saveBtn.onclick = showSaveModal;

  var searchContainer = document.createElement("div");
  searchContainer.className = "playlist-search-container";

  var searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = config.languageLabels.searchTracks;
  searchInput.className = "playlist-search-input";
  searchInput.id = "playlist-search-input";
  searchInput.name = "playlist-search";
  searchInput.autocomplete = "off";
  searchInput.setAttribute("aria-labelledby", "playlist-modal-title");
  searchInput.setAttribute("aria-label", "Search in playlist");

  searchInput.addEventListenerfunction("input", (e) {
    filterPlaylistItems(e.target.value.toLowerCase());
  });

  searchContainer.appendChild(searchInput);

  var removeSelectedBtn = document.createElement("button");
  removeSelectedBtn.className = "playlist-remove-selected";
  removeSelectedBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
  removeSelectedBtn.title = config.languageLabels.removeSelected || "Remover Selecionados";
  removeSelectedBtn.setAttribute("aria-label", "Remove selected tracks");
  removeSelectedBtn.onclick = function(e) {
    e.stopPropagation();
    showRemoveSelectedConfirmModal();
  };

  var headerButtons = document.createElement("div");
  headerButtons.className = "playlist-header-buttons";
  headerButtons.appendChild(selectAllBtn);
  headerButtons.appendChild(removeSelectedBtn);
  headerButtons.appendChild(saveBtn);
  headerButtons.appendChild(closeBtn);

  var itemsContainer = document.createElement("div");
  itemsContainer.className = "playlist-items";
  itemsContainer.setAttribute("role", "list");
  itemsContainer.setAttribute("aria-label", "Playlist items");

  header.appendChild(title);
  header.appendChild(headerButtons);

  container.appendChild(searchContainer);
  container.appendChild(header);
  container.appendChild(itemsContainer);
  modal.appendChild(container);
  document.body.appendChild(modal);

  musicPlayerState.playlistModal = modal;
  musicPlayerState.playlistItemsContainer = itemsContainer;
  musicPlayerState.playlistSearchInput = searchInput;
  musicPlayerState.selectedTracks = new Set();
}

function updateSelectAllBtnState() {
  var itemsCount = musicPlayerState.playlistItemsContainer
    .querySelectorAll(".playlist-item").length;
  var selectedCount = musicPlayerState.selectedTracks.size;
  var selectAllBtn = document.querySelector(".playlist-select-all");
  if (!selectAllBtn) return;

  var allSelected = selectedCount === itemsCount && itemsCount > 0;
  if (allSelected) {
    selectAllBtn.innerHTML = '<i class="fa-solid fa-minus"></i>';
    selectAllBtn.title = config.languageLabels.deselectAll || "Desmarcar Tudo";
  } else {
    selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectAllBtn.title = config.languageLabels.selectAll || "Selecionar Tudo";
  }
}

function showSaveModal() {
  var selectedCount = musicPlayerState.selectedTracks.size;
  var saveSelected = selectedCount > 0;

  var modal = document.createElement("div");
  modal.className = "playlist-save-modal";
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("role", "dialog");

  var modalContent = document.createElement("div");
  modalContent.className = "playlist-save-modal-content";

  var modalHeader = document.createElement("div");
  modalHeader.className = "playlist-save-modal-header";

  var modalTitle = document.createElement("h3");
  modalTitle.textContent = config.languageLabels.savePlaylist;
  modalTitle.id = "save-modal-title";
  modalHeader.appendChild(modalTitle);

  var closeButton = document.createElement("div");
  closeButton.className = "playlist-save-modal-close";
  closeButton.innerHTML = '<i class="fas fa-times"></i>';
  closeButton.setAttribute("aria-label", "Close save dialog");
  closeButton.onclick = function() closeModal();
  modalHeader.appendChild(closeButton);

  var modalBody = document.createElement("div");
  modalBody.className = "playlist-save-modal-body";

  var nameInputContainer = document.createElement("div");
  nameInputContainer.className = "name-input-container";
  var nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = config.languageLabels.enterPlaylistName;
  nameInput.id = "playlist-save-name-input";
  nameInput.name = "playlist-save-name-input";
  nameInput.value = "GMMP Playlist " + (new Date().toLocaleString(config.dateLocale || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  ) + ")}";
  nameInput.setAttribute("aria-labelledby", "save-modal-title");
  nameInputContainer.appendChild(nameInput);

  var publicLabel = document.createElement("label");
  publicLabel.className = "public-checkbox-label";
  publicLabel.htmlFor = "playlist-save-public";
  var publicCheckbox = document.createElement("input");
  publicCheckbox.type = "checkbox";
  publicCheckbox.id = "playlist-save-public";
  publicCheckbox.name = "playlist-save-public";
  publicLabel.appendChild(publicCheckbox);
  publicLabel.appendChild(document.createTextNode(config.languageLabels.makePlaylistPublic));

  var actionContainer = document.createElement("div");
  actionContainer.className = "action-container";

  var newPlaylistOption = document.createElement("div");
  newPlaylistOption.className = "radio-option";
  var newPlaylistRadio = document.createElement("input");
  newPlaylistRadio.type = "radio";
  newPlaylistRadio.name = "saveAction";
  newPlaylistRadio.id = "playlist-save-new-playlist";
  newPlaylistRadio.value = "new";
  newPlaylistRadio.checked = true;
  newPlaylistRadio.onchange = togglePlaylistSelection;
  var newPlaylistLabel = document.createElement("label");
  newPlaylistLabel.htmlFor = "playlist-save-new-playlist";
  newPlaylistLabel.textContent = config.languageLabels.newPlaylist || "Criar nova lista";
  newPlaylistOption.appendChild(newPlaylistRadio);
  newPlaylistOption.appendChild(newPlaylistLabel);

  var existingPlaylistOption = document.createElement("div");
  existingPlaylistOption.className = "radio-option";
  var existingPlaylistRadio = document.createElement("input");
  existingPlaylistRadio.type = "radio";
  existingPlaylistRadio.name = "saveAction";
  existingPlaylistRadio.id = "playlist-save-existing-playlist";
  existingPlaylistRadio.value = "existing";
  existingPlaylistRadio.onchange = togglePlaylistSelection;
  var existingPlaylistLabel = document.createElement("label");
  existingPlaylistLabel.htmlFor = "playlist-save-existing-playlist";
  existingPlaylistLabel.textContent = config.languageLabels.addToExisting || "Adicionar a uma lista existente";
  existingPlaylistOption.appendChild(existingPlaylistRadio);
  existingPlaylistOption.appendChild(existingPlaylistLabel);

  actionContainer.appendChild(newPlaylistOption);
  actionContainer.appendChild(existingPlaylistOption);

  var playlistSelectContainer = document.createElement("div");
  playlistSelectContainer.className = "playlist-select-container";
  playlistSelectContainer.style.display = "none";

  var playlistSelectLabel = document.createElement("label");
  playlistSelectLabel.textContent = config.languageLabels.selectPlaylist || "Selecione uma lista:";
  playlistSelectLabel.htmlFor = "playlist-save-existing-playlist-select";

  var playlistSelect = document.createElement("select");
  playlistSelect.className = "playlist-select";
  playlistSelect.id = "playlist-save-existing-playlist-select";
  playlistSelect.name = "playlist-save-existing-playlist-select";
  playlistSelect.disabled = true;

  var loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = config.languageLabels.loadingPlaylists || "Carregando listas...";
  playlistSelect.appendChild(loadingOption);

  playlistSelectContainer.appendChild(playlistSelectLabel);
  playlistSelectContainer.appendChild(playlistSelect);

  var selectedOnlyContainer = document.createElement("div");
  selectedOnlyContainer.className = "selected-only-container";
  var selectedOnlyCheckbox = document.createElement("input");
  selectedOnlyCheckbox.type = "checkbox";
  selectedOnlyCheckbox.id = "playlist-save-selected-only";
  selectedOnlyCheckbox.name = "playlist-save-selected-only";
  selectedOnlyCheckbox.checked = saveSelected;
  selectedOnlyCheckbox.disabled = (selectedCount === 0);
  var selectedOnlyLabel = document.createElement("label");
  selectedOnlyLabel.htmlFor = "playlist-save-selected-only";
  selectedOnlyLabel.textContent = saveSelected
    : config.languageLabels.noSelection || "Nenhuma música selecionada";
  selectedOnlyContainer.appendChild(selectedOnlyCheckbox);
  selectedOnlyContainer.appendChild(selectedOnlyLabel);

  modalBody.appendChild(nameInputContainer);
  modalBody.appendChild(publicLabel);
  modalBody.appendChild(actionContainer);
  modalBody.appendChild(playlistSelectContainer);
  modalBody.appendChild(selectedOnlyContainer);

  var modalFooter = document.createElement("div");
  modalFooter.className = "playlist-save-modal-footer";

  var saveButton = document.createElement("button");
  saveButton.className = "playlist-save-modal-save";
  saveButton.textContent = config.languageLabels.kaydet;
  saveButton.onclick = function() {
    var selectedIdx = Array.from(musicPlayerState.selectedTracks);
    var tracksToSave = selectedOnlyCheckbox.checked
      ? selectedIdx.map(function(i) musicPlayerState.playlist[i])
      : musicPlayerState.playlist;

    var isNew = newPlaylistRadio.checked;
    var playlistId = isNew ? null : playlistSelect.value;
    var playlistName = isNew
      ? nameInput.value
      : playlistSelect.options[playlistSelect.selectedIndex].text;

    try {
      saveCurrentPlaylistToJellyfin(
        playlistName,
        publicCheckbox.checked,
        tracksToSave,
        isNew,
        playlistId
      );
      showNotification(
        "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.playlistCreatedSuccessfully || "Lista salva com sucesso"),
        2500,
        'addlist'
      );
      closeModal();
    } catch (err) {
      console.error(err);
      showNotification(
        "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.playlistSaveError || "Erro ao salvar lista"),
        3000,
        'error'
      );
    }
  };

  modalFooter.appendChild(saveButton);
  modalContent.appendChild(modalHeader);
  modalContent.appendChild(modalBody);
  modalContent.appendChild(modalFooter);
  enhanceFormAccessibility(modalContent, { prefix: "playlist-save" });
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  loadExistingPlaylists(playlistSelect);

  modal.onclick = function(e) {
    if (e.target === modal) {
      closeModal();
    }
  };

  nameInput.focus();

  var handleKeyDown = function(e) {
    if (e.key === "Escape") {
      closeModal();
    }
  };
  document.addEventListener("keydown", handleKeyDown);

  function togglePlaylistSelection() {
    var isNew = newPlaylistRadio.checked;
    nameInputContainer.style.display = isNew ? "block" : "none";
    playlistSelectContainer.style.display = isNew ? "none" : "block";
    publicLabel.style.display = isNew ? "block" : "none";
  }

  function closeModal() {
    document.removeEventListener("keydown", handleKeyDown);
    try { document.body.removeChild(modal); } catch {}
  }
}

function loadExistingPlaylists(selectElement) {
  try {
    var playlists = fetchJellyfinPlaylists();
    selectElement.innerHTML = '';

    if (playlists.length === 0) {
      var noPlaylistOption = document.createElement("option");
      noPlaylistOption.value = "";
      noPlaylistOption.textContent = config.languageLabels.noPlaylists || "Nenhuma playlist encontrada";
      selectElement.appendChild(noPlaylistOption);
      selectElement.disabled = true;
      return;
    }

    playlists.sortfunction((a, b) a.name.localeCompare(b.name));

    playlists.forEach(function(playlist) {
      var option = document.createElement("option");
      option.value = playlist.id;
      option.textContent = playlist.name;
      selectElement.appendChild(option);
    });

    selectElement.disabled = false;
  } catch (error) {
    console.error("Erro ao carregar listas:", error);
    selectElement.innerHTML = '';

    var errorOption = document.createElement("option");
    errorOption.value = "";
    errorOption.textContent = config.languageLabels.loadError || "Erro ao carregar listas";
    selectElement.appendChild(errorOption);
    selectElement.disabled = true;
  }
}

function toggleSelectAll() {
  var itemsContainer = musicPlayerState.playlistItemsContainer;
  var items = itemsContainer.querySelectorAll(".playlist-item");
  var checkboxes = itemsContainer.querySelectorAll(".playlist-item-checkbox");
  var selectAllBtn = document.querySelector(".playlist-select-all");

  var allSelected = items.length === musicPlayerState.selectedTracks.size;

  if (allSelected) {
    musicPlayerState.selectedTracks.clear();
    checkboxes.forEach(function(checkbox) {
      checkbox.checked = false;
      checkbox.parentElement.classList.remove("selected");
    });
    selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectAllBtn.title = config.languageLabels.selectAll || "Selecionar Tudo";
  } else {
    musicPlayerState.selectedTracks = new Set([...Array(items.length).keys()]);
    checkboxes.forEach(function((checkbox) {
      checkbox.checked = true;
      checkbox.parentElement.classList.add("selected");
    });
    selectAllBtn.innerHTML = '<i class="fa-solid fa-minus"></i>';
    selectAllBtn.title = config.languageLabels.deselectAll || "Desmarcar Tudo";
  }
  updateSelectAllBtnState();
}

export function togglePlaylistModal(e) {
  var modal = musicPlayerState.playlistModal;
  if (!modal) return;

  if (modal.style.display === "flex") {
    modal.style.display = "none";
    removeOutsideClickListener();
    disconnectItemsObserver();
    resetSelectionState();
  } else {
    updatePlaylistModal();
    modal.style.display = "flex";

    if (e) {
      var x = e.clientX;
      var y = e.clientY;
      var modalWidth = 300;
      var modalHeight = 400;
      var left = Math.min(x, window.innerWidth - modalWidth - 20);
      var top = Math.min(y, window.innerHeight - modalHeight - 20);
      modal.style.left = (left) + "px";
      modal.style.top = (top) + "px";
    } else {
      modal.style.left = "";
      modal.style.top = "";
    }

    setTimeoutfunction(() {
      var activeItem = musicPlayerState.playlistItemsContainer.querySelector(".playlist-item.active");
      if (activeItem) {
        activeItem.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 0);

    addOutsideClickListener();
  }
}

function resetSelectionState() {
  musicPlayerState.selectedTracks.clear();
  var checkboxes = document.querySelectorAll(".playlist-item-checkbox");
  checkboxes.forEach(function(checkbox) {
    checkbox.checked = false;
    checkbox.parentElement.classList.remove("selected");
  });
  var selectAllBtn = document.querySelector(".playlist-select-all");
  if (selectAllBtn) {
    selectAllBtn.innerHTML = '<i class="fa-solid fa-check-double"></i>';
    selectAllBtn.title = config.languageLabels.selectAll || "Selecionar Tudo";
  }
}

function addOutsideClickListener() {
  if (outsideClickListener) return;

  outsideClickListener = function(event) {
    var playlistModal = musicPlayerState.playlistModal;
    var saveModal = document.querySelector('.playlist-save-modal');
    if (
      (playlistModal && playlistModal.contains(event.target)) ||
      (saveModal && saveModal.contains(event.target))
    ) {
      return;
    }

    playlistModal.style.display = 'none';
    removeOutsideClickListener();
    disconnectItemsObserver();
    resetSelectionState();
  };

  setTimeoutfunction(() {
    document.addEventListener('click', outsideClickListener);
  }, 0);
}

function removeOutsideClickListener() {
  if (!outsideClickListener) return;
  document.removeEventListener('click', outsideClickListener);
  outsideClickListener = null;
}

function disconnectItemsObserver() {
  try { playlistItemsObserver.disconnect.(); } catch {}
  playlistItemsObserver = null;
}

export function destroyPlaylistModal() {
  removeOutsideClickListener();
  disconnectItemsObserver();
  try { musicPlayerState.selectedTracks.clear.(); } catch {}
  musicPlayerState.selectedTracks = new Set();

  document.querySelectorAll(".playlist-save-modal").forEach(function((modal) {
    try { modal.remove(); } catch {}
  });

  try { musicPlayerState.playlistModal.remove.(); } catch {}
  musicPlayerState.playlistModal = null;
  musicPlayerState.playlistItemsContainer = null;
  musicPlayerState.playlistSearchInput = null;
}

export function updatePlaylistModal() {
  var itemsContainer = musicPlayerState.playlistItemsContainer;
  itemsContainer.innerHTML = "";

  var DEFAULT_ARTWORK = "url('./slider/src/images/defaultArt.png')";

  for (var [index, track] of musicPlayerState.playlist.entries()) {
    var item = document.createElement("div");
    item.className = "playlist-item " + (index === musicPlayerState.currentIndex ? "active" : "") + " " + (
      musicPlayerState.selectedTracks.has(index) ? "selected" : ""
    );
    item.dataset.index = index;
    item.setAttribute("role", "listitem");

    var removeBtn = document.createElement('div');
    removeBtn.className = 'playlist-item-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = config.languageLabels.removeTrack || 'Remover música';
    removeBtn.setAttribute("aria-label", "Remove " + (track.Name || 'unknown track'));
    removeBtn.onclick = function(e) {
      e.stopPropagation();
      showRemoveConfirmModal(index, track.Name || config.languageLabels.unknownTrack);
    };
    item.appendChild(removeBtn);

    var checkboxId = "playlist-item-checkbox-" + (index);
    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "playlist-item-checkbox";
    checkbox.id = checkboxId;
    checkbox.name = "playlist-item-" + (index);
    checkbox.checked = musicPlayerState.selectedTracks.has(index);
    checkbox.setAttribute("aria-label", "Select " + (track.Name || 'unknown track'));
    checkbox.onclick = function(e) {
      e.stopPropagation();
      if (checkbox.checked) {
        musicPlayerState.selectedTracks.add(index);
        item.classList.add("selected");
      } else {
        musicPlayerState.selectedTracks.delete(index);
        item.classList.remove("selected");
      }
      updateSelectAllBtnState();
    };

    var itemContent = document.createElement("div");
    itemContent.className = "playlist-item-content";
    itemContent.onclick = function() playTrack(index);

    var img = document.createElement("div");
    img.className = "playlist-item-img";
    img.style.backgroundImage = DEFAULT_ARTWORK;
    img.setAttribute("aria-hidden", "true");

    var info = document.createElement("div");
    info.className = "playlist-item-info";

    var title = document.createElement("div");
    title.className = "playlist-item-title";
    title.textContent = (index + 1) + ". " + (track.Name || config.languageLabels.unknownTrack);

    var artist = document.createElement("div");
    artist.className = "playlist-item-artist";
    artist.textContent = track.Artists.join(", ") || config.languageLabels.unknownArtist || "Artista Desconhecido";

    info.appendChild(title);
    info.appendChild(artist);
    itemContent.appendChild(img);
    itemContent.appendChild(info);
    item.appendChild(checkbox);
    item.appendChild(itemContent);
    itemsContainer.appendChild(item);
  }

  disconnectItemsObserver();

  playlistItemsObserver = new IntersectionObserverfunction((entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        var item = entry.target;
        var index = parseInt(item.dataset.index, 10);
        loadImageForItem(item, index);
        playlistItemsObserver.unobserve(item);
      }
    });
  }, { threshold: 0.1, root: itemsContainer });

  document.querySelectorAll('.playlist-item').forEach(function(item) {
    playlistItemsObserver.observe(item);
  });

  updateSelectAllBtnState();

  var activeItem = itemsContainer.querySelector(".playlist-item.active");
  if (activeItem) {
    activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
    activeItem.setAttribute("aria-current", "true");
  }
}

function loadImageForItem(item, index) {
  var track = musicPlayerState.playlist[index];
  if (!track) return;

  var img = item.querySelector(".playlist-item-img");
  var DEFAULT_ARTWORK = "url('./slider/src/images/defaultArt.png')";
  img.style.backgroundImage = DEFAULT_ARTWORK;

  try {
    if (isRadioTrack(track)) {
      var radioArt = resolveRadioStationArtUrl(track);
      if (radioArt) {
        img.style.backgroundImage = "url('" + (radioArt) + "')";
      }
      return;
    }

    var imageTag = track.AlbumPrimaryImageTag || track.PrimaryImageTag;
    if (imageTag) {
      var imageId = track.AlbumId || track.Id;
      var serverImageUrl = withParams("/Items/" + (imageId) + "/Images/Primary", {
        fillHeight: 100,
        fillWidth: 100,
        quality: 70,
        tag: imageTag,
        api_key: getAuthToken(),
      });
      img.style.backgroundImage = "url('" + (serverImageUrl) + "')";
      return;
    }

    var tags = readID3Tags(track.Id);
    if (tags.pictureUri) {
      img.style.backgroundImage = "url('" + (tags.pictureUri) + "')";
      return;
    }
  } catch (error) {
    console.warn("Erro ao carregar capa (ID: " + (track.Id) + "):", error);
  }
}

function filterPlaylistItems(searchTerm) {
  var items = musicPlayerState.playlistItemsContainer.querySelectorAll(".playlist-item");

  items.forEach(function((item) {
    var title = item.querySelector(".playlist-item-title").textContent.toLowerCase() || "";
    var artist = item.querySelector(".playlist-item-artist").textContent.toLowerCase() || "";

    if (title.includes(searchTerm) || artist.includes(searchTerm)) {
      item.style.display = "";
    } else {
      item.style.display = "none";
    }
  });
}

export function showRemoveConfirmModal(trackIndex, trackName) {
  var overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  var dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = "\n    <p><strong>" + (trackName) + "</strong> " + (config.languageLabels.confirmRemove || "deve ser removida da lista?") + "</p>\n    <button class=\"confirm-yes\">" + (config.languageLabels.yes || "Sim") + "</button>\n    <button class=\"confirm-no\">" + (config.languageLabels.no || "Não") + "</button>\n  ";
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function(e) {
    e.stopPropagation();
    if (e.target === overlay) overlay.remove();
  });

  dialog.querySelector(".confirm-yes").addEventListener("click", function(e) {
    e.stopPropagation();
    try {
      var playlistId = musicPlayerState.currentPlaylistId;
      var trackId = musicPlayerState.playlist[trackIndex].Id;
      var isCurrentTrack = trackIndex === musicPlayerState.currentIndex;

      if (playlistId) {
        removeItemsFromPlaylist(playlistId, [trackId]);
        showNotification(
          "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.trackRemoved || "Música removida"),
          3000,
          'success'
        );
      } else {
        showNotification(
          "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.trackRemovedLocal || "Música removida da lista local"),
          3000,
          'success'
        );
      }
      musicPlayerState.playlist.splice(trackIndex, 1);

      if (isCurrentTrack) {
        if (musicPlayerState.playlist.length > 0) {
          var newIndex = Math.min(trackIndex, musicPlayerState.playlist.length - 1);
          playTrack(newIndex);
        } else {
          if (musicPlayerState.audioElement) {
            musicPlayerState.audioElement.pause();
            musicPlayerState.audioElement.currentTime = 0;
          }
          musicPlayerState.currentIndex = -1;
          musicPlayerState.isPlaying = false;
        }
      } else if (trackIndex < musicPlayerState.currentIndex) {
        musicPlayerState.currentIndex--;
      }

      updatePlaylistModal();
    } catch (err) {
      console.error(err);
      showNotification(
        "<i class=\"fas fa-exclamation-circle\"></i> " + (musicPlayerState.currentPlaylistId ? (config.languageLabels.removeError || "Erro ao remover") : (config.languageLabels.removeLocalError || "Erro ao remover localmente")),
        3000,
        'error'
      );
    } finally {
      overlay.remove();
    }
  });

  dialog.querySelector(".confirm-no").addEventListener("click", function(e) {
    e.stopPropagation();
    overlay.remove();
  });
}

export function showRemoveSelectedConfirmModal() {
  var selected = Array.from(musicPlayerState.selectedTracks);
  var count = selected.length;
  if (!count) {
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.noSelection || "Nenhuma música selecionada"),
      3000,
      'warning'
    );
    return;
  }

  var overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  var dialog = document.createElement("div");
  dialog.className = "confirm-dialog";
  dialog.innerHTML = "\n    <p>" + (count) + " " + (config.languageLabels.confirmRemoveSelected || "músicas devem ser removidas?") + "</p>\n    <button class=\"confirm-yes\">" + (config.languageLabels.yes || "Sim") + "</button>\n    <button class=\"confirm-no\">" + (config.languageLabels.no || "Não") + "</button>\n  ";
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", function(e) {
    e.stopPropagation();
    if (e.target === overlay) overlay.remove();
  });

  dialog.querySelector(".confirm-yes").addEventListener("click", function(e) {
    e.stopPropagation();
    try {
      var playlistId = musicPlayerState.currentPlaylistId;
      var trackIds = selected.map(function(i) musicPlayerState.playlist[i].Id);
      var currentTrackWasRemoved = selected.includes(musicPlayerState.currentIndex);

      if (playlistId) {
        removeItemsFromPlaylist(playlistId, trackIds);
        showNotification(
          "<i class=\"fas fa-check-circle\"></i> " + (count) + " " + (config.languageLabels.tracksRemoved || "músicas removidas"),
          2000,
          'success'
        );
      } else {
        showNotification(
          "<i class=\"fas fa-info-circle\"></i> " + (count) + " " + (config.languageLabels.tracksRemovedLocal || "músicas removidas da lista local"),
          2000,
          'info'
        );
      }
      selected.sortfunction((a, b) b - a).forEach(function(i) {
        musicPlayerState.playlist.splice(i, 1);
        if (i < musicPlayerState.currentIndex) {
          musicPlayerState.currentIndex--;
        }
      });

      if (currentTrackWasRemoved) {
        if (musicPlayerState.playlist.length > 0) {
          var newIndex = Math.min(musicPlayerState.currentIndex, musicPlayerState.playlist.length - 1);
          playTrack(newIndex);
        } else {
          if (musicPlayerState.audioElement) {
            musicPlayerState.audioElement.pause();
            musicPlayerState.audioElement.currentTime = 0;
          }
          musicPlayerState.currentIndex = -1;
          musicPlayerState.isPlaying = false;
        }
      }

      musicPlayerState.selectedTracks.clear();
      updatePlaylistModal();
    } catch (err) {
      console.error(err);
      showNotification(
        "<i class=\"fas fa-exclamation-circle\"></i> " + (musicPlayerState.currentPlaylistId ? (config.languageLabels.removeError || "Erro ao remover") : (config.languageLabels.removeLocalError || "Erro ao remover localmente")),
        3000,
        'error'
      );
    } finally {
      overlay.remove();
    }
  });

  dialog.querySelector(".confirm-no").addEventListener("click", function(e) {
    e.stopPropagation();
    overlay.remove();
  });
}
