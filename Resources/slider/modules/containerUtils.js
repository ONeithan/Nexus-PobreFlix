import { getConfig } from "./config.js";
import { applyContainerStyles } from "./positionUtils.js";
import { fetchItemDetails } from "../../Plugins/NexusPobreFlix/runtime/api.js";
import { calculateMatchPercentage } from "./hoverTrailerModal.js";
import { withServer } from "./jfUrl.js";
import { getTomatoIconHtml } from "./customIcons.js";

var config = getConfig();
var QUALITY_SVG_BY_LEVEL = {
  sd: "./slider/src/images/quality/sd.svg",
  hd: "./slider/src/images/quality/hd.svg",
  fhd: "./slider/src/images/quality/fhd.svg",
  "4k": "./slider/src/images/quality/4k.svg"
};

function escapeMetaHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMetaTextSpan(text, ...classNames) {
  var className = ["monwui-meta-text", ...classNames.filter(Boolean)].join(" ");
  return "<span class=\"" + (className) + "\">" + (escapeMetaHtml(text)) + "</span>";
}

function stringToVibrantColor(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  var h = Math.abs(hash % 360);
  var isCool = h >= 200 && h <= 280;
  var isWarm = h < 45 || h > 300;
  var s = isCool ? 55 : isWarm ? 65 : 50;

  return "hsl(" + (h) + ", " + (s) + "%, 45%)";
}

