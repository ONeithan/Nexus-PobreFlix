function isObjectLike(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rebuildLegacyLyricsText(data) {
  if (!isObjectLike(data)) return null;

  const chars = Object.keys(data)
    .filter((key) => /^\d+$/.test(key))
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => (typeof data[key] === "string" ? data[key] : ""))
    .join("");

  return chars.trim() ? chars : null;
}

export function normalizeLyricsPayload(data) {
  if (data == null) return null;

  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        const normalized = normalizeLyricsPayload(parsed);
        if (normalized) return normalized;
      } catch {}
    }

    return data;
  }

  if (Array.isArray(data)) {
    return data.length ? { Lyrics: data } : null;
  }

  if (!isObjectLike(data)) return null;

  if (Array.isArray(data.Lyrics)) {
    return data.Lyrics.length ? { Lyrics: data.Lyrics } : null;
  }

  if (Array.isArray(data.lyrics)) {
    return data.lyrics.length ? { Lyrics: data.lyrics } : null;
  }

  const textCandidates = [
    data.text,
    data.Text,
    data.lyricsText,
    typeof data.Lyrics === "string" ? data.Lyrics : null,
    typeof data.lyrics === "string" ? data.lyrics : null,
  ];

  for (const candidate of textCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return rebuildLegacyLyricsText(data);
}

export function hasLyricsPayload(data) {
  const normalized = normalizeLyricsPayload(data);
  if (!normalized) return false;

  if (typeof normalized === "string") {
    return normalized.trim().length > 0;
  }

  return Array.isArray(normalized.Lyrics) && normalized.Lyrics.length > 0;
}

export function buildLyricsRecord(trackId, data) {
  if (!trackId) return null;

  const normalized = normalizeLyricsPayload(data);
  if (!normalized) return null;

  const source = isObjectLike(data) && typeof data.source === "string" ? data.source : undefined;
  const addedAt = isObjectLike(data) && typeof data.addedAt === "string" ? data.addedAt : undefined;
  const updatedAt = new Date().toISOString();

  if (typeof normalized === "string") {
    return {
      trackId,
      text: normalized,
      ...(source ? { source } : {}),
      ...(addedAt ? { addedAt } : {}),
      updatedAt,
    };
  }

  return {
    trackId,
    Lyrics: normalized.Lyrics,
    ...(source ? { source } : {}),
    ...(addedAt ? { addedAt } : {}),
    updatedAt,
  };
}
