import { getConfig } from "./config.js";
import { applyContainerStyles } from "./positionUtils.js";
import { fetchItemDetails } from "../../Plugins/JMSFusion/runtime/api.js";
import { calculateMatchPercentage } from "./hoverTrailerModal.js";
import { withServer } from "./jfUrl.js";
import { getTomatoIconHtml } from "./customIcons.js";

const config = getConfig();
const QUALITY_LABEL_BY_LEVEL = {
  sd: "SD",
  hd: "HD",
  fhd: "FHD",
  "4k": "4K"
};

function escapeMetaHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildMetaTextSpan(text, ...classNames) {
  const className = ["monwui-meta-text", ...classNames.filter(Boolean)].join(" ");
  return `<span class="${className}">${escapeMetaHtml(text)}</span>`;
}

export function getMetaVibrantColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  const h = Math.abs(hash % 360);
  const isCool = h >= 200 && h <= 280;
  const isWarm = h < 45 || h > 300;
  const s = isCool ? 55 : isWarm ? 65 : 50;

  return `hsl(${h}, ${s}%, 45%)`;
}

function applyMetaIconColors(container, itemSeed = "") {
  if (!container) return;
  if (!config?.metaIconColors) return;

  container.querySelectorAll(".monwui-meta-container i").forEach((icon, index) => {
    const cls = icon.className || "";
    const isHeartIcon =
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

    const seed =
      `${itemSeed}-${icon.closest("span")?.className || ""}-${cls}-${index}`;

    icon.style.color = getMetaVibrantColor(seed);
  });
}

