import { bindCheckboxKontrol, createCheckbox, createSection } from "./shared.js";

const DEFAULT_TRAILER_COUNT = 2;
const MAX_TRAILER_COUNT = 5;
const CINEMA_PREROLL_LANGUAGE_OPTIONS = Object.freeze([
  { value: "auto", label: "🌐 Auto" },
  { value: "tr-TR", label: "🇹🇷 Türkçe" },
  { value: "en-US", label: "🇺🇸 English (US)" },
  { value: "en-GB", label: "🇬🇧 English (UK)" },
  { value: "de-DE", label: "🇩🇪 Deutsch" },
  { value: "fr-FR", label: "🇫🇷 Français" },
  { value: "es-ES", label: "🇪🇸 Español" },
  { value: "it-IT", label: "🇮🇹 Italiano" },
  { value: "ru-RU", label: "🇷🇺 Русский" },
  { value: "ja-JP", label: "🇯🇵 日本語" },
  { value: "zh-CN", label: "🇨🇳 简体中文" },
  { value: "pt-PT", label: "🇵🇹 Português (Portugal)" },
  { value: "pt-BR", label: "🇧🇷 Português (Brasil)" },
  { value: "nl-NL", label: "🇳🇱 Nederlands" },
  { value: "sv-SE", label: "🇸🇪 Svenska" },
  { value: "pl-PL", label: "🇵🇱 Polski" },
  { value: "uk-UA", label: "🇺🇦 Українська" },
  { value: "ko-KR", label: "🇰🇷 한국어" },
  { value: "ar-SA", label: "🇸🇦 العربية" },
  { value: "hi-IN", label: "🇮🇳 हिन्दी" },
  { value: "fa-IR", label: "🇮🇷 فارسی" }
]);

function normalizeTrailerCount(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TRAILER_COUNT;
  return Math.min(MAX_TRAILER_COUNT, Math.max(1, parsed));
}

function normalizeRegionMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "global" || mode === "custom") return mode;
  return "auto";
}

function normalizeCustomRegion(value) {
  const region = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
  return region.length === 2 ? region : "";
}

function normalizeLanguageSetting(value) {
  const raw = String(value || "").trim();
  if (!raw) return "auto";
  if (raw.toLowerCase() === "auto") return "auto";
  const exact = CINEMA_PREROLL_LANGUAGE_OPTIONS.find((entry) => entry.value === raw);
  if (exact) return exact.value;
  return "auto";
}

function createDescriptionText(text) {
  const description = document.createElement("div");
  description.className = "description-text cinema-preroll-field-note";
  description.textContent = text;
  return description;
}

function appendDescriptionText(parent, text) {
  const value = String(text || "").trim();
  if (!value) return null;
  const description = createDescriptionText(value);
  parent.appendChild(description);
  return description;
}

