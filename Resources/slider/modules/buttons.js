import { getConfig } from "./config.js";
import { getSessionInfo, makeApiRequest, getAuthHeader, playNow, fetchItemDetails, getEmbyHeaders, jms } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { openSettings } from "./settingsLoader.js";
import { getProviderUrl } from './utils.js';
import { applyContainerStyles } from './positionUtils.js';
import { withServer } from "./jfUrl.js";
import { ensureWatchlistLoaded, getCachedWatchlistMembership, getWatchlistButtonText } from "./watchlist.js";

var __castModulePromise = null;

function getCastModule() {
  if (!__castModulePromise) {
    __castModulePromise = import("./castModule.js").catchfunction((error) {
      __castModulePromise = null;
      throw error;
    });
  }

  return __castModulePromise;
}

function castShowNotification(message, type) {
  try {
    var mod = getCastModule();
    mod.showNotification.(message, type);
  } catch {}
}

var _menuCloserAttached = false;
function attachGlobalMenuCloser() {
  if (_menuCloserAttached) return;
  document.addEventListenerfunction('click', (e) {
    document.querySelectorAll('.monwui-main-button-container.open')
      .forEach(function(cont) {
        if (!cont.contains(e.target)) {
          var bc = cont.querySelector('.monwui-button-container');
          if (bc) { bc.classList.remove('visible'); bc.classList.add('hidden'); }
          cont.classList.remove('open');
        }
      });
  }, { passive: true });
  _menuCloserAttached = true;
}
attachGlobalMenuCloser();

function normalizeTrailerEntry(entry) {
  if (!entry) return null;

  if (typeof entry === "string") {
    var url = entry.trim();
    return url ? { Url: url, Name: "" } : null;
  }

  if (typeof entry !== "object") return null;

  var url = String(
    entry.Url ||
    entry.url ||
    entry.Path ||
    entry.path ||
    entry.Link ||
    entry.link ||
    ""
  ).trim();
  if (!url) return null;

  var name = String(
    entry.Name ||
    entry.name ||
    entry.Title ||
    entry.title ||
    ""
  ).trim();

  return {
    ...entry,
    Url: url,
    Name: name
  };
}

function collectTrailers(...candidates) {
  var trailers = [];
  var seen = new Set();

  for (var list of candidates) {
    if (!Array.isArray(list)) continue;
    for (var raw of list) {
      var normalized = normalizeTrailerEntry(raw);
      if (!normalized.Url) continue;
      var key = normalized.Url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      trailers.push(normalized);
    }
  }

  return trailers;
}

function pickTrailers(RemoteTrailers, item) {
  return collectTrailers(
    RemoteTrailers,
    item.RemoteTrailers,
    item.RemoteTrailerItems,
    item.RemoteTrailerUrls,
    item.TrailerUrls
  );
}