function getNormalizedDimension(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isPlaybackCompleted(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (userData.Played === true) return true;

  const playedPercentage = Number(userData.PlayedPercentage);
  if (Number.isFinite(playedPercentage) && playedPercentage >= 100) return true;

  const positionTicks = Number(userData.PlaybackPositionTicks || 0);
  const totalTicks = Number(runtimeTicks || 0);
  return positionTicks > 0 && totalTicks > 0 && positionTicks >= totalTicks;
}

function hasPartialPlayback(userData, runtimeTicks = 0) {
  if (!userData || typeof userData !== "object") return false;
  if (isPlaybackCompleted(userData, runtimeTicks)) return false;

  const positionTicks = Number(userData.PlaybackPositionTicks || 0);
  if (!(positionTicks > 0)) return false;

  const totalTicks = Number(runtimeTicks || 0);
  return totalTicks > 0 ? positionTicks < totalTicks : true;
}

function getVideoQualityInfo(videoStream) {
  const width = getNormalizedDimension(videoStream?.Width);
  const height = getNormalizedDimension(videoStream?.Height);
  const longerEdge = Math.max(width, height);
  const shorterEdge = Math.min(width, height);

  let baseQuality = "sd";
  if (longerEdge >= 3800 || shorterEdge >= 2160) {
    baseQuality = "4k";
  } else if (longerEdge >= 1900 || shorterEdge >= 1080) {
    baseQuality = "fhd";
  } else if (longerEdge >= 1200 || shorterEdge >= 720) {
    baseQuality = "hd";
  }

  return {
    baseQuality,
    qualityLabel: QUALITY_LABEL_BY_LEVEL[baseQuality] || QUALITY_LABEL_BY_LEVEL.sd
  };
}

function getVideoRangeLabel(videoStream) {
  const range = String(videoStream?.VideoRangeType || "").toUpperCase();
  if (!range) return "SDR";
  if (range.includes("DOLBY") || range.includes("DOVI")) return "DV";
  if (range.includes("HLG")) return "HLG";
  if (range.includes("HDR")) return "HDR";
  return "SDR";
}

function getVideoCodecLabel(videoStream) {
  const codec = String(videoStream?.Codec || "").toLowerCase().trim();
  if (!codec) return "";

  if (codec.includes("av1")) return "AV1";
  if (codec.includes("h265") || codec.includes("hevc") || codec.includes("x265")) return "HEVC";
  if (codec.includes("h264") || codec.includes("avc") || codec.includes("x264")) return "AVC";
  if (codec.includes("vp9")) return "VP9";
  if (codec.startsWith("mpeg") || codec.includes("mpeg4")) return "MPEG";

  return codec.replace(/[^a-z0-9]+/g, "").toUpperCase().slice(0, 5);
}

function getVideoBitDepthLabel(videoStream) {
  const depth = Number(videoStream?.BitDepth || 0);
  if (!Number.isFinite(depth) || depth <= 8) return "";
  return `${Math.round(depth)}BIT`;
}

function getPrimaryAudioStream(mediaStreams = []) {
  const audioStreams = Array.isArray(mediaStreams)
    ? mediaStreams.filter(stream => stream?.Type === "Audio")
    : [];

  if (!audioStreams.length) return null;

  return (
    audioStreams.find(stream => stream?.IsDefault) ||
    audioStreams.find(stream => Number(stream?.Index) >= 0) ||
    audioStreams[0]
  );
}

function getAudioCodecLabel(audioStream) {
  if (!audioStream) return "";

  const raw = [
    audioStream.Codec,
    audioStream.DisplayTitle,
    audioStream.Title,
    audioStream.Profile,
    audioStream.CodecTag
  ].filter(Boolean).join(" ").toLowerCase();

  if (!raw) return "";
  if (raw.includes("atmos")) return "ATMOS";
  if (raw.includes("truehd")) return "TRUEHD";
  if (raw.includes("eac3") || raw.includes("dd+")) return "DDP";
  if (raw.includes("ac3") || raw.includes("dolby digital")) return "DD";
  if (raw.includes("dts-hd") || raw.includes("dtshd")) return "DTS-HD";
  if (raw.includes("dts")) return "DTS";
  if (raw.includes("flac")) return "FLAC";
  if (raw.includes("aac")) return "AAC";
  if (raw.includes("opus")) return "OPUS";
  if (raw.includes("mp3")) return "MP3";
  if (raw.includes("pcm") || raw.includes("lpcm")) return "PCM";

  const codec = String(audioStream?.Codec || "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
  return codec.slice(0, 7);
}

function getAudioLayoutLabel(audioStream) {
  if (!audioStream) return "";

  const channels = Number(audioStream?.Channels || 0);
  if (Number.isFinite(channels) && channels > 0) {
    if (channels === 1) return "1.0";
    if (channels === 2) return "2.0";
    if (channels === 6) return "5.1";
    if (channels === 8) return "7.1";
    return `${channels}CH`;
  }

  const layout = String(audioStream?.ChannelLayout || "").toUpperCase().trim();
  if (layout.includes("7.1")) return "7.1";
  if (layout.includes("5.1")) return "5.1";
  if (layout.includes("2.0")) return "2.0";
  return "";
}

function buildQualitySegment(label, part) {
  const safeLabel = escapeMetaHtml(String(label || "").trim());
  if (!safeLabel) return "";
  const safePart = escapeMetaHtml(part);
  return `
    <span class="monwui-quality-segment monwui-quality-segment--${safePart}" data-quality-part="${safePart}">
      ${safeLabel}
    </span>
  `.trim();
}

export function ensureVideoQualityBadgeStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("monwui-video-quality-style")) return;

  const style = document.createElement("style");
  style.id = "monwui-video-quality-style";
  style.textContent = `
    .monwui-quality-group {
      --monwui-quality-size: 24px;
      --monwui-quality-gap: 2px;
      --monwui-quality-direction: row;
      --monwui-quality-wrap: wrap;
      align-items: flex-start;
      display: inline-flex;
      flex-direction: var(--monwui-quality-direction);
      flex-wrap: var(--monwui-quality-wrap);
      gap: var(--monwui-quality-gap);
      justify-content: flex-start;
      max-width: 100%;
    }
    .monwui-quality-segment {
      align-items: center;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      box-sizing: border-box;
      color: #fff;
      display: inline-flex;
      font-family: var(--mwui-font-head, "Roboto Condensed", sans-serif);
      font-size: 10px;
      font-weight: 700;
      height: var(--monwui-quality-size);
      justify-content: center;
      letter-spacing: 0.04em;
      line-height: 1;
      min-width: var(--monwui-quality-size);
      padding: 0 4px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .monwui-quality-segment--level {
      background: rgba(37, 99, 235, 0.92);
    }
    .monwui-quality-segment--range {
      background: rgba(234, 88, 12, 0.92);
    }
    .monwui-quality-segment--codec {
      background: rgba(71, 85, 105, 0.92);
    }
    .monwui-quality-segment--bitdepth {
      background: rgba(79, 70, 229, 0.92);
    }
    .monwui-quality-segment--audio {
      background: rgba(5, 150, 105, 0.92);
    }
    .monwui-quality-segment--audio-layout {
      background: rgba(8, 145, 178, 0.92);
    }
    .monwui-dot-quality-badge,
    .mini-quality-inline,
    .monwui-meta-container .video-quality,
    .quality-badge .quality-text,
    .jf-notif-item .quality,
    .jf-resume-card .quality {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .quality-badge,
    .monwui-dot-quality-badge {
      --monwui-quality-direction: column;
      --monwui-quality-wrap: nowrap;
    }
    .quality-badge .quality-text {
      align-items: flex-start;
      background: none;
      border-radius: 0;
      padding: 0;
    }
    .quality-badge .monwui-quality-group,
    .monwui-dot-quality-badge .monwui-quality-group {
      align-items: flex-start;
    }
    .jf-resume-card .quality {
      justify-content: center;
    }
  `;
  document.head.appendChild(style);
}

