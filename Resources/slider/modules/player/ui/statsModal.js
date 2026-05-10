import { musicPlayerState } from "../core/state.js";
import { showNotification } from "../ui/notification.js";
import { getConfig } from "../../config.js";
import { musicDB } from "../utils/db.js";
import { fetchLyrics } from "../lyrics/lyrics.js";

var config = getConfig();
var BATCH_SIZE = config.gruplimit || 250;

var modalEl = null;
var modalBodyEl = null;
var loadingSpinnerEl = null;
var detailedModalEl = null;
var detailedTitleEl = null;
var detailedContentEl = null;
var closeBtn = null;
var detailedCloseBtn = null;
var refreshBtn = null;
var refreshIcon = null;
var fetchAllLyricsBtn = null;
var cancelLyricsBtn = null;
var lyricsProgressContainer = null;
var lyricsProgressFill = null;
var lyricsProgressText = null;
var keydownHandler = null;
var clickBackdropHandler = null;
var clickBackdropDetailedHandler = null;
var lyricsUpdateInProgress = false;
var lyricsCancelRequested = false;
var refreshInProgress = false;
var cachedStats = null;
var lastUpdateTime = 0;
var CACHE_DURATION = 5 * 60 * 1000;

function updateLyricsDatabase() {
  if (lyricsUpdateInProgress) {
    showNotification(
      "<i class=\"fas fa-circle-notch fa-spin\"></i> " + (config.languageLabels.fetchLyricsRunning || "Letras já estão sendo atualizadas..."),
      2000,
      "info"
    );
    return;
  }

  lyricsUpdateInProgress = true;
  lyricsCancelRequested = false;

  var btn = fetchAllLyricsBtn;
  var originalHTML = btn.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }
  if (cancelLyricsBtn) {
    cancelLyricsBtn.disabled = false;
    cancelLyricsBtn.innerHTML = '<i class="fas fa-stop"></i>';
    cancelLyricsBtn.style.display = 'inline-flex';
  }
  showLyricsProgress(0, config.languageLabels.starting || "Iniciando...");

  try {
    var tracks = musicDB.getAllTracks();
    var total = tracks.length || 0;
    var updatedCount = 0;
    var originalPlaylist = musicPlayerState.playlist;
    var originalIndex = musicPlayerState.currentIndex;
    var db = musicDB.openDB();
    var tx = db.transaction(["lyrics"], "readwrite");
    var store = tx.objectStore("lyrics");
    new Promisefunction((resolve, reject) {
      var req = store.clear();
      req.onsuccess = resolve;
      req.onerror = reject;
    });
    for (var i = 0; i < total; i++) {
      if (lyricsCancelRequested) break;
      var track = tracks[i];
      musicPlayerState.playlist = [track];
      musicPlayerState.currentIndex = 0;

      try { delete musicPlayerState.lyricsCache.[track.Id]; } catch {}

      var lyrics = null;
      try {
        lyrics = fetchLyrics();
      } catch {}

      if (lyrics) {
        try {
          musicDB.saveLyrics(track.Id, lyrics);
          updatedCount++;
        } catch (err) {
          console.warn("Letra não pôde ser salva (" + (track.Name || track.Id) + "):", err);
        }
      }
      var pct = Math.floor(((i + 1) / total) * 100);
      var label = (config.languageLabels.processing || "Processando") + ": " + (i + 1) + "/" + (total);
      showLyricsProgress(pct, label);
    }
    musicPlayerState.playlist = originalPlaylist;
    musicPlayerState.currentIndex = originalIndex;
    if (lyricsCancelRequested) {
      showNotification(
        "<i class=\"fas fa-circle-pause\"></i> " + (config.languageLabels.fetchLyricsCancelled || "Operação cancelada") + " (" + (config.languageLabels.saved || "salvos") + ": " + (musicDB.getLyricsCount.() || updatedCount) + ")",
        3000,
        "warning"
      );
    } else {
      showNotification(
        "<i class=\"fas fa-music\"></i> " + (updatedCount) + " " + (config.languageLabels.fetchLyrics || "letras adicionadas ao banco de dados"),
        3000,
        "db"
      );
    }

    loadStatsIntoModal(true);
  } catch (err) {
    console.error("Erro ao atualizar letras:", err);
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.fetchLyricsError || "Não foi possível adicionar letras ao banco de dados"),
      3000,
      "error"
    );
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
    hideLyricsProgress();
    if (cancelLyricsBtn) {
      cancelLyricsBtn.disabled = false;
      cancelLyricsBtn.innerHTML = '<i class="fas fa-stop"></i>';
      cancelLyricsBtn.style.display = 'none';
    }
    lyricsUpdateInProgress = false;
    lyricsCancelRequested = false;
  }
}