function applyMetaIconColors(container, itemSeed = "") {
  if (!container) return;
  if (!config.metaIconColors) return;

  container.querySelectorAll(".monwui-meta-container i").forEach(function((icon, index) {
    var cls = icon.className || "";
    var isHeartIcon =
      cls.includes("fa-heart") ||
      !!icon.closest(".monwui-match-percentage, .monwui-match-rating");

    if (
      isHeartIcon ||
      cls.includes("fa-star") ||
      icon.closest(".monwui-t-rating")
    ) {
      icon.style.removeProperty("color");
      return;
    }

    var seed =
      (itemSeed) + "-" + (icon.closest("span").className || "") + "-" + (cls) + "-" + (index);

    icon.style.color = stringToVibrantColor(seed);
  });
}

function getNormalizedDimension(value) {
  var n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isPlaybackCompleted(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.Played === true) return true;

  var playedPercentage = Number(userData.PlayedPercentage);
  if (Number.isFinite(playedPercentage) && playedPercentage >= 100) return true;

  var positionTicks = Number(userData.PlaybackPositionTicks || 0);
  var totalTicks = Number(runtimeTicks || 0);
  return positionTicks > 0 && totalTicks > 0 && positionTicks >= totalTicks;
}

function hasPartialPlayback(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (isPlaybackCompleted(userData, runtimeTicks)) return false;

  var positionTicks = Number(userData.PlaybackPositionTicks || 0);
  if (!(positionTicks > 0)) return false;

  var totalTicks = Number(runtimeTicks || 0);
  return totalTicks > 0 ? positionTicks < totalTicks : true;
}

function getVideoQualityInfo(videoStream) {
  var width = getNormalizedDimension(videoStream.Width);
  var height = getNormalizedDimension(videoStream.Height);
  var longerEdge = Math.max(width, height);
  var shorterEdge = Math.min(width, height);

  var baseQuality = "sd";
  if (longerEdge >= 3800 || shorterEdge >= 2160) {
    baseQuality = "4k";
  } else if (longerEdge >= 1900 || shorterEdge >= 1080) {
    baseQuality = "fhd";
  } else if (longerEdge >= 1200 || shorterEdge >= 720) {
    baseQuality = "hd";
  }

  return {
    baseQuality,
    qualitySvg: QUALITY_SVG_BY_LEVEL[baseQuality] || QUALITY_SVG_BY_LEVEL.sd
  };
}

export function createSlidesContainer(indexPage) {
  var slidesContainer = indexPage.querySelector("#monwui-slides-container");
  if (!slidesContainer) {
    slidesContainer = document.createElement("div");
    slidesContainer.id = "monwui-slides-container";
    applyContainerStyles(slidesContainer);
    indexPage.insertBefore(slidesContainer, indexPage.firstChild);
  }
  return slidesContainer;
}

export function createHorizontalGradientOverlay() {
  var overlay = document.createElement("div");
  overlay.className = "monwui-horizontal-gradient-overlay";
  return overlay;
}

export function createLogoContainer() {
  var container = document.createElement("div");
  container.className = "monwui-logo-container";
  applyContainerStyles(container, 'logo');
  return container;
}

export function createStatusContainer(itemType, config, UserData, ChildCount, RunTimeTicks, MediaStreams) {
  var statusContainer = document.createElement("div");
  statusContainer.className = "monwui-status-container";
  applyContainerStyles(statusContainer, 'status');
  var hasResumeProgress = !Array.isArray(RunTimeTicks) && hasPartialPlayback(UserData, RunTimeTicks);

  if (itemType && config.showTypeInfo) {
    var typeSpan = document.createElement("span");
    typeSpan.className = "type";
    var typeTranslations = {
      Series: { text: config.languageLabels.series || "Série", icon: '<i class="fas fa-tv "></i>' },
      Season: { text: config.languageLabels.season || "Temporada", icon: '<i class="fas fa-tv "></i>' },
      Episode: { text: config.languageLabels.episode || "Episódio", icon: '<i class="fas fa-tv "></i>' },
      BoxSet: { text: config.languageLabels.collection || "Coleção", icon: '<i class="fas fa-film "></i>' },
      Movie: { text: config.languageLabels.movie || "Filme", icon: '<i class="fas fa-film "></i>' }
    };
    var typeInfo = typeTranslations[itemType] || { text: itemType, icon: "" };
    var typeText = typeInfo.text;
    if (itemType === "Series" && ChildCount) {
      typeText += " (" + (ChildCount) + " " + (config.languageLabels.season || "Temporadas") + ")";
    }
    if (itemType === "BoxSet" && ChildCount) {
      typeText += " (" + (ChildCount) + " " + (config.languageLabels.seriesLabel || "Séries") + ")";
    }
    typeSpan.innerHTML = (typeInfo.icon) + (buildMetaTextSpan(typeText, "monwui-type-text"));
    statusContainer.appendChild(typeSpan);
  }

  if (UserData && config.showWatchedInfo) {
    var watchedSpan = document.createElement("span");
    watchedSpan.className = "watched-status";
    var watchedIcon = UserData.Played
      ? "<i class=\"fa-regular fa-circle-check\"></i>"
      : "<i class=\"fa-regular fa-circle-xmark\"></i>";
    var watchedText = UserData.Played
      ? config.languageLabels.watched || "Assistido"
      : config.languageLabels.unwatched || "Não Assistido";
    if (UserData.Played && UserData.PlayCount > 0) {
      watchedText += " (" + (UserData.PlayCount) + ")";
    }
    watchedSpan.innerHTML = (watchedIcon) + (buildMetaTextSpan(watchedText, "monwui-watched-text"));
    statusContainer.appendChild(watchedSpan);
  }

    if (RunTimeTicks && config.showRuntimeInfo) {
    var runtimeSpan = document.createElement("span");
    runtimeSpan.className = "sure";

    var calcRuntime = function(ticks) {
      var totalMinutes = Math.floor(ticks / 600000000);
      var hours = Math.floor(totalMinutes / 60);
      var minutes = totalMinutes % 60;
      return hours > 0
        ? (hours) + (config.languageLabels.hourShort || "h") + " " + (minutes) + (config.languageLabels.minuteShort || "min")
        : (minutes) + (config.languageLabels.minuteShort || "min");
    };

    var formatEndTimeLocalized = function(ticks) {
      var totalMinutes = Math.floor(ticks / 600000000);
      var end = new Date(Date.now() + totalMinutes * 60 * 1000);
      var locale = String(config.languageLabels.timeLocale || "pt-BR").trim() || "pt-BR";

      try {
        return new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit"
        }).format(end);
      } catch {
        var hh = String(end.getHours()).padStart(2, "0");
        var mm = String(end.getMinutes()).padStart(2, "0");
        return (hh) + ":" + (mm);
      }
    };

    if (Array.isArray(RunTimeTicks)) {
      runtimeSpan.innerHTML =
        "<i class=\"fa-solid fa-hourglass-end\"></i>" +
        buildMetaTextSpan(
          RunTimeTicks.map(function(val) calcRuntime(val)).join(", "),
          "monwui-runtime-text"
        );
    } else {
      var remainingTicks =
        hasResumeProgress
          ? Math.max(RunTimeTicks - UserData.PlaybackPositionTicks, 0)
          : RunTimeTicks;
      var endHHMM = formatEndTimeLocalized(remainingTicks);
      var endTimeLabel = String(config.languageLabels.endTimeLabel || "").trim();
      runtimeSpan.innerHTML = "\n        <i class=\"fa-solid fa-hourglass-end\"></i>\n        " + (buildMetaTextSpan(calcRuntime(RunTimeTicks), "monwui-runtime-text")) + "\n        <span class=\"end-time\">\n          <i class=\"fa-solid fa-clock\"></i>\n          ${buildMetaTextSpan("${endTimeLabel ? (endTimeLabel) + " " : ""}${endHHMM}", \"monwui-end-time-text\")}\n        </span>\n      ".trim();
    }

    statusContainer.appendChild(runtimeSpan);
  }

  var videoStream = MediaStreams ? MediaStreams.find(function(s) s.Type === "Video") : null;
  if (videoStream && config.showQualityInfo) {
    var qualitySpan = document.createElement("span");
    qualitySpan.className = "video-quality";
    var { qualitySvg } = getVideoQualityInfo(videoStream);

    var rangeSvg = "./slider/src/images/quality/sdr.svg";
    if (videoStream.VideoRangeType && videoStream.VideoRangeType.toUpperCase().includes("HDR")) {
      rangeSvg = "./slider/src/images/quality/hdr.svg";
    }

    var codecSvg = "";
    if (videoStream.Codec) {
      var codec = videoStream.Codec.toLowerCase();
      if (codec.includes("h264")) {
        codecSvg = "<img src=\"./slider/src/images/quality/h264.svg\" alt=\"H.264\" style=\"width:24px;height:24px;vertical-align:middle;margin-right:2px;\">";
      } else if (codec.includes("h265") || codec.includes("hevc")) {
        codecSvg = "<img src=\"./slider/src/images/quality/h265.svg\" alt=\"H.265\" style=\"width:24px;height:24px;vertical-align:middle;margin-right:2px;\">";
      } else if (codec.includes("vp9")) {
        codecSvg = "<img src=\"./slider/src/images/quality/vp9.svg\" alt=\"VP9\" style=\"width:24px;height:24px;vertical-align:middle;margin-right:2px;\">";
      } else if (codec.startsWith("mpeg") || codec.includes("mpeg4")) {
        codecSvg = "<img src=\"./slider/src/images/quality/mpeg.svg\" alt=\"MPEG\" style=\"width:24px;height:24px;vertical-align:middle;margin-right:2px;\">";
      }
    }

    qualitySpan.innerHTML = "\n      <img src=\"" + (rangeSvg) + "\" alt=\"\" style=\"width:24px;height:24px;vertical-align:middle;margin-right:2px;\">\n      <img src=\"" + (qualitySvg) + "\" alt=\"\" style=\"width:24px;height:24px;vertical-align:middle;margin-right:2px;\">\n      " + (codecSvg) + "\n    ".trim();

    statusContainer.appendChild(qualitySpan);
  }

  return statusContainer;
}