export function createSlidesContainer(indexPage) {
  let slidesContainer = indexPage.querySelector("#monwui-slides-container");
  if (!slidesContainer) {
    slidesContainer = document.createElement("div");
    slidesContainer.id = "monwui-slides-container";
    applyContainerStyles(slidesContainer);
    indexPage.insertBefore(slidesContainer, indexPage.firstChild);
  }
  return slidesContainer;
}

export function createHorizontalGradientOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "monwui-horizontal-gradient-overlay";
  return overlay;
}

export function createLogoContainer() {
  const container = document.createElement("div");
  container.className = "monwui-logo-container";
  applyContainerStyles(container, 'logo');
  return container;
}

export function createStatusContainer(itemType, config, UserData, ChildCount, RunTimeTicks, MediaStreams) {
  const statusContainer = document.createElement("div");
  statusContainer.className = "monwui-status-container";
  applyContainerStyles(statusContainer, 'status');
  const hasResumeProgress = !Array.isArray(RunTimeTicks) && hasPartialPlayback(UserData, RunTimeTicks);

  if (itemType && config.showTypeInfo) {
    const typeSpan = document.createElement("span");
    typeSpan.className = "type";
    const typeTranslations = {
      Series: { text: config.languageLabels.dizi, icon: '<i class="fas fa-tv "></i>' },
      Season: { text: config.languageLabels.season, icon: '<i class="fas fa-tv "></i>' },
      Episode: { text: config.languageLabels.episode, icon: '<i class="fas fa-tv "></i>' },
      BoxSet: { text: config.languageLabels.boxset, icon: '<i class="fas fa-film "></i>' },
      Movie: { text: config.languageLabels.film, icon: '<i class="fas fa-film "></i>' }
    };
    const typeInfo = typeTranslations[itemType] || { text: itemType, icon: "" };
    let typeText = typeInfo.text;
    if (itemType === "Series" && ChildCount) {
      typeText += ` (${ChildCount} ${config.languageLabels.sezon})`;
    }
    if (itemType === "BoxSet" && ChildCount) {
      typeText += ` (${ChildCount} ${config.languageLabels.seri})`;
    }
    typeSpan.innerHTML = `${typeInfo.icon}${buildMetaTextSpan(typeText, "monwui-type-text")}`;
    statusContainer.appendChild(typeSpan);
  }

  if (UserData && config.showWatchedInfo) {
    const watchedSpan = document.createElement("span");
    watchedSpan.className = "watched-status";
    const watchedIcon = UserData.Played
      ? `<i class="fa-regular fa-circle-check"></i>`
      : `<i class="fa-regular fa-circle-xmark"></i>`;
    let watchedText = UserData.Played
      ? config.languageLabels.izlendi
      : config.languageLabels.izlenmedi;
    if (UserData.Played && UserData.PlayCount > 0) {
      watchedText += ` (${UserData.PlayCount})`;
    }
    watchedSpan.innerHTML = `${watchedIcon}${buildMetaTextSpan(watchedText, "monwui-watched-text")}`;
    statusContainer.appendChild(watchedSpan);
  }

    if (RunTimeTicks && config.showRuntimeInfo) {
    const runtimeSpan = document.createElement("span");
    runtimeSpan.className = "sure";

    const calcRuntime = (ticks) => {
      const totalMinutes = Math.floor(ticks / 600000000);
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      return hours > 0
        ? `${hours}${config.languageLabels.sa} ${minutes}${config.languageLabels.dk}`
        : `${minutes}${config.languageLabels.dk}`;
    };

    const formatEndTimeLocalized = (ticks) => {
      const totalMinutes = Math.floor(ticks / 600000000);
      const end = new Date(Date.now() + totalMinutes * 60 * 1000);
      const locale = String(config?.languageLabels?.timeLocale || "tr-TR").trim() || "tr-TR";

      try {
        return new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit"
        }).format(end);
      } catch {
        const hh = String(end.getHours()).padStart(2, "0");
        const mm = String(end.getMinutes()).padStart(2, "0");
        return `${hh}:${mm}`;
      }
    };

    if (Array.isArray(RunTimeTicks)) {
      runtimeSpan.innerHTML =
        `<i class="fa-solid fa-hourglass-end"></i>` +
        buildMetaTextSpan(
          RunTimeTicks.map(val => calcRuntime(val)).join(", "),
          "monwui-runtime-text"
        );
    } else {
      const remainingTicks =
        hasResumeProgress
          ? Math.max(RunTimeTicks - UserData.PlaybackPositionTicks, 0)
          : RunTimeTicks;
      const endHHMM = formatEndTimeLocalized(remainingTicks);
      const endTimeLabel = String(config?.languageLabels?.endTimeLabel || "").trim();
      runtimeSpan.innerHTML = `
        <i class="fa-solid fa-hourglass-end"></i>
        ${buildMetaTextSpan(calcRuntime(RunTimeTicks), "monwui-runtime-text")}
        <span class="end-time">
          <i class="fa-solid fa-clock"></i>
          ${buildMetaTextSpan(`${endTimeLabel ? `${endTimeLabel} ` : ""}${endHHMM}`, "monwui-end-time-text")}
        </span>
      `.trim();
    }

    statusContainer.appendChild(runtimeSpan);
  }

  const videoStream = MediaStreams ? MediaStreams.find(s => s.Type === "Video") : null;
  if (videoStream && config.showQualityInfo) {
    const qualityHtml = getVideoQualityText(videoStream, MediaStreams);
    if (qualityHtml) {
      const qualitySpan = document.createElement("span");
      qualitySpan.className = "video-quality";
      qualitySpan.innerHTML = qualityHtml;
      statusContainer.appendChild(qualitySpan);
    }
  }

  return statusContainer;
}