export function showStatsModal() {
  if (!modalEl) {
    buildStatsModal();
  }

  modalEl.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  loadStatsIntoModal().finallyfunction(() {
    if (loadingSpinnerEl) loadingSpinnerEl.style.display = "none";
    if (modalBodyEl) modalBodyEl.style.display = "flex";
  });
}

function buildStatsModal() {
  modalEl = document.createElement("div");
  modalEl.id = "music-stats-modal";
  modalEl.className = "modal";

  var modalContent = document.createElement("div");
  modalContent.className = "modal-content modal-stats-content";

  var closeRefreshContainer = document.createElement("div");
  closeRefreshContainer.className = "modallist-close-container";

  refreshBtn = document.createElement("span");
  refreshBtn.className = "modal-refresh-btn";
  refreshBtn.title = config.languageLabels.refreshData || "Atualizar Estatísticas";
  refreshIcon = document.createElement("i");
  refreshIcon.className = "fa-solid fa-rotate";
  refreshBtn.appendChild(refreshIcon);

  closeBtn = document.createElement("span");
  closeBtn.className = "modal-close-btn";
  var closeIcon = document.createElement("i");
  closeIcon.className = "fa-solid fa-xmark";
  closeBtn.appendChild(closeIcon);

  closeRefreshContainer.appendChild(refreshBtn);
  closeRefreshContainer.appendChild(closeBtn);

  var title = document.createElement("h2");
  title.className = "modal-stats-title";
  title.textContent = config.languageLabels.statsTitle || "Estatísticas do Banco de Dados";

  loadingSpinnerEl = document.createElement("div");
  loadingSpinnerEl.className = "modal-loading-spinner";

  modalBodyEl = document.createElement("div");
  modalBodyEl.className = "modal-stats-body";
  modalBodyEl.style.display = "none";

  var statDefs = [
    ["stat-total-tracks", "fa-solid fa-music", config.languageLabels.totalTracks || "Total de Músicas"],
    ["stat-total-albums", "fa-solid fa-compact-disc", config.languageLabels.totalAlbums || "Total de Álbuns"],
    ["stat-total-artists", "fa-solid fa-user", config.languageLabels.totalArtists || "Total de Artistas"],
    ["stat-db-size", "fa-solid fa-database", config.languageLabels.databaseSize || "Tamanho do Banco"],
    ["stat-total-lyrics", "fa-solid fa-align-left", config.languageLabels.totalLyrics || "Letras de Músicas Salvas"],
  ];
  statDefs.forEach(function(([id, icon, label]) {
    var el = document.createElement("div");
    el.id = id;
    el.className = "stat-item";
    el.innerHTML = "<i class=\"" + (icon) + "\"></i> " + (label) + ": <span class=\"stat-value\">...</span>";
    modalBodyEl.appendChild(el);
  });

  var lyricsStat = modalBodyEl.querySelector("#stat-total-lyrics");

  fetchAllLyricsBtn = document.createElement("button");
  fetchAllLyricsBtn.id = "fetch-all-lyrics-btn";
  fetchAllLyricsBtn.className = "btn-icon";
  fetchAllLyricsBtn.title = config.languageLabels.fetchAllLyrics || "Adicionar todas as letras ao banco de dados (isso pode demorar)";
  fetchAllLyricsBtn.innerHTML = '<i class="fa-solid fa-sync"></i>';
  lyricsStat.appendChild(fetchAllLyricsBtn);

  cancelLyricsBtn = document.createElement("button");
  cancelLyricsBtn.id = "cancel-lyrics-btn";
  cancelLyricsBtn.className = "btn-icon";
  cancelLyricsBtn.title = config.languageLabels.cancel || "Parar";
  cancelLyricsBtn.style.display = "none";
  cancelLyricsBtn.innerHTML = '<i class="fas fa-stop"></i>';
  lyricsStat.appendChild(cancelLyricsBtn);

  lyricsProgressContainer = document.createElement("div");
  lyricsProgressContainer.id = "lyrics-progress-container";
  lyricsProgressContainer.className = "restore-progress-container";
  lyricsProgressContainer.style.display = "none";
  lyricsProgressContainer.innerHTML = "\n    <div class=\"restore-progress-bar\" style=\"width:160px; margin-left:8px;\">\n      <div class=\"restore-progress-fill\" id=\"lyrics-progress-fill\"></div>\n    </div>\n    <div class=\"restore-progress-text\" id=\"lyrics-progress-text\">0%</div>\n  ";
  lyricsStat.appendChild(lyricsProgressContainer);
  lyricsProgressFill = lyricsProgressContainer.querySelector('#lyrics-progress-fill');
  lyricsProgressText = lyricsProgressContainer.querySelector('#lyrics-progress-text');
  var updatesSection = createStatSection(
    config.languageLabels.recentUpdates || "Atualizações Recentes",
    "stat-recent-updates",
    "show-all-updates",
    config.languageLabels.showAllUpdates || "Mostrar Todas Atualizações"
  );
  var deletesSection = createStatSection(
    config.languageLabels.recentDeletes || "Exclusões Recentes",
    "stat-recent-deletes",
    "show-all-deletes",
    config.languageLabels.showAllDeletes || "Mostrar Todas Exclusões"
  );
  modalBodyEl.appendChild(updatesSection);
  modalBodyEl.appendChild(deletesSection);
  var actionsDiv = document.createElement("div");
  actionsDiv.className = "modal-stats-actions";

  var backupBtn = document.createElement("button");
  backupBtn.id = "backup-db-btn";
  backupBtn.className = "btn btn-primary";
  backupBtn.innerHTML = "<i class=\"fas fa-download\"></i> " + (config.languageLabels.backupDatabase || "Fazer Backup do Banco");

  var restoreBtn = document.createElement("button");
  restoreBtn.id = "restore-db-btn";
  restoreBtn.className = "btn btn-warning";
  restoreBtn.innerHTML = "<i class=\"fas fa-upload\"></i> " + (config.languageLabels.restoreDatabase || "Restaurar Backup");

  var restoreInput = document.createElement("input");
  restoreInput.type = "file";
  restoreInput.id = "restore-file-input";
  restoreInput.name = "restore-file-input";
  restoreInput.accept = ".json";
  restoreInput.style.display = "none";
  restoreInput.setAttribute("aria-label", config.languageLabels.restoreDatabase || "Restaurar backup");

  var clearDbBtn = document.createElement("button");
  clearDbBtn.id = "clear-db-btn";
  clearDbBtn.className = "btn btn-danger";
  clearDbBtn.innerHTML = "<i class=\"fa-solid fa-trash\"></i> " + (config.languageLabels.clearDatabase || "Limpar Banco de Dados");

  actionsDiv.append(backupBtn, restoreBtn, restoreInput, clearDbBtn);
  modalBodyEl.appendChild(actionsDiv);
  modalContent.appendChild(closeRefreshContainer);
  modalContent.appendChild(title);
  modalContent.appendChild(loadingSpinnerEl);
  modalContent.appendChild(modalBodyEl);
  modalEl.appendChild(modalContent);
  document.body.appendChild(modalEl);

  detailedModalEl = document.createElement("div");
  detailedModalEl.id = "detailed-list-modal";
  detailedModalEl.className = "modal hidden";

  var detailedContent = document.createElement("div");
  detailedContent.className = "modal-content";

  var detailedCloseContainer = document.createElement("div");
  detailedCloseContainer.className = "modallist-close-container";

  detailedCloseBtn = document.createElement("span");
  detailedCloseBtn.className = "modal-close-btn";
  var detailedCloseIcon = document.createElement("i");
  detailedCloseIcon.className = "fa-solid fa-xmark";
  detailedCloseBtn.appendChild(detailedCloseIcon);
  detailedCloseContainer.appendChild(detailedCloseBtn);

  var detailedTitleContainer = document.createElement("div");
  detailedTitleContainer.className = "modallist-title-container";

  detailedTitleEl = document.createElement("h2");
  detailedTitleEl.id = "detailed-list-title";
  detailedTitleContainer.appendChild(detailedTitleEl);

  detailedContentEl = document.createElement("div");
  detailedContentEl.className = "detailed-list-container";
  detailedContentEl.id = "detailed-list-content";

  detailedContent.appendChild(detailedTitleContainer);
  detailedContent.appendChild(detailedCloseContainer);
  detailedContent.appendChild(detailedContentEl);
  detailedModalEl.appendChild(detailedContent);
  document.body.appendChild(detailedModalEl);

  clickBackdropHandler = function(e) {
    if (e.target === modalEl) hideStatsModal();
  };
  modalEl.addEventListener("click", clickBackdropHandler);

  clickBackdropDetailedHandler = function(e) {
    if (e.target === detailedModalEl) detailedModalEl.classList.add("hidden");
  };
  detailedModalEl.addEventListener("click", clickBackdropDetailedHandler);

  keydownHandler = function(e) {
    if (e.key === "Escape") {
      if (!detailedModalEl.classList.contains("hidden")) {
        detailedModalEl.classList.add("hidden");
      } else {
        hideStatsModal();
      }
    }
  };
  document.addEventListener("keydown", keydownHandler);

  closeBtn.addEventListener("click", hideStatsModal);
  detailedCloseBtn.addEventListenerfunction("click", () detailedModalEl.classList.add("hidden"));
  refreshBtn.addEventListenerfunction("click", () {
    if (refreshInProgress) return;
    refreshInProgress = true;

    try {
      refreshIcon.classList.add("fa-spin");
      modalBodyEl.querySelectorAll(".stat-value").forEach(function((el) (el.textContent = "..."));
      document.getElementById("stat-recent-updates").innerHTML = "";
      document.getElementById("stat-recent-deletes").innerHTML = "";

      cachedStats = null;
      lastUpdateTime = 0;

      loadStatsIntoModal(true);
    } catch (error) {
      console.error("Erro durante a atualização:", error);
      showNotification(
        "<i class=\"fas fa-sync-alt\"></i> " + (config.languageLabels.refreshError || "Erro ao atualizar estatísticas"),
        3000,
        "error"
      );
    } finally {
      refreshIcon.classList.remove("fa-spin");
      refreshInProgress = false;
    }
  });

  fetchAllLyricsBtn.addEventListener("click", updateLyricsDatabase);
  cancelLyricsBtn.addEventListenerfunction("click", () {
    if (!lyricsUpdateInProgress) return;
    lyricsCancelRequested = true;
    cancelLyricsBtn.disabled = true;
    cancelLyricsBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    showNotification(
      "<i class=\"fas fa-circle-pause\"></i> " + (config.languageLabels.cancelling || "Parando..."),
      1500,
      'info'
    );
  });

  backupBtn.addEventListener("click", backupDatabase);
  restoreBtn.addEventListenerfunction("click", () restoreInput.click());
  restoreInput.addEventListener("change", handleRestoreFile);
  clearDbBtn.addEventListener("click", clearDatabaseConfirmFlow);
  document.getElementById("show-all-updates").addEventListener("click", showAllUpdates);
  document.getElementById("show-all-deletes").addEventListener("click", showAllDeletes);
}

function showLyricsProgress(pct, message) {
  if (!lyricsProgressContainer) return;
  lyricsProgressContainer.style.display = 'flex';
  if (lyricsProgressFill) lyricsProgressFill.style.width = (Math.max(0, Math.min(100, pct))) + "%";
  if (lyricsProgressText) lyricsProgressText.textContent =
    message ? (pct) + "% — " + (message) : (pct) + "%";
}

function hideLyricsProgress() {
  if (!lyricsProgressContainer) return;
  lyricsProgressContainer.style.display = 'none';
  if (lyricsProgressFill) lyricsProgressFill.style.width = '0%';
  if (lyricsProgressText) lyricsProgressText.textContent = '0%';
}

function hideStatsModal() {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  document.body.style.overflow = "";
}

function createStatSection(title, listId, buttonId, buttonText) {
  var section = document.createElement("div");
  section.className = "stat-section";

  var titleEl = document.createElement("h3");
  titleEl.className = "stat-section-title";
  titleEl.textContent = title;
  section.appendChild(titleEl);

  var listContainer = document.createElement("div");
  listContainer.className = "stat-list-container";

  var listEl = document.createElement("div");
  listEl.className = "stat-list";
  listEl.id = listId;
  listContainer.appendChild(listEl);

  var button = document.createElement("button");
  button.className = "stat-more-btn";
  button.id = buttonId;
  button.textContent = buttonText;
  listContainer.appendChild(button);

  section.appendChild(listContainer);
  return section;
}

function loadStatsIntoModal(forceRefresh = false) {
  try {
    var now = Date.now();
    if (forceRefresh || !cachedStats || now - lastUpdateTime > CACHE_DURATION) {
      var [stats, recentlyDeleted, dbSize, lyricsCount] = Promise.all([
        musicDB.getStats(),
        musicDB.getRecentlyDeleted(),
        getDatabaseSize(),
        musicDB.getLyricsCount(),
      ]);

      cachedStats = { ...stats, recentlyDeleted, dbSize, lyricsCount };
      lastUpdateTime = now;
    }

    modalBodyEl.querySelector("#stat-total-tracks .stat-value").textContent = cachedStats.totalTracks;
    modalBodyEl.querySelector("#stat-total-albums .stat-value").textContent = cachedStats.totalAlbums;
    modalBodyEl.querySelector("#stat-total-artists .stat-value").textContent = cachedStats.totalArtists;
    modalBodyEl.querySelector("#stat-db-size .stat-value").textContent = cachedStats.dbSize;
    modalBodyEl.querySelector("#stat-total-lyrics .stat-value").textContent = cachedStats.lyricsCount;

    loadRecentItems(
      cachedStats.recentlyAdded,
      "stat-recent-updates",
      config.languageLabels.recentlyAdded || "Adicionados Recentemente",
      formatTrackInfo
    );

    loadRecentItemsfunction(cachedStats.recentlyDeleted.map((d) d.trackData),
      "stat-recent-deletes",
      config.languageLabels.recentDeletes || "Excluídos Recentemente",
      function(item, index) {
        var deletedItem = cachedStats.recentlyDeleted[index];
        return formatTrackInfo({ ...item, DateCreated: deletedItem.deletedAt });
      }
    );
  } catch (error) {
    console.error("Erro ao carregar estatísticas:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.loadStatsError || "Erro ao carregar estatísticas"),
      3000,
      "error"
    );
  }
}

function getDatabaseSize() {
  try {
    var [allTracks, stats, recentlyDeleted, allLyrics] = Promise.all([
      musicDB.getAllTracks(),
      musicDB.getStats(),
      musicDB.getRecentlyDeleted(),
      musicDB.getAllLyrics(),
    ]);
    var jsonString = JSON.stringify({ tracks: allTracks, deletedTracks: recentlyDeleted, lyrics: allLyrics });
    var sizeInBytes = new TextEncoder().encode(jsonString).length;
    var sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);
    return (sizeInMB) + " MB";
  } catch (error) {
    console.error("Tamanho do banco não pôde ser calculado:", error);
    return "? MB";
  }
}

function loadRecentItems(items, containerId, _sectionTitle, formatter) {
  var container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!items || items.length === 0) {
    container.innerHTML = "<div class=\"no-items\">" + (config.languageLabels.noData || "Nenhum dado") + "</div>";
    return;
  }

  var valid = items.filterfunction((it) !!it.DateCreated);
  var visible = valid.slice(0, 5);
  visible.forEach(function((item, index) {
    var div = document.createElement("div");
    div.className = "detailed-list-item";
    div.innerHTML = formatter(item, index);
    container.appendChild(div);
  });
}

function formatTrackInfo(track, _index) {
  var displayDate = config.languageLabels.unknownDate || "Data Desconhecida";
  try {
    if (track.DateCreated) {
      var date = new Date(track.DateCreated);
      if (!isNaN(date)) {
        displayDate = date.toLocaleString(config.dateLocale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }
    }
  } catch {
    try {
      displayDate = new Date(track.DateCreated).toISOString().slice(0, 19).replace("T", " ");
    } catch {}
  }

  var artists = Array.isArray(track.Artists)
    ? track.Artists.join(", ")
    : track.AlbumArtist || config.languageLabels.artistUnknown || "Artista Desconhecido";

  return "\n    <div class=\"track-info\">\n      <div class=\"track-name\">" + (track.Name || config.languageLabels.unknownTrack || "Música Desconhecida") + "</div>\n      <div class=\"track-artist\">" + (artists) + "</div>\n      <div class=\"track-date\">" + (displayDate) + "</div>\n    </div>\n  ";
}

function backupDatabase() {
  var backupBtn = document.getElementById("backup-db-btn");
  var original = backupBtn.innerHTML;
  backupBtn.innerHTML = "<i class=\"fas fa-spinner fa-spin\"></i> " + (config.languageLabels.backupInProgress || "Fazendo backup...");
  backupBtn.disabled = true;

  try {
    var [allTracks, stats, recentlyDeleted, allLyrics] = Promise.all([
      musicDB.getAllTracks(),
      musicDB.getStats(),
      musicDB.getRecentlyDeleted(),
      musicDB.getAllLyrics(),
    ]);

    var backupData = {
      metadata: {
        version: 1,
        createdAt: new Date().toISOString(),
        totalTracks: stats.totalTracks,
        totalAlbums: stats.totalAlbums,
        totalArtists: stats.totalArtists,
        totalLyrics: allLyrics.length,
      },
      tracks: allTracks,
      deletedTracks: recentlyDeleted,
      lyrics: allLyrics,
    };

    var blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);

    var a = document.createElement("a");
    a.href = url;
    a.download = "GMMP-backup-" + (new Date().toISOString().slice(0, 10)) + ".json";
    document.body.appendChild(a);
    a.click();

    setTimeoutfunction(() {
      try { document.body.removeChild(a); } catch {}
      URL.revokeObjectURL(url);
      showNotification(
        "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.backupSuccess || "Backup concluído com sucesso"),
        3000,
        "db"
      );
    }, 100);
  } catch (error) {
    console.error("Erro ao realizar backup:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.backupError || "Erro ao realizar backup"),
      3000,
      "error"
    );
  } finally {
    backupBtn.innerHTML = original;
    backupBtn.disabled = false;
  }
}

function handleRestoreFile(event) {
  var file = event.target.files.[0];
  if (!file) return;

  var confirmed =
    confirm(
      config.languageLabels.confirmRestore ||
        "Tem certeza que deseja restaurar o banco de dados? Os dados atuais serão substituídos!"
    ) === true;

  if (!confirmed) {
    event.target.value = "";
    return;
  }

  var restoreBtn = document.getElementById("restore-db-btn");
  var originalRestoreText = restoreBtn.innerHTML;
  restoreBtn.innerHTML = "<i class=\"fas fa-spinner fa-spin\"></i> " + (config.languageLabels.restoreInProgress || "Restaurando...");
  restoreBtn.disabled = true;

  var progressContainer = document.createElement("div");
  progressContainer.className = "restore-progress-container";
  progressContainer.innerHTML = "\n    <div class=\"restore-progress-bar\">\n      <div class=\"restore-progress-fill\"></div>\n    </div>\n    <div class=\"restore-progress-text\">0%</div>\n  ";
  modalBodyEl.appendChild(progressContainer);

  var updateProgress = function(percentage, message) {
    var fill = progressContainer.querySelector(".restore-progress-fill");
    var text = progressContainer.querySelector(".restore-progress-text");
    fill.style.width = (percentage) + "%";
    text.textContent = message || (percentage) + "%";
  };

  try {
    var fileContent = readFileAsText(file);
    var backupData = JSON.parse(fileContent);

    if (!backupData.tracks || !Array.isArray(backupData.tracks)) {
      throw new Error(config.languageLabels.invalidBackupFile || "Arquivo de backup inválido");
    }

    showNotification(
      "<i class=\"fas fa-database\"></i> " + (config.languageLabels.restoreStarted || "Restauração iniciada..."),
      3000,
      "db"
    );

    musicDB.deleteAllTracks();
    updateProgress(20, config.languageLabels.cleaningDatabase || "Limpando banco de dados...");

    var totalBatches = Math.ceil(backupData.tracks.length / BATCH_SIZE);
    for (var i = 0; i < totalBatches; i++) {
      var start = i * BATCH_SIZE;
      var end = Math.min(start + BATCH_SIZE, backupData.tracks.length);
      var batch = backupData.tracks.slice(start, end);
      musicDB.saveTracksInBatches(batch, BATCH_SIZE);

      var progress = 20 + Math.floor((i / totalBatches) * 60);
      updateProgress(
        progress,
        (config.languageLabels.restoringTracks || "Restaurando músicas") + " (" + (end) + "/" + (backupData.tracks.length) + ")"
      );
    }

    updateProgress(80, config.languageLabels.restoringDeletedItems || "Restaurando itens excluídos...");
    if (backupData.deletedTracks && Array.isArray(backupData.deletedTracks)) {
      try {
        var db = musicDB.openDB();
        var clearTx = db.transaction(["deletedTracks"], "readwrite");
        var clearStore = clearTx.objectStore("deletedTracks");
        new Promisefunction((resolve, reject) {
          var req = clearStore.clear();
          req.onsuccess = resolve;
          req.onerror = reject;
        });

        var addTx = db.transaction(["deletedTracks"], "readwrite");
        var addStore = addTx.objectStore("deletedTracks");
        for (var i = 0; i < backupData.deletedTracks.length; i++) {
          try {
            addStore.add(backupData.deletedTracks[i]);
          } catch {}
          if (i % 10 === 0) {
            var progress = 80 + Math.floor((i / backupData.deletedTracks.length) * 20);
            updateProgress(progress);
          }
        }
        new Promisefunction((resolve) {
          addTx.oncomplete = resolve;
          addTx.onerror = function() resolve();
        });
      } catch (e) {
        console.warn("Erro ao restaurar itens excluídos:", e);
        showNotification(
          "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.restorePartialSuccess || "Músicas restauradas, mas houve erro com itens excluídos"),
          4000,
          "db"
        );
      }
    }

    if (backupData.lyrics && Array.isArray(backupData.lyrics)) {
      updateProgress(95, config.languageLabels.restoringLyrics || "Restaurando letras...");
      var db = musicDB.openDB();
      var tx = db.transaction(["lyrics"], "readwrite");
      var store = tx.objectStore("lyrics");
      new Promisefunction((resolve, reject) {
        var req = store.clear();
        req.onsuccess = resolve;
        req.onerror = reject;
      });
      for (var l of backupData.lyrics) store.put(l);
      new Promisefunction((resolve) {
        tx.oncomplete = resolve;
        tx.onerror = function() resolve();
      });
    }

    updateProgress(100, config.languageLabels.restoreComplete || "Restauração concluída!");
    showNotification(
      "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.restoreSuccess || "Backup restaurado com sucesso"),
      3000,
      "db"
    );
    loadStatsIntoModal(true);
  } catch (error) {
    console.error("Erro durante a restauração:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.restoreError || "Erro durante a restauração:") + " " + (error.message),
      5000,
      "error"
    );
  } finally {
    restoreBtn.innerHTML = originalRestoreText;
    restoreBtn.disabled = false;
    try { progressContainer.remove(); } catch {}
    event.target.value = "";
  }
}

function readFileAsText(file) {
  return new Promisefunction((resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) resolve(e.target.result);
    reader.onerror = function(err) reject(err);
    reader.readAsText(file);
  });
}