export function createActorSlider(People, config, item) {
  if (config.showActorAll) {
    var emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  var actualPeople = People;

  if (
    (item.Type === "Episode" || item.Type === "Season") &&
    item.SeriesId &&
    (!Array.isArray(actualPeople) || actualPeople.length === 0)
  ) {
    try {
      var parent = fetchItemDetails(item.SeriesId);
      if (parent && Array.isArray(parent.People)) {
        actualPeople = parent.People;
      }
    } catch (e) {
      console.warn("Falha ao obter detalhes da série pai:", e);
    }
  }

  var allActors = (actualPeople || []).filter(function(p) p.Type === "Actor");
  var actorsForSlide = allActors.slice(0, config.artistLimit || 9);

  if (actorsForSlide.length === 0) {
    var emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  var sliderWrapper = document.createElement("div");
  sliderWrapper.className = "monwui-slider-wrapper";
  applyContainerStyles(sliderWrapper, 'slider');

  var actorContainer = document.createElement("div");
  actorContainer.className = "monwui-artist-container";

  var leftArrow = document.createElement("button");
  leftArrow.className = "monwui-slider-arrow left hidden";
  leftArrow.innerHTML = "<i class=\"fa-solid fa-chevron-left\"></i>";

  var rightArrow = document.createElement("button");
  rightArrow.className = "monwui-slider-arrow right hidden";
  rightArrow.innerHTML = "<i class=\"fa-solid fa-chevron-right\"></i>";

  sliderWrapper.appendChild(leftArrow);
  sliderWrapper.appendChild(actorContainer);
  sliderWrapper.appendChild(rightArrow);

  actorsForSlide.forEach(function(actor) {
    var actorDiv = document.createElement("div");
    actorDiv.className = "monwui-actor-item";

    var actorContent = document.createElement("div");
    actorContent.className = "monwui-actor-content";

    var actorLink = document.createElement("a");
    actorLink.href = "#/details?id=" + (actor.Id) + "${config.serverId ? "&serverId=${encodeURIComponent(config.serverId)}" : \"\"}";
    actorLink.target = "_blank";
    actorLink.style.textDecoration = "none";

    if (config.showActorImg) {
      var actorImg = document.createElement("img");
      actorImg.className = "monwui-actor-image";
      actorImg.loading = "lazy";
      if (actor.PrimaryImageTag) {
        actorImg.src = withServer("/Items/" + (actor.Id) + "/Images/Primary?fillHeight=320&fillWidth=320&quality=80&tag=" + (actor.PrimaryImageTag));
        actorImg.alt = actor.Name;
      } else {
        actorImg.src = "./slider/src/images/nofoto.png";
        actorImg.alt = "No Image";
      }
      actorImg.onerror = function() {
        actorImg.src = "./slider/src/images/nofoto.png";
      };
      actorLink.appendChild(actorImg);
    }

    actorContent.appendChild(actorLink);

    var roleSpan = document.createElement("span");
    roleSpan.className = "monwui-actor-role";
    roleSpan.textContent = config.showActorRole ? actor.Role || "" : "";
    actorContent.appendChild(roleSpan);

    var nameSpan = document.createElement("span");
    nameSpan.className = "monwui-actor-name";
    nameSpan.textContent = config.showActorInfo ? actor.Name || "" : "";
    actorContent.appendChild(nameSpan);

    actorDiv.appendChild(actorContent);
    actorContainer.appendChild(actorDiv);
  });

  return sliderWrapper;
}

export function createInfoContainer({ config, Genres, ProductionYear, ProductionLocations }) {
  var container = document.createElement("div");
  container.className = "monwui-info-container";
  applyContainerStyles(container, "info");

  var normalizeKey = function(str) str.toString().toLowerCase().replace(/\s+/g, "");

  var parts = [];

  if (Array.isArray(Genres) && Genres.length && config.showGenresInfo) {
    var translated = Genres.mapfunction((genre) {
      var key = normalizeKey(genre);
      var matchedEntry = Object.entries(config.languageLabels.genres || {}).findfunction(([labelKey]) normalizeKey(labelKey) === key
      );
      return matchedEntry ? matchedEntry[1] : genre;
    }).join(", ");

    parts.push("<span class=\"genres\"><i class=\"fa-solid fa-masks-theater\"></i> " + (translated) + "</span>");
  }

  if (ProductionYear && config.showYearInfo) {
    var yearText = Array.isArray(ProductionYear) ? ProductionYear.join(", ") : ProductionYear;
    parts.push("<span class=\"yil\"><i class=\"fa-solid fa-calendar\"></i> " + (yearText) + "</span>");
  }

  if (ProductionLocations && config.showCountryInfo) {
    var getFlagEmoji = function(code)
      code
        ? code
            .toUpperCase()
            .split("")
            .mapfunction((char) String.fromCodePoint(127397 + char.charCodeAt()))
            .join("")
        : "";

    var getCountryInfo = function(countryRaw) {
      var key = normalizeKey(countryRaw);
      var matchedEntry = Object.entries(config.languageLabels.country || {}).findfunction(([labelKey]) normalizeKey(labelKey) === key
      );
      return matchedEntry
        ? matchedEntry[1]
        : { code: countryRaw.slice(0, 2).toUpperCase(), name: countryRaw };
    };

    var countryText = Array.isArray(ProductionLocations)
      ? ProductionLocations.mapfunction((c) {
          var info = getCountryInfo(c);
          return (getFlagEmoji(info.code)) + " " + (info.name);
        }).join(", ")
      : function(() {
          var info = getCountryInfo(ProductionLocations);
          return (getFlagEmoji(info.code)) + " " + (info.name);
        })();

    parts.push("<span class=\"ulke\"><i class=\"fa-solid fa-location-dot\"></i> " + (countryText) + "</span>");
  }

  container.innerHTML = parts.join(" <span class=\"info-sep\">✧</span> ");

  if (!parts.length) container.style.display = "none";

  return container;
}

export function createDirectorContainer({ config, People, item }) {
  var container = document.createElement("div");
  container.className = "monwui-director-container";
  applyContainerStyles(container, 'director');

  var actualPeople = People;

  if (
    (item.Type === "Episode" || item.Type === "Season") &&
    item.SeriesId &&
    (!Array.isArray(actualPeople) || actualPeople.length === 0)
  ) {
    try {
      var parent = fetchItemDetails(item.SeriesId);
      if (parent && Array.isArray(parent.People)) {
        actualPeople = parent.People;
      }
    } catch (e) {
      console.warn("Falha ao obter detalhes da série pai:", e);
    }
  }

  if (actualPeople && actualPeople.length > 0 && config.showDirectorWriter) {
    if (config.showDirector) {
      var directors = actualPeople.filter(function(p) p.Type.toLowerCase() === "director");
      if (directors.length) {
        var directorNames = directors.map(function(d) d.Name).join(", ");
        var directorSpan = document.createElement("span");
        directorSpan.className = "monwui-yonetmen";
        directorSpan.textContent = (config.languageLabels.director || "Diretor") + ": " + (directorNames);
        container.appendChild(directorSpan);
      }
    }

    if (config.showWriter) {
      var writers = actualPeople.filter(function(p) p.Type.toLowerCase() === "writer");
      var allow = (config.allowedWriters || [])
        .map(function(x) x.toLowerCase.())
        .filter(Boolean);
      var matchingWriters = writers.filter(function(w)
        w.Name && allow.includes(w.Name.toLowerCase())
      );
      if (matchingWriters.length) {
        var writerNames = matchingWriters.map(function(w) w.Name).join(", ");
        var writerSpan = document.createElement("span");
        writerSpan.className = "writer";
        writerSpan.textContent = (writerNames) + " " + (config.languageLabels.writer || "Escritor") + " ...";
        container.appendChild(writerSpan);
      }
    }
  }

  return container;
}

export function createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
}) {
  var container = document.createElement("div");
  container.className = "monwui-rating-container";
  applyContainerStyles(container, 'rating');

  var ratingExists = false;

  if (config.showRatingInfo) {
    if (config.showMatchPercentage && UserData && item) {
      var matchPercentage = calculateMatchPercentage(UserData, item);
      var matchSpan = document.createElement("span");
      matchSpan.className = "monwui-match-percentage";
      matchSpan.innerHTML = "\n  <span class=\"monwui-match-rating\">\n    <i class=\"fa-regular fa-heart fa-lg\"></i>\n      <span class=\"monwui-heart-filled\" style=\"clip-path: inset(" + (100 - matchPercentage) + "% 0 0 0);\">\n      <i class=\"fa-solid fa-heart fa-lg\"></i>\n    </span>\n  </span>\n  ${buildMetaTextSpan("${matchPercentage}%", \"monwui-percentage-text\")}";
      container.appendChild(matchSpan);
      ratingExists = true;
    }

    if (config.showCommunityRating && CommunityRating) {
    var ratingValue = Array.isArray(CommunityRating)
    ? Math.roundfunction((CommunityRating.reduce((a, b) a + b, 0) / CommunityRating.length) * 10) / 10
    : Math.round(CommunityRating * 10) / 10;

  var ratingClass = "monwui-rating-default";
  if (ratingValue >= 9) ratingClass = "monwui-rating-excellent";
  else if (ratingValue >= 7.5) ratingClass = "monwui-rating-good";
  else if (ratingValue >= 6) ratingClass = "monwui-rating-average";
  else if (ratingValue >= 4) ratingClass = "monwui-rating-poor";
  else ratingClass = "monwui-rating-bad";

  var ratingPercentage = ratingValue * 10;
  var ratingSpan = document.createElement("span");
  ratingSpan.className = "monwui-rating " + (ratingClass);
  ratingSpan.innerHTML = "\n    <span class=\"monwui-star-rating\">\n      <i class=\"fa-regular fa-star fa-lg\"></i>\n      <span class=\"monwui-star-filled\" style=\"clip-path: inset(" + (100 - ratingPercentage) + "% 0 0 0);\">\n        <i class=\"fa-solid fa-star fa-lg\" style=\"display: block;\"></i>\n      </span>\n    </span>\n    " + (buildMetaTextSpan(ratingValue, "monwui-rating-text"));
  container.appendChild(ratingSpan);
  ratingExists = true;
}

    if (config.showCriticRating && CriticRating) {
      var criticSpan = document.createElement("span");
      criticSpan.className = "monwui-t-rating";
      criticSpan.innerHTML =
        (getTomatoIconHtml()) +
        buildMetaTextSpan(
          Array.isArray(CriticRating) ? CriticRating.join(", ") : CriticRating,
          "monwui-critic-rating-text"
        );
      container.appendChild(criticSpan);
      ratingExists = true;
    }

    if (config.showOfficialRating && OfficialRating) {
      var officialRatingSpan = document.createElement("span");
      officialRatingSpan.className = "monwui-officialrating";
      officialRatingSpan.innerHTML =
        "<i class=\"fa-solid fa-user-group\"></i>" +
        buildMetaTextSpan(
          Array.isArray(OfficialRating) ? OfficialRating.join(", ") : OfficialRating,
          "monwui-officialrating-text"
        );
      container.appendChild(officialRatingSpan);
      ratingExists = true;
    }
  }

  return { container, ratingExists };
}