export async function createActorSlider(People, config, item) {
  if (config.showActorAll) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  let actualPeople = People;

  if (
    (item.Type === "Episode" || item.Type === "Season") &&
    item.SeriesId &&
    (!Array.isArray(actualPeople) || actualPeople.length === 0)
  ) {
    try {
      const parent = await fetchItemDetails(item.SeriesId);
      if (parent && Array.isArray(parent.People)) {
        actualPeople = parent.People;
      }
    } catch (e) {
      console.warn("Ana dizi bilgileri alınamadı:", e);
    }
  }

  const allActors = (actualPeople || []).filter(p => p.Type === "Actor");
  const actorsForSlide = allActors.slice(0, config.artistLimit || 9);

  if (actorsForSlide.length === 0) {
    const emptyDiv = document.createElement("div");
    emptyDiv.style.display = "none";
    return emptyDiv;
  }

  const sliderWrapper = document.createElement("div");
  sliderWrapper.className = "monwui-slider-wrapper monwui-artist-menu";
  if (!config.showActorImg) {
    sliderWrapper.classList.add("monwui-artist-menu--no-images");
  }

  const actorToggle = document.createElement("button");
  actorToggle.type = "button";
  actorToggle.className = "monwui-artist-toggle";
  actorToggle.setAttribute("aria-expanded", "false");
  actorToggle.setAttribute(
    "aria-label",
    `${config.languageLabels?.showActorInfo || "Actors"} (${actorsForSlide.length})`
  );
  actorToggle.innerHTML = `
    <i class="fa-solid fa-users"></i>
    <span class="monwui-artist-count">${actorsForSlide.length}</span>
  `.trim();

  const actorPanel = document.createElement("div");
  actorPanel.className = "monwui-artist-popover";
  const panelIdSeed = `${item?.Id || "unknown"}-${Math.random().toString(36).slice(2, 8)}`;
  actorPanel.id = `monwui-artist-popover-${panelIdSeed.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  actorPanel.setAttribute("role", "region");
  actorPanel.setAttribute("aria-label", config.languageLabels?.showActorInfo || "Actors");
  actorToggle.setAttribute("aria-controls", actorPanel.id);

  const actorPanelBody = document.createElement("div");
  actorPanelBody.className = "monwui-artist-popover-body";

  const actorContainer = document.createElement("div");
  actorContainer.className = "monwui-artist-container";

  const leftArrow = document.createElement("button");
  leftArrow.type = "button";
  leftArrow.className = "monwui-slider-arrow left hidden";
  leftArrow.setAttribute("aria-label", "Previous actors");
  leftArrow.innerHTML = `<i class="fa-solid fa-chevron-left"></i>`;

  const rightArrow = document.createElement("button");
  rightArrow.type = "button";
  rightArrow.className = "monwui-slider-arrow right hidden";
  rightArrow.setAttribute("aria-label", "Next actors");
  rightArrow.innerHTML = `<i class="fa-solid fa-chevron-right"></i>`;

  actorPanelBody.appendChild(leftArrow);
  actorPanelBody.appendChild(actorContainer);
  actorPanelBody.appendChild(rightArrow);
  actorPanel.appendChild(actorPanelBody);
  sliderWrapper.appendChild(actorToggle);
  sliderWrapper.appendChild(actorPanel);

  let hoverCloseTimer = 0;
  const clearHoverCloseTimer = () => {
    if (!hoverCloseTimer) return;
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = 0;
  };
  const setExpanded = (expanded) => {
    actorToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  };
  const blurFocusedArrow = () => {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      sliderWrapper.contains(activeElement) &&
      activeElement.classList?.contains("monwui-slider-arrow")
    ) {
      activeElement.blur();
    }
  };
  [leftArrow, rightArrow].forEach((arrow) => {
    arrow.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    arrow.addEventListener("click", () => {
      setTimeout(() => {
        if (!sliderWrapper.matches(":hover")) {
          arrow.blur();
          setExpanded(false);
        }
      }, 0);
    });
  });
  sliderWrapper.addEventListener("mouseenter", () => {
    clearHoverCloseTimer();
    setExpanded(true);
  });
  sliderWrapper.addEventListener("mouseleave", () => {
    if (sliderWrapper.classList.contains("is-open")) return;
    blurFocusedArrow();
    clearHoverCloseTimer();
    hoverCloseTimer = setTimeout(() => {
      hoverCloseTimer = 0;
      if (!sliderWrapper.matches(":hover") && !sliderWrapper.matches(":focus-within")) {
        setExpanded(false);
      }
    }, 180);
  });
  sliderWrapper.addEventListener("focusin", () => {
    clearHoverCloseTimer();
    setExpanded(true);
  });
  sliderWrapper.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!sliderWrapper.matches(":focus-within")) {
        sliderWrapper.classList.remove("is-open");
        setExpanded(false);
      }
    }, 0);
  });
  actorToggle.addEventListener("click", (event) => {
    event.preventDefault();
    clearHoverCloseTimer();
    const nextOpen = !sliderWrapper.classList.contains("is-open");
    sliderWrapper.classList.toggle("is-open", nextOpen);
    setExpanded(nextOpen);
    if (!nextOpen) actorToggle.blur();
  });

  actorsForSlide.forEach(actor => {
    const actorDiv = document.createElement("div");
    actorDiv.className = "monwui-actor-item";

    const actorContent = document.createElement("div");
    actorContent.className = "monwui-actor-content";

    const actorLink = document.createElement("a");
    actorLink.href = `#/details?id=${actor.Id}${config?.serverId ? `&serverId=${encodeURIComponent(config.serverId)}` : ""}`;
    actorLink.target = "_blank";
    actorLink.style.textDecoration = "none";

    if (config.showActorImg) {
      const actorImg = document.createElement("img");
      actorImg.className = "monwui-actor-image";
      actorImg.loading = "lazy";
      if (actor.PrimaryImageTag) {
        actorImg.src = withServer(`/Items/${actor.Id}/Images/Primary?fillHeight=320&fillWidth=320&quality=80&tag=${actor.PrimaryImageTag}`);
        actorImg.alt = actor.Name;
      } else {
        actorImg.src = "./slider/src/images/nofoto.png";
        actorImg.alt = "No Image";
      }
      actorImg.onerror = () => {
        actorImg.src = "./slider/src/images/nofoto.png";
      };
      actorLink.appendChild(actorImg);
      actorContent.appendChild(actorLink);
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "monwui-actor-name";
    nameSpan.textContent = config.showActorInfo ? actor.Name || "" : "";
    actorContent.appendChild(nameSpan);

    const roleSpan = document.createElement("span");
    roleSpan.className = "monwui-actor-role";
    roleSpan.textContent = config.showActorRole ? actor.Role || "" : "";
    actorContent.appendChild(roleSpan);

    actorDiv.appendChild(actorContent);
    actorContainer.appendChild(actorDiv);
  });

  return sliderWrapper;
}