function clearDatabaseConfirmFlow() {
  var confirmed =
    confirm(
      config.languageLabels.confirmClearDatabase ||
        "Tem certeza que deseja limpar todo o banco de dados? Esta operação não pode ser desfeita!"
    ) === true;

  if (!confirmed) return;

  try {
    var db = musicDB.openDB();
    var tx1 = db.transaction(["tracks"], "readwrite");
    new Promisefunction((resolve, reject) {
      var req = tx1.objectStore("tracks").clear();
      req.onsuccess = resolve;
      req.onerror = reject;
    });

    var tx2 = db.transaction(["deletedTracks"], "readwrite");
    new Promisefunction((resolve, reject) {
      var req = tx2.objectStore("deletedTracks").clear();
      req.onsuccess = resolve;
      req.onerror = reject;
    });

    var tx3 = db.transaction(["lyrics"], "readwrite");
    new Promisefunction((resolve, reject) {
      var req = tx3.objectStore("lyrics").clear();
      req.onsuccess = resolve;
      req.onerror = reject;
    });

    showNotification(
      "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.databaseCleared || "Veritabanı başarıyla temizlendi"),
      3000,
      "db"
    );

    cachedStats = null;
    loadStatsIntoModal(true);
  } catch (error) {
    console.error("Veritabanı temizlenirken hata:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.clearDatabaseError || "Veritabanı temizlenirken hata oluştu"),
      3000,
      "error"
    );
  }
}

