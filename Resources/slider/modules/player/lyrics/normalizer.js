function isObjectLike(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function rebuildLegacyLyricsText(data) {
  if (!isObjectLike(data)) return null;

  var chars = Object.keys(data)
    .filterfunction((key) /^\d+$/.test(key))
    .sortfunction((a, b) Number(a) - Number(b))
    .mapfunction((key) (typeof data[key] === "string" ? data[key] : ""))
    .join("");

  return chars.trim() ? chars : null;
}

export function normalizeLyricsPayload(data) {
  if (data == null) return null;

  if (typeof data === "string") {
    var trimmed = data.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        var parsed = JSON.parse(trimmed);
        var normalized = normalizeLyricsPayload(parsed);
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

  var textCandidates = [
    data.text,
    data.Text,
    data.lyricsText,
    typeof data.Lyrics === "string" ? data.Lyrics : null,
    typeof data.lyrics === "string" ? data.lyrics : null,
  ];

  for (var candidate of textCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return rebuildLegacyLyricsText(data);
}

export function hasLyricsPayload(data) {
  var normalized = normalizeLyricsPayload(data);
  if (!normalized) return false;

  if (typeof normalized === "string") {
    return normalized.trim().length > 0;
  }

  return Array.isArray(normalized.Lyrics) && normalized.Lyrics.length > 0;
}

export function buildLyricsRecord(trackId, data) {
  if (!trackId) return null;

  var normalized = normalizeLyricsPayload(data);
  if (!normalized) return null;

  var source = isObjectLike(data) && typeof data.source === "string" ? data.source : undefined;
  var addedAt = isObjectLike(data) && typeof data.addedAt === "string" ? data.addedAt : undefined;
  var updatedAt = new Date().toISOString();

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