export function createLanguageContainer({ config, MediaStreams, itemType }) {
  var container = document.createElement("div");
  container.className = "monwui-language-container";

  if (
    !config.showLanguageInfo ||
    !MediaStreams ||
    MediaStreams.length === 0 ||
    String(itemType || "").toLowerCase() === "series"
  ) {
    return container;
  }

  var audioCodecs = ["ac3", "mp3", "aac", "flac", "dts", "truehd", "eac3"];
  var subtitleCodecs = ["srt", "ass", "vtt", "subrip"];

  var audioStreams = MediaStreams.filter(
    function(stream) stream.Codec && audioCodecs.includes(stream.Codec.toLowerCase())
  );
  var subtitleStreams = MediaStreams.filter(
    function(stream) stream.Codec && subtitleCodecs.includes(stream.Codec.toLowerCase())
  );

  var hasTurkishAudio = audioStreams.some(
    function(stream) stream.Language.toLowerCase() === config.defaultLanguage
  );
  var hasTurkishSubtitle = subtitleStreams.some(
    function(stream) stream.Language.toLowerCase() === config.defaultLanguage
  );

  var audioLabel = "";
  var subtitleLabel = "";

  if (hasTurkishAudio) {
    audioLabel =
      "<i class=\"fa-solid fa-language\"></i>" +
      buildMetaTextSpan(config.languageLabels.audio, "monwui-audio-label-text");
  } else {
    var defaultAudioStream = audioStreams.find(function(stream) stream.IsDefault);
    var fallbackLanguage = defaultAudioStream.Language || "";
    audioLabel =
      "<i class=\"fa-solid fa-language\"></i>" +
      buildMetaTextSpan(
        (config.languageLabels.original) + "${fallbackLanguage ? " ${fallbackLanguage}" : \"\"}",
        "monwui-audio-label-text"
      );
  }

  if (!hasTurkishAudio && hasTurkishSubtitle) {
    subtitleLabel =
      "<i class=\"fa-solid fa-closed-captioning\"></i>" +
      buildMetaTextSpan(config.languageLabels.subtitle, "monwui-subtitle-text");
  }

  var selectedAudioStream =
    audioStreams.find(function(stream) stream.Language.toLowerCase() === config.defaultLanguage) ||
    audioStreams[0];

  if (selectedAudioStream) {
    var channelsText = selectedAudioStream.Channels
      ? (selectedAudioStream.Channels) + " " + (config.languageLabels.channel)
      : "";
    var bitRateText = selectedAudioStream.BitRate
      ? (Math.floor(selectedAudioStream.BitRate / 1000)) + " kbps"
      : "";
    var codecText = selectedAudioStream.Codec
      ? selectedAudioStream.Codec.toUpperCase()
      : "";

    var detailsText = [channelsText, bitRateText].filter(Boolean).join(" - ");

    if (detailsText) {
      audioLabel +=
        "<i class=\"fa-solid fa-volume-high\"></i>" +
        buildMetaTextSpan(detailsText, "monwui-audio-details-text");
    }

    if (codecText) {
      audioLabel +=
        "<i class=\"fa-solid fa-microchip\"></i>" +
        buildMetaTextSpan(codecText, "monwui-audio-codec-text");
    }
  }

  if (audioLabel) {
    var audioSpan = document.createElement("span");
    audioSpan.className = "audio-label";
    audioSpan.innerHTML = audioLabel;
    container.appendChild(audioSpan);
  }

  if (subtitleLabel) {
    var subtitleSpan = document.createElement("span");
    subtitleSpan.className = "subtitle-label";
    subtitleSpan.innerHTML = subtitleLabel;
    container.appendChild(subtitleSpan);
  }

  return container;
}