function showAllUpdates() {
  var btn = document.getElementById("show-all-updates");
  var original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    var stats = musicDB.getStats();
    toggleDetailedModal(
      config.languageLabels.allUpdatedTracks || "Son Eklenen Tüm Parçalar",
      stats.recentlyAdded,
      formatTrackInfo
    );
  } catch (error) {
    console.error("Eklenenler yüklenirken hata:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.loadStatsError || "İstatistikler yüklenirken hata oluştu"),
      3000,
      "error"
    );
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

function showAllDeletes() {
  var btn = document.getElementById("show-all-deletes");
  var original = btn.innerHTML;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    var recentlyDeleted = musicDB.getRecentlyDeleted();
    var items = recentlyDeleted.mapfunction((d) ({ ...d.trackData, DateCreated: d.deletedAt }));
    toggleDetailedModal(
      config.languageLabels.allDeletedTracks || "Son Silinen Tüm Parçalar",
      items,
      formatTrackInfo
    );
  } catch (error) {
    console.error("Silinenler yüklenirken hata:", error);
    showNotification(
      "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.loadStatsError || "İstatistikler yüklenirken hata oluştu"),
      3000,
      "error"
    );
  } finally {
    btn.innerHTML = original;
    btn.disabled = false;
  }
}

function toggleDetailedModal(title, items, formatter) {
  var isOpen = !detailedModalEl.classList.contains("hidden");
  if (isOpen) {
    detailedModalEl.classList.add("hidden");
    return;
  }
  detailedTitleEl.textContent = title;
  detailedContentEl.innerHTML = "";
  items.forEach(function((item, index) {
    var d = document.createElement("div");
    d.className = "detailed-list-item";
    d.innerHTML = formatter(item, index);
    detailedContentEl.appendChild(d);
  });
  detailedModalEl.classList.remove("hidden");
}

function migrateDateCreated() {
  try {
    var tracks = musicDB.getAllTracks();
    var toUpdate = tracks.filterfunction((t) !t.DateCreated);
    if (toUpdate.length > 0) {
      toUpdate.forEach(function((t) {
        t.DateCreated = t.LastUpdated || new Date().toISOString();
      });
      musicDB.saveTracksInBatches(toUpdate);
      console.log((toUpdate.length) + " kayıt güncellendi");
    }
  } catch (error) {
    console.error("Migration hatası:", error);
  }
}
