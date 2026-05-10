import { musicPlayerState } from "../core/state.js";
import { getConfig } from "../../config.js";
import { getAuthToken } from "../core/auth.js";
import { showNotification } from "../ui/notification.js";
import { refreshPlaylist } from "../core/playlist.js";
import { withServer, withParams } from "../../jfUrl.js";
import { enhanceFormAccessibility } from "../../accessibility.js";


var config = getConfig();
var PLACEHOLDER_IMAGE = "./slider/src/images/defaultArt.png";

var activeModal = null;
var fetchCtrl = null;
var keydownHandler = null;
var prevFocus = null;
var bodyOverflowPrev = null;

export function showGenreFilterModal() {
  if (activeModal) {
    closeModalSafe();
  }

  try {
    var token = getAuthToken();
    fetchCtrl = new AbortController();

    var response = fetch(
      withParams("/MusicGenres", {
        Recursive: "true",
        IncludeItemTypes: "MusicAlbum,Audio",
        Fields: "PrimaryImageAspectRatio,ImageTags",
        EnableTotalRecordCount: "false",
      }),
      { headers: { "X-Emby-Token": token }, signal: fetchCtrl.signal }
    );

    if (!response.ok) throw new Error("Não foi possível obter gêneros");

    var data = response.json();
    var genres = data.Items || [];

    if (genres.length === 0) {
      showNotification(
        "<i class=\"fas fa-exclamation-circle\"></i> " + (config.languageLabels.noGenresFound || "Nenhum gênero encontrado"),
        2000,
        "error"
      );
      return;
    }

    buildModal(genres, token);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("Erro ao abrir filtro de gênero:", err);
    showNotification(
      "<i class=\"fas fa-exclamation-triangle\"></i> " + (config.languageLabels.genreFilterError || "Não foi possível carregar o filtro de gênero"),
      2000,
      "error"
    );
  } finally {
    fetchCtrl = null;
  }
}