export function createInfoContainer({ config, Genres, ProductionYear, ProductionLocations }) {
  const container = document.createElement("div");
  container.className = "monwui-info-container";
  applyContainerStyles(container, "info");

  const normalizeKey = (str) => str?.toString().toLowerCase().replace(/\s+/g, "");

  const parts = [];

  if (Array.isArray(Genres) && Genres.length && config.showGenresInfo) {
    const translated = Genres.map((genre) => {
      const key = normalizeKey(genre);
      const matchedEntry = Object.entries(config.languageLabels.turler || {}).find(
        ([labelKey]) => normalizeKey(labelKey) === key
      );
      return matchedEntry ? matchedEntry[1] : genre;
    }).join(", ");

    parts.push(`<span class="genres"><i class="fa-solid fa-masks-theater"></i> ${translated}</span>`);
  }

  if (ProductionYear && config.showYearInfo) {
    const yearText = Array.isArray(ProductionYear) ? ProductionYear.join(", ") : ProductionYear;
    parts.push(`<span class="yil"><i class="fa-solid fa-calendar"></i> ${yearText}</span>`);
  }

  if (ProductionLocations && config.showCountryInfo) {
    const getFlagEmoji = (code) =>
      code
        ? code
            .toUpperCase()
            .split("")
            .map((char) => String.fromCodePoint(127397 + char.charCodeAt()))
            .join("")
        : "";

    const getCountryInfo = (countryRaw) => {
      const key = normalizeKey(countryRaw);
      const matchedEntry = Object.entries(config.languageLabels.ulke || {}).find(
        ([labelKey]) => normalizeKey(labelKey) === key
      );
      return matchedEntry
        ? matchedEntry[1]
        : { code: countryRaw.slice(0, 2).toUpperCase(), name: countryRaw };
    };

    const countryText = Array.isArray(ProductionLocations)
      ? ProductionLocations.map((c) => {
          const info = getCountryInfo(c);
          return `${getFlagEmoji(info.code)} ${info.name}`;
        }).join(", ")
      : (() => {
          const info = getCountryInfo(ProductionLocations);
          return `${getFlagEmoji(info.code)} ${info.name}`;
        })();

    parts.push(`<span class="ulke"><i class="fa-solid fa-location-dot"></i> ${countryText}</span>`);
  }

  container.innerHTML = parts.join(` <span class="info-sep">✧</span> `);

  if (!parts.length) container.style.display = "none";

  return container;
}