export function createButtons(slide, config, UserData, itemId, RemoteTrailers, updatePlayedStatus, updateFavoriteStatus, openTrailerModal, item) {
    var trailers = pickTrailers(RemoteTrailers, item);
    var mainContainer = document.createElement('div');
    mainContainer.className = 'monwui-main-button-container';
    applyContainerStyles(mainContainer, 'button');

    var buttonContainer = document.createElement('div');
    buttonContainer.className = 'monwui-button-container hidden';

    var buttonGradientOverlay = document.createElement('div');
    buttonGradientOverlay.className = 'monwui-button-gradient-overlay';

    var mainButton = document.createElement('button');
    mainButton.className = 'monwui-main-btn';
    mainButton.innerHTML = "\n        <span class=\"monwui-icon-wrapper\">\n            <i class=\"fa-solid fa-ellipsis\"></i>\n        </span>\n    ";

    var mainButtonContainer = document.createElement('div');
    mainButtonContainer.className = 'monwui-btn-container monwui-main-btn-container';
    mainButtonContainer.style.position = "relative";
    mainButtonContainer.style.display = "inline-block";

    mainContainer.addEventListenerfunction('mouseenter', () {
        if (!isTouchDevice()) {
            buttonContainer.classList.remove('hidden');
            buttonContainer.classList.add('visible');
        }
    });

    mainContainer.addEventListenerfunction('mouseleave', () {
        if (!isTouchDevice()) {
            buttonContainer.classList.remove('visible');
            buttonContainer.classList.add('hidden');
        }
    });

    mainButton.addEventListenerfunction('click', (e) {
        if (!isTouchDevice()) return;

        e.preventDefault();
        e.stopPropagation();

        var nowOpen = !mainContainer.classList.contains('open');
        if (nowOpen) {
          buttonContainer.classList.remove('hidden');
          buttonContainer.classList.add('visible');
          mainContainer.classList.add('open');
        } else {
          buttonContainer.classList.remove('visible');
          buttonContainer.classList.add('hidden');
          mainContainer.classList.remove('open');
      }
    });

    function isTouchDevice() {
        return (('ontouchstart' in window) ||
               (navigator.maxTouchPoints > 0) ||
               (navigator.msMaxTouchPoints > 0));
    }

    var createButtonWithBackground = function(buttonType, iconHtml, text, clickHandler, initialClass = '') {
    var bgType = config[(buttonType) + "BackgroundImageType"] || "backdropUrl";
    var bgImage = "";
    if (bgType !== "none") {
        bgImage = slide.dataset[bgType];
    }

    var btnContainer = document.createElement("div");
    btnContainer.className = "monwui-btn-container";
    if (!bgImage) btnContainer.classList.add("no-bg-image");

    if (bgImage) {
        var bgLayer = document.createElement("div");
        bgLayer.className = "monwui-button-bg-layer";
        bgLayer.style.backgroundImage = "url(" + (bgImage) + ")";
        bgLayer.style.opacity = config.buttonBackgroundOpacity || 0.3;
        bgLayer.style.filter = "blur(" + (config.buttonBackgroundBlur) + "px)";
        btnContainer.appendChild(bgLayer);
    }

    var contentDiv = document.createElement("div");
    contentDiv.className = "monwui-btn-content";

    var btn = document.createElement("button");
    btn.className = "monwui-" + (buttonType) + "-btn " + (initialClass);
    btn.innerHTML = "\n        <span class=\"monwui-icon-wrapper\">\n            " + (iconHtml) + "\n        </span>\n    ";

    var textSpan = document.createElement("span");
    textSpan.className = "monwui-btn-text";
    textSpan.textContent = text;

    contentDiv.appendChild(btn);
    contentDiv.appendChild(textSpan);
    btnContainer.appendChild(contentDiv);
    if (bgImage) {
        btnContainer.appendChild(buttonGradientOverlay.cloneNode(true));
    }

    if (clickHandler) {
    btnContainer.addEventListenerfunction("click", (event) {
        event.preventDefault();
        event.stopPropagation();
        clickHandler(event, btn);
    });
}

    return btnContainer;
};

    if (config.showWatchButton) {
    var playedPercentage = Number(UserData.PlayedPercentage || 0);
    var isResumable = UserData.Played !== true && playedPercentage < 100 && Number(UserData.PlaybackPositionTicks || 0) > 0;

    var watchBtnContainer = createButtonWithBackgroundfunction("watch",
        '<i class="fa-solid fa-circle-play icon"></i>',
        isResumable
            ? config.languageLabels.continuar
            : config.languageLabels.assistir,
        (e) {
            e.preventDefault();
            e.stopPropagation();
            try {
                castToCurrentDevice(itemId);
            } catch (error) {
                console.error("Cast işlemi başarısız:", error);
                window.location.href = slide.dataset.detailUrl;
            }
        }
    );
    buttonContainer.appendChild(watchBtnContainer);
}

    var trailerButtonMounted = false;
    var appendTrailerButton = function(trailer) {
      if (!config.showTrailerButton || trailerButtonMounted) return;
      if (!trailer.Url) return;

      trailerButtonMounted = true;
      var trailerBtnContainer = createButtonWithBackgroundfunction("trailer",
        '<i class="fa-solid fa-film icon"></i>',
        config.languageLabels.trailer,
        (e) {
          e.preventDefault();
          e.stopPropagation();

          var effectiveItemId = item.Id || itemId;
          var isFav = false;
          if (effectiveItemId) {
            try {
              var details = fetchItemDetails(effectiveItemId);
              isFav = Boolean(details.UserData.IsFavorite);
            } catch (err) {
              console.warn("Favori durumu alınamadı, varsayılan false ile açılıyor", err);
            }
          }

          openTrailerModal(
            trailer.Url,
            trailer.Name || "",
            item.Name || item.OriginalTitle || "",
            item.Type || "",
            isFav,
            effectiveItemId || null,
            updateFavoriteStatus,
            item.CommunityRating,
            item.CriticRating,
            item.OfficialRating
          );
        }
      );
      buttonContainer.appendChild(trailerBtnContainer);
    };

    appendTrailerButton(trailers[0]);

    if (config.showTrailerButton && !trailerButtonMounted && itemId) {
      function(() {
        try {
          var details = fetchItemDetails(itemId);
          var enrichedTrailers = pickTrailers(null, details);
          appendTrailerButton(enrichedTrailers[0]);
        } catch (err) {
          console.warn("Fragman butonu için detay zenginleştirme başarısız:", err);
        }
      })();
    }

    if (config.showPlayedButton) {
    var isPlayed = UserData && UserData.Played;
    var playedBtnContainer = createButtonWithBackgroundfunction("played",
        isPlayed ? '<i class="fa-solid fa-check" style="color: #FFC107;"></i>' : '<i class="fa-regular fa-circle-check"></i>',
        isPlayed ? config.languageLabels.visto : config.languageLabels.naoVisto,
        (event, buttonElement) {
            var iconWrapper = buttonElement.querySelector('.monwui-icon-wrapper');
            var textSpan = buttonElement.nextElementSibling;
            var wasPlayed = buttonElement.classList.contains("played");
            var prevUserData = UserData ? {
                Played: UserData.Played === true,
                PlayedPercentage: Number(UserData.PlayedPercentage || 0),
                PlaybackPositionTicks: Number(UserData.PlaybackPositionTicks || 0)
            } : null;
            var prevDatasetPlayed = slide.dataset.played || "false";
            var prevDatasetTicks = slide.dataset.playbackpositionticks || "0";

            try {
                if (wasPlayed) {
                    buttonElement.classList.remove("played");
                    iconWrapper.innerHTML = '<i class="fa-regular fa-circle-check"></i>';
                    textSpan.textContent = config.languageLabels.naoVisto;
                    if (UserData) {
                        UserData.Played = false;
                        UserData.PlayedPercentage = 0;
                        UserData.PlaybackPositionTicks = 0;
                    }
                    if (slide.dataset) {
                        slide.dataset.played = "false";
                        slide.dataset.playbackpositionticks = "0";
                    }
                    updatePlayedStatus(itemId, false);
                } else {
                    buttonElement.classList.add("played");
                    iconWrapper.innerHTML = '<i class="fa-solid fa-check" style="color: #FFC107;"></i>';
                    textSpan.textContent = config.languageLabels.visto;
                    if (UserData) {
                        UserData.Played = true;
                        UserData.PlayedPercentage = 100;
                        UserData.PlaybackPositionTicks = 0;
                    }
                    if (slide.dataset) {
                        slide.dataset.played = "true";
                        slide.dataset.playbackpositionticks = "0";
                    }
                    updatePlayedStatus(itemId, true);
                }
            } catch (error) {
                if (wasPlayed) {
                    buttonElement.classList.add("played");
                    iconWrapper.innerHTML = '<i class="fa-solid fa-check" style="color: #FFC107;"></i>';
                    textSpan.textContent = config.languageLabels.visto;
                } else {
                    buttonElement.classList.remove("played");
                    iconWrapper.innerHTML = '<i class="fa-regular fa-circle-check"></i>';
                    textSpan.textContent = config.languageLabels.naoVisto;
                }

                if (UserData && prevUserData) {
                    UserData.Played = prevUserData.Played;
                    UserData.PlayedPercentage = prevUserData.PlayedPercentage;
                    UserData.PlaybackPositionTicks = prevUserData.PlaybackPositionTicks;
                }
                if (slide.dataset) {
                    slide.dataset.played = prevDatasetPlayed;
                    slide.dataset.playbackpositionticks = prevDatasetTicks;
                }
                console.error("Played durumu güncellenemedi:", error);
            }
        },
        isPlayed ? "played" : ""
    );
    buttonContainer.appendChild(playedBtnContainer);
}

if (config.showFavoriteButton) {
    var favoriteSource = item || { Id: itemId, Type: item.Type };
    var isFavorited = getCachedWatchlistMembership(itemId, UserData && UserData.IsFavorite);
    if (UserData) UserData.IsFavorite = isFavorited;
    var favoriteBtnContainer = createButtonWithBackground(
        "favorite",
        isFavorited ? '<i class="fa-solid fa-heart" style="color: #FFC107;"></i>' : '<i class="fa-regular fa-heart"></i>',
        getWatchlistButtonText(favoriteSource, isFavorited),
        function(event, buttonElement) {
            if (buttonElement.dataset.busy === "1") return;
            buttonElement.dataset.busy = "1";
            var iconWrapper = buttonElement.querySelector('.monwui-icon-wrapper');
            var textSpan = buttonElement.nextElementSibling;
            var nextValue = !buttonElement.classList.contains("favorited");

            try {
                updateFavoriteStatus(itemId, nextValue, { item: favoriteSource });
                if (UserData) UserData.IsFavorite = nextValue;

                if (nextValue) {
                    buttonElement.classList.add("favorited");
                    iconWrapper.innerHTML = '<i class="fa-solid fa-heart" style="color: #FFC107;"></i>';
                } else {
                    buttonElement.classList.remove("favorited");
                    iconWrapper.innerHTML = '<i class="fa-regular fa-heart"></i>';
                }
                textSpan.textContent = getWatchlistButtonText(favoriteSource, nextValue);
            } catch (error) {
                console.error("Liste butonu güncellenemedi:", error);
            } finally {
                buttonElement.dataset.busy = "0";
            }
        },
        isFavorited ? "favorited" : ""
    );

    ensureWatchlistLoaded().thenfunction(() {
        var buttonElement = favoriteBtnContainer.querySelector(".monwui-favorite-btn");
        var textSpan = favoriteBtnContainer.querySelector(".monwui-btn-text");
        var iconWrapper = buttonElement.querySelector(".monwui-icon-wrapper");
        var nextValue = getCachedWatchlistMembership(itemId, isFavorited);
        if (UserData) UserData.IsFavorite = nextValue;
        if (!buttonElement || !textSpan || !iconWrapper) return;

        buttonElement.classList.toggle("favorited", nextValue);
        iconWrapper.innerHTML = nextValue
            ? '<i class="fa-solid fa-heart" style="color: #FFC107;"></i>'
            : '<i class="fa-regular fa-heart"></i>';
        textSpan.textContent = getWatchlistButtonText(favoriteSource, nextValue);
    }).catchfunction(() {});

    buttonContainer.appendChild(favoriteBtnContainer);
}

    mainButtonContainer.appendChild(mainButton);
    var mainOverlay = buttonGradientOverlay.cloneNode(true);
    mainOverlay.classList.add("exclude-overlay");
    mainButtonContainer.appendChild(mainOverlay);
    mainContainer.appendChild(mainButtonContainer);
    mainContainer.appendChild(buttonContainer);

    return mainContainer;
}