export function createMetaContainer(itemSeed = "") {
  var container = document.createElement("div");
  container.className = "monwui-meta-container";
  applyContainerStyles(container, 'meta');
  var originalAppend = container.appendChild.bind(container);
  container.appendChild = function(child) {
    var res = originalAppend(child);
    applyMetaIconColors(container, itemSeed);
    return res;
  };

  return container;
}

export function createMainContentContainer() {
  var container = document.createElement("div");
  container.className = "monwui-main-content-container";
  return container;
}

export function createPlotContainer(config, Overview, UserData, RunTimeTicks) {
  var container = document.createElement("div");
  container.className = "monwui-plot-container";
  applyContainerStyles(container, 'plot');
  var hasResumeProgress = hasPartialPlayback(UserData, RunTimeTicks);

  if (config.showDescriptions && config.showPlotInfo && Overview) {
    var plotSpan = document.createElement("span");
    plotSpan.className = "monwui-plot";
    plotSpan.textContent = Overview;
    container.appendChild(plotSpan);
  }

  if (
    config.showPlaybackProgress &&
    hasResumeProgress &&
    typeof UserData.PlaybackPositionTicks === "number" &&
    typeof RunTimeTicks === "number"
  ) {
    var progressContainer = document.createElement("div");
    progressContainer.className = "monwui-playing-progress-container";

    var barWrapper = document.createElement("div");
    barWrapper.className = "monwui-duration-bar-wrapper";

    var bar = document.createElement("div");
    bar.className = "monwui-duration-bar";

    var percentage = Math.min(
      (UserData.PlaybackPositionTicks / RunTimeTicks) * 100,
      100
    );
    bar.style.width = (percentage.toFixed(1)) + "%";

    var remainingMinutes = Math.round(
      (RunTimeTicks - UserData.PlaybackPositionTicks) / 600000000
    );
    var text = document.createElement("span");
    text.className = "monwui-duration-remaining";
    text.innerHTML = "<i class=\"fa-solid fa-hourglass-half\"></i> " + (remainingMinutes) + " " + (config.languageLabels.minutos || "minutos") + " " + (config.languageLabels.restantes || "restantes");

    barWrapper.appendChild(bar);
    progressContainer.appendChild(barWrapper);
    progressContainer.appendChild(text);
    container.appendChild(progressContainer);
  }

  return container;
}