export async function createDirectorContainer({ config, People, item }) {
  const container = document.createElement("div");
  container.className = "monwui-director-container";
  applyContainerStyles(container, 'director');

  let actualPeople = People;

  if (
    (item.Type === "Episode" || item.Type === "Season") &&
    item.SeriesId &&
    (!Array.isArray(actualPeople) || actualPeople.length === 0)
  ) {
    try {
      const parent = await fetchItemDetails(item.SeriesId);
      if (parent && Array.isArray(parent.People)) {
        actualPeople = parent.People;
      }
    } catch (e) {
      console.warn("Ana dizi bilgileri alınamadı:", e);
    }
  }

  if (actualPeople && actualPeople.length > 0 && config.showDirectorWriter) {
    if (config.showDirector) {
      const directors = actualPeople.filter(p => p.Type?.toLowerCase() === "director");
      if (directors.length) {
        const directorNames = directors.map(d => d.Name).join(", ");
        const directorSpan = document.createElement("span");
        directorSpan.className = "monwui-yonetmen";
        directorSpan.textContent = `${config.languageLabels.yonetmen}: ${directorNames}`;
        container.appendChild(directorSpan);
      }
    }

    if (config.showWriter) {
      const writers = actualPeople.filter(p => p.Type?.toLowerCase() === "writer");
      const allow = (config.allowedWriters || [])
        .map(x => x?.toLowerCase?.())
        .filter(Boolean);
      const matchingWriters = writers.filter(w =>
        w?.Name && allow.includes(w.Name.toLowerCase())
      );
      if (matchingWriters.length) {
        const writerNames = matchingWriters.map(w => w.Name).join(", ");
        const writerSpan = document.createElement("span");
        writerSpan.className = "writer";
        writerSpan.textContent = `${writerNames} ${config.languageLabels.yazar} ...`;
        container.appendChild(writerSpan);
      }
    }
  }

  return container;
}

