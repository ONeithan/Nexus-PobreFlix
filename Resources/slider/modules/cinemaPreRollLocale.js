import { getConfig } from "./config.js";
import { withServer } from "./jfUrl.js";

export const CINEMA_PREROLL_CACHE_ENDPOINT = "/Plugins/JMSFusion/cinema-preroll/cache";

export function normalizeCinemaPreRollLanguage(raw) {
  const value = String(raw || "").trim().replace("_", "-");
  if (/^[a-z]{2}-[A-Z]{2}$/.test(value)) return value;
  const lower = value.toLowerCase();
  if (lower === "pt" || lower === "por" || lower === "pt-br" || lower === "por-br") return "pt-BR";
  if (lower === "tr" || lower === "tur") return "tr-TR";
  if (lower === "en" || lower === "eng") return "en-US";
  if (lower === "de" || lower === "deu") return "de-DE";
  if (lower === "fr" || lower === "fre" || lower === "fra") return "fr-FR";
  if (lower === "ru" || lower === "rus") return "ru-RU";
  if (lower === "es" || lower === "spa") return "es-ES";
  return "pt-BR";
}

export function normalizeCinemaPreRollLanguageSetting(raw) {
  const value = String(raw || "").trim();
  if (!value) return "auto";
  if (value.toLowerCase() === "auto") return "auto";
  return normalizeCinemaPreRollLanguage(value);
}

export function normalizeCinemaPreRollRegionMode(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "global") return "global";
  if (value === "custom") return "custom";
  return "auto";
}

export function normalizeCinemaPreRollCustomRegion(raw) {
  const value = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
  return value.length === 2 ? value : "";
}

export function resolveCinemaPreRollLocale(source = getConfig()) {
  const cfg = source || {};
  const fallbackLanguage = (
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "pt-BR"
  );
  const languageSetting = normalizeCinemaPreRollLanguageSetting(cfg?.cinemaPreRollLanguage);
  const language = normalizeCinemaPreRollLanguage(
    languageSetting === "auto"
      ? (cfg?.defaultLanguage || fallbackLanguage)
      : languageSetting
  );
  const desiredMode = normalizeCinemaPreRollRegionMode(cfg?.cinemaPreRollRegionMode);
  const customRegion = normalizeCinemaPreRollCustomRegion(cfg?.cinemaPreRollCustomRegion);
  const autoRegion = language.split("-")[1] || "BR";

  let regionMode = desiredMode;
  let region = "";

  if (desiredMode === "global") {
    region = "";
  } else if (desiredMode === "custom" && customRegion) {
    region = customRegion;
  } else {
    regionMode = "auto";
    region = autoRegion;
  }

  return {
    language,
    languageSetting,
    region,
    regionMode,
    customRegion,
    cacheKey: region ? `${language}:${region}` : `${language}:GLOBAL`
  };
}

export function getCinemaPreRollLocaleSignature(source = getConfig()) {
  const locale = resolveCinemaPreRollLocale(source);
  return `${locale.language}|${locale.regionMode}|${locale.region || "GLOBAL"}`;
}

export function buildCinemaPreRollCacheUrl(source = getConfig(), { force = false } = {}) {
  const locale =
    source && typeof source === "object" && typeof source.language === "string"
      ? source
      : resolveCinemaPreRollLocale(source);

  const endpoint = withServer(CINEMA_PREROLL_CACHE_ENDPOINT) || CINEMA_PREROLL_CACHE_ENDPOINT;
  const baseHref = (
    typeof window !== "undefined" && window.location?.href
      ? window.location.href
      : "http://localhost/"
  );
  const url = new URL(endpoint, baseHref);
  url.searchParams.set("language", locale.language);
  url.searchParams.set("regionMode", locale.regionMode || "auto");
  if (locale.region) {
    url.searchParams.set("region", locale.region);
  }
  if (force) {
    url.searchParams.set("force", "true");
  }
  return url;
}