function castToCurrentDevice(itemId) {
  try {
    var config = getConfig();
    var success = playNow(itemId);
    if (!success) {
      castShowNotification(config.languageLabels.erroCast, 'error');
    }
  } catch (error) {
    console.error('Cast işlemi sırasında hata:', error);
    var config = getConfig();
    castShowNotification((config.languageLabels.erroCast) + ": " + (error.message), 'error');
  }
}

function startNowPlayback(itemId, sessionId) {
  try {
    var config = getConfig();
    var playUrl = "/Sessions/" + (encodeURIComponent(sessionId)) + "/Playing?playCommand=PlayNow&itemIds=" + (encodeURIComponent(itemId));

    var response = fetch(withServer(playUrl), {
      method: "POST",
      headers: getEmbyHeaders({ "Content-Type": "application/json" })
    });

    if (!response.ok) {
      throw new Error((config.languageLabels.erroReproducaoCast) + ": " + (response.statusText));
    }

    castShowNotification(config.languageLabels.castSucesso, 'success');
    return true;
  } catch (error) {
    console.error("Oynatma hatası:", error);
    var config = getConfig();
    castShowNotification((config.languageLabels.erroReproducaoCast) + ": " + (error.message), 'error');
    return false;
  }
}

export function createProviderContainer({ config, ProviderIds, RemoteTrailers, itemId, slide, item } = {}) {
  var trailers = pickTrailers(RemoteTrailers, item);

  var pids = ProviderIds || item.ProviderIds;
  var container = document.createElement("div");
  container.className = "monwui-provider-container";
  applyContainerStyles(container, 'provider');

  var canEnrichLater = Boolean(itemId) && (config.showTrailerIcon || config.showProviderInfo);
  if (!pids && !config.showSettingsLink && !(config.showTrailerIcon && trailers.length) && !(config.enableCastModule !== false && config.showCast) && !canEnrichLater) {
    return container;
  }

  var allowedProviders = ["Imdb", "Tmdb", "Tvdb"];
  var providerDiv = document.createElement("div");
  providerDiv.className = "monwui-providericons-container";
  applyContainerStyles(providerDiv, 'providericons');

  var ensureProviderDivMounted = function() {
    if (!container.contains(providerDiv)) container.appendChild(providerDiv);
  };

  var addTrailerIcon = function(url) {
    if (!url) return;
    if (providerDiv.querySelector(".monwui-provider-link.youtube")) return;
    var trailerLink = document.createElement("span");
    trailerLink.innerHTML = "<i class=\"fa-brands fa-youtube\"></i>";
    trailerLink.className = "monwui-provider-link youtube";
    trailerLink.title = (config.languageLabels.trailerYoutube);
    trailerLink.addEventListenerfunction("click", (event) {
      event.preventDefault();
      event.stopPropagation();
      window.open(url, "_blank");
    });
    providerDiv.appendChild(trailerLink);
    ensureProviderDivMounted();
  };

  var addProviderIcons = function(providerIds) {
    if (!providerIds) return;
    allowedProviders.forEach(function(provider) {
      if (!config.showProviderInfo || !providerIds[provider]) return;
      var cls = ".monwui-provider-link." + (provider.toLowerCase());
      if (providerDiv.querySelector(cls)) return;

      var link = document.createElement("span");
      if (provider === "Imdb") {
        link.innerHTML = "<img src=\"./slider/src/images/imdb.svg\" alt=\"IMDb\">";
        link.className = "monwui-provider-link imdb";
      } else if (provider === "Tmdb") {
        link.innerHTML = "<img src=\"./slider/src/images/tmdb.svg\" alt=\"TMDb\">";
        link.className = "monwui-provider-link tmdb";
      } else {
        link.innerHTML = "<img src=\"./slider/src/images/tvdb.svg\" alt=\"TVDb\">";
        link.className = "monwui-provider-link tvdb";
      }
      link.title = (provider) + " Profiline Git";
      link.addEventListenerfunction("click", (event) {
        event.preventDefault();
        event.stopPropagation();
        var url = getProviderUrl(provider, providerIds[provider], providerIds["TvdbSlug"]);
        window.open(url, "_blank");
      });
      providerDiv.appendChild(link);
      ensureProviderDivMounted();
    });
  };

  if (config.showSettingsLink) {
    var settingsLink = document.createElement("span");
    settingsLink.innerHTML = "<i class=\"fa-solid fa-gear\"></i>";
    settingsLink.className = "monwui-provider-link settings";
    settingsLink.title = (config.languageLabels.atalhoConfiguracoes);
    settingsLink.addEventListenerfunction("click", (e) {
      e.preventDefault();
      void openSettings("monwui");
    });
    providerDiv.appendChild(settingsLink);
    ensureProviderDivMounted();
  }

 if (config.enableCastModule !== false && config.showCast) {
    var castContainer = document.createElement("div");
    castContainer.className = "monwui-cast-container monwui-provider-link";

    var deviceSelectorContainer = document.createElement("div");
    deviceSelectorContainer.className = "monwui-device-selector-top-container";

    var deviceIcon = document.createElement("div");
    deviceIcon.className = "monwui-device-selector-top-icon";
    deviceIcon.innerHTML = "<i class=\"fa-solid fa-display\"></i>";
    deviceIcon.title = config.languageLabels.reproduzirCast;

    var deviceDropdown = document.createElement("div");
    deviceDropdown.className = "monwui-device-selector-top-dropdown hide";

    deviceIcon.addEventListenerfunction('click', (e) {
      e.stopPropagation();

      if (deviceDropdown.classList.contains('hide')) {
        var { loadAvailableDevices } = getCastModule();
        loadAvailableDevices(itemId, deviceDropdown);

        deviceDropdown.classList.remove('hide');
        deviceDropdown.classList.add('show');

        setTimeoutfunction(() {
          var closeHandler = function(e) {
            if (!castContainer.contains(e.target)) {
              deviceDropdown.classList.remove('show');
              deviceDropdown.classList.add('hide');
              document.removeEventListener('click', closeHandler);
            }
          };
          document.addEventListener('click', closeHandler);
        }, 0);
      } else {
        deviceDropdown.classList.add('hide');
      }
    });

    deviceSelectorContainer.appendChild(deviceIcon);
    deviceSelectorContainer.appendChild(deviceDropdown);
    castContainer.appendChild(deviceSelectorContainer);
    providerDiv.appendChild(castContainer);
    ensureProviderDivMounted();
  }

  if (config.showTrailerIcon && trailers.length > 0) {
    addTrailerIcon(trailers[0].Url);
  }

  if (pids) addProviderIcons(pids);

  if (itemId && (config.showTrailerIcon || config.showProviderInfo) && (!trailers.length || !pids)) {
    function(() {
      try {
        var details = fetchItemDetails(itemId);
        var dTrailers = pickTrailers(null, details);
        var dPids = details.ProviderIds;

        if (config.showTrailerIcon && !trailers.length && dTrailers.length) {
          addTrailerIcon(dTrailers[0].Url);
        }
        if (config.showProviderInfo && !pids && dPids) {
          addProviderIcons(dPids);
        }
      } catch (e) {
        console.warn("Provider/Trailer enrich başarısız:", e);
      }
    })();
  }

  return container;
}