export function createTitleContainer({ config, Taglines, title, OriginalTitle, Type, ParentIndexNumber, IndexNumber }) {
  var container = document.createElement("div");
  container.className = "monwui-title-container";
  applyContainerStyles(container, 'title');

  if (config.showDescriptions && config.showTitleInfo) {
    var titleSpan = document.createElement("span");
    titleSpan.className = "monwui-baslik";

    if (Type === "Episode") {
      var s = String(ParentIndexNumber || "0").padStart(2, '0');
      var e = String(IndexNumber || "0").padStart(2, '0');
      titleSpan.textContent = "T" + (s) + " E" + (e) + ": " + (title || "");
    } else {
      titleSpan.textContent = title || "";
    }

    container.appendChild(titleSpan);
  }

  if (Taglines && Taglines.length && config.showDescriptions && config.showSloganInfo) {
    var sloganSpan = document.createElement("span");
    sloganSpan.className = "monwui-slogan";
    sloganSpan.innerHTML = "“ " + (Taglines.join(
      ' <i class="fa-solid fa-star fa-2xs" style="color: #ffffff;"></i> '
    )) + " ”";
    container.appendChild(sloganSpan);
  }

  if (config.showDescriptions && config.showOriginalTitleInfo && OriginalTitle) {
    if (!config.hideOriginalTitleIfSame || title !== OriginalTitle) {
      var originalTitleSpan = document.createElement("span");
      originalTitleSpan.className = "monwui-o-baslik";
      originalTitleSpan.textContent = OriginalTitle;
      container.appendChild(originalTitleSpan);
    }
  }

  return container;
}