export async function createRatingContainer({
  config,
  CommunityRating,
  CriticRating,
  OfficialRating,
  UserData,
  item
}) {
  const container = document.createElement("div");
  container.className = "monwui-rating-container";
  applyContainerStyles(container, 'rating');

  let ratingExists = false;

  if (config.showRatingInfo) {
    if (config.showMatchPercentage && UserData && item) {
      const matchPercentage = await calculateMatchPercentage(UserData, item);
      const matchSpan = document.createElement("span");
      matchSpan.className = "monwui-match-percentage";
      matchSpan.innerHTML = `
  <span class="monwui-match-rating">
    <i class="fa-regular fa-heart fa-lg"></i>
      <span class="monwui-heart-filled" style="clip-path: inset(${100 - matchPercentage}% 0 0 0);">
      <i class="fa-solid fa-heart fa-lg"></i>
    </span>
  </span>
  ${buildMetaTextSpan(`${matchPercentage}%`, "monwui-percentage-text")}`;
      container.appendChild(matchSpan);
      ratingExists = true;
    }

    if (config.showCommunityRating && CommunityRating) {
    let ratingValue = Array.isArray(CommunityRating)
    ? Math.round((CommunityRating.reduce((a, b) => a + b, 0) / CommunityRating.length) * 10) / 10
    : Math.round(CommunityRating * 10) / 10;

  let ratingClass = "monwui-rating-default";
  if (ratingValue >= 9) ratingClass = "monwui-rating-excellent";
  else if (ratingValue >= 7.5) ratingClass = "monwui-rating-good";
  else if (ratingValue >= 6) ratingClass = "monwui-rating-average";
  else if (ratingValue >= 4) ratingClass = "monwui-rating-poor";
  else ratingClass = "monwui-rating-bad";

  const ratingPercentage = ratingValue * 10;
  const ratingSpan = document.createElement("span");
  ratingSpan.className = `monwui-rating ${ratingClass}`;
  ratingSpan.innerHTML = `
    <span class="monwui-star-rating">
      <i class="fa-regular fa-star fa-lg"></i>
      <span class="monwui-star-filled" style="clip-path: inset(${100 - ratingPercentage}% 0 0 0);">
        <i class="fa-solid fa-star fa-lg" style="display: block;"></i>
      </span>
    </span>
    ${buildMetaTextSpan(ratingValue, "monwui-rating-text")}`;
  container.appendChild(ratingSpan);
  ratingExists = true;
}

    if (config.showCriticRating && CriticRating) {
      const criticSpan = document.createElement("span");
      criticSpan.className = "monwui-t-rating";
      criticSpan.innerHTML =
        `${getTomatoIconHtml()}` +
        buildMetaTextSpan(
          Array.isArray(CriticRating) ? CriticRating.join(", ") : CriticRating,
          "monwui-critic-rating-text"
        );
      container.appendChild(criticSpan);
      ratingExists = true;
    }

    if (config.showOfficialRating && OfficialRating) {
      const officialRatingSpan = document.createElement("span");
      officialRatingSpan.className = "monwui-officialrating";
      officialRatingSpan.innerHTML =
        `<i class="fa-solid fa-user-group"></i>` +
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
  const container = document.createElement("div");
  container.className = "monwui-language-container";

  if (
    !config.showLanguageInfo ||
    !MediaStreams ||
    MediaStreams.length === 0 ||
    String(itemType || "").toLowerCase() === "series"
  ) {
    return container;
  }

  const audioCodecs = ["ac3", "mp3", "aac", "flac", "dts", "truehd", "eac3"];
  const subtitleCodecs = ["srt", "ass", "vtt", "subrip"];

  const audioStreams = MediaStreams.filter(
    stream => stream.Codec && audioCodecs.includes(stream.Codec.toLowerCase())
  );
  const subtitleStreams = MediaStreams.filter(
    stream => stream.Codec && subtitleCodecs.includes(stream.Codec.toLowerCase())
  );

  const hasTurkishAudio = audioStreams.some(
    stream => stream.Language?.toLowerCase() === config.defaultLanguage
  );
  const hasTurkishSubtitle = subtitleStreams.some(
    stream => stream.Language?.toLowerCase() === config.defaultLanguage
  );

  let audioLabel = "";
  let subtitleLabel = "";

  if (hasTurkishAudio) {
    audioLabel =
      `<i class="fa-solid fa-language"></i>` +
      buildMetaTextSpan(config.languageLabels.audio, "monwui-audio-label-text");
  } else {
    const defaultAudioStream = audioStreams.find(stream => stream.IsDefault);
    const fallbackLanguage = defaultAudioStream?.Language || "";
    audioLabel =
      `<i class="fa-solid fa-language"></i>` +
      buildMetaTextSpan(
        `${config.languageLabels.original}${fallbackLanguage ? ` ${fallbackLanguage}` : ""}`,
        "monwui-audio-label-text"
      );
  }

  if (!hasTurkishAudio && hasTurkishSubtitle) {
    subtitleLabel =
      `<i class="fa-solid fa-closed-captioning"></i>` +
      buildMetaTextSpan(config.languageLabels.subtitle, "monwui-subtitle-text");
  }

  const selectedAudioStream =
    audioStreams.find(stream => stream.Language?.toLowerCase() === config.defaultLanguage) ||
    audioStreams[0];

  if (selectedAudioStream) {
    const channelsText = selectedAudioStream.Channels
      ? `${selectedAudioStream.Channels} ${config.languageLabels.channel}`
      : "";
    const bitRateText = selectedAudioStream.BitRate
      ? `${Math.floor(selectedAudioStream.BitRate / 1000)} kbps`
      : "";
    const codecText = selectedAudioStream.Codec
      ? selectedAudioStream.Codec.toUpperCase()
      : "";

    const detailsText = [channelsText, bitRateText].filter(Boolean).join(" - ");

    if (detailsText) {
      audioLabel +=
        `<i class="fa-solid fa-volume-high"></i>` +
        buildMetaTextSpan(detailsText, "monwui-audio-details-text");
    }

    if (codecText) {
      audioLabel +=
        `<i class="fa-solid fa-microchip"></i>` +
        buildMetaTextSpan(codecText, "monwui-audio-codec-text");
    }
  }

  if (audioLabel) {
    const audioSpan = document.createElement("span");
    audioSpan.className = "audio-label";
    audioSpan.innerHTML = audioLabel;
    container.appendChild(audioSpan);
  }

  if (subtitleLabel) {
    const subtitleSpan = document.createElement("span");
    subtitleSpan.className = "subtitle-label";
    subtitleSpan.innerHTML = subtitleLabel;
    container.appendChild(subtitleSpan);
  }

  return container;
}

export function createMetaContainer(itemSeed = "") {
  const container = document.createElement("div");
  container.className = "monwui-meta-container";
  applyContainerStyles(container, 'meta');
  const originalAppend = container.appendChild.bind(container);
  container.appendChild = (child) => {
    const res = originalAppend(child);
    applyMetaIconColors(container, itemSeed);
    return res;
  };

  return container;
}

export function createMainContentContainer() {
  const container = document.createElement("div");
  container.className = "monwui-main-content-container";
  return container;
}

export function createPlotContainer(config, Overview, UserData, RunTimeTicks) {
  const container = document.createElement("div");
  container.className = "monwui-plot-container";
  applyContainerStyles(container, 'plot');
  const hasResumeProgress = hasPartialPlayback(UserData, RunTimeTicks);

  if (config.showDescriptions && config.showPlotInfo && Overview) {
    const plotSpan = document.createElement("span");
    plotSpan.className = "monwui-plot";
    plotSpan.textContent = Overview;
    container.appendChild(plotSpan);
  }

  if (
    config.showPlaybackProgress &&
    hasResumeProgress &&
    typeof UserData?.PlaybackPositionTicks === "number" &&
    typeof RunTimeTicks === "number"
  ) {
    const progressContainer = document.createElement("div");
    progressContainer.className = "monwui-playing-progress-container";

    const barWrapper = document.createElement("div");
    barWrapper.className = "monwui-duration-bar-wrapper";

    const bar = document.createElement("div");
    bar.className = "monwui-duration-bar";

    const percentage = Math.min(
      (UserData.PlaybackPositionTicks / RunTimeTicks) * 100,
      100
    );
    bar.style.width = `${percentage.toFixed(1)}%`;

    const remainingMinutes = Math.round(
      (RunTimeTicks - UserData.PlaybackPositionTicks) / 600000000
    );
    const text = document.createElement("span");
    text.className = "monwui-duration-remaining";
    text.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ${remainingMinutes} ${config.languageLabels.dakika} ${config.languageLabels.kaldi}`;

    barWrapper.appendChild(bar);
    progressContainer.appendChild(barWrapper);
    progressContainer.appendChild(text);
    container.appendChild(progressContainer);
  }

  return container;
}

export function createTitleContainer({ config, Taglines, title, OriginalTitle, Type, ParentIndexNumber, IndexNumber }) {
  const container = document.createElement("div");
  container.className = "monwui-title-container";
  applyContainerStyles(container, 'title');

  if (config.showDescriptions && config.showTitleInfo) {
    const titleSpan = document.createElement("span");
    titleSpan.className = "monwui-baslik";

    if (Type === "Episode" && typeof ParentIndexNumber === "number" && typeof IndexNumber === "number") {
      titleSpan.textContent = `S${ParentIndexNumber} B${IndexNumber}: ${title}`;
    } else {
      titleSpan.textContent = title;
    }

    container.appendChild(titleSpan);
  }

  if (Taglines && Taglines.length && config.showDescriptions && config.showSloganInfo) {
    const sloganSpan = document.createElement("span");
    sloganSpan.className = "monwui-slogan";
    sloganSpan.innerHTML = `“ ${Taglines.join(
      ' <i class="fa-solid fa-star fa-2xs" style="color: #ffffff;"></i> '
    )} ”`;
    container.appendChild(sloganSpan);
  }

  if (config.showDescriptions && config.showOriginalTitleInfo && OriginalTitle) {
    if (!config.hideOriginalTitleIfSame || title !== OriginalTitle) {
      const originalTitleSpan = document.createElement("span");
      originalTitleSpan.className = "monwui-o-baslik";
      originalTitleSpan.textContent = OriginalTitle;
      container.appendChild(originalTitleSpan);
    }
  }

  return container;
}

export function getVideoQualityText(videoStream, mediaStreams = null) {
  if (!videoStream) return "";
  ensureVideoQualityBadgeStyles();

  const { qualityLabel } = getVideoQualityInfo(videoStream);
  const rangeLabel = getVideoRangeLabel(videoStream);
  const codecLabel = getVideoCodecLabel(videoStream);
  const bitDepthLabel = getVideoBitDepthLabel(videoStream);

  const videoParts = [
    buildQualitySegment(qualityLabel, "level"),
    buildQualitySegment(rangeLabel, "range"),
    buildQualitySegment(codecLabel, "codec"),
    buildQualitySegment(bitDepthLabel, "bitdepth")
  ].filter(Boolean);

  const audioStream = getPrimaryAudioStream(mediaStreams);
  const audioParts = [
    buildQualitySegment(getAudioCodecLabel(audioStream), "audio"),
    buildQualitySegment(getAudioLayoutLabel(audioStream), "audio-layout")
  ].filter(Boolean);

  const groups = [];
  if (videoParts.length) {
    groups.push(`
      <span class="monwui-quality-group" data-quality-group="video">
        ${videoParts.join("")}
      </span>
    `.trim());
  }
  if (audioParts.length) {
    groups.push(`
      <span class="monwui-quality-group" data-quality-group="audio">
        ${audioParts.join("")}
      </span>
    `.trim());
  }

  if (!groups.length) return "";

  return groups.join("");
}
