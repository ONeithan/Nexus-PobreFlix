/**
 * categoryDetector.js - Detector Inteligente de Categorias para Nexus PobreFlix
 * Distingue Animes, Desenhos, Novelas, Séries e Filmes mesmo quando
 * cadastrados genericamente como "Series" ou "Movies" no Jellyfin.
 */

export function detectItemCategory(item, fallbackType = "Movie") {
  if (!item) return { id: "movie", label: "Filme", icon: "film" };
  if (typeof item === "string") {
    return detectCategoryFromType(item);
  }

  const type = item.Type || fallbackType || "Movie";
  const genres = Array.isArray(item.Genres)
    ? item.Genres.map(g => (typeof g === "string" ? g : g?.Name || "").toLowerCase())
    : [];
  const tags = Array.isArray(item.Tags)
    ? item.Tags.map(t => (typeof t === "string" ? t : t?.Name || "").toLowerCase())
    : [];
  const path = (item.Path || item.Location || "").toLowerCase();
  const libName = (item.__libraryName || "").toLowerCase();

  // 1. Anime Detection
  const isAnime =
    libName.includes("anime") ||
    path.includes("/anime") || path.includes("\\anime") ||
    genres.includes("anime") || genres.includes("animação japonesa") || genres.includes("japanese animation") ||
    tags.includes("anime");

  if (isAnime) {
    return { id: "anime", label: "Anime", icon: "star" };
  }

  // 2. Novela / Dorama Detection
  const isNovela =
    libName.includes("novela") || libName.includes("dorama") ||
    path.includes("/novela") || path.includes("\\novela") ||
    path.includes("/dorama") || path.includes("\\dorama") ||
    genres.includes("novela") || genres.includes("telenovela") || genres.includes("soap") ||
    genres.includes("dorama") || genres.includes("k-drama") || genres.includes("asian drama") ||
    tags.includes("novela") || tags.includes("dorama");

  if (isNovela) {
    return { id: "novela", label: "Novela", icon: "tv" };
  }

  // 3. Desenho / Cartoons / Kids Animation Detection
  const isDesenho =
    libName.includes("desenho") || libName.includes("cartoon") || libName.includes("kids") ||
    path.includes("/desenho") || path.includes("\\desenho") || path.includes("/kids") ||
    genres.includes("desenho") || genres.includes("cartoons") ||
    (genres.includes("animation") && (genres.includes("family") || genres.includes("infantil") || genres.includes("kids") || genres.includes("children")) && !isAnime) ||
    tags.includes("desenho") || tags.includes("cartoon");

  if (isDesenho) {
    return { id: "desenho", label: "Desenho", icon: "tv" };
  }

  // 4. Fallback by Type
  if (type === "Series" || type === "Season" || type === "Episode") {
    return { id: "series", label: "Série", icon: "tv" };
  }
  if (type === "BoxSet") {
    return { id: "boxset", label: "Coleção", icon: "layerGroup" };
  }
  return { id: "movie", label: "Filme", icon: "film" };
}

export function detectCategoryFromType(type) {
  if (type === "Series" || type === "Season" || type === "Episode") {
    return { id: "series", label: "Série", icon: "tv" };
  }
  if (type === "BoxSet") {
    return { id: "boxset", label: "Coleção", icon: "layerGroup" };
  }
  return { id: "movie", label: "Filme", icon: "film" };
}