export function getVideoQualityText(videoStream) {
  if (!videoStream) return "";

  var { baseQuality, qualitySvg } = getVideoQualityInfo(videoStream);

  var iconSvg;
  if (videoStream.VideoRangeType && videoStream.VideoRangeType.toUpperCase().includes("HDR")) {
    iconSvg = "./slider/src/images/quality/hdr.svg";
  } else {
    iconSvg = "./slider/src/images/quality/sdr.svg";
  }

  var codecSvg = "";
  if (videoStream.Codec) {
    var codec = videoStream.Codec.toLowerCase();
    if (codec.includes("h264")) {
      codecSvg = "./slider/src/images/quality/h264.svg";
    } else if (codec.includes("h265") || codec.includes("hevc")) {
      codecSvg = "./slider/src/images/quality/h265.svg";
    } else if (codec.includes("vp9")) {
      codecSvg = "./slider/src/images/quality/vp9.svg";
    } else if (codec.startsWith("mpeg") || codec.includes("mpeg4")) {
      codecSvg = "./slider/src/images/quality/mpeg.svg";
    }
  }

  return "\n    <img src=\"" + (qualitySvg) + "\" alt=\"" + (baseQuality.toUpperCase()) + "\" class=\"quality-icon\">\n    <img src=\"" + (iconSvg) + "\" alt=\"\" class=\"range-icon\">\n    ${codecSvg ? "<img src="${codecSvg}" alt="" class="codec-icon">" : \"\"}\n  ".trim();
}