export function createCinemaPreRollPanel(config, labels) {
  const panel = document.createElement("div");
  panel.id = "cinema-preroll-panel";
  panel.className = "settings-panel";

  const section = createSection(labels.cinemaPreRollTab || "Sinema Ön Gösterimleri");

  const enableCheckbox = createCheckbox(
    "cinemaPreRollEnabled",
    labels.cinemaPreRollEnabled || "Film/dizi başlamadan önce vizyondaki fragmanları oynat",
    config.cinemaPreRollEnabled === true
  );
  section.appendChild(enableCheckbox);
  appendDescriptionText(
    section,
    labels.cinemaPreRollDescription ||
      "TMDb vizyondaki içerik listesinden fragmanlar seçilir ve asıl içerikten önce sinema ön gösterimi gibi oynatılır."
  );
  appendDescriptionText(
    section,
    labels.cinemaPreRollHint ||
      "Bu özelliğin çalışabilmesi için MonWUI Ayarları sekmesinde geçerli bir TMDb API anahtarı tanımlanmış olmalıdır."
  );

  const subOptions = document.createElement("div");
  subOptions.className = "sub-options cinema-preroll-sub-options";

  const countRow = document.createElement("div");
  countRow.className = "fsetting-item";

  const countLabel = document.createElement("label");
  countLabel.className = "settings-label";
  countLabel.htmlFor = "cinemaPreRollTrailerCount";
  countLabel.textContent = labels.cinemaPreRollTrailerCount || "Oynatılacak fragman sayısı";

  const countSelect = document.createElement("select");
  countSelect.id = "cinemaPreRollTrailerCount";
  countSelect.name = "cinemaPreRollTrailerCount";
  countSelect.className = "settings-select";

  const currentCount = normalizeTrailerCount(config.cinemaPreRollTrailerCount);
  for (let value = 1; value <= MAX_TRAILER_COUNT; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value}`;
    option.selected = currentCount === value;
    countSelect.appendChild(option);
  }

  countRow.append(countLabel, countSelect);
  subOptions.appendChild(countRow);

  const fullscreenCheckbox = createCheckbox(
    "cinemaPreRollStartFullscreen",
    labels.cinemaPreRollStartFullscreen || "Ön gösterimleri mümkün olduğunda tam ekran başlat",
    config.cinemaPreRollStartFullscreen === true
  );
  subOptions.appendChild(fullscreenCheckbox);
  appendDescriptionText(
    subOptions,
    labels.cinemaPreRollStartFullscreenHint ||
      "Desteklenen tarayıcılarda ön gösterim oynatıcısı otomatik olarak tam ekran moduna geçmeyi dener. Bazı cihazlarda ilk dokunuş gerekebilir."
  );

  const languageRow = document.createElement("div");
  languageRow.className = "fsetting-item";

  const languageLabel = document.createElement("label");
  languageLabel.className = "settings-label";
  languageLabel.htmlFor = "cinemaPreRollLanguage";
  languageLabel.textContent =
    labels.cinemaPreRollLanguage || "TMDb dili";

  const languageSelect = document.createElement("select");
  languageSelect.id = "cinemaPreRollLanguage";
  languageSelect.name = "cinemaPreRollLanguage";
  languageSelect.className = "settings-select";

  const currentLanguage = normalizeLanguageSetting(config.cinemaPreRollLanguage);
  CINEMA_PREROLL_LANGUAGE_OPTIONS.forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent =
      entry.value === "auto"
        ? (labels.cinemaPreRollLanguageAuto || "Otomatik - Eklenti / tarayıcı dilini kullan")
        : entry.label;
    option.selected = currentLanguage === entry.value;
    languageSelect.appendChild(option);
  });

  languageRow.append(languageLabel, languageSelect);
  subOptions.appendChild(languageRow);
  appendDescriptionText(
    subOptions,
    labels.cinemaPreRollLanguageHint ||
      "Bu alan TMDb başlık, açıklama ve fragman havuzunun dilini belirler."
  );

  const regionModeRow = document.createElement("div");
  regionModeRow.className = "fsetting-item";

  const regionModeLabel = document.createElement("label");
  regionModeLabel.className = "settings-label";
  regionModeLabel.htmlFor = "cinemaPreRollRegionMode";
  regionModeLabel.textContent =
    labels.cinemaPreRollRegionMode || "TMDb bölge modu";

  const regionModeSelect = document.createElement("select");
  regionModeSelect.id = "cinemaPreRollRegionMode";
  regionModeSelect.name = "cinemaPreRollRegionMode";
  regionModeSelect.className = "settings-select";

  const currentRegionMode = normalizeRegionMode(config.cinemaPreRollRegionMode);
  [
    {
      value: "auto",
      label: labels.cinemaPreRollRegionModeAuto || "Otomatik - Dil kodundan ülkeyi türet"
    },
    {
      value: "global",
      label: labels.cinemaPreRollRegionModeGlobal || "Küresel - TMDb'ye bölge göndermeden kullan"
    },
    {
      value: "custom",
      label: labels.cinemaPreRollRegionModeCustom || "Özel bölge - Ülke kodunu elle seç"
    }
  ].forEach((entry) => {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    option.selected = currentRegionMode === entry.value;
    regionModeSelect.appendChild(option);
  });

  regionModeRow.append(regionModeLabel, regionModeSelect);
  subOptions.appendChild(regionModeRow);
  appendDescriptionText(
    subOptions,
    labels.cinemaPreRollRegionModeHint ||
      "Otomatik modda ülke kodu TMDb dil ayarından türetilir. Küresel modda TMDb isteğine bölge parametresi eklenmez. Özel bölge modunda iki harfli ülke kodu kullanılır."
  );

  const customRegionRow = document.createElement("div");
  customRegionRow.className = "fsetting-item cinema-preroll-custom-region-row";

  const customRegionLabel = document.createElement("label");
  customRegionLabel.className = "settings-label";
  customRegionLabel.htmlFor = "cinemaPreRollCustomRegion";
  customRegionLabel.textContent =
    labels.cinemaPreRollCustomRegion || "Özel bölge kodu";

  const customRegionInput = document.createElement("input");
  customRegionInput.type = "text";
  customRegionInput.id = "cinemaPreRollCustomRegion";
  customRegionInput.name = "cinemaPreRollCustomRegion";
  customRegionInput.className = "settings-input";
  customRegionInput.placeholder = "US";
  customRegionInput.maxLength = 2;
  customRegionInput.autocomplete = "off";
  customRegionInput.spellcheck = false;
  customRegionInput.value = normalizeCustomRegion(config.cinemaPreRollCustomRegion);
  customRegionInput.addEventListener("input", () => {
    const next = customRegionInput.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
    if (customRegionInput.value !== next) {
      const pos = next.length;
      customRegionInput.value = next;
      try { customRegionInput.setSelectionRange(pos, pos); } catch {}
    }
  });

  customRegionRow.append(customRegionLabel, customRegionInput);
  subOptions.appendChild(customRegionRow);
  const customRegionHint = appendDescriptionText(
    subOptions,
    labels.cinemaPreRollCustomRegionHint ||
      "Örnek ülke kodları: US, GB, TR, DE. Ayar değiştiğinde önbellek dosyası yeni yerel ayar için anında yenilenir."
  );
  section.appendChild(subOptions);

  const updateCustomRegionState = () => {
    const enabled = normalizeRegionMode(regionModeSelect.value) === "custom";
    customRegionRow.style.display = enabled ? "" : "none";
    if (customRegionHint) customRegionHint.style.display = enabled ? "" : "none";
    customRegionInput.disabled = !enabled;
  };
  updateCustomRegionState();
  regionModeSelect.addEventListener("change", updateCustomRegionState);

  bindCheckboxKontrol("#cinemaPreRollEnabled", ".cinema-preroll-sub-options");

  panel.appendChild(section);
  return panel;
}