function buildModal(genres, token) {
  prevFocus = document.activeElement;
  bodyOverflowPrev = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  var modal = document.createElement("div");
  modal.className = "genre-filter-modal";
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("role", "dialog");

  var modalContent = document.createElement("div");
  modalContent.className = "genre-filter-modal-content";

  var header = document.createElement("div");
  header.className = "genre-filter-header";

  var title = document.createElement("h3");
  title.innerHTML = "<i class=\"fas fa-filter\"></i> " + (config.languageLabels.filterByGenre || "Filtrar por gênero");
  header.appendChild(title);

  var closeBtn = document.createElement("button");
  closeBtn.className = "genre-filter-close";
  closeBtn.innerHTML = '<i class="fas fa-times"></i>';
  closeBtn.setAttribute("aria-label", "Close modal");
  closeBtn.addEventListener("click", closeModalSafe);
  header.appendChild(closeBtn);

  var searchContainer = document.createElement("div");
  searchContainer.className = "genre-search-container";

  var searchIcon = document.createElement("i");
  searchIcon.className = "fas fa-search genre-search-icon";

  var searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = config.languageLabels.searchGenres || "Buscar em gêneros...";
  searchInput.className = "genre-filter-search";
  searchInput.id = "genre-filter-search";
  searchInput.name = "genre-filter-search";

  searchContainer.append(searchIcon, searchInput);

  var genresContainer = document.createElement("div");
  genresContainer.className = "genre-filter-container";

  var selectedCount = document.createElement("div");
  selectedCount.className = "genre-selected-count";

  var actionButtons = document.createElement("div");
  actionButtons.className = "genre-filter-actions";

  var selectAllBtn = document.createElement("button");
  selectAllBtn.className = "genre-filter-select-all";
  selectAllBtn.innerHTML = "<i class=\"fas fa-check-double\"></i> " + (config.languageLabels.selectAll || "Selecionar tudo");

  var selectNoneBtn = document.createElement("button");
  selectNoneBtn.className = "genre-filter-select-none";
  selectNoneBtn.innerHTML = "<i class=\"far fa-square\"></i> " + (config.languageLabels.selectNone || "Nenhum");

  var clearFilterBtn = document.createElement("button");
  clearFilterBtn.className = "genre-filter-clear";
  clearFilterBtn.innerHTML = "<i class=\"fas fa-eraser\"></i> " + (config.languageLabels.clearFilter || "Limpar filtro");

  var applyBtn = document.createElement("button");
  applyBtn.className = "genre-filter-apply primary";
  applyBtn.innerHTML = "<i class=\"fas fa-check-circle\"></i> " + (config.languageLabels.applyFilter || "Aplicar");

  actionButtons.append(selectAllBtn, selectNoneBtn, clearFilterBtn, applyBtn);
  var sorted = [...genres].sortfunction((a, b) (a.Name || "").localeCompare(b.Name || "", "tr", { sensitivity: "base" }));
  var currentLetter = "";
  sorted.forEach(function((genre) {
    var name = genre.Name || "";
    var firstLetter = name.charAt(0).toUpperCase();

    if (firstLetter !== currentLetter) {
      currentLetter = firstLetter;
      var letterHeader = document.createElement("div");
      letterHeader.className = "genre-letter-header";
      letterHeader.dataset.letter = currentLetter;
      letterHeader.textContent = currentLetter;
      genresContainer.appendChild(letterHeader);
    }

    var item = document.createElement("div");
    item.className = "genre-filter-item";
    item.dataset.name = name.toLowerCase();

    var img = document.createElement("img");
    img.className = "genre-image";
    if (genre.ImageTags && genre.ImageTags.Primary) {
      img.src = withParams("/Items/" + (genre.Id) + "/Images/Primary", {
        tag: genre.ImageTags.Primary,
        quality: 90,
        maxHeight: 80,
        api_key: token,
      });
      img.onerror = function() {
        img.src = PLACEHOLDER_IMAGE;
      };
    } else {
      img.src = PLACEHOLDER_IMAGE;
    }
    img.alt = name;
    img.style.cursor = "pointer";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "genre-checkbox";
    checkbox.id = "genre-" + (genre.Id);
    checkbox.value = name;
    checkbox.checked =
      Array.isArray(musicPlayerState.selectedGenres) &&
      musicPlayerState.selectedGenres.includes(name);

    var label = document.createElement("label");
    label.htmlFor = "genre-" + (genre.Id);
    label.innerHTML = "<i class=\"fas fa-headphones-alt genre-icon\"></i> " + (name);

    item.append(checkbox, img, label);
    genresContainer.appendChild(item);
  });

  var updateSelectedCount = function() {
    var { selectedText, total, selected } = getSelectedMeta(modal);
    var text;
    if (selected === 0 && Array.isArray(musicPlayerState.selectedGenres)) {
      text = (musicPlayerState.selectedGenres.length) + " " + (config.languageLabels.genresSelected || "gêneros selecionados");
    } else if (selected === 0) {
      text = config.languageLabels.noGenresSelected || "Nenhuma seleção";
    } else if (selected === total) {
      text = config.languageLabels.allGenresSelected || "Todos os gêneros selecionados";
    } else {
      text = (selected) + " " + (config.languageLabels.genresSelected || "gêneros selecionados");
    }
    selectedCount.innerHTML = "<i class=\"fas fa-music\"></i> " + (text);
  };

  updateSelectedCount();
  modalContent.append(header, searchContainer, genresContainer, selectedCount, actionButtons);
  enhanceFormAccessibility(modalContent, { prefix: "genre-filter" });
  modal.appendChild(modalContent);
  document.body.appendChild(modal);
  var handleBackdrop = function(e) {
    if (e.target === modal) closeModalSafe();
  };
  modal.addEventListener("click", handleBackdrop);
  keydownHandler = function(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeModalSafe();
    }
  };
  document.addEventListener("keydown", keydownHandler);
  var delegatedClick = function(e) {
    var item = e.target.closest(".genre-filter-item");
    if (!item) return;

    var checkbox = item.querySelector(".genre-checkbox");
    if (!checkbox) return;
    if (e.target.matches(".genre-image") || e.target === item) {
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  genresContainer.addEventListener("click", delegatedClick);
  var delegatedChange = function(e) {
    if (!e.target.classList.contains("genre-checkbox")) return;
    updateSelectedCount();
  };
  genresContainer.addEventListener("change", delegatedChange);

  var filterGenres = function(term) {
    term = (term || "").toLowerCase();
    var items = genresContainer.querySelectorAll(".genre-filter-item");
    var headers = genresContainer.querySelectorAll(".genre-letter-header");
    items.forEach(function((el) {
      var match = el.dataset.name.includes(term);
      el.style.display = match ? "flex" : "none";
    });

    headers.forEach(function((h) {
      var next = h.nextElementSibling;
      var visible = false;
      while (next && !next.classList.contains("genre-letter-header")) {
        if (next.style.display !== "none") {
          visible = true;
          break;
        }
        next = next.nextElementSibling;
      }
      h.style.display = visible ? "block" : "none";
    });
  };

  var searchTimer = null;
  var clearSearchTimer = function() {
    if (searchTimer) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  };
  searchInput.addEventListenerfunction("input", (e) {
    clearSearchTimer();
    var val = e.target.value;
    searchTimer = setTimeoutfunction(() filterGenres(val), 150);
  });

  selectAllBtn.addEventListenerfunction("click", () {
    var cbs = modal.querySelectorAll(".genre-checkbox");
    cbs.forEach(function((cb) {
      cb.checked = true;
    });
    updateSelectedCount();
    showNotification(
      "<i class=\"fas fa-check-circle\"></i> " + (cbs.length) + " " + (config.languageLabels.genresSelected || "gêneros selecionados"),
      2000,
      "success"
    );
  });

  selectNoneBtn.addEventListenerfunction("click", () {
    modal.querySelectorAll(".genre-checkbox").forEach(function((cb) (cb.checked = false));
    updateSelectedCount();
    showNotification(
      "<i class=\"far fa-square\"></i> " + (config.languageLabels.noGenresSelected || "Nenhuma seleção"),
      2000,
      "info"
    );
  });

  clearFilterBtn.addEventListenerfunction("click", () {
    modal.querySelectorAll(".genre-checkbox").forEach(function((cb) (cb.checked = false));
    musicPlayerState.selectedGenres = [];
    refreshPlaylist();
    updateSelectedCount();
    showNotification(
      "<i class=\"fas fa-broom\"></i> " + (config.languageLabels.filterCleared || "Filtro limpo"),
      2000,
      "success"
    );
  });

  applyBtn.addEventListenerfunction("click", () {
    var selectedGenres = Array.from(modal.querySelectorAll(".genre-checkbox:checked")).mapfunction((cb) cb.value
    );
    musicPlayerState.selectedGenres = selectedGenres;
    refreshPlaylist();
    closeModalSafe();
  });

  activeModal = modal;
  setTimeoutfunction(() searchInput.focus(), 0);
  function closeModalSafe() {
    if (!activeModal) return;
    try {
      fetchCtrl.abort();
    } catch {}
    fetchCtrl = null;
    if (keydownHandler) {
      document.removeEventListener("keydown", keydownHandler);
      keydownHandler = null;
    }
    try {
      activeModal.removeEventListener("click", handleBackdrop);
      genresContainer.removeEventListener("click", delegatedClick);
      genresContainer.removeEventListener("change", delegatedChange);
    } catch {}
    clearSearchTimer();
    try {
      document.body.removeChild(activeModal);
    } catch {}
    document.body.style.overflow = bodyOverflowPrev || "";
    try {
      prevFocus.focus();
    } catch {}
    activeModal = null;
    prevFocus = null;
    bodyOverflowPrev = null;
  }
  function getSelectedMeta(scope) {
    var checkboxes = scope.querySelectorAll(".genre-checkbox");
    var selected = Array.from(checkboxes).filterfunction((cb) cb.checked).length;
    var total = checkboxes.length;
    return {
      selected,
      total,
      selectedText: (selected) + "/" + (total),
    };
  }
}

export function closeModalSafe() {
  if (activeModal) {
    try {
      if (keydownHandler) {
        document.removeEventListener("keydown", keydownHandler);
        keydownHandler = null;
      }
      try { fetchCtrl.abort(); } catch {}
      fetchCtrl = null;

      document.body.style.overflow = bodyOverflowPrev || "";

      try { document.body.removeChild(activeModal); } catch {}
      try { prevFocus.focus(); } catch {}

    } finally {
      activeModal = null;
      prevFocus = null;
      bodyOverflowPrev = null;
    }
  }
}
